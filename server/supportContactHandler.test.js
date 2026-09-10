/**
 * Public support contact handler smoke tests (honeypot + validation).
 * Does not require Resend; invalid payloads never reach sendEmail.
 */
process.env.WORSHIPSYNC_SERVER_TEST_SUPPORT = "1";

import test from "node:test";
import assert from "node:assert/strict";

const { authHandlers } = await import("../authService.js");

const createReq = ({ body = {}, ip = "127.0.0.1" } = {}) => ({
  body,
  headers: {},
  session: {},
  ip,
  socket: { remoteAddress: ip },
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

test("submitSupportContact rejects a short message", async () => {
  const res = createRes();
  await authHandlers.submitSupportContact(
    createReq({
      body: {
        name: "Alex",
        email: "alex@example.com",
        message: "Help",
      },
    }),
    res,
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload?.success, false);
  assert.match(String(res.payload?.errorMessage || ""), /short description/i);
});

test("submitSupportContact honeypot returns success without requiring email", async () => {
  const res = createRes();
  await authHandlers.submitSupportContact(
    createReq({
      body: {
        name: "Bot",
        email: "bot@example.com",
        message: "Buy cheap projector lenses today please.",
        company: "Spam Co",
      },
    }),
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { success: true });
});
