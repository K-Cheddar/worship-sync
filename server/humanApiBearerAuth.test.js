/**
 * Human API bearer regression tests. Sets WORSHIPSYNC_SERVER_TEST_SUPPORT for seed helpers.
 * Positive-path cases skip when Firestore is configured: seeding uses in-memory Maps only
 * so we never write disposable test rows to a real project (see authService seed helper).
 */
process.env.WORSHIPSYNC_SERVER_TEST_SUPPORT = "1";

import test from "node:test";
import assert from "node:assert/strict";

const {
  authHandlers,
  authRuntimeInfo,
  resolveRequestBootstrap,
  seedActiveHumanBearerForServerTests,
  canSeedHumanBearerAuthForServerTests,
} = await import("../authService.js");

const createReq = ({ headers = {}, session = null, body = {} } = {}) => {
  const sess =
    session ||
    Object.assign(
      {},
      {
        destroy(callback) {
          callback?.();
        },
      },
    );
  return { headers, session: sess, body };
};

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
    set() {
      return this;
    },
    clearCookie() {
      return this;
    },
  };
  return res;
};

test("getAuthMe returns unauthenticated for unknown Bearer token", async () => {
  const res = createRes();
  await authHandlers.getAuthMe(
    createReq({ headers: { authorization: "Bearer wsh_invalidtoken" } }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload?.authenticated, false);
});

test("createSharedDataToken returns 401 for unknown Bearer token", async () => {
  const res = createRes();
  await authHandlers.createSharedDataToken(
    createReq({ headers: { authorization: "Bearer wsh_invalidtoken" } }),
    res,
  );
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload?.success, false);
});

const skipUnlessHumanBearerSeedInMemory = (t) => {
  if (!canSeedHumanBearerAuthForServerTests()) {
    t.skip(
      "human bearer seed uses in-memory auth only (skip when Firestore is configured)",
    );
    return true;
  }
  return false;
};

test("resolveRequestBootstrap returns human bootstrap for valid Bearer credential", async (t) => {
  if (skipUnlessHumanBearerSeedInMemory(t)) return;
  const req = createReq();
  const { humanApiToken, churchId } = await seedActiveHumanBearerForServerTests(
    {
      req,
      userId: "test_human_bearer_uid_1",
      email: "human-bearer-test-1@example.com",
      churchId: "test_human_bearer_church_1",
    },
  );
  const bootstrap = await resolveRequestBootstrap(
    createReq({
      headers: { authorization: `Bearer ${humanApiToken}` },
    }),
  );
  assert.ok(bootstrap);
  assert.equal(bootstrap.authenticated, true);
  assert.equal(bootstrap.sessionKind, "human");
  assert.equal(bootstrap.churchId, churchId);
  assert.equal(bootstrap.database, `rtdb_${churchId}`);
});

test("getAuthMe returns authenticated human session for valid Bearer credential", async (t) => {
  if (skipUnlessHumanBearerSeedInMemory(t)) return;
  const req = createReq();
  const { humanApiToken, churchId } = await seedActiveHumanBearerForServerTests(
    {
      req,
      userId: "test_human_bearer_uid_2",
      email: "human-bearer-test-2@example.com",
      churchId: "test_human_bearer_church_2",
    },
  );
  const res = createRes();
  await authHandlers.getAuthMe(
    createReq({
      headers: { authorization: `Bearer ${humanApiToken}` },
    }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload?.authenticated, true);
  assert.equal(res.payload?.sessionKind, "human");
  assert.equal(res.payload?.churchId, churchId);
  assert.ok(String(res.payload?.csrfToken || "").length > 0);
});

test("logout revokes human API credential so Bearer no longer authenticates", async (t) => {
  if (skipUnlessHumanBearerSeedInMemory(t)) return;
  const session = {
    destroy(callback) {
      callback?.();
    },
  };
  const req = createReq({ session });
  const { humanApiToken } = await seedActiveHumanBearerForServerTests({
    req,
    userId: "test_human_bearer_uid_3",
    email: "human-bearer-test-3@example.com",
    churchId: "test_human_bearer_church_3",
  });

  const meRes = createRes();
  await authHandlers.getAuthMe(
    createReq({
      headers: { authorization: `Bearer ${humanApiToken}` },
    }),
    meRes,
  );
  assert.equal(meRes.payload?.authenticated, true);
  const csrfToken = String(meRes.payload?.csrfToken || "").trim();
  assert.ok(csrfToken.length > 0);

  const logoutRes = createRes();
  await authHandlers.logout(
    createReq({
      headers: {
        authorization: `Bearer ${humanApiToken}`,
        "x-csrf-token": csrfToken,
      },
      session,
    }),
    logoutRes,
  );
  assert.equal(logoutRes.statusCode, 200);
  assert.equal(logoutRes.payload?.success, true);

  const afterRes = createRes();
  await authHandlers.getAuthMe(
    createReq({
      headers: { authorization: `Bearer ${humanApiToken}` },
    }),
    afterRes,
  );
  assert.equal(afterRes.statusCode, 200);
  assert.equal(afterRes.payload?.authenticated, false);
});

test("createSharedDataToken succeeds for valid human Bearer when Firebase Admin is configured", async (t) => {
  if (skipUnlessHumanBearerSeedInMemory(t)) return;
  if (!authRuntimeInfo.hasFirebaseAdmin) {
    t.skip("needs Firebase Admin credentials for createCustomToken");
    return;
  }
  const req = createReq();
  const { humanApiToken, churchId } = await seedActiveHumanBearerForServerTests(
    {
      req,
      userId: "test_human_bearer_uid_4",
      email: "human-bearer-test-4@example.com",
      churchId: "test_human_bearer_church_4",
    },
  );
  const res = createRes();
  await authHandlers.createSharedDataToken(
    createReq({
      headers: { authorization: `Bearer ${humanApiToken}` },
    }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload?.success, true);
  assert.ok(typeof res.payload?.token === "string" && res.payload.token.length > 0);
  assert.equal(res.payload?.database, `rtdb_${churchId}`);
});
