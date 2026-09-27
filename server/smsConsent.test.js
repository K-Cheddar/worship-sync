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
  smsConsentIdForChurchPhone,
  verifySmsConsentCode,
} from "./smsConsent.js";

const {
  COLLECTIONS,
  authHandlers,
  canSeedHumanBearerAuthForServerTests,
  getSmsConsentForServerTests,
  seedSmsConsentForServerTests,
  seedLegacySmsConsentForServerTests,
  setServerFirestoreForTests,
  setDoc,
} = await import("../authService.js");

const CHURCH_ID = "church_sms_consent_test";

let sentCodes = new Map();
let sentChallengeIds = new Map();
setSmsConsentSenderForServerTests(({ phoneNumber, code, challengeId }) => {
  sentCodes.set(phoneNumber, code);
  sentChallengeIds.set(phoneNumber, challengeId);
  return { provider: "test", method: "sms_otp" };
});

const createReq = ({ body = {}, ip = "127.0.0.1", churchId = CHURCH_ID } = {}) => ({
  body,
  params: { churchId },
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

const verificationBody = (phoneNumber, code) => ({
  phoneNumber,
  code,
  challengeId: sentChallengeIds.get(phoneNumber),
});
const cancellationBody = (phoneNumber, submitResponse, overrides = {}) => ({
  phoneNumber,
  challengeId: submitResponse.payload.challengeId,
  cancellationToken: submitResponse.payload.cancellationToken,
  ...overrides,
});

const submitChallenge = async (phoneNumber, ip = "127.0.0.1", churchId = CHURCH_ID) => {
  const response = createRes();
  await authHandlers.submitSmsConsent(
    createReq({ body: validBody(phoneNumber), ip, churchId }),
    response,
  );
  return response;
};

const cancelChallenge = async (phoneNumber, challengeResponse, options = {}) => {
  const response = createRes();
  await authHandlers.cancelSmsConsent(
    createReq({
      body: cancellationBody(phoneNumber, challengeResponse, options.body),
      ip: options.ip || "127.0.0.1",
      churchId: options.churchId || CHURCH_ID,
    }),
    response,
  );
  return response;
};

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

  assert.equal(res.payload?.success, true);
  assert.equal(res.payload?.verificationRequired, true);
  assert.match(res.payload?.challengeId || "", /^[a-f\d]{32}$/i);
  assert.match(res.payload?.cancellationToken || "", /^[A-Za-z\d_-]{43}$/);
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
  assert.equal(record?.verificationChallengeId, res.payload.challengeId);
  assert.match(record?.verificationCancellationTokenHash || "", /^[a-f\d]{64}$/i);
  assert.notEqual(
    record?.verificationCancellationTokenHash,
    res.payload.cancellationToken,
  );
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

test("cancelling a pending challenge invalidates its OTP and is idempotent", async (t) => {
  if (!canSeedHumanBearerAuthForServerTests()) {
    t.skip("SMS consent persistence tests use the in-memory store only.");
    return;
  }

  const phoneNumber = "+19545551246";
  const submitted = await submitChallenge(phoneNumber, "sms-cancel-success-ip");
  const before = await getSmsConsentForServerTests(CHURCH_ID, phoneNumber);
  const cancelled = await cancelChallenge(phoneNumber, submitted, {
    ip: "sms-cancel-success-ip",
  });
  assert.deepEqual(cancelled.payload, { success: true, cancelled: true });

  const after = await getSmsConsentForServerTests(CHURCH_ID, phoneNumber);
  assert.equal(after?.status, "pending");
  assert.equal(after?.consentedAt, undefined);
  assert.equal(after?.verifiedAt, undefined);
  assert.equal(after?.verificationCodeHash, null);
  assert.equal(after?.verificationChallengeId, null);
  assert.equal(after?.verificationCancellationTokenHash, null);
  assert.equal(after?.lastCancelledVerificationChallengeId, submitted.payload.challengeId);
  assert.match(after?.verificationCancelledAt || "", /^20\d\d-/);

  const oldOtp = createRes();
  await authHandlers.verifySmsConsent(
    createReq({
      body: {
        phoneNumber,
        code: sentCodes.get(phoneNumber),
        challengeId: submitted.payload.challengeId,
      },
      ip: "sms-cancel-success-ip",
    }),
    oldOtp,
  );
  assert.equal(oldOtp.statusCode, 400);
  assert.equal(
    (await getSmsConsentForServerTests(CHURCH_ID, phoneNumber))?.status,
    "pending",
  );

  const repeated = await cancelChallenge(phoneNumber, submitted, {
    ip: "sms-cancel-success-ip",
  });
  assert.deepEqual(repeated.payload, { success: true, cancelled: true });
  assert.equal(
    (await getSmsConsentForServerTests(CHURCH_ID, phoneNumber))
      ?.verificationCancelledAt,
    after?.verificationCancelledAt,
  );
  assert.notEqual(before?.verificationCodeHash, after?.verificationCodeHash);

  const nextChallenge = await submitChallenge(
    phoneNumber,
    "sms-cancel-success-ip-next",
  );
  const staleCancellation = await cancelChallenge(phoneNumber, submitted, {
    ip: "sms-cancel-success-ip-next",
  });
  assert.deepEqual(staleCancellation.payload, {
    success: true,
    cancelled: false,
  });
  assert.equal(
    (await getSmsConsentForServerTests(CHURCH_ID, phoneNumber))
      ?.verificationChallengeId,
    nextChallenge.payload.challengeId,
  );
});

test("verification and cancellation cannot both consume the same pending challenge", async (t) => {
  if (!canSeedHumanBearerAuthForServerTests()) {
    t.skip("SMS consent persistence tests use the in-memory store only.");
    return;
  }

  const phoneNumber = "+19545551265";
  const submitted = await submitChallenge(phoneNumber, "sms-cancel-race-ip");
  const cancellation = cancelChallenge(phoneNumber, submitted, {
    ip: "sms-cancel-race-ip",
  });
  const verification = createRes();
  const verificationRequest = authHandlers.verifySmsConsent(
    createReq({
      body: {
        phoneNumber,
        code: sentCodes.get(phoneNumber),
        challengeId: submitted.payload.challengeId,
      },
      ip: "sms-cancel-race-ip",
    }),
    verification,
  );
  const [cancelled] = await Promise.all([cancellation, verificationRequest]);

  assert.deepEqual(cancelled.payload, { success: true, cancelled: true });
  assert.equal(verification.statusCode, 400);
  const record = await getSmsConsentForServerTests(CHURCH_ID, phoneNumber);
  assert.equal(record?.status, "pending");
  assert.equal(record?.verificationCodeHash, null);

  const secondPhone = "+19545551266";
  const secondSubmitted = await submitChallenge(
    secondPhone,
    "sms-verify-race-ip",
  );
  const successfulVerification = createRes();
  const successfulVerificationRequest = authHandlers.verifySmsConsent(
    createReq({
      body: {
        phoneNumber: secondPhone,
        code: sentCodes.get(secondPhone),
        challengeId: secondSubmitted.payload.challengeId,
      },
      ip: "sms-verify-race-ip",
    }),
    successfulVerification,
  );
  const lateCancellation = cancelChallenge(secondPhone, secondSubmitted, {
    ip: "sms-verify-race-ip",
  });
  await Promise.all([successfulVerificationRequest, lateCancellation]);
  assert.deepEqual(successfulVerification.payload, { success: true });
  assert.deepEqual((await lateCancellation).payload, {
    success: true,
    cancelled: false,
  });
  const verifiedRecord = await getSmsConsentForServerTests(CHURCH_ID, secondPhone);
  assert.equal(verifiedRecord?.status, "opted_in");
  assert.match(verifiedRecord?.consentedAt || "", /^20\d\d-/);
});

test("cancellation requires its capability and does not disclose consent state", async () => {
  const phoneNumber = "+19545551247";
  const submitted = await submitChallenge(phoneNumber, "sms-cancel-capability-ip");
  const denied = await cancelChallenge(phoneNumber, submitted, {
    ip: "sms-cancel-capability-ip",
    body: { cancellationToken: "A".repeat(43) },
  });

  assert.deepEqual(denied.payload, { success: true, cancelled: false });
  assert.equal(
    (await getSmsConsentForServerTests(CHURCH_ID, phoneNumber))?.status,
    "pending",
  );
  const validCode = createRes();
  await authHandlers.verifySmsConsent(
    createReq({
      body: verificationBody(phoneNumber, sentCodes.get(phoneNumber)),
      ip: "sms-cancel-capability-ip",
    }),
    validCode,
  );
  assert.deepEqual(validCode.payload, { success: true });
});

test("cancellation is isolated to the church and challenge that issued it", async () => {
  const phoneNumber = "+19545551248";
  const submitted = await submitChallenge(phoneNumber, "sms-cancel-scope-ip");
  const supersededCode = sentCodes.get(phoneNumber);
  const wrongChurch = await cancelChallenge(phoneNumber, submitted, {
    ip: "sms-cancel-scope-ip",
    churchId: "another_church",
  });
  assert.deepEqual(wrongChurch.payload, { success: true, cancelled: false });
  assert.equal(
    (await getSmsConsentForServerTests(CHURCH_ID, phoneNumber))?.status,
    "pending",
  );

  const submittedAgain = await submitChallenge(
    phoneNumber,
    "sms-cancel-scope-ip-2",
  );
  const superseded = await cancelChallenge(phoneNumber, submitted, {
    ip: "sms-cancel-scope-ip-2",
  });
  assert.deepEqual(superseded.payload, { success: true, cancelled: false });
  const afterSupersededCancel = await getSmsConsentForServerTests(
    CHURCH_ID,
    phoneNumber,
  );
  assert.equal(
    afterSupersededCancel?.verificationChallengeId,
    submittedAgain.payload.challengeId,
  );

  const oldCode = createRes();
  await authHandlers.verifySmsConsent(
    createReq({
      body: {
        phoneNumber,
        code: supersededCode,
        challengeId: submitted.payload.challengeId,
      },
      ip: "sms-cancel-scope-ip-2",
    }),
    oldCode,
  );
  assert.equal(oldCode.statusCode, 400);

  const currentCode = createRes();
  await authHandlers.verifySmsConsent(
    createReq({
      body: {
        phoneNumber,
        code: sentCodes.get(phoneNumber),
        challengeId: submittedAgain.payload.challengeId,
      },
      ip: "sms-cancel-scope-ip-3",
    }),
    currentCode,
  );
  assert.deepEqual(currentCode.payload, { success: true });
});

test("expired cancellation capabilities cannot affect the consent record", async () => {
  const phoneNumber = "+19545551249";
  const submitted = await submitChallenge(phoneNumber, "sms-cancel-expired-ip");
  const record = await getSmsConsentForServerTests(CHURCH_ID, phoneNumber);
  await setDoc(
    COLLECTIONS.smsConsents,
    record.id,
    {
      verificationExpiresAt: new Date(Date.now() - 1000).toISOString(),
      verificationCancellationExpiresAt: new Date(Date.now() - 1000).toISOString(),
    },
    { merge: true },
  );

  const expired = await cancelChallenge(phoneNumber, submitted, {
    ip: "sms-cancel-expired-ip",
  });
  assert.deepEqual(expired.payload, { success: true, cancelled: false });
  const after = await getSmsConsentForServerTests(CHURCH_ID, phoneNumber);
  assert.equal(after?.status, "pending");
  assert.equal(after?.consentedAt, undefined);
  assert.ok(after?.verificationCodeHash);
  const verify = createRes();
  await authHandlers.verifySmsConsent(
    createReq({
      body: {
        phoneNumber,
        code: sentCodes.get(phoneNumber),
        challengeId: submitted.payload.challengeId,
      },
      ip: "sms-cancel-expired-ip",
    }),
    verify,
  );
  assert.equal(verify.statusCode, 400);
});

test("cancelling a re-verification challenge preserves prior verified consent", async () => {
  const phoneNumber = "+19545551250";
  const first = await submitChallenge(phoneNumber, "sms-cancel-verified-ip-1");
  const verify = createRes();
  await authHandlers.verifySmsConsent(
    createReq({
      body: verificationBody(phoneNumber, sentCodes.get(phoneNumber)),
      ip: "sms-cancel-verified-ip-1",
    }),
    verify,
  );
  assert.deepEqual(verify.payload, { success: true });
  const before = await getSmsConsentForServerTests(CHURCH_ID, phoneNumber);

  const reverification = await submitChallenge(
    phoneNumber,
    "sms-cancel-verified-ip-2",
  );
  const cancelled = await cancelChallenge(phoneNumber, reverification, {
    ip: "sms-cancel-verified-ip-2",
  });
  assert.deepEqual(cancelled.payload, { success: true, cancelled: true });
  const after = await getSmsConsentForServerTests(CHURCH_ID, phoneNumber);
  assert.equal(after?.status, "opted_in");
  assert.equal(after?.consentedAt, before?.consentedAt);
  assert.equal(after?.verifiedAt, before?.verifiedAt);
  assert.equal(after?.consentSubmittedAt, before?.consentSubmittedAt);
  assert.equal(after?.verificationCodeHash, null);
  assert.equal(after?.verificationChallengeId, null);
  assert.notEqual(first.payload.challengeId, reverification.payload.challengeId);
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
    assert.equal(response.payload?.success, true);
    assert.equal(response.payload?.verificationRequired, true);
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

test("Firestore cancellation transaction clears only its pending challenge", async (t) => {
  const firestore = createTransactionalFirestoreMock();
  setServerFirestoreForTests(firestore);
  t.after(() => setServerFirestoreForTests(null));

  const phoneNumber = "+19545551267";
  const submitted = await submitChallenge(
    phoneNumber,
    "sms-firestore-cancel-ip",
  );
  const consentRef = firestore
    .collection(COLLECTIONS.smsConsents)
    .doc(smsConsentIdForChurchPhone(CHURCH_ID, phoneNumber));
  const before = await consentRef.get();
  assert.equal(before.data()?.status, "pending");
  assert.ok(before.data()?.verificationCodeHash);

  const cancellation = await cancelChallenge(phoneNumber, submitted, {
    ip: "sms-firestore-cancel-ip",
  });
  assert.deepEqual(cancellation.payload, { success: true, cancelled: true });
  const after = await consentRef.get();
  assert.equal(after.data()?.status, "pending");
  assert.equal(after.data()?.verificationCodeHash, null);
  assert.equal(after.data()?.verificationCodeSalt, null);
  assert.equal(after.data()?.verificationChallengeId, null);
  assert.equal(after.data()?.verificationCancellationTokenHash, null);
  assert.equal(after.data()?.consentedAt, undefined);
  assert.equal(after.data()?.verifiedAt, undefined);

  const staleVerification = createRes();
  await authHandlers.verifySmsConsent(
    createReq({
      body: {
        phoneNumber,
        code: sentCodes.get(phoneNumber),
        challengeId: submitted.payload.challengeId,
      },
      ip: "sms-firestore-cancel-ip",
    }),
    staleVerification,
  );
  assert.equal(staleVerification.statusCode, 400);
  assert.equal((await consentRef.get()).data()?.status, "pending");
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
  assert.equal(second.payload?.success, true);
  assert.equal(second.payload?.verificationRequired, true);

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
