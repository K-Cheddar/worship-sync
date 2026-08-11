/**
 * Auth handler authz / validation smoke tests for invite, recovery, pairing, and webhooks.
 * Follows the unauthenticated / missing-input patterns in authInviteRevoke.test.js.
 */
import test from "node:test";
import assert from "node:assert/strict";

const { authHandlers } = await import("../authService.js");

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

test("createInvite requires an authenticated admin session", async () => {
  const res = createRes();
  await authHandlers.createInvite(
    createReq({
      params: { churchId: "church_test" },
      body: { email: "member@example.com" },
      session: {},
    }),
    res,
  );
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload?.success, false);
});

test("getInvitePreview requires an invite token", async () => {
  const res = createRes();
  await authHandlers.getInvitePreview(createReq({ query: {} }), res);
  assert.equal(res.statusCode, 400);
  assert.match(errorMessage(res), /invite token/i);
});

test("acceptInvite requires an invite token", async () => {
  const res = createRes();
  await authHandlers.acceptInvite(createReq({ body: {} }), res);
  assert.equal(res.statusCode, 400);
  assert.match(errorMessage(res), /invite token/i);
});

test("confirmRecovery requires a recovery token", async () => {
  const res = createRes();
  await authHandlers.confirmRecovery(createReq({ body: {} }), res);
  assert.equal(res.statusCode, 400);
  assert.match(errorMessage(res), /recovery token/i);
});

test("redeemWorkstationPairing requires a pairing token", async () => {
  const res = createRes();
  await authHandlers.redeemWorkstationPairing(createReq({ body: {} }), res);
  assert.equal(res.statusCode, 400);
  assert.match(errorMessage(res), /pairing token/i);
});

test("handleResendWebhook requires a delivery id header", async () => {
  const res = createRes();
  await authHandlers.handleResendWebhook(
    createReq({ headers: {}, body: {} }),
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.match(errorMessage(res), /delivery id/i);
});

test("createHumanSession rejects empty credentials", async () => {
  const res = createRes();
  await authHandlers.createHumanSession(createReq({ body: {} }), res);
  assert.ok(res.statusCode >= 400);
  assert.equal(res.payload?.success, false);
});
