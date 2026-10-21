import crypto from "node:crypto";

export const DEFAULT_VOLUNTEER_ACCESS_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const TOKEN_PATTERN = /^v_[A-Za-z0-9_-]{32}$/;
const SESSION_PATTERN = /^vs_[A-Za-z0-9_-]{32}$/;
const randomToken = (prefix) => `${prefix}${crypto.randomBytes(24).toString("base64url")}`;

// Server-only credential storage. Route activation uses the explicit portal gate.
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
    throw new Error("Personal access requires Firestore and a dedicated secret of at least 32 characters.");
  }
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error("Invalid personal access lifetime.");
  const digest = (purpose, value) => crypto.createHmac("sha256", secret)
    .update(`worshipsync/volunteer/v1/${purpose}:${value}`).digest("hex");
  const encryptionKey = crypto.createHash("sha256").update(`volunteer-credential-envelope:${secret}`).digest();
  const encrypt = (token, scope) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
    cipher.setAAD(Buffer.from(scope));
    const value = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), value.toString("base64url")].join(".");
  };
  const decrypt = (envelope, scope) => {
    try {
      const [version, iv, tag, value] = String(envelope || "").split(".");
      if (version !== "v1") return null;
      const cipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(iv, "base64url"));
      cipher.setAAD(Buffer.from(scope));
      cipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([cipher.update(Buffer.from(value, "base64url")), cipher.final()]).toString("utf8");
    } catch { return null; }
  };
  const scopeId = ({ churchId, memberId }) => digest("scope", JSON.stringify([churchId, memberId]));
  const ref = (kind, id) => db.collection(collections[kind]).doc(id);
  const read = async (transaction, document) => {
    const snapshot = transaction ? await transaction.get(document) : await document.get();
    return snapshot.exists ? snapshot.data() : null;
  };
  const readMember = async (transaction, identity) => {
    if (!identity.churchId || !identity.memberId) return null;
    const member = await read(transaction, db.collection(memberCollection).doc(identity.memberId));
    return member && member.churchId === identity.churchId && !member.archivedAt &&
      (!member.memberId || member.memberId === identity.memberId) ? member : null;
  };
  const accessError = (status) => Object.assign(new Error("Personal access is unavailable."), { status });

  const validateCredential = async (token, transaction = null) => {
    if (!TOKEN_PATTERN.test(String(token || ""))) return { status: "invalid" };
    const credentialDigest = digest("credential", token);
    const credential = await read(transaction, ref("credentials", credentialDigest));
    if (!credential) return { status: "invalid" };
    const state = await read(transaction, ref("access", scopeId(credential)));
    if (!state || state.revokedAt) return { status: state?.revokedAt ? "revoked" : "invalid" };
    if (!await readMember(transaction, credential)) return { status: "invalid" };
    if (credential.expiresAt <= now()) {
      // Internal recovery candidate only. Expiration never authorizes data.
      return { status: "expired", candidate: {
        churchId: credential.churchId, memberId: credential.memberId,
      } };
    }
    if (state.generation !== credential.generation || state.credentialDigest !== credentialDigest) {
      return { status: "invalid" };
    }
    return { status: "active", identity: {
      churchId: credential.churchId, memberId: credential.memberId,
      generation: credential.generation, credentialDigest, expiresAt: credential.expiresAt,
    } };
  };

  // Intentional preparation only: never call from a page read. The encrypted
  // envelope permits exact reuse in later explicitly approved notifications.
  const prepare = async (identity, { replace = false, actorUid } = {}) => db.runTransaction(async (transaction) => {
    if (!await readMember(transaction, identity)) throw accessError(404);
    const scope = scopeId(identity);
    const stateRef = ref("access", scope);
    const current = await read(transaction, stateRef);
    if (current?.revokedAt) throw accessError(403);
    if (!replace && current?.credentialDigest) {
      const credential = await read(transaction, ref("credentials", current.credentialDigest));
      const token = decrypt(current.credentialEnvelope, scope);
      if (credential?.expiresAt > now() && credential.generation === current.generation &&
          token && digest("credential", token) === current.credentialDigest) {
        return { token, expiresAt: credential.expiresAt, reused: true };
      }
    }
    const token = randomToken("v_");
    const credentialDigest = digest("credential", token);
    const generation = (current?.generation || 0) + 1;
    const issuedAt = now();
    const expiresAt = issuedAt + ttlMs;
    const credential = {
      churchId: identity.churchId, memberId: identity.memberId,
      generation, issuedAt, expiresAt, issuedByUid: actorUid || "",
    };
    transaction.create(ref("credentials", credentialDigest), credential);
    transaction.set(stateRef, {
      churchId: identity.churchId, memberId: identity.memberId,
      generation, credentialDigest, credentialEnvelope: encrypt(token, scope),
      revokedAt: null, updatedAt: issuedAt, updatedByUid: actorUid || "",
      lastAction: replace ? "replaced" : "prepared",
    });
    return { token, expiresAt, reused: false };
  });

  const changeRevocation = async (identity, revoked, actorUid) => db.runTransaction(async (transaction) => {
    if (!await readMember(transaction, identity)) throw accessError(404);
    const document = ref("access", scopeId(identity));
    const current = await read(transaction, document);
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
    if (!SESSION_PATTERN.test(String(session || ""))) return null;
    const sessionDigest = digest("session", session);
    const stored = await read(transaction, ref("sessions", sessionDigest));
    if (!stored || stored.expiresAt <= now()) return null;
    const state = await read(transaction, ref("access", scopeId(stored)));
    if (!state || state.revokedAt || state.generation !== stored.generation ||
        state.credentialDigest !== stored.credentialDigest) return null;
    const credential = await read(transaction, ref("credentials", stored.credentialDigest));
    if (!credential || credential.expiresAt <= now() || credential.generation !== stored.generation ||
        credential.churchId !== stored.churchId || credential.memberId !== stored.memberId ||
        !await readMember(transaction, stored)) return null;
    return {
      churchId: stored.churchId, memberId: stored.memberId, expiresAt: stored.expiresAt,
      csrfToken: digest("csrf", session),
    };
  };

  // Called only after a verified, single-use recovery challenge has been read
  // and checked in this transaction. Consumption is written by that caller.
  const recover = async (transaction, identity, expectedGeneration) => {
    if (!await readMember(transaction, identity)) throw accessError(404);
    const scope = scopeId(identity);
    const stateRef = ref("access", scope);
    const current = await read(transaction, stateRef);
    if (current?.revokedAt || (current?.generation || 0) !== expectedGeneration) throw accessError(403);
    const token = randomToken("v_");
    const session = randomToken("vs_");
    const credentialDigest = digest("credential", token);
    const generation = expectedGeneration + 1;
    const issuedAt = now();
    const expiresAt = issuedAt + ttlMs;
    const principal = { churchId: identity.churchId, memberId: identity.memberId,
      credentialDigest, generation, expiresAt };
    transaction.create(ref("credentials", credentialDigest), {
      churchId: identity.churchId, memberId: identity.memberId,
      generation, issuedAt, expiresAt, issuedByUid: "verified-recovery",
    });
    transaction.set(stateRef, { ...principal, credentialEnvelope: encrypt(token, scope),
      revokedAt: null, updatedAt: issuedAt, updatedByUid: "verified-recovery", lastAction: "recovered" });
    transaction.create(ref("sessions", digest("session", session)), { ...principal, createdAt: issuedAt });
    return { token, session, expiresAt };
  };

  return {
    prepare, validateCredential, redeem, readSession, recover,
    readState: (identity, transaction) => read(transaction, ref("access", scopeId(identity))),
    current: async (identity) => {
      const scope = scopeId(identity);
      const state = await read(null, ref("access", scope));
      const token = decrypt(state?.credentialEnvelope, scope);
      if (!token) return null;
      const validated = await validateCredential(token);
      return validated.status === "active" ? { token, ...validated.identity } : null;
    },
    revoke: (identity, actorUid) => changeRevocation(identity, true, actorUid),
    restore: (identity, actorUid) => changeRevocation(identity, false, actorUid),
  };
};
