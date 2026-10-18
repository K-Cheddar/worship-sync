import crypto from "node:crypto";
import { normalizeUsPhoneNumber, smsConsentIdForChurchPhone } from "./smsConsent.js";
import { resolveSmsMemberEligibility } from "./smsEligibility.js";
import { encryptTeamIntakeRecipientToken, decryptTeamIntakeRecipientToken } from "./teamIntakeRecipientToken.js";

const HOUR = 60 * 60 * 1000;
const CODE_TTL = 10 * 60 * 1000;
const normalizeContact = (channel, value) => channel === "sms"
  ? normalizeUsPhoneNumber(value)
  : String(value || "").trim().toLowerCase();

export const createVolunteerRecovery = ({
  db, access, secret, memberCollection, consentCollection,
  sendCode, now = Date.now,
  collections = { proofs: "volunteerContactProofs", challenges: "volunteerRecoveryChallenges", limits: "volunteerRecoveryLimits" },
}) => {
  const hash = (kind, value) => crypto.createHmac("sha256", secret)
    .update(`volunteer-recovery/v1/${kind}:${value}`).digest("hex");
  const envelopeSecret = hash("envelope", "completion");
  const document = (kind, id) => db.collection(collections[kind]).doc(id);
  const proofId = (identity, channel) => hash("proof", JSON.stringify([identity.churchId, identity.memberId, channel]));
  const read = async (transaction, ref) => {
    const snapshot = transaction ? await transaction.get(ref) : await ref.get();
    return snapshot.exists ? snapshot.data() : null;
  };
  const contactHash = (channel, value) => hash("contact", `${channel}:${normalizeContact(channel, value)}`);
  const safeEqual = (a, b) => {
    const first = Buffer.from(String(a || "")); const second = Buffer.from(String(b || ""));
    return first.length > 0 && first.length === second.length && crypto.timingSafeEqual(first, second);
  };
  const eligible = async (identity, channel, transaction, requireProof = true) => {
    if (!identity?.churchId || !identity?.memberId || !["sms", "email"].includes(channel)) return null;
    const member = await read(transaction, db.collection(memberCollection).doc(identity.memberId));
    if (!member || member.churchId !== identity.churchId || member.archivedAt || (member.memberId && member.memberId !== identity.memberId)) return null;
    const state = await access.readState(identity, transaction);
    if (state?.revokedAt) return null;
    const address = normalizeContact(channel, channel === "sms" ? member.phoneNumber : member.email);
    if (!address || (channel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))) return null;
    // Read the church roster to also detect legacy formatted phone duplicates.
    const query = db.collection(memberCollection).where("churchId", "==", identity.churchId).limit(5000);
    const snapshot = transaction ? await transaction.get(query) : await query.get();
    if (snapshot.size >= 5000 || snapshot.docs.filter((row) => {
      const candidate = row.data();
      return !candidate.archivedAt && normalizeContact(channel, channel === "sms" ? candidate.phoneNumber : candidate.email) === address;
    }).length !== 1) return null;
    if (channel === "sms") {
      const consent = await read(transaction, db.collection(consentCollection).doc(smsConsentIdForChurchPhone(identity.churchId, address)));
      if (!resolveSmsMemberEligibility({ member, churchId: identity.churchId, consent }).eligible) return null;
    }
    const addressHash = contactHash(channel, address);
    const contactVersion = member.personalContactVersion || "";
    if (requireProof) {
      const proof = await read(transaction, document("proofs", proofId(identity, channel)));
      if (!proof?.verifiedAt || proof.contactHash !== addressHash || proof.contactVersion !== contactVersion) return null;
    }
    return { ...identity, channel, address, contactHash: addressHash, contactVersion, generation: state?.generation || 0 };
  };

  const candidateFor = async ({ token, contact, enrollment }) => {
    if (enrollment) return { identity: enrollment.identity, channel: enrollment.channel, purpose: "enrollment", actorUid: enrollment.actorUid };
    if (token) {
      const result = await access.validateCredential(token);
      if (result.status !== "expired") return null;
      for (const channel of ["sms", "email"]) {
        if (await eligible(result.candidate, channel, null)) return { identity: result.candidate, channel, purpose: "recovery" };
      }
      return null;
    }
    const channel = String(contact || "").includes("@") ? "email" : "sms";
    const address = normalizeContact(channel, contact);
    if (!address) return null;
    const proofs = await db.collection(collections.proofs).where("contactHash", "==", contactHash(channel, address)).limit(2).get();
    // A lost-link request never selects between churches or members.
    if (proofs.size !== 1) return null;
    const proof = proofs.docs[0].data();
    return { identity: { churchId: proof.churchId, memberId: proof.memberId }, channel, purpose: "recovery" };
  };

  const start = async ({ token, contact, requestKey, clientIp, enrollment }) => {
    if (!/^[A-Za-z0-9_-]{32,64}$/.test(String(requestKey || ""))) throw new Error("Invalid recovery request key.");
    const id = hash("request", requestKey);
    const challengeRef = document("challenges", id);
    const candidate = await candidateFor({ token, contact, enrollment });
    const code = String(crypto.randomInt(100000, 1000000));
    const result = await db.runTransaction(async (transaction) => {
      const previous = await read(transaction, challengeRef);
      if (previous) return { challengeId: id };
      const current = candidate ? await eligible(candidate.identity, candidate.channel, transaction, candidate.purpose !== "enrollment") : null;
      const budgetKeys = [["ip", clientIp || "unknown", 20]];
      if (current) budgetKeys.push(["contact", current.contactHash, 5],
        ["member", JSON.stringify([current.churchId, current.memberId]), 5], ["church", current.churchId, 200]);
      const budgets = [];
      for (const [kind, value, limit] of budgetKeys) {
        const ref = document("limits", hash(kind, value));
        const saved = await read(transaction, ref);
        const active = saved && now() - saved.windowStartedAt < HOUR;
        budgets.push({ ref, limit, count: active ? saved.count : 0,
          windowStartedAt: active ? saved.windowStartedAt : now(),
          cooldown: kind === "member" && saved?.nextSendAt > now() });
      }
      const allowed = budgets.every((budget) => budget.count < budget.limit && !budget.cooldown);
      // Always reserve the IP budget, including unknown/ambiguous requests.
      for (const budget of budgets) {
        if (budget === budgets[0] || (allowed && current)) transaction.set(budget.ref, {
          windowStartedAt: budget.windowStartedAt, count: Math.min(budget.count + 1, budget.limit), nextSendAt: now() + 60 * 1000,
        });
      }
      const active = Boolean(current && allowed);
      transaction.create(challengeRef, {
        active, purpose: candidate?.purpose || "recovery", createdAt: now(), expiresAt: now() + CODE_TTL,
        attempts: 0, consumedAt: null, delivery: active ? "pending" : "unavailable",
        ...(active ? { churchId: current.churchId, memberId: current.memberId,
          channel: current.channel, contactHash: current.contactHash, contactVersion: current.contactVersion,
          generation: current.generation, actorUid: candidate.actorUid || "",
          codeHash: hash("code", `${id}:${code}`) } : {}),
      });
      return { challengeId: id, ...(active ? { delivery: current } : {}) };
    });
    if (result.delivery) {
      // Reserve before provider work; an interrupted/uncertain request never
      // sends again when the same request key is retried.
      let delivery = "sent";
      try {
        const latest = await eligible(result.delivery, result.delivery.channel, null, candidate.purpose !== "enrollment");
        if (!latest || latest.contactHash !== result.delivery.contactHash || latest.contactVersion !== result.delivery.contactVersion) {
          delivery = "failed";
        } else await sendCode({ ...latest, code, challengeId: id });
      } catch (error) { delivery = error?.definitiveRejection ? "failed" : "uncertain"; }
      await challengeRef.update({ delivery }).catch(() => {});
    }
    // Same shape for eligible, unknown, ambiguous, revoked and throttled cases.
    return { success: true, challengeId: id };
  };

  const verify = async ({ challengeId, code, completionKey, enrollmentActorUid, enrollmentIdentity }) => {
    if (!/^[a-f0-9]{64}$/.test(String(challengeId || "")) || !/^[A-Za-z0-9_-]{32,64}$/.test(String(completionKey || ""))) return { success: false };
    return db.runTransaction(async (transaction) => {
      const challengeRef = document("challenges", challengeId);
      const challenge = await read(transaction, challengeRef);
      if (!challenge?.active || challenge.expiresAt <= now() || challenge.delivery === "failed") return { success: false };
      if (challenge.purpose === "enrollment" && (!enrollmentActorUid || challenge.actorUid !== enrollmentActorUid)) return { success: false };
      if (challenge.purpose === "enrollment" && (challenge.churchId !== enrollmentIdentity?.churchId || challenge.memberId !== enrollmentIdentity?.memberId)) return { success: false };
      if (challenge.purpose !== "enrollment" && enrollmentActorUid) return { success: false };
      const current = await eligible(challenge, challenge.channel, transaction, challenge.purpose !== "enrollment");
      if (!current || current.contactHash !== challenge.contactHash || current.contactVersion !== challenge.contactVersion) return { success: false };
      const completionHash = hash("completion", completionKey);
      if (challenge.consumedAt) {
        if (!safeEqual(challenge.completionHash, completionHash)) return { success: false };
        if (challenge.purpose === "enrollment") return { success: true };
        const restored = decryptTeamIntakeRecipientToken(challenge.completionEnvelope, envelopeSecret);
        if (!restored) return { success: false };
        const result = JSON.parse(restored);
        if (!await access.readSession(result.session, transaction)) return { success: false };
        return { success: true, ...result };
      }
      if (challenge.attempts >= 5) return { success: false };
      if (!safeEqual(hash("code", `${challengeId}:${String(code || "")}`), challenge.codeHash)) {
        transaction.update(challengeRef, { attempts: challenge.attempts + 1 });
        return { success: false };
      }
      if (current.generation !== challenge.generation) return { success: false };
      if (challenge.purpose === "enrollment") {
        transaction.set(document("proofs", proofId(current, current.channel)), {
          churchId: current.churchId, memberId: current.memberId, channel: current.channel,
          contactHash: current.contactHash, contactVersion: current.contactVersion,
          verifiedAt: now(), verifiedByUid: enrollmentActorUid, method: "independent_otp",
        });
        transaction.update(challengeRef, { consumedAt: now(), completionHash, codeHash: null });
        return { success: true };
      }
      const result = await access.recover(transaction, current, challenge.generation);
      transaction.update(challengeRef, { consumedAt: now(), completionHash, codeHash: null,
        completionEnvelope: encryptTeamIntakeRecipientToken(JSON.stringify(result), envelopeSecret) });
      return { success: true, ...result };
    });
  };
  return { start, verify };
};
