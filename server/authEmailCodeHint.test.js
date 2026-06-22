/**
 * Email code hint regression tests. Uses in-memory auth only (no Firestore writes).
 */
process.env.WORSHIPSYNC_SERVER_TEST_SUPPORT = "1";

import test from "node:test";
import assert from "node:assert/strict";

const {
  authHandlers,
  canSeedHumanBearerAuthForServerTests,
  seedEmailCodeChallengeForServerTests,
} = await import("../authService.js");

const createReq = ({
  body = {},
  ip = "127.0.0.1",
  socketRemoteAddress,
} = {}) => ({
  body,
  headers: {},
  session: {},
  ip,
  socket: {
    remoteAddress: socketRemoteAddress === undefined ? ip : socketRemoteAddress,
  },
});

const createRes = () => {
  const res = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  return res;
};

const callEmailCodeHint = async (body, reqOptions = {}) => {
  const req = createReq({ body, ...reqOptions });
  const res = createRes();
  await authHandlers.getEmailCodeHint(req, res);
  return res;
};

const skipUnlessInMemoryAuth = (t) => {
  if (!canSeedHumanBearerAuthForServerTests()) {
    t.skip(
      "email code hint seed uses in-memory auth only (skip when Firestore is configured)",
    );
    return true;
  }
  return false;
};

test("getEmailCodeHint returns verificationEmail for an active challenge", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;

  const { pendingAuthId, verificationEmail } =
    await seedEmailCodeChallengeForServerTests({
      userId: "user_hint_active",
      email: "operator@example.com",
    });

  const res = await callEmailCodeHint({ pendingAuthId });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload?.success, true);
  assert.equal(res.payload?.verificationEmail, verificationEmail);
  assert.equal(res.payload?.verificationEmail, "operator@example.com");
});

test("getEmailCodeHint prefers primaryEmail over email", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;

  const { pendingAuthId } = await seedEmailCodeChallengeForServerTests({
    userId: "user_hint_primary",
    email: "alias@example.com",
    primaryEmail: "primary@example.com",
  });

  const res = await callEmailCodeHint({ pendingAuthId });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload?.verificationEmail, "primary@example.com");
});

test("getEmailCodeHint rejects missing pendingAuthId", async () => {
  const res = await callEmailCodeHint({});

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload?.success, false);
  assert.match(res.payload?.errorMessage || "", /pending sign-in is required/i);
});

test("getEmailCodeHint rejects unknown pendingAuthId", async () => {
  const res = await callEmailCodeHint({
    pendingAuthId: "pending_missing_test_id",
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload?.success, false);
  assert.match(res.payload?.errorMessage || "", /sign in again/i);
});

test("getEmailCodeHint rejects expired challenges", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;

  const { pendingAuthId } = await seedEmailCodeChallengeForServerTests({
    userId: "user_hint_expired",
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  });

  const res = await callEmailCodeHint({ pendingAuthId });

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload?.success, false);
  assert.match(res.payload?.errorMessage || "", /sign in again/i);
});

test("getEmailCodeHint rejects locked challenges", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;

  const { pendingAuthId } = await seedEmailCodeChallengeForServerTests({
    userId: "user_hint_locked",
    lockedAt: new Date().toISOString(),
  });

  const res = await callEmailCodeHint({ pendingAuthId });

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload?.success, false);
  assert.match(res.payload?.errorMessage || "", /sign in again/i);
});

test("getEmailCodeHint rejects when challenge user record is missing", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;

  const { pendingAuthId } = await seedEmailCodeChallengeForServerTests({
    userId: "user_hint_orphan",
    includeUser: false,
  });

  const res = await callEmailCodeHint({ pendingAuthId });

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload?.success, false);
  assert.match(res.payload?.errorMessage || "", /sign in again/i);
});

test("getEmailCodeHint rate limits repeated lookups for the same pending id", async () => {
  const pendingAuthId = "pending_rate_limit_test_id";
  const reqOptions = { ip: "203.0.113.51" };

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const res = await callEmailCodeHint({ pendingAuthId }, reqOptions);
    assert.notEqual(
      res.statusCode,
      429,
      `expected rate limit not to trigger before attempt ${attempt + 1}`,
    );
  }

  const blocked = await callEmailCodeHint({ pendingAuthId }, reqOptions);
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.payload?.success, false);
  assert.match(blocked.payload?.errorMessage || "", /too many attempts/i);
});
