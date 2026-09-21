process.env.WORSHIPSYNC_SERVER_TEST_SUPPORT = "1";
process.env.FIREBASE_PROJECT_ID = "";
process.env.FIREBASE_CLIENT_EMAIL = "";
process.env.FIREBASE_PRIVATE_KEY = "";

import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeUsPhoneNumber,
  SMS_CONSENT_TEXT,
  SMS_CONSENT_VERSION,
} from "./smsConsent.js";

const {
  authHandlers,
  canSeedHumanBearerAuthForServerTests,
  getSmsConsentForServerTests,
} = await import("../authService.js");

const createReq = ({ body = {}, ip = "127.0.0.1" } = {}) => ({
  body,
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
  const record = await getSmsConsentForServerTests("+19545551234");

  assert.deepEqual(res.payload, { success: true });
  assert.equal(record?.phoneNumber, "+19545551234");
  assert.equal(record?.status, "opted_in");
  assert.equal(record?.source, "web_form");
  assert.equal(record?.consentVersion, SMS_CONSENT_VERSION);
  assert.equal(record?.consentText, SMS_CONSENT_TEXT);
  assert.match(record?.consentedAt || "", /^20\d\d-/);
  assert.equal(record?.consentedAt, record?.updatedAt);
  assert.equal(record?.createdAt, record?.updatedAt);
  assert.equal(record?.memberId, undefined);
});

test("repeat opt-in updates one record and does not disclose existence", async (t) => {
  if (!canSeedHumanBearerAuthForServerTests()) {
    t.skip("SMS consent persistence tests use the in-memory store only.");
    return;
  }

  const first = createRes();
  await authHandlers.submitSmsConsent(
    createReq({ body: validBody("(954) 555-1235"), ip: "sms-repeat-ip" }),
    first,
  );
  const before = await getSmsConsentForServerTests("+19545551235");
  await new Promise((resolve) => setTimeout(resolve, 2));
  const second = createRes();
  await authHandlers.submitSmsConsent(
    createReq({ body: validBody("+1 954 555 1235"), ip: "sms-repeat-ip-2" }),
    second,
  );
  const after = await getSmsConsentForServerTests("+19545551235");

  assert.deepEqual(first.payload, { success: true });
  assert.deepEqual(second.payload, { success: true });
  assert.equal(after?.consentId, before?.consentId);
  assert.equal(after?.createdAt, before?.createdAt);
  assert.notEqual(after?.consentedAt, before?.consentedAt);
  assert.equal(after?.updatedAt, after?.consentedAt);
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
