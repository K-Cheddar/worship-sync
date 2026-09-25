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
  SMS_CONSENT_MAX_ATTEMPTS,
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
  setServerFirestoreForTests,
} = await import("../authService.js");

const CHURCH_ID = "church_sms_consent_test";

let sentCodes = new Map();
const defaultSmsConsentSender = ({ phoneNumber, code }) => {
  sentCodes.set(phoneNumber, code);
  return { provider: "test", method: "sms_otp" };
};
setSmsConsentSenderForServerTests(defaultSmsConsentSender);

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

const clone = (value) => (value == null ? value : structuredClone(value));

const createTransactionalFirestoreMock = () => {
  const documents = new Map();
  const versions = new Map();
  const keyFor = (collectionName, id) => `${collectionName}/${id}`;
  const refFor = (collectionName, id) => ({
    collectionName,
    id: String(id),
    key: keyFor(collectionName, String(id)),
  });
  const read = (ref) => {
    const value = documents.get(ref.key);
    return {
      exists: documents.has(ref.key),
      id: ref.id,
      data: () => clone(value),
    };
  };
  const applyWrite = (ref, data, merge) => {
    const current = documents.get(ref.key) || {};
    documents.set(ref.key, merge ? { ...current, ...clone(data) } : clone(data));
    versions.set(ref.key, (versions.get(ref.key) || 0) + 1);
  };

  return {
    collection(collectionName) {
      return {
        doc(id) {
          const ref = refFor(collectionName, id);
          return {
            ...ref,
            async get() {
              return read(ref);
            },
            async set(data, { merge = false } = {}) {
              applyWrite(ref, data, merge);
            },
          };
        },
      };
    },
    async runTransaction(callback) {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const readVersions = new Map();
        const writes = [];
        const transaction = {
          async get(ref) {
            const snapshot = read(ref);
            readVersions.set(ref.key, versions.get(ref.key) || 0);
            return snapshot;
          },
          set(ref, data, { merge = false } = {}) {
            writes.push({ ref, data, merge });
          },
        };
        const result = await callback(transaction);
        const hasConflict = Array.from(readVersions.entries()).some(
          ([key, version]) => (versions.get(key) || 0) !== version,
        );
        if (hasConflict) continue;
        for (const { ref, data, merge } of writes) {
          applyWrite(ref, data, merge);
        }
        return result;
      }
      throw new Error("Firestore mock transaction retry limit exceeded");
    },
  };
};

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

test("reports missing SMS setup as a verification delivery failure and keeps consent pending", async (t) => {
  if (!canSeedHumanBearerAuthForServerTests()) {
    t.skip("SMS consent persistence tests use the in-memory store only.");
    return;
  }
  setSmsConsentSenderForServerTests(() => {
    throw Object.assign(new Error("SMS messaging is not configured on this server."), {
      code: "sms_provider_not_configured",
      statusCode: 503,
    });
  });
  t.after(() => setSmsConsentSenderForServerTests(defaultSmsConsentSender));

  const phoneNumber = "+19545551244";
  const response = createRes();
  await authHandlers.submitSmsConsent(
    createReq({ body: validBody(phoneNumber), ip: "sms-provider-config-failure-ip" }),
    response,
  );

  assert.equal(response.statusCode, 503);
  assert.match(response.payload.errorMessage, /verification is not configured/i);
  assert.doesNotMatch(response.payload.errorMessage, /could not save/i);
  const record = await getSmsConsentForServerTests(CHURCH_ID, phoneNumber);
  assert.equal(record.status, "pending");
  assert.ok(record.verificationCodeHash);
});

test("Firestore verification commits invalid attempts and preserves the lockout", async (t) => {
  setServerFirestoreForTests(createTransactionalFirestoreMock());
  t.after(() => setServerFirestoreForTests(null));

  const submit = async (phoneNumber, ip) => {
    const response = createRes();
    await authHandlers.submitSmsConsent(
      createReq({ body: validBody(phoneNumber), ip }),
      response,
    );
    assert.deepEqual(response.payload, {
      success: true,
      verificationRequired: true,
    });
  };
  const verify = async (phoneNumber, code, ip) => {
    const response = createRes();
    await authHandlers.verifySmsConsent(
      createReq({ body: verificationBody(phoneNumber, code), ip }),
      response,
    );
    return response;
  };
  const invalidCode = (phoneNumber) =>
    sentCodes.get(phoneNumber) === "000000" ? "999999" : "000000";

  const oneAttemptPhone = "+19545551241";
  await submit(oneAttemptPhone, "sms-firestore-one-ip");
  const oneAttemptResponse = await verify(
    oneAttemptPhone,
    invalidCode(oneAttemptPhone),
    "sms-firestore-one-ip",
  );
  assert.equal(oneAttemptResponse.statusCode, 400);
  assert.equal(
    (await getSmsConsentForServerTests(CHURCH_ID, oneAttemptPhone))
      ?.verificationAttempts,
    1,
  );

  const repeatedPhone = "+19545551242";
  await submit(repeatedPhone, "sms-firestore-repeated-ip");
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await verify(
      repeatedPhone,
      invalidCode(repeatedPhone),
      "sms-firestore-repeated-ip",
    );
    assert.equal(response.statusCode, 400);
    assert.equal(
      (await getSmsConsentForServerTests(CHURCH_ID, repeatedPhone))
        ?.verificationAttempts,
      attempt,
    );
  }

  const lockedPhone = "+19545551243";
  await submit(lockedPhone, "sms-firestore-locked-ip");
  for (let attempt = 0; attempt < SMS_CONSENT_MAX_ATTEMPTS; attempt += 1) {
    assert.equal(
      (await verify(
        lockedPhone,
        invalidCode(lockedPhone),
        "sms-firestore-locked-ip",
      )).statusCode,
      400,
    );
  }
  const lockedRecord = await getSmsConsentForServerTests(CHURCH_ID, lockedPhone);
  assert.equal(lockedRecord?.verificationAttempts, SMS_CONSENT_MAX_ATTEMPTS);
  assert.equal(lockedRecord?.verificationCodeHash, null);
  assert.equal(
    (await verify(
      lockedPhone,
      sentCodes.get(lockedPhone),
      "sms-firestore-locked-ip",
    )).statusCode,
    400,
  );
  assert.equal(
    (await getSmsConsentForServerTests(CHURCH_ID, lockedPhone))?.status,
    "pending",
  );

  const validPhone = "+19545551244";
  await submit(validPhone, "sms-firestore-valid-ip");
  assert.equal(
    (await verify(
      validPhone,
      invalidCode(validPhone),
      "sms-firestore-valid-ip",
    )).statusCode,
    400,
  );
  const validResponse = await verify(
    validPhone,
    sentCodes.get(validPhone),
    "sms-firestore-valid-ip",
  );
  assert.deepEqual(validResponse.payload, { success: true });
  assert.equal(
    (await getSmsConsentForServerTests(CHURCH_ID, validPhone))?.status,
    "opted_in",
  );

  const concurrentPhone = "+19545551245";
  const concurrentIp = "sms-firestore-concurrent-ip";
  await submit(concurrentPhone, concurrentIp);
  const concurrentResponses = await Promise.all(
    Array.from({ length: 4 }, () =>
      verify(concurrentPhone, invalidCode(concurrentPhone), concurrentIp),
    ),
  );
  assert.deepEqual(
    concurrentResponses.map((response) => response.statusCode),
    [400, 400, 400, 400],
  );
  assert.equal(
    (await getSmsConsentForServerTests(CHURCH_ID, concurrentPhone))
      ?.verificationAttempts,
    4,
  );
  assert.equal(
    (await verify(
      concurrentPhone,
      invalidCode(concurrentPhone),
      concurrentIp,
    )).statusCode,
    400,
  );
  const concurrentRecord = await getSmsConsentForServerTests(
    CHURCH_ID,
    concurrentPhone,
  );
  assert.equal(concurrentRecord?.verificationAttempts, 5);
  assert.equal(concurrentRecord?.verificationCodeHash, null);
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
