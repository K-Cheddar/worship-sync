import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createVolunteerPersonalAccess, DEFAULT_VOLUNTEER_ACCESS_TTL_MS } from "./volunteerPersonalAccess.js";
import { createVolunteerRecovery } from "./volunteerRecovery.js";
import { smsConsentIdForChurchPhone } from "./smsConsent.js";
const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const key = () => crypto.randomBytes(24).toString("base64url");
const fixture = async (task) => {
  const suffix = crypto.randomUUID();
  const app = initializeApp({ projectId: "demo-worshipsync" }, `recovery-${suffix}`);
  const db = getFirestore(app);
  const memberCollection = `recovery_${suffix}_members`;
  const consentCollection = `recovery_${suffix}_consents`;
  const accessCollections = Object.fromEntries(["access", "credentials", "sessions"].map((name) => [name, `recovery_${suffix}_${name}`]));
  const collections = Object.fromEntries(["proofs", "challenges", "limits"].map((name) => [name, `recovery_${suffix}_${name}`]));
  const secret = "synthetic-independent-recovery-test-secret-only";
  let time = Date.parse("2026-10-18T12:00:00Z");
  const identity = { churchId: "church", memberId: "member" };
  const memberRef = db.collection(memberCollection).doc(identity.memberId);
  const member = { ...identity, email: "volunteer@example.test", phoneNumber: "+12125550123", archivedAt: null };
  const deliveries = [];
  const access = createVolunteerPersonalAccess({ db, memberCollection, secret, collections: accessCollections, now: () => time });
  const recovery = createVolunteerRecovery({ db, access, secret, memberCollection, consentCollection, collections,
    now: () => time, sendCode: async (delivery) => { deliveries.push(delivery); } });
  const start = (body = {}) => recovery.start({ requestKey: key(), clientIp: "127.0.0.1", ...body });
  const enroll = async (channel = "email") => {
    const challenge = await start({ enrollment: { identity, channel, actorUid: "admin" } });
    const result = await recovery.verify({ challengeId: challenge.challengeId, code: deliveries.at(-1)?.code,
      completionKey: key(), enrollmentActorUid: "admin", enrollmentIdentity: identity });
    assert.equal(result.success, true);
  };
  const expire = () => { time += DEFAULT_VOLUNTEER_ACCESS_TTL_MS + 1; };
  try {
    await memberRef.set(member);
    await task({ db, identity, member, memberRef, memberCollection, consentCollection, access, recovery,
      start, enroll, expire, deliveries, collections, secret, now: () => time, advance: (ms) => { time += ms; } });
  } finally {
    await Promise.all([memberCollection, consentCollection, ...Object.values(collections), ...Object.values(accessCollections)]
      .map((name) => db.recursiveDelete(db.collection(name))));
    await db.terminate(); await deleteApp(app);
  }
};

test("verified recovery atomically renews expired access and lost-success retry returns the same session", { skip: !enabled }, async () => fixture(async ({ access, identity, enroll, expire, start, recovery, deliveries }) => {
  const original = await access.prepare(identity);
  await enroll();
  expire();
  const challenge = await start({ token: original.token });
  const request = { challengeId: challenge.challengeId, code: deliveries.at(-1).code, completionKey: key() };
  const results = await Promise.all([recovery.verify(request), recovery.verify(request)]);
  assert.equal(results[0].success, true);
  assert.equal(results[1].session, results[0].session);
  assert.equal((await access.readSession(results[0].session)).memberId, identity.memberId);
  assert.notEqual((await access.validateCredential(original.token)).status, "active");
  assert.equal((await recovery.verify({ ...request, completionKey: key() })).success, false);
}));

test("unverified, shared, changed and revoked contacts cannot recover and unknown contacts have the same result shape", { skip: !enabled }, async () => fixture(async ({ access, identity, memberRef, member, memberCollection, db, enroll, expire, start, deliveries }) => {
  const original = await access.prepare(identity);
  expire();
  const unknown = await start({ contact: "unknown@example.test" });
  const unverified = await start({ token: original.token });
  assert.deepEqual(Object.keys(unknown), Object.keys(unverified));
  assert.equal(deliveries.length, 0);
  await enroll();
  const count = deliveries.length;
  await db.collection(memberCollection).doc("shared").set({ ...member, memberId: "shared" });
  await start({ contact: member.email });
  assert.equal(deliveries.length, count);
  await db.collection(memberCollection).doc("shared").delete();
  await memberRef.update({ personalContactVersion: "contact-changed-and-restored" });
  await start({ contact: member.email });
  assert.equal(deliveries.length, count);
  await access.revoke(identity, "admin");
  await start({ token: original.token });
  assert.equal(deliveries.length, count);
}));

test("verification enforces five attempts, expiry and current contact state", { skip: !enabled }, async () => fixture(async ({ access, identity, enroll, expire, start, recovery, deliveries, advance, memberRef }) => {
  const original = await access.prepare(identity); await enroll(); expire();
  const challenge = await start({ token: original.token });
  const code = deliveries.at(-1).code;
  const common = { challengeId: challenge.challengeId, completionKey: key() };
  for (let count = 0; count < 5; count += 1) assert.equal((await recovery.verify({ ...common, code: "wrong" })).success, false);
  assert.equal((await recovery.verify({ ...common, code })).success, false);
  advance(60 * 1000);
  const expired = await start({ token: original.token });
  advance(10 * 60 * 1000);
  assert.equal((await recovery.verify({ challengeId: expired.challengeId, code: deliveries.at(-1).code, completionKey: key() })).success, false);
  const changed = await start({ token: original.token });
  await memberRef.update({ email: "new@example.test" });
  assert.equal((await recovery.verify({ challengeId: changed.challengeId, code: deliveries.at(-1).code, completionKey: key() })).success, false);
}));

test("durable recovery reservation prevents duplicate sends, cooldown bypass and more than five hourly sends", { skip: !enabled }, async () => fixture(async ({ access, identity, enroll, expire, start, deliveries, advance }) => {
  const original = await access.prepare(identity); await enroll(); expire();
  const requestKey = key();
  const first = await start({ token: original.token, requestKey });
  const retry = await start({ token: original.token, requestKey });
  assert.equal(first.challengeId, retry.challengeId);
  assert.equal(deliveries.length, 2);
  await start({ token: original.token });
  assert.equal(deliveries.length, 2);
  for (let count = 0; count < 4; count += 1) { advance(60 * 1000); await start({ token: original.token }); }
  assert.equal(deliveries.length, 6);
  advance(60 * 1000); await start({ token: original.token, clientIp: "another-ip" });
  assert.equal(deliveries.length, 6);
}));

test("SMS recovery requires independent proof and current consent; STOP after sending blocks verification", { skip: !enabled }, async () => fixture(async ({ db, access, identity, member, consentCollection, enroll, expire, start, recovery, deliveries }) => {
  const consentRef = db.collection(consentCollection).doc(smsConsentIdForChurchPhone(identity.churchId, member.phoneNumber));
  await consentRef.set({ churchId: identity.churchId, phoneNumber: member.phoneNumber, status: "opted_in" });
  const original = await access.prepare(identity); expire();
  await start({ token: original.token });
  assert.equal(deliveries.length, 0);
  await enroll("sms");
  // Enrollment shares the durable cooldown with recovery.
  expire();
  const challenge = await start({ token: original.token });
  assert.equal(deliveries.at(-1).channel, "sms");
  await consentRef.update({ status: "opted_out", optedOutAt: "now" });
  assert.equal((await recovery.verify({ challengeId: challenge.challengeId, code: deliveries.at(-1).code, completionKey: key() })).success, false);
}));

test("durable IP and church budgets allow their final send and reject the next reservation", { skip: !enabled }, async () => {
  for (const [kind, value, limit] of [["ip", "127.0.0.1", 20], ["church", "church", 200]]) {
    await fixture(async ({ db, collections, secret, now, enroll, advance, start, identity, deliveries }) => {
      const id = crypto.createHmac("sha256", secret).update(`volunteer-recovery/v1/${kind}:${value}`).digest("hex");
      await db.collection(collections.limits).doc(id).set({ count: limit - 1, windowStartedAt: now(), nextSendAt: 0 });
      await enroll();
      assert.equal(deliveries.length, 1);
      advance(61_000);
      await start({ enrollment: { identity, channel: "email", actorUid: "admin" } });
      assert.equal(deliveries.length, 1);
      assert.equal((await db.collection(collections.limits).doc(id).get()).data().count, limit);
    });
  }
});
