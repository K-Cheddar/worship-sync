import crypto from "node:crypto";

export const DEFAULT_VOLUNTEER_ACCESS_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const TOKEN_PATTERN = /^v_[A-Za-z0-9_-]{32}$/;
const SESSION_PATTERN = /^vs_[A-Za-z0-9_-]{32}$/;
const randomToken = (prefix) => `${prefix}${crypto.randomBytes(24).toString("base64url")}`;

// Server-only credential storage; missing security configuration fails closed.
export const createVolunteerPersonalAccess = ({
  db, memberCollection, secret,
  collections = {
    access: "volunteerPersonalAccess", credentials: "volunteerPersonalCredentials",
    sessions: "volunteerPersonalSessions",
  },
  ttlMs = DEFAULT_VOLUNTEER_ACCESS_TTL_MS,
  now = Date.now,
}) => {
  if (!db || typeof secret !== "string" || secret.length < 32) {
    throw Object.assign(new Error("Personal access requires Firestore and a dedicated secret of at least 32 characters."), { status: 503 });
  }
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw Object.assign(new Error("Invalid personal access lifetime."), { status: 503 });
  const digest = (purpose, value) => crypto.createHmac("sha256", secret)
    .update(`worshipsync/volunteer/v1/${purpose}:${value}`).digest("hex");
  const encryptionKey = crypto.createHash("sha256").update(`volunteer-credential-envelope:${secret}`).digest();
  const envelopeScope = (identity, credentialDigest, generation) => JSON.stringify([
    "worshipsync/personal-credential", 2, identity.churchId, identity.memberId, credentialDigest, generation,
  ]);
  const encrypt = (token, scope) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
    cipher.setAAD(Buffer.from(scope));
    const value = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    return ["v2", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), value.toString("base64url")].join(".");
  };
  const decrypt = (envelope, scope, legacyScope) => {
    try {
      const parts = String(envelope || "").split(".");
      const [version, iv, tag, value] = parts;
      if (parts.length !== 4 || !["v1", "v2"].includes(version) ||
          ![iv, tag, value].every((part) => /^[A-Za-z0-9_-]+$/.test(part || "")) ||
          Buffer.from(iv, "base64url").length !== 12 || Buffer.from(tag, "base64url").length !== 16) return null;
      const cipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(iv, "base64url"));
      cipher.setAAD(Buffer.from(version === "v1" ? legacyScope : scope));
      cipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([cipher.update(Buffer.from(value, "base64url")), cipher.final()]).toString("utf8");
    } catch { return null; }
  };
  const scopeId = ({ churchId, memberId }) => crypto.createHash("sha256")
    .update(`worshipsync/volunteer/access/v2:${JSON.stringify([churchId, memberId])}`).digest("hex");
  const sameScope = (first, second) => first?.churchId === second?.churchId && first?.memberId === second?.memberId;
  const validIdentity = (identity) => [identity?.churchId, identity?.memberId].every((id) =>
    typeof id === "string" && id.length > 0 && id.length <= 160 && !id.includes("/"));
  const validAuthority = (record) => validIdentity(record) && Number.isSafeInteger(record.generation) &&
    record.generation > 0 && Number.isSafeInteger(record.issuedAt) && Number.isSafeInteger(record.expiresAt) &&
    record.expiresAt > record.issuedAt;
  const isRevoked = (state) => state?.revokedAt !== null && state?.revokedAt !== undefined;
  const ref = (kind, id) => db.collection(collections[kind]).doc(id);
  const read = async (transaction, document) => {
    const snapshot = transaction ? await transaction.get(document) : await document.get();
    return snapshot.exists ? snapshot.data() : null;
  };
  const accessRecord = async (transaction, identity) => {
    if (!validIdentity(identity)) throw accessError(404);
    const document = ref("access", scopeId(identity));
    const state = await read(transaction, document);
    if (state) {
      if (!sameScope(state, identity) || !Number.isSafeInteger(state.generation) || state.generation < 1 ||
          (state.credentialDigest && !/^[a-f0-9]{64}$/.test(state.credentialDigest))) throw accessError(503);
      return { document, state };
    }
    // Legacy IDs were HMAC-derived. Lookup by authoritative scope retains a
    // revocation even if the encryption secret changes. Never choose a duplicate.
    const query = db.collection(collections.access).where("churchId", "==", identity.churchId)
      .where("memberId", "==", identity.memberId).limit(2);
    const rows = transaction ? await transaction.get(query) : await query.get();
    if (rows.size > 1) throw accessError(503);
    if (rows.empty) return { document, state: null };
    const legacy = rows.docs[0].data();
    if (!Number.isSafeInteger(legacy.generation) || legacy.generation < 1) throw accessError(503);
    return { document: rows.docs[0].ref, state: legacy };
  };
  const recoverToken = (state, credential) => {
    const token = decrypt(state.credentialEnvelope,
      envelopeScope(credential, state.credentialDigest, credential.generation),
      digest("scope", JSON.stringify([credential.churchId, credential.memberId])));
    if (!TOKEN_PATTERN.test(token || "") || digest("credential", token) !== state.credentialDigest) throw accessError(503);
    return token;
  };
  const readMember = async (transaction, identity) => {
    if (!validIdentity(identity)) return null;
    const member = await read(transaction, db.collection(memberCollection).doc(identity.memberId));
    return member && member.churchId === identity.churchId && !member.archivedAt &&
      (!member.memberId || member.memberId === identity.memberId) ? member : null;
  };
  const accessError = (status) => Object.assign(new Error("Personal access is unavailable."), { status });

  const validateCredential = async (token, transaction = null) => {
    if (!transaction) return db.runTransaction((tx) => validateCredential(token, tx));
    if (!TOKEN_PATTERN.test(String(token || ""))) return { status: "invalid" };
    const credentialDigest = digest("credential", token);
    const credential = await read(transaction, ref("credentials", credentialDigest));
    if (!credential) return { status: "invalid" };
    if (!validAuthority(credential)) return { status: "invalid" };
    const { state } = await accessRecord(transaction, credential);
    if (!state || isRevoked(state)) return { status: isRevoked(state) ? "revoked" : "invalid" };
    if (state.generation !== credential.generation || state.credentialDigest !== credentialDigest) return { status: "invalid" };
    if (!await readMember(transaction, credential)) return { status: "invalid" };
    if (credential.expiresAt <= now()) {
      // Internal recovery candidate only. Expiration never authorizes data.
      return { status: "expired", candidate: {
        churchId: credential.churchId, memberId: credential.memberId,
      } };
    }
    return { status: "active", identity: {
      churchId: credential.churchId, memberId: credential.memberId,
      accessType: "personal-volunteer-credential", generation: credential.generation, credentialDigest, expiresAt: credential.expiresAt,
    } };
  };

  // Intentional preparation only: never call from a page read. The encrypted
  // envelope permits exact reuse in later explicitly approved notifications.
  const prepare = async (identity, { replace = false, actorUid, requestKey } = {}) => {
    if (!validIdentity(identity)) throw accessError(404);
    if (replace && !/^[A-Za-z0-9_-]{16,128}$/.test(String(requestKey || ""))) throw accessError(400);
    return db.runTransaction(async (transaction) => {
      if (!await readMember(transaction, identity)) throw accessError(404);
      const { document: stateRef, state: current } = await accessRecord(transaction, identity);
      if (isRevoked(current)) throw accessError(403);
      const receiptRef = replace ? stateRef.collection("lifecycleRequests").doc(
        crypto.createHash("sha256").update(`replace:${requestKey}`).digest("hex")) : null;
      const receipt = receiptRef ? await read(transaction, receiptRef) : null;
      if (receipt && (receipt.generation !== current?.generation || receipt.credentialDigest !== current?.credentialDigest ||
          receipt.actorUid !== (actorUid || ""))) throw accessError(409);
      const credential = current?.credentialDigest ? await read(transaction, ref("credentials", current.credentialDigest)) : null;
      const active = credential && validAuthority(credential) && sameScope(credential, identity) &&
        credential.generation === current.generation && credential.expiresAt > now();
      if (receipt && !active) throw accessError(409);
      if ((!replace || receipt) && active) {
        // An unreadable envelope is an operational error, never consent to replace.
        const token = recoverToken(current, credential);
        if (current.credentialEnvelope.startsWith("v1.")) transaction.update(stateRef, {
          credentialEnvelope: encrypt(token, envelopeScope(identity, current.credentialDigest, credential.generation)),
        });
        return { token, expiresAt: credential.expiresAt, reused: true, generation: credential.generation };
      }
      if (!replace && current?.credentialDigest && (!credential || !validAuthority(credential) || !sameScope(credential, identity) ||
          credential.generation !== current.generation)) throw accessError(503);
      const token = randomToken("v_");
      const credentialDigest = digest("credential", token);
      const generation = (current?.generation || 0) + 1;
      const issuedAt = now();
      const expiresAt = issuedAt + ttlMs;
      if (!Number.isSafeInteger(expiresAt) || !Number.isSafeInteger(generation)) throw accessError(503);
      const credentialRecord = { churchId: identity.churchId, memberId: identity.memberId,
        generation, issuedAt, expiresAt, issuedByUid: actorUid || "" };
      transaction.create(ref("credentials", credentialDigest), credentialRecord);
      transaction.set(stateRef, { churchId: identity.churchId, memberId: identity.memberId,
        generation, credentialDigest, credentialEnvelope: encrypt(token, envelopeScope(identity, credentialDigest, generation)),
        revokedAt: null, updatedAt: issuedAt, updatedByUid: actorUid || "", lastAction: replace ? "replaced" : "prepared" });
      if (receiptRef) transaction.create(receiptRef, { generation, credentialDigest, actorUid: actorUid || "", createdAt: issuedAt });
      return { token, expiresAt, reused: false, generation };
    });
  };

  const changeRevocation = async (identity, revoked, actorUid) => db.runTransaction(async (transaction) => {
    if (!await readMember(transaction, identity)) throw accessError(404);
    const { document, state: current } = await accessRecord(transaction, identity);
    // Idempotent lost-response retries cannot advance a restored generation.
    if (revoked === isRevoked(current)) return;
    // Restoration is explicit, and never reactivates any old credential.
    transaction.set(document, {
      churchId: identity.churchId, memberId: identity.memberId,
      generation: (current?.generation || 0) + 1,
      credentialDigest: "", credentialEnvelope: "",
      revokedAt: revoked ? now() : null,
      updatedAt: now(), updatedByUid: actorUid || "",
      lastAction: revoked ? "revoked" : "restored",
    });
  });

  const redeem = async (token) => db.runTransaction(async (transaction) => {
    const validated = await validateCredential(token, transaction);
    if (validated.status !== "active") return validated;
    const session = randomToken("vs_");
    const sessionDigest = digest("session", session);
    transaction.create(ref("sessions", sessionDigest), {
      ...validated.identity, createdAt: now(),
    });
    return { status: "active", session, expiresAt: validated.identity.expiresAt };
  });

  const readSession = async (session, transaction = null) => {
    if (!transaction) return db.runTransaction((tx) => readSession(session, tx));
    if (!SESSION_PATTERN.test(String(session || ""))) return null;
    const sessionDigest = digest("session", session);
    const stored = await read(transaction, ref("sessions", sessionDigest));
    if (!stored || stored.expiresAt <= now()) return null;
    if (!validIdentity(stored) || !Number.isSafeInteger(stored.expiresAt)) return null;
    const { state } = await accessRecord(transaction, stored);
    if (!state || isRevoked(state) || state.generation !== stored.generation ||
        state.credentialDigest !== stored.credentialDigest) return null;
    const credential = await read(transaction, ref("credentials", stored.credentialDigest));
    if (!credential || !validAuthority(credential) || credential.expiresAt <= now() || credential.generation !== stored.generation ||
        credential.churchId !== stored.churchId || credential.memberId !== stored.memberId ||
        !await readMember(transaction, stored)) return null;
    return {
      accessType: "personal-volunteer-credential", generation: stored.generation, credentialDigest: stored.credentialDigest,
      churchId: stored.churchId, memberId: stored.memberId, expiresAt: Math.min(stored.expiresAt, credential.expiresAt),
      csrfToken: digest("csrf", session),
    };
  };

  // Called only after a verified, single-use recovery challenge has been read
  // and checked in this transaction. Consumption is written by that caller.
  const recover = async (transaction, identity, expectedGeneration) => {
    if (!await readMember(transaction, identity)) throw accessError(404);
    const { document: stateRef, state: current } = await accessRecord(transaction, identity);
    if (isRevoked(current) || (current?.generation || 0) !== expectedGeneration) throw accessError(403);
    const token = randomToken("v_");
    const session = randomToken("vs_");
    const credentialDigest = digest("credential", token);
    const generation = expectedGeneration + 1;
    const issuedAt = now();
    const expiresAt = issuedAt + ttlMs;
    if (!Number.isSafeInteger(expiresAt) || !Number.isSafeInteger(generation)) throw accessError(503);
    const principal = { churchId: identity.churchId, memberId: identity.memberId,
      credentialDigest, generation, expiresAt };
    transaction.create(ref("credentials", credentialDigest), {
      churchId: identity.churchId, memberId: identity.memberId,
      generation, issuedAt, expiresAt, issuedByUid: "verified-recovery",
    });
    transaction.set(stateRef, { ...principal, credentialEnvelope: encrypt(token, envelopeScope(identity, credentialDigest, generation)),
      revokedAt: null, updatedAt: issuedAt, updatedByUid: "verified-recovery", lastAction: "recovered" });
    transaction.create(ref("sessions", digest("session", session)), { ...principal, createdAt: issuedAt });
    return { token, session, expiresAt };
  };

  return {
    prepare, validateCredential, redeem, readSession, recover,
    readState: async (identity, transaction) => (await accessRecord(transaction, identity)).state,
    current: async (identity) => {
      const { state } = await accessRecord(null, identity);
      if (!state || isRevoked(state) || !state.credentialDigest) return null;
      const credential = await read(null, ref("credentials", state.credentialDigest));
      if (!credential || !validAuthority(credential) || !sameScope(credential, identity) ||
          credential.generation !== state.generation) throw accessError(503);
      if (credential.expiresAt <= now()) return null;
      const token = recoverToken(state, credential);
      const validated = await validateCredential(token);
      return validated.status === "active" ? { token, ...validated.identity } : null;
    },
    revoke: (identity, actorUid) => changeRevocation(identity, true, actorUid),
    restore: (identity, actorUid) => changeRevocation(identity, false, actorUid),
  };
};
