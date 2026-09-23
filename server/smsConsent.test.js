process.env.WORSHIPSYNC_SERVER_TEST_SUPPORT = "1";
process.env.FIREBASE_PROJECT_ID = "";
process.env.FIREBASE_CLIENT_EMAIL = "";
process.env.FIREBASE_PRIVATE_KEY = "";

import test from "node:test";
import assert from "node:assert/strict";
import {
  createSmsConsentChallenge,
  normalizeUsPhoneNumber,
  SMS_CONSENT_TEXT,
  SMS_CONSENT_VERSION,
  setSmsConsentSenderForServerTests,
  verifySmsConsentCode,
} from "./smsConsent.js";

const {
  authHandlers,
  canSeedHumanBearerAuthForServerTests,
  getSmsConsentForServerTests,
  seedSmsConsentForServerTests,
  seedLegacySmsConsentForServerTests,
} = await import("../authService.js");

const CHURCH_ID = "church_sms_consent_test";

let sentCodes = new Map();
setSmsConsentSenderForServerTests(({ phoneNumber, code }) => {
  sentCodes.set(phoneNumber, code);
  return { provider: "test", method: "sms_otp" };
});

const createReq = ({ body = {}, ip = "127.0.0.1" } = {}) => ({
  body,
  params: { churchId: CHURCH_ID },
  headers: {},
  session: {},
  ip,
  socket: { remoteAddress: ip },
});

const createRes = () => ({
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

const validBody = (phoneNumber) => ({
  phoneNumber,
  consent: true,
  consentedAt: "2000-01-01T00:00:00.000Z",
});

const verificationBody = (phoneNumber, code) => ({ phoneNumber, code });

test("normalizes valid U.S. phone numbers and rejects invalid numbers", () => {
  assert.equal(normalizeUsPhoneNumber("(954) 555-1234"), "+19545551234");
  assert.equal(normalizeUsPhoneNumber("+1 954-555-1234"), "+19545551234");
  assert.equal(normalizeUsPhoneNumber("954-155-1234"), null);
  assert.equal(normalizeUsPhoneNumber("not a phone number"), null);
});

test("rejects an opt-in without affirmative consent", async () => {
  const res = createRes();
  await authHandlers.submitSmsConsent(
    createReq({ body: { phoneNumber: "(954) 555-1234", consent: false } }),
    res,
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.payload?.errorMessage || "", /check the box/i);
});

test("persists server-side consent fields without linking a member", async (t) => {
  if (!canSeedHumanBearerAuthForServerTests()) {
    t.skip("SMS consent persistence tests use the in-memory store only.");
    return;
  }

  const res = createRes();
  await authHandlers.submitSmsConsent(
    createReq({ body: validBody("(954) 555-1234"), ip: "sms-audit-ip" }),
    res,
  );
  const record = await getSmsConsentForServerTests(CHURCH_ID, "+19545551234");

  assert.deepEqual(res.payload, { success: true, verificationRequired: true });
  assert.equal(record?.phoneNumber, "+19545551234");
  assert.equal(record?.status, "pending");
  assert.equal(record?.consentedAt, undefined);
  assert.equal(record?.verifiedAt, undefined);
  assert.equal(record?.source, "web_form");
  assert.equal(record?.consentVersion, SMS_CONSENT_VERSION);
  assert.equal(record?.consentText, SMS_CONSENT_TEXT);
  assert.match(record?.consentSubmittedAt || "", /^20\d\d-/);
  assert.match(record?.verificationExpiresAt || "", /^20\d\d-/);
  assert.equal(record?.verificationCode, undefined);
  assert.equal(record?.memberId, undefined);
});

test("correct verification transitions pending consent to opted in", async (t) => {
  if (!canSeedHumanBearerAuthForServerTests()) {
    t.skip("SMS consent persistence tests use the in-memory store only.");
    return;
  }

  const phoneNumber = "+19545551235";
  const submit = createRes();
  await authHandlers.submitSmsConsent(
    createReq({ body: validBody(phoneNumber), ip: "sms-verify-ip" }),
    submit,
  );
  const verify = createRes();
  await authHandlers.verifySmsConsent(
    createReq({ body: verificationBody(phoneNumber, sentCodes.get(phoneNumber)), ip: "sms-verify-ip" }),
    verify,
  );
  const record = await getSmsConsentForServerTests(CHURCH_ID, phoneNumber);

  assert.deepEqual(verify.payload, { success: true });
  assert.equal(record?.status, "opted_in");
  assert.equal(record?.source, "web_form");
  assert.equal(record?.consentVersion, SMS_CONSENT_VERSION);
  assert.equal(record?.consentText, SMS_CONSENT_TEXT);
  assert.match(record?.consentSubmittedAt || "", /^20\d\d-/);
  assert.match(record?.consentedAt || "", /^20\d\d-/);
  assert.match(record?.verifiedAt || "", /^20\d\d-/);
  assert.equal(record?.verificationCodeHash, null);
});

test("incorrect and expired codes never become affirmative consent", async (t) => {
  if (!canSeedHumanBearerAuthForServerTests()) {
    t.skip("SMS consent persistence tests use the in-memory store only.");
    return;
  }

  const phoneNumber = "+19545551236";
  const submit = createRes();
  await authHandlers.submitSmsConsent(
    createReq({ body: validBody(phoneNumber), ip: "sms-invalid-code-ip" }),
    submit,
  );
  const invalid = createRes();
  await authHandlers.verifySmsConsent(
    createReq({ body: verificationBody(phoneNumber, "000000"), ip: "sms-invalid-code-ip" }),
    invalid,
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal((await getSmsConsentForServerTests(CHURCH_ID, phoneNumber))?.status, "pending");

  const challenge = createSmsConsentChallenge({ now: Date.now() - 20 * 60 * 1000 });
  assert.deepEqual(
    verifySmsConsentCode({
      record: {
        status: "pending",
        verificationCodeHash: challenge.codeHash,
        verificationCodeSalt: challenge.codeSalt,
        verificationExpiresAt: challenge.expiresAt,
        verificationAttempts: 0,
      },
      code: challenge.code,
    }),
    { ok: false, reason: "expired" },
  );
});

test("reverification protects the verified snapshot and records confirmation separately", async (t) => {
  if (!canSeedHumanBearerAuthForServerTests()) {
    t.skip("SMS consent persistence tests use the in-memory store only.");
    return;
  }

  const phoneNumber = "+19545551237";
  const first = createRes();
  await authHandlers.submitSmsConsent(createReq({ body: validBody(phoneNumber), ip: "sms-safe-retry-ip" }), first);
  const verify = createRes();
  await authHandlers.verifySmsConsent(
    createReq({ body: verificationBody(phoneNumber, sentCodes.get(phoneNumber)), ip: "sms-safe-retry-ip" }),
    verify,
  );
  const before = await getSmsConsentForServerTests(CHURCH_ID, phoneNumber);
  const second = createRes();
  await authHandlers.submitSmsConsent(createReq({ body: validBody(phoneNumber), ip: "sms-safe-retry-ip-2" }), second);
  const afterSubmission = await getSmsConsentForServerTests(CHURCH_ID, phoneNumber);

  assert.equal(afterSubmission?.status, "opted_in");
  for (const field of [
    "consentedAt",
    "verifiedAt",
    "consentSubmittedAt",
    "consentVersion",
    "consentText",
    "source",
  ]) {
    assert.equal(afterSubmission?.[field], before?.[field], field);
  }
  assert.notEqual(afterSubmission?.verificationCodeHash, before?.verificationCodeHash);
  assert.equal(afterSubmission?.verificationAttempts, 0);
  assert.deepEqual(second.payload, { success: true, verificationRequired: true });

  const invalid = createRes();
  await authHandlers.verifySmsConsent(
    createReq({ body: verificationBody(phoneNumber, "000000"), ip: "sms-safe-retry-ip-2" }),
    invalid,
  );
  assert.equal(invalid.statusCode, 400);
  const afterInvalid = await getSmsConsentForServerTests(CHURCH_ID, phoneNumber);
  assert.equal(afterInvalid?.status, "opted_in");
  for (const field of [
    "consentedAt",
    "verifiedAt",
    "consentSubmittedAt",
    "consentVersion",
    "consentText",
    "source",
  ]) {
    assert.equal(afterInvalid?.[field], before?.[field], field);
  }

  const reverification = createRes();
  await authHandlers.verifySmsConsent(
    createReq({ body: verificationBody(phoneNumber, sentCodes.get(phoneNumber)), ip: "sms-safe-retry-ip-2" }),
    reverification,
  );
  const afterReverification = await getSmsConsentForServerTests(CHURCH_ID, phoneNumber);

  assert.deepEqual(reverification.payload, { success: true });
  assert.equal(afterReverification?.status, "opted_in");
  for (const field of [
    "consentedAt",
    "verifiedAt",
    "consentSubmittedAt",
    "consentVersion",
    "consentText",
    "source",
  ]) {
    assert.equal(afterReverification?.[field], before?.[field], field);
  }
  assert.match(afterReverification?.verificationConfirmedAt || "", /^20\d\d-/);
});

test("rate limits repeated SMS consent submissions by IP", async () => {
  const ip = "sms-rate-limit-ip";
  for (let index = 0; index < 5; index += 1) {
    const res = createRes();
    await authHandlers.submitSmsConsent(
      createReq({
        body: validBody(`954555${String(2000 + index).padStart(4, "0")}`),
        ip,
      }),
      res,
    );
    assert.equal(res.statusCode, 200);
  }

  const limited = createRes();
  await authHandlers.submitSmsConsent(
    createReq({ body: validBody("9545552999"), ip }),
    limited,
  );
  assert.equal(limited.statusCode, 429);
  assert.match(limited.payload?.errorMessage || "", /too many/i);
});

test("opted-out consent cannot be silently reactivated through the public form", async (t) => {
  if (!canSeedHumanBearerAuthForServerTests()) {
    t.skip("SMS consent tests seed in-memory auth only.");
    return;
  }
  const phoneNumber = "+19545551239";
  await seedSmsConsentForServerTests({
    churchId: CHURCH_ID,
    phoneNumber,
    status: "opted_out",
  });
  const response = createRes();
  await authHandlers.submitSmsConsent(
    createReq({
      body: { phoneNumber, consent: true },
      ip: "sms-opted-out-ip",
    }),
    response,
  );
  assert.equal(response.statusCode, 400);
  assert.match(response.payload.errorMessage, /opted out/i);
  assert.equal(
    (await getSmsConsentForServerTests(CHURCH_ID, phoneNumber)).status,
    "opted_out",
  );
});

test("legacy phone-global consent does not authorize a church-scoped lookup", async (t) => {
  if (!canSeedHumanBearerAuthForServerTests()) {
    t.skip("SMS consent migration tests use the in-memory store only.");
    return;
  }
  const phoneNumber = "+19545551240";
  await seedLegacySmsConsentForServerTests({ phoneNumber, status: "opted_in" });
  assert.equal(
    await getSmsConsentForServerTests(CHURCH_ID, phoneNumber),
    null,
  );
});
