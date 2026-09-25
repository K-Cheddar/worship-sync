import test from "node:test";
import assert from "node:assert/strict";
import {
  createSmsInboundWebhookHandler,
  normalizeTwilioSmsKeyword,
  resolveTwilioInboundCallbackUrl,
} from "./smsInboundWebhook.js";
import { smsConsentIdForChurchPhone } from "./smsConsent.js";

const makeHarness = ({ valid = true } = {}) => {
  const docs = new Map();
  const key = (collection, id) => `${collection}:${id}`;
  const churchA = { id: "church_a", churchId: "church_a", senderPhoneNumber: "+14155550999" };
  const churchB = { id: "church_b", churchId: "church_b", senderPhoneNumber: "+14155550888" };
  docs.set(key("churchMessagingConfigs", "a"), churchA);
  docs.set(key("churchMessagingConfigs", "b"), churchB);
  const phone = "+14155550123";
  const consentA = smsConsentIdForChurchPhone("church_a", phone);
  const consentB = smsConsentIdForChurchPhone("church_b", phone);
  docs.set(key("smsConsents", consentA), {
    consentId: consentA, churchId: "church_a", phoneNumber: phone, status: "opted_in",
    verifiedAt: "verified", consentedAt: "consented", createdAt: "created",
  });
  const handler = createSmsInboundWebhookHandler({
    COLLECTIONS: { churchMessagingConfigs: "churchMessagingConfigs", smsConsents: "smsConsents", smsInboundCommands: "smsInboundCommands" },
    getDoc: async (collection, id) => docs.get(key(collection, id)) || null,
    hashValue: (value) => `h_${Buffer.from(String(value)).toString("hex")}`,
    nowIso: () => "2026-09-25T12:00:00.000Z",
    queryDocs: async (collection, filters) => [...docs.entries()]
      .filter(([docKey]) => docKey.startsWith(`${collection}:`))
      .map(([, value]) => value)
      .filter((value) => filters.every((filter) => value[filter.field] === filter.value)),
    requireFirestore: () => null,
    setDoc: async (collection, id, value, { merge = false } = {}) => {
      const old = docs.get(key(collection, id)) || {};
      docs.set(key(collection, id), merge ? { ...old, ...value } : value);
    },
    validateSignature: () => valid,
    getAuthToken: () => "token",
    getCallbackUrl: () => "https://example.test/api/webhooks/twilio/sms-inbound",
  });
  const invoke = async ({ to = "+14155550999", body = "STOP", sid = "SM1" } = {}) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      type(value) { this.contentType = value; return this; },
      send(value) { this.body = value; return this; },
    };
    await handler({
      headers: { "x-twilio-signature": "signature" },
      body: { To: to, From: phone, Body: body, MessageSid: sid },
    }, res);
    return res;
  };
  return { invoke, docs, key, consentA, consentB, phone };
};

test("Twilio inbound callback URL fails closed in production without configuration", () => {
  assert.equal(
    resolveTwilioInboundCallbackUrl({ env: { AUTH_APP_BASE_URL: "https://app.test" } }),
    "https://app.test/api/webhooks/twilio/sms-inbound",
  );
  assert.throws(
    () => resolveTwilioInboundCallbackUrl({ env: { NODE_ENV: "production" } }),
    /TWILIO_INBOUND_CALLBACK_URL must be set/,
  );
});

test("STOP opts out only the church identified by the receiving sender and deduplicates callbacks", async () => {
  const h = makeHarness();
  const first = await h.invoke({ body: "STOP" });
  const repeat = await h.invoke({ body: "STOP" });
  assert.equal(first.statusCode, 200);
  assert.equal(first.contentType, "text/xml");
  assert.match(first.body, /<Response\/>/);
  assert.equal(h.docs.get(h.key("smsConsents", h.consentA)).status, "opted_out");
  assert.equal(h.docs.has(h.key("smsConsents", h.consentB)), false);
  assert.equal([...h.docs.keys()].filter((item) => item.startsWith("smsInboundCommands:")).length, 1);
  assert.equal(repeat.statusCode, 200);
});

test("START restores only a previously verified opt-in and HELP does not send an automatic reply", async () => {
  const h = makeHarness();
  await h.invoke({ body: "STOP", sid: "SM_STOP" });
  await h.invoke({ body: "START", sid: "SM_START" });
  const restored = h.docs.get(h.key("smsConsents", h.consentA));
  assert.equal(restored.status, "opted_in");
  assert.equal(restored.optedOutAt, null);
  const help = await h.invoke({ body: "HELP", sid: "SM_HELP" });
  assert.equal(help.body, "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response/>");
  assert.equal(h.docs.get(h.key("smsConsents", h.consentA)).status, "opted_in");
});

test("unsigned and ambiguous/unmapped sender callbacks never change consent", async () => {
  const invalid = makeHarness({ valid: false });
  const rejected = await invalid.invoke({ body: "STOP" });
  assert.equal(rejected.statusCode, 403);
  assert.equal(invalid.docs.get(invalid.key("smsConsents", invalid.consentA)).status, "opted_in");

  const unmatched = makeHarness();
  const ignored = await unmatched.invoke({ to: "+14155550777", body: "STOP" });
  assert.equal(ignored.statusCode, 200);
  assert.equal(unmatched.docs.get(unmatched.key("smsConsents", unmatched.consentA)).status, "opted_in");
});

test("Twilio STOP, START, and HELP aliases normalize without sending a response", () => {
  assert.equal(normalizeTwilioSmsKeyword("unsubscribe"), "STOP");
  assert.equal(normalizeTwilioSmsKeyword("unstop"), "START");
  assert.equal(normalizeTwilioSmsKeyword("help please"), "HELP");
  assert.equal(normalizeTwilioSmsKeyword("availability"), "OTHER");
});
