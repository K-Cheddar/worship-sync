/**
 * Deeper auth validation paths: unknown tokens, device/pairing session gates,
 * and webhook configuration failures (before signature verification).
 */
process.env.WORSHIPSYNC_SERVER_TEST_SUPPORT = "1";

import test from "node:test";
import assert from "node:assert/strict";

const { authHandlers, authRuntimeInfo } = await import("../authService.js");

const createReq = ({
  params = {},
  query = {},
  headers = {},
  session = {},
  body = {},
} = {}) => ({
  params,
  query,
  headers,
  session,
  body,
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
    set() {
      return this;
    },
  };
  return res;
};

const errorMessage = (res) => String(res.payload?.errorMessage || "");

test("getInvitePreview returns 404 for an unknown invite token", async () => {
  const res = createRes();
  await authHandlers.getInvitePreview(
    createReq({ query: { token: "unknown-invite-token" } }),
    res,
  );
  assert.equal(res.statusCode, 404);
  assert.match(errorMessage(res), /invite not found/i);
});

test("acceptInvite rejects an unknown invite token", async () => {
  const res = createRes();
  await authHandlers.acceptInvite(
    createReq({ body: { token: "unknown-invite-token" } }),
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.match(errorMessage(res), /not active|invite/i);
});

test("confirmRecovery rejects an unknown recovery token", async () => {
  const res = createRes();
  await authHandlers.confirmRecovery(
    createReq({ body: { token: "unknown-recovery-token" } }),
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.match(errorMessage(res), /not active|recovery/i);
});

test("redeemWorkstationPairing rejects an unknown pairing token", async () => {
  const res = createRes();
  await authHandlers.redeemWorkstationPairing(
    createReq({ body: { token: "unknown-pairing-token" } }),
    res,
  );
  assert.ok(res.statusCode >= 400);
  assert.equal(res.payload?.success, false);
});

test("redeemDisplayPairing rejects an unknown pairing token", async () => {
  const res = createRes();
  await authHandlers.redeemDisplayPairing(
    createReq({ body: { token: "unknown-display-pairing-token" } }),
    res,
  );
  assert.ok(res.statusCode >= 400);
  assert.equal(res.payload?.success, false);
});

test("listTrustedHumanDevices requires an authenticated session", async () => {
  const res = createRes();
  await authHandlers.listTrustedHumanDevices(createReq({ session: {} }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload?.success, false);
});

test("createWorkstationPairing requires an authenticated admin session", async () => {
  const res = createRes();
  await authHandlers.createWorkstationPairing(
    createReq({
      params: { churchId: "church_test" },
      body: { label: "Booth PC" },
      session: {},
    }),
    res,
  );
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload?.success, false);
});

test("listWorkstations requires an authenticated admin session", async () => {
  const res = createRes();
  await authHandlers.listWorkstations(
    createReq({
      params: { churchId: "church_test" },
      session: {},
    }),
    res,
  );
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload?.success, false);
});

test("createDisplayPairing requires an authenticated admin session", async () => {
  const res = createRes();
  await authHandlers.createDisplayPairing(
    createReq({
      params: { churchId: "church_test" },
      body: { label: "Projector" },
      session: {},
    }),
    res,
  );
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload?.success, false);
});

test("handleResendWebhook fails closed when Resend webhooks are not configured", async () => {
  // With a delivery id present, verifyResendWebhook runs next and must not
  // silently accept unsigned payloads when the provider secret is missing.
  assert.equal(
    Boolean(authRuntimeInfo.hasFirestore),
    authRuntimeInfo.hasFirestore,
  );
  const res = createRes();
  await authHandlers.handleResendWebhook(
    createReq({
      headers: {
        "svix-id": "msg_test_delivery_1",
        "svix-timestamp": "1710000000",
        "svix-signature": "v1,invalid",
      },
      body: { type: "email.delivered" },
    }),
    res,
  );
  assert.ok(res.statusCode === 503 || res.statusCode === 400);
  assert.equal(res.payload?.success, false);
  assert.match(errorMessage(res), /not configured|webhook|signature|verify/i);
});
