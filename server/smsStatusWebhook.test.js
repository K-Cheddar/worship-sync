import test from "node:test";
import assert from "node:assert/strict";
import { createSmsStatusWebhookHandler } from "./smsStatusWebhook.js";

const createResponse = () => ({
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
});

const createHandler = ({ valid = true, attempt } = {}) => {
  let saved = null;
  const handler = createSmsStatusWebhookHandler({
    queryDocs: async () => (attempt ? [{ ...attempt }] : []),
    setDoc: async (_collection, _id, update) => {
      saved = update;
    },
    nowIso: () => "2026-09-23T12:00:00.000Z",
    validateSignature: () => valid,
    normalizeStatus: (value) => String(value || "").toLowerCase(),
    getCallbackUrl: () => "https://example.test/api/webhooks/twilio/sms-status",
    getAuthToken: () => "token",
  });
  return { handler, getSaved: () => saved };
};

test("status webhook rejects invalid signatures", async () => {
  const { handler } = createHandler({ valid: false });
  const res = createResponse();
  await handler({ headers: { "x-twilio-signature": "bad" }, body: {} }, res);
  assert.equal(res.statusCode, 403);
});

test("status webhook is idempotent and does not regress delivered", async () => {
  const { handler, getSaved } = createHandler({
    attempt: {
      attemptId: "attempt_1",
      providerMessageId: "SM123",
      status: "delivered",
    },
  });
  const req = {
    headers: { "x-twilio-signature": "valid" },
    body: { MessageSid: "SM123", MessageStatus: "sent" },
  };
  const first = createResponse();
  await handler(req, first);
  const second = createResponse();
  await handler(req, second);
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(first.payload.updated, false);
  assert.equal(getSaved(), null);
});

test("status webhook advances a matching attempt", async () => {
  const { handler, getSaved } = createHandler({
    attempt: {
      attemptId: "attempt_1",
      providerMessageId: "SM123",
      status: "sent",
    },
  });
  const res = createResponse();
  await handler(
    {
      headers: { "x-twilio-signature": "valid" },
      body: { MessageSid: "SM123", MessageStatus: "delivered" },
    },
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(getSaved().status, "delivered");
});

