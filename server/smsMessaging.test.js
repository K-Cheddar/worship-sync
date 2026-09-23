import test from "node:test";
import assert from "node:assert/strict";
import twilio from "twilio";
import {
  canSmsMember,
  resolveSmsMemberEligibility,
} from "./smsEligibility.js";
import {
  isChurchMessagingReady,
  normalizeChurchMessagingConfig,
} from "./churchMessagingConfig.js";
import { buildTeamIntakeSms } from "./smsMessage.js";
import {
  createFakeSmsProvider,
  createTwilioSmsProvider,
  normalizeTwilioStatus,
  validateTwilioWebhookSignature,
} from "./smsProvider.js";
import {
  nextSmsDeliveryStatus,
  normalizeSmsDeliveryStatus,
} from "./smsDeliveryAttempts.js";

const member = (phoneNumber) => ({ memberId: "member_1", phoneNumber });

test("SMS eligibility requires a phone-level opted-in consent", () => {
  assert.equal(canSmsMember(member("(954) 555-1234"), null), false);
  assert.deepEqual(
    resolveSmsMemberEligibility(member("(954) 555-1234"), {
      status: "opted_in",
    }),
    { status: "enabled", eligible: true, phoneNumber: "+19545551234" },
  );
});

test("phone-level opt-out wins and applies to shared numbers without linking members", () => {
  const consent = { status: "opted_out", optedOutAt: "2026-09-23T00:00:00.000Z" };
  const first = resolveSmsMemberEligibility(member("+19545551234"), consent);
  const second = resolveSmsMemberEligibility(
    { memberId: "member_2", phoneNumber: "(954) 555-1234" },
    consent,
  );
  assert.equal(first.status, "opted_out");
  assert.equal(second.status, "opted_out");
  assert.equal(first.memberId, undefined);
  assert.equal(second.memberId, undefined);
});

test("invalid and missing member phone numbers are not eligible", () => {
  assert.equal(resolveSmsMemberEligibility(member(""), { status: "opted_in" }).status, "no_mobile");
  assert.equal(
    resolveSmsMemberEligibility(member("+11235551234"), { status: "opted_in" }).status,
    "no_mobile",
  );
});

test("church messaging config is server-side and only approved enabled configs send", () => {
  const config = normalizeChurchMessagingConfig({
    churchId: "church_1",
    provider: "twilio",
    providerAccountId: "AC123",
    messagingServiceId: "MG123",
    registrationStatus: "approved",
    enabled: true,
    authToken: "must-not-survive-normalization",
  });
  assert.equal(isChurchMessagingReady(config), true);
  assert.equal(config.authToken, undefined);
  assert.equal(
    isChurchMessagingReady({ ...config, registrationStatus: "pending" }),
    false,
  );
});

test("centralized intake SMS contains a personalized URL and exposes segment length", () => {
  const message = buildTeamIntakeSms({
    churchName: "Grace Church",
    formName: "October availability",
    publicUrl: "https://www.worshipsync.net/a/r_123456789012345678901234",
  });
  assert.match(message.body, /Grace Church/);
  assert.match(message.body, /October availability/);
  assert.match(message.body, /\/a\/r_123456789012345678901234/);
  assert.doesNotMatch(message.body, /member_1|19545551234/);
  assert.equal(message.segmentCount, 1);
});

test("fake provider is deterministic and Twilio responses normalize inside the provider boundary", async () => {
  const fake = createFakeSmsProvider();
  const result = await fake.sendMessage({ to: "+19545551234", body: "hello" });
  assert.equal(result.status, "accepted");
  assert.equal(fake.calls.length, 1);
  assert.equal(normalizeTwilioStatus("queued"), "accepted");
  assert.equal(normalizeTwilioStatus("delivered"), "delivered");

  const created = [];
  const provider = createTwilioSmsProvider({
    accountSid: "AC123",
    authToken: "token",
    messagingServiceId: "MG123",
    clientFactory: () => ({
      messages: {
        create: async (input) => {
          created.push(input);
          return { sid: "SM123", status: "queued" };
        },
      },
    }),
  });
  assert.deepEqual(
    await provider.sendMessage({ to: "+19545551234", body: "hello" }),
    { providerMessageId: "SM123", status: "accepted" },
  );
  assert.equal(created[0].messagingServiceSid, "MG123");
  assert.equal(created[0].from, undefined);
});

test("Twilio webhook validation accepts the signed callback and rejects mutations", () => {
  const authToken = "test-auth-token";
  const url = "https://example.test/api/webhooks/twilio/sms-status";
  const params = { MessageSid: "SM123", MessageStatus: "delivered" };
  const signature = twilio.getExpectedTwilioSignature(authToken, url, params);

  assert.equal(
    validateTwilioWebhookSignature({ authToken, signature, url, params }),
    true,
  );
  assert.equal(
    validateTwilioWebhookSignature({
      authToken,
      signature,
      url,
      params: { ...params, MessageStatus: "failed" },
    }),
    false,
  );
});

test("delivery status progression is monotonic and preserves final states", () => {
  assert.equal(normalizeSmsDeliveryStatus("unknown"), "accepted");
  assert.equal(nextSmsDeliveryStatus("delivered", "sent"), "delivered");
  assert.equal(nextSmsDeliveryStatus("failed", "queued"), "failed");
  assert.equal(nextSmsDeliveryStatus("sent", "delivered"), "delivered");
});
