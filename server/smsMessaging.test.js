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
import { buildTeamIntakeSms, measureSmsMessage } from "./smsMessage.js";
import {
  createFakeSmsProvider,
  createTwilioSmsProvider,
  normalizeTwilioStatus,
  resolveTwilioAccountConfiguration,
  resolveTwilioStatusCallbackUrl,
  validateTwilioWebhookSignature,
} from "./smsProvider.js";
import {
  nextSmsDeliveryStatus,
  normalizeSmsDeliveryStatus,
} from "./smsDeliveryAttempts.js";

const member = (phoneNumber) => ({ memberId: "member_1", phoneNumber });

test("SMS eligibility requires a church-scoped opted-in consent", () => {
  assert.equal(
    canSmsMember({
      member: member("(954) 555-1234"),
      churchId: "church_1",
      consent: null,
    }),
    false,
  );
  assert.deepEqual(
    resolveSmsMemberEligibility({
      member: member("(954) 555-1234"),
      churchId: "church_1",
      consent: {
        churchId: "church_1",
        status: "pending",
        verificationCodeHash: "pending-challenge",
      },
    }),
    { status: "consent_needed", eligible: false, phoneNumber: "+19545551234" },
  );
  assert.deepEqual(
    resolveSmsMemberEligibility({
      member: member("(954) 555-1234"),
      churchId: "church_1",
      consent: { churchId: "church_1", status: "opted_in" },
    }),
    { status: "enabled", eligible: true, phoneNumber: "+19545551234" },
  );
});

test("phone-level opt-out wins for every shared-number member in one church", () => {
  const consent = {
    churchId: "church_1",
    status: "opted_out",
    optedOutAt: "2026-09-23T00:00:00.000Z",
  };
  const first = resolveSmsMemberEligibility({
    member: member("+19545551234"),
    churchId: "church_1",
    consent,
  });
  const second = resolveSmsMemberEligibility({
    member: { memberId: "member_2", phoneNumber: "(954) 555-1234" },
    churchId: "church_1",
    consent,
  });
  assert.equal(first.status, "opted_out");
  assert.equal(second.status, "opted_out");
  assert.equal(first.memberId, undefined);
  assert.equal(second.memberId, undefined);
});

test("identical shared numbers remain independent between churches", () => {
  const memberRecord = member("+19545551234");
  assert.equal(
    resolveSmsMemberEligibility({
      member: memberRecord,
      churchId: "church_a",
      consent: { churchId: "church_a", status: "opted_in" },
    }).status,
    "enabled",
  );
  assert.equal(
    resolveSmsMemberEligibility({
      member: memberRecord,
      churchId: "church_b",
      consent: { churchId: "church_a", status: "opted_in" },
    }).status,
    "consent_needed",
  );
});

test("invalid and missing member phone numbers are not eligible", () => {
  assert.equal(
    resolveSmsMemberEligibility({
      member: member(""),
      churchId: "church_1",
      consent: { status: "opted_in" },
    }).status,
    "no_mobile",
  );
  assert.equal(
    resolveSmsMemberEligibility({
      member: member("+11235551234"),
      churchId: "church_1",
      consent: { status: "opted_in" },
    }).status,
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
  assert.equal(config.twilioAccountSid, "AC123");
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
    collectsAvailability: true,
  });
  assert.equal(
    message.body,
    "Grace Church: Please submit your October availability: https://www.worshipsync.net/a/r_123456789012345678901234 Reply STOP to opt out.",
  );
  assert.doesNotMatch(message.body, /member_1|19545551234/);
  assert.equal(message.segmentCount, 1);
});

test("availability reminders keep the concise form name and fit one typical GSM-7 segment", () => {
  const message = buildTeamIntakeSms({
    churchName: "Grace Church",
    formName: "October availability",
    publicUrl: "https://www.worshipsync.net/a/r_123456789012345678901234",
    intentType: "availability_reminder",
    collectsAvailability: true,
  });
  assert.equal(
    message.body,
    "Grace Church: Reminder: Please submit your October availability: https://www.worshipsync.net/a/r_123456789012345678901234 Reply STOP to opt out.",
  );
  assert.equal(message.encoding, "gsm7");
  assert.equal(message.segmentCount, 1);
});

test("SMS measurement counts GSM-7 extension characters as two septets", () => {
  assert.deepEqual(measureSmsMessage("A^B\\C\u20acD"), {
    encoding: "gsm7",
    characterCount: 7,
    unitCount: 10,
    segmentCount: 1,
  });
  assert.equal(measureSmsMessage("A".repeat(160)).segmentCount, 1);
  assert.equal(measureSmsMessage("A".repeat(161)).segmentCount, 2);
  assert.equal(measureSmsMessage("A".repeat(153)).segmentCount, 1);
  assert.equal(measureSmsMessage("A".repeat(154)).segmentCount, 1);
  assert.equal(measureSmsMessage("^".repeat(80)).segmentCount, 1);
  assert.equal(measureSmsMessage("^".repeat(81)).segmentCount, 2);
});

test("SMS measurement uses UCS-2 units and concatenated limits for Unicode", () => {
  assert.deepEqual(measureSmsMessage("\u{1f642}"), {
    encoding: "ucs2",
    characterCount: 1,
    unitCount: 2,
    segmentCount: 1,
  });
  assert.equal(measureSmsMessage("\u{1f642}".repeat(70)).segmentCount, 3);
  assert.equal(measureSmsMessage("\u{1f642}".repeat(35)).segmentCount, 1);
  assert.equal(measureSmsMessage("\u{1f642}".repeat(36)).segmentCount, 2);
});

test("fake provider is deterministic and Twilio responses normalize inside the provider boundary", async () => {
  const fake = createFakeSmsProvider();
  const result = await fake.sendMessage({ to: "+19545551234", body: "hello" });
  assert.equal(result.status, "accepted");
  assert.equal(fake.calls.length, 1);
  assert.equal(normalizeTwilioStatus("queued"), "accepted");
  assert.equal(normalizeTwilioStatus("delivered"), "delivered");

  const created = [];
  let factoryArgs;
  const provider = createTwilioSmsProvider({
    accountSid: "AC_subaccount",
    parentAccountSid: "AC_parent",
    authToken: "token",
    messagingServiceId: "MG123",
    clientFactory: (...args) => {
      factoryArgs = args;
      return {
        messages: {
          create: async (input) => {
            created.push(input);
            return { sid: "SM123", status: "queued" };
          },
        },
      };
    },
  });
  assert.deepEqual(
    await provider.sendMessage({ to: "+19545551234", body: "hello" }),
    { providerMessageId: "SM123", status: "accepted" },
  );
  assert.equal(created[0].messagingServiceSid, "MG123");
  assert.equal(created[0].from, undefined);
  assert.deepEqual(factoryArgs, [
    "AC_parent",
    "token",
    { accountSid: "AC_subaccount" },
  ]);
  assert.deepEqual(
    resolveTwilioAccountConfiguration({
      config: { twilioAccountSid: "AC_subaccount" },
      env: { TWILIO_ACCOUNT_SID: "AC_parent" },
    }),
    { parentAccountSid: "AC_parent", targetAccountSid: "AC_subaccount" },
  );
});

test("production callback URL is explicit and proxy request data cannot change it", async () => {
  const env = {
    NODE_ENV: "production",
    TWILIO_STATUS_CALLBACK_URL: "https://status.worshipsync.com/twilio/status",
  };
  assert.equal(
    resolveTwilioStatusCallbackUrl({
      env,
      request: {
        protocol: "http",
        originalUrl: "/api/webhooks/twilio/sms-status",
        get: () => "internal.herokuapp.com",
      },
    }),
    env.TWILIO_STATUS_CALLBACK_URL,
  );
  assert.throws(
    () => resolveTwilioStatusCallbackUrl({ env: { NODE_ENV: "production" } }),
    /TWILIO_STATUS_CALLBACK_URL must be set in production/,
  );
  assert.throws(
    () => resolveTwilioStatusCallbackUrl({
      env: { NODE_ENV: "production", TWILIO_STATUS_CALLBACK_URL: "http://localhost:5000/status" },
    }),
    /must be a valid public HTTPS URL in production/,
  );
  let created;
  const provider = createTwilioSmsProvider({
    accountSid: "AC123", authToken: "token", senderPhoneNumber: "+19545551234",
    clientFactory: () => ({ messages: { create: async (input) => {
      created = input;
      return { sid: "SM123", status: "queued" };
    } } }),
  });
  await provider.sendMessage({
    to: "+19545550123",
    body: "hello",
    statusCallbackUrl: resolveTwilioStatusCallbackUrl({ env }),
  });
  assert.equal(created.statusCallback, env.TWILIO_STATUS_CALLBACK_URL);
});

test("development omits an unconfigured callback and accepts an explicit public tunnel", () => {
  assert.equal(resolveTwilioStatusCallbackUrl({ env: { NODE_ENV: "development" } }), undefined);
  assert.equal(
    resolveTwilioStatusCallbackUrl({
      env: { NODE_ENV: "development", TWILIO_STATUS_CALLBACK_URL: "https://worshipsync.ngrok-free.app/status" },
    }),
    "https://worshipsync.ngrok-free.app/status",
  );
});

test("development private callback values are omitted from Twilio sends", async () => {
  const created = [];
  const provider = createTwilioSmsProvider({
    accountSid: "AC123", authToken: "token", senderPhoneNumber: "+19545551234",
    clientFactory: () => ({ messages: { create: async (input) => {
      created.push(input);
      return { sid: "SM123", status: "queued" };
    } } }),
  });
  for (const callback of [
    "http://localhost:5000/api/webhooks/twilio/sms-status",
    "https://127.0.0.1/status",
    "https://192.168.1.20/status",
    "https://worshipsync.local/status",
  ]) {
    const statusCallbackUrl = resolveTwilioStatusCallbackUrl({
      env: { NODE_ENV: "development", TWILIO_STATUS_CALLBACK_URL: callback },
    });
    await provider.sendMessage({ to: "+19545550123", body: "hello", statusCallbackUrl });
  }
  assert.equal(created.length, 4);
  assert.ok(created.every((input) => !("statusCallback" in input)));
});

test("an explicit public development callback is sent to Twilio", async () => {
  let created;
  const provider = createTwilioSmsProvider({
    accountSid: "AC123", authToken: "token", senderPhoneNumber: "+19545551234",
    clientFactory: () => ({ messages: { create: async (input) => {
      created = input;
      return { sid: "SM123", status: "queued" };
    } } }),
  });
  const statusCallbackUrl = resolveTwilioStatusCallbackUrl({
    env: { NODE_ENV: "development", TWILIO_STATUS_CALLBACK_URL: "https://worshipsync.ngrok-free.app/status" },
  });
  await provider.sendMessage({ to: "+19545550123", body: "hello", statusCallbackUrl });
  assert.equal(created.statusCallback, statusCallbackUrl);
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
