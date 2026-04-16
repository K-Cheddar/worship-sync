import test from "node:test";
import assert from "node:assert/strict";

process.env.AUTH_DESKTOP_AUTH_TTL_MS = "2000";

const { authHandlers } = await import("../authService.js");

const createReq = (body = {}) => ({
  body,
  headers: {},
  session: {},
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("desktop/start returns handshake and desktop/status validates secret", async () => {
  const startReq = createReq({
    provider: "google",
    deviceId: "device-1",
    userAgent: "node-test",
    platform: "linux",
    deviceLabel: "Test Device",
  });
  const startRes = createRes();
  await authHandlers.startDesktopAuth(startReq, startRes);

  assert.equal(startRes.statusCode, 200);
  assert.equal(startRes.payload?.success, true);
  assert.ok(startRes.payload?.desktopAuthId);
  assert.ok(startRes.payload?.desktopAuthSecret);
  assert.match(startRes.payload?.browserUrl || "", /#\/login\?/);
  assert.match(startRes.payload?.browserUrl || "", /provider=google/);

  const statusReq = createReq({
    desktopAuthId: startRes.payload.desktopAuthId,
    desktopAuthSecret: startRes.payload.desktopAuthSecret,
  });
  const statusRes = createRes();
  await authHandlers.getDesktopAuthStatus(statusReq, statusRes);
  assert.equal(statusRes.statusCode, 200);
  assert.equal(statusRes.payload?.success, true);
  assert.equal(statusRes.payload?.status, "pending");

  const badSecretReq = createReq({
    desktopAuthId: startRes.payload.desktopAuthId,
    desktopAuthSecret: "wrong-secret",
  });
  const badSecretRes = createRes();
  await authHandlers.getDesktopAuthStatus(badSecretReq, badSecretRes);
  assert.equal(badSecretRes.statusCode, 403);
  assert.equal(badSecretRes.payload?.success, false);
  assert.match(badSecretRes.payload?.errorMessage || "", /not valid/i);
});

test("desktop/exchange rejects when request is not awaiting exchange", async () => {
  const startRes = createRes();
  await authHandlers.startDesktopAuth(
    createReq({
      provider: "microsoft",
      deviceId: "device-exchange-1",
      userAgent: "node-test",
      platform: "windows",
    }),
    startRes,
  );

  assert.equal(startRes.payload?.success, true);

  const exchangeRes = createRes();
  await authHandlers.exchangeDesktopAuth(
    createReq({
      desktopAuthId: startRes.payload.desktopAuthId,
      desktopAuthSecret: startRes.payload.desktopAuthSecret,
      exchangeCode: "not-ready-code",
    }),
    exchangeRes,
  );

  assert.equal(exchangeRes.statusCode, 409);
  assert.equal(exchangeRes.payload?.success, false);
  assert.match(exchangeRes.payload?.errorMessage || "", /not ready/i);
});

test("desktop/status returns expired after ttl passes", async () => {
  const startRes = createRes();
  await authHandlers.startDesktopAuth(
    createReq({
      provider: "google",
      deviceId: "device-expire-1",
      userAgent: "node-test",
      platform: "darwin",
    }),
    startRes,
  );

  assert.equal(startRes.payload?.success, true);
  await sleep(2200);

  const statusRes = createRes();
  await authHandlers.getDesktopAuthStatus(
    createReq({
      desktopAuthId: startRes.payload.desktopAuthId,
      desktopAuthSecret: startRes.payload.desktopAuthSecret,
    }),
    statusRes,
  );

  assert.equal(statusRes.statusCode, 200);
  assert.equal(statusRes.payload?.success, true);
  assert.equal(statusRes.payload?.status, "expired");
});

test("desktop/complete marks request failed when completion errors", async () => {
  const startRes = createRes();
  await authHandlers.startDesktopAuth(
    createReq({
      provider: "google",
      deviceId: "device-fail-1",
      userAgent: "node-test",
      platform: "linux",
    }),
    startRes,
  );
  assert.equal(startRes.payload?.success, true);

  const completeRes = createRes();
  await authHandlers.completeDesktopAuth(
    createReq({
      desktopAuthId: startRes.payload.desktopAuthId,
      idToken: "invalid-or-unavailable",
    }),
    completeRes,
  );
  assert.equal(completeRes.payload?.success, false);

  const statusRes = createRes();
  await authHandlers.getDesktopAuthStatus(
    createReq({
      desktopAuthId: startRes.payload.desktopAuthId,
      desktopAuthSecret: startRes.payload.desktopAuthSecret,
    }),
    statusRes,
  );
  assert.equal(statusRes.statusCode, 200);
  assert.equal(statusRes.payload?.status, "failed");
});
