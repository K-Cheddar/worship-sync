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
  setAuthReadObserverForServerTests,
  setDoc,
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

test("request bootstrap shares concurrent work and resolves fresh work per request", async (t) => {
  if (skipUnlessHumanBearerSeedInMemory(t)) return;
  const seedReq = createReq();
  const { humanApiToken } = await seedActiveHumanBearerForServerTests({
    req: seedReq,
    userId: "test_human_request_cache_uid",
    email: "human-request-cache@example.com",
    churchId: "test_human_request_cache_church",
  });
  const reads = [];
  setAuthReadObserverForServerTests((read) => reads.push(read));
  try {
    const firstReq = createReq({
      headers: { authorization: `Bearer ${humanApiToken}` },
    });
    const [first, second, third] = await Promise.all([
      resolveRequestBootstrap(firstReq),
      resolveRequestBootstrap(firstReq),
      resolveRequestBootstrap(firstReq),
    ]);
    assert.equal(first.sessionKind, "human");
    assert.equal(second, first);
    assert.equal(third, first);
    assert.equal(
      reads.filter((read) => read.collectionName === "humanApiCredentials").length,
      1,
    );

    await resolveRequestBootstrap(
      createReq({ headers: { authorization: `Bearer ${humanApiToken}` } }),
    );
    assert.equal(
      reads.filter((read) => read.collectionName === "humanApiCredentials").length,
      2,
    );

    const beforeNullResolutions = reads.filter(
      (read) => read.collectionName === "humanApiCredentials",
    ).length;
    const unknownReq = createReq({
      headers: { authorization: "Bearer wsh_unknown_cached_token" },
    });
    const [unknownFirst, unknownSecond] = await Promise.all([
      resolveRequestBootstrap(unknownReq),
      resolveRequestBootstrap(unknownReq),
    ]);
    assert.equal(unknownFirst, null);
    assert.equal(unknownSecond, null);
    assert.equal(
      reads.filter((read) => read.collectionName === "humanApiCredentials")
        .length - beforeNullResolutions,
      1,
    );
  } finally {
    setAuthReadObserverForServerTests(null);
  }
});

test("bearer human authentication validates its exact trusted device document", async (t) => {
  if (skipUnlessHumanBearerSeedInMemory(t)) return;
  const seedReq = createReq();
  const { humanApiToken, userId, deviceId } =
    await seedActiveHumanBearerForServerTests({
      req: seedReq,
      userId: "test_human_bearer_device_uid",
      email: "human-bearer-device@example.com",
      churchId: "test_human_bearer_device_church",
      deviceId: "test_human_bearer_device_doc",
    });
  const reads = [];
  setAuthReadObserverForServerTests((read) => reads.push(read));
  try {
    const bootstrap = await resolveRequestBootstrap(
      createReq({ headers: { authorization: `Bearer ${humanApiToken}` } }),
    );
    assert.equal(bootstrap.sessionKind, "human");
    assert.equal(bootstrap.device.deviceId, deviceId);
    assert.equal(
      reads.filter(
        (read) =>
          read.type === "getDoc" &&
          read.collectionName === "trustedHumanDevices" &&
          read.id === deviceId,
      ).length,
      1,
    );
    assert.equal(
      reads.filter(
        (read) =>
          read.type === "queryDocs" &&
          read.collectionName === "trustedHumanDevices",
      ).length,
      0,
    );

    await setDoc(
      "trustedHumanDevices",
      deviceId,
      { userId: "another-user", revokedAt: null },
      { merge: true },
    );
    const mismatched = await resolveRequestBootstrap(
      createReq({ headers: { authorization: `Bearer ${humanApiToken}` } }),
    );
    assert.equal(mismatched, null);

    await setDoc(
      "trustedHumanDevices",
      deviceId,
      { userId, revokedAt: new Date().toISOString() },
      { merge: true },
    );
    const revoked = await resolveRequestBootstrap(
      createReq({ headers: { authorization: `Bearer ${humanApiToken}` } }),
    );
    assert.equal(revoked, null);
  } finally {
    setAuthReadObserverForServerTests(null);
  }
});

test("cookie human authentication destroys sessions with missing, revoked, or foreign devices", async (t) => {
  if (skipUnlessHumanBearerSeedInMemory(t)) return;
  const seedReq = createReq();
  const { userId, churchId, deviceId } =
    await seedActiveHumanBearerForServerTests({
      req: seedReq,
      userId: "test_human_cookie_device_uid",
      email: "human-cookie-device@example.com",
      churchId: "test_human_cookie_device_church",
      deviceId: "test_human_cookie_device_doc",
    });
  const createHumanSessionReq = (sessionDeviceId = deviceId) => {
    let destroyed = false;
    const req = createReq({
      session: {
        auth: {
          sessionKind: "human",
          issuedAt: Date.now(),
          userId,
          churchId,
          deviceId: sessionDeviceId,
        },
        destroy(callback) {
          destroyed = true;
          callback?.();
        },
      },
    });
    return { req, wasDestroyed: () => destroyed };
  };

  const valid = createHumanSessionReq();
  const validBootstrap = await resolveRequestBootstrap(valid.req);
  assert.equal(validBootstrap.sessionKind, "human");
  assert.equal(valid.wasDestroyed(), false);

  const missing = createHumanSessionReq("missing-device-id");
  assert.equal(await resolveRequestBootstrap(missing.req), null);
  assert.equal(missing.wasDestroyed(), true);

  await setDoc(
    "trustedHumanDevices",
    deviceId,
    { userId, revokedAt: new Date().toISOString() },
    { merge: true },
  );
  const revoked = createHumanSessionReq();
  assert.equal(await resolveRequestBootstrap(revoked.req), null);
  assert.equal(revoked.wasDestroyed(), true);

  await setDoc(
    "trustedHumanDevices",
    deviceId,
    { userId: "another-user", revokedAt: null },
    { merge: true },
  );
  const foreign = createHumanSessionReq();
  assert.equal(await resolveRequestBootstrap(foreign.req), null);
  assert.equal(foreign.wasDestroyed(), true);
});

test("trusted-device listing keeps list queries and fingerprint deduplication", async (t) => {
  if (skipUnlessHumanBearerSeedInMemory(t)) return;
  const seedReq = createReq();
  const { userId, churchId, deviceId } =
    await seedActiveHumanBearerForServerTests({
      req: seedReq,
      userId: "test_human_device_listing_uid",
      email: "human-device-listing@example.com",
      churchId: "test_human_device_listing_church",
      deviceId: "test_human_device_listing_active",
    });
  await setDoc(
    "trustedHumanDevices",
    deviceId,
    {
      deviceFingerprintHash: "shared-device-fingerprint",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
    },
    { merge: true },
  );
  await setDoc("trustedHumanDevices", "test_human_device_listing_revoked", {
    userId,
    deviceFingerprintHash: "shared-device-fingerprint",
    label: "Older revoked record",
    createdAt: "2025-01-01T00:00:00.000Z",
    lastSeenAt: "2026-02-01T00:00:00.000Z",
    revokedAt: "2026-02-02T00:00:00.000Z",
  });
  const req = createReq({
    session: {
      auth: {
        sessionKind: "human",
        issuedAt: Date.now(),
        userId,
        churchId,
        deviceId,
      },
      destroy(callback) {
        callback?.();
      },
    },
  });
  const reads = [];
  setAuthReadObserverForServerTests((read) => reads.push(read));
  try {
    const res = createRes();
    await authHandlers.listTrustedHumanDevices(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.devices.length, 1);
    assert.equal(res.payload.devices[0].deviceId, deviceId);
    assert.equal(res.payload.devices[0].revokedAt, null);
    assert.ok(
      reads.some(
        (read) =>
          read.type === "queryDocs" &&
          read.collectionName === "trustedHumanDevices",
      ),
    );
  } finally {
    setAuthReadObserverForServerTests(null);
  }
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
