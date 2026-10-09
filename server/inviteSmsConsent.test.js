process.env.WORSHIPSYNC_SERVER_TEST_SUPPORT = "1";
process.env.FIREBASE_PROJECT_ID = "";
process.env.FIREBASE_CLIENT_EMAIL = "";
process.env.FIREBASE_PRIVATE_KEY = "";

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setSmsConsentSenderForServerTests } from "./smsConsent.js";

const {
  authHandlers,
  authRuntimeInfo,
  COLLECTIONS,
  getDoc,
  getSmsConsentForServerTests,
  seedActiveHumanBearerForServerTests,
  seedPendingInviteForServerTests,
  seedRosterMemberForServerTests,
  setDoc,
  seedSmsConsentForServerTests,
  setAuthReadObserverForServerTests,
  setServerFirestoreForTests,
  setVerifyIdTokenForServerTests,
} = await import("../authService.js");
const { smsConsentIdForChurchPhone } = await import("./smsConsent.js");

const createReq = ({ body = {}, query = {}, ip = "invite-sms-test" } = {}) => ({
  body,
  query,
  params: {},
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

const createFirestoreMock = () => {
  const documents = new Map();
  const keyFor = (collection, id) => `${collection}/${id}`;
  const snapshotFor = (collection, id) => {
    const value = documents.get(keyFor(collection, id));
    return {
      id,
      exists: Boolean(value),
      data: () => value ? structuredClone(value) : undefined,
    };
  };
  const reference = (collection, id) => ({
    collection,
    id,
    async get() { return snapshotFor(collection, id); },
    async set(value, { merge = false } = {}) {
      const key = keyFor(collection, id);
      documents.set(key, merge ? { ...(documents.get(key) || {}), ...structuredClone(value) } : structuredClone(value));
    },
  });
  return {
    seed(collection, id, value) { documents.set(keyFor(collection, id), structuredClone(value)); },
    collection(collection) {
      return {
        doc(id) { return reference(collection, id); },
        where(field, operator, value) {
          const filters = [[field, operator, value]];
          const query = {
            where(nextField, nextOperator, nextValue) {
              filters.push([nextField, nextOperator, nextValue]);
              return query;
            },
            limit() { return query; },
            async get() {
              const docs = [...documents.entries()]
                .filter(([key]) => key.startsWith(`${collection}/`))
                .filter(([, data]) => filters.every(([name, op, expected]) =>
                  op === "==" && data[name] === expected))
                .map(([key]) => ({
                  id: key.slice(collection.length + 1),
                  data: () => structuredClone(documents.get(key)),
                }));
              return { docs };
            },
          };
          return query;
        },
      };
    },
    async runTransaction(callback) {
      const writes = [];
      const transaction = {
        async get(ref) { return snapshotFor(ref.collection, ref.id); },
        set(ref, value, { merge = false } = {}) { writes.push({ ref, value, merge }); },
      };
      const result = await callback(transaction);
      for (const { ref, value, merge } of writes) {
        await reference(ref.collection, ref.id).set(value, { merge });
      }
      return result;
    },
  };
};

let sentCode = "";
let sendCount = 0;
const defaultSmsConsentSender = ({ code }) => {
  sentCode = code;
  sendCount += 1;
  return { provider: "test", method: "sms_otp" };
};
setSmsConsentSenderForServerTests(defaultSmsConsentSender);

const setupAcceptedInvite = async ({
  label,
  memberId = `member-${label}`,
  phoneNumber = "+12125550123",
  churchId: suppliedChurchId,
} = {}) => {
  const churchId = suppliedChurchId || `invite_sms_${label}`;
  const email = `${label}@example.com`;
  const userId = `user-${label}`;
  const req = { session: {} };
  const { humanApiToken } = await seedActiveHumanBearerForServerTests({
    req,
    userId,
    email,
    churchId,
  });
  const { token, inviteId } = await seedPendingInviteForServerTests({
    churchId,
    email,
    token: `invite-token-${label}`,
    inviteId: `invite-${label}`,
    memberId: phoneNumber ? memberId : "",
    status: "accepted",
    acceptedAt: new Date().toISOString(),
  });
  if (phoneNumber) {
    await seedRosterMemberForServerTests({ memberId, churchId, phoneNumber });
  }
  setVerifyIdTokenForServerTests(async (idToken) => {
    assert.equal(idToken, "firebase-id-token");
    return { uid: userId, email };
  });
  return { churchId, email, userId, token, inviteId, memberId, humanApiToken };
};

const consentBody = ({ invite, phoneNumber, expectedRosterPhoneNumber, challengeId = "a".repeat(32) }) => ({
  inviteToken: invite.token,
  idToken: "firebase-id-token",
  phoneNumber,
  expectedRosterPhoneNumber,
  consent: true,
  challengeId,
  cancellationToken: "b".repeat(43),
});

test("invitation SMS enrollment stays disabled unless the rollout flag is enabled", async (t) => {
  if (authRuntimeInfo.hasFirestore) return t.skip("Uses in-memory auth storage only.");
  const previousFlag = process.env.SMS_INVITE_CONSENT_ENABLED;
  delete process.env.SMS_INVITE_CONSENT_ENABLED;
  t.after(() => {
    if (previousFlag === undefined) delete process.env.SMS_INVITE_CONSENT_ENABLED;
    else process.env.SMS_INVITE_CONSENT_ENABLED = previousFlag;
  });
  const invite = await setupAcceptedInvite({ label: "disabled" });
  const res = createRes();
  await authHandlers.submitInviteSmsConsent(
    createReq({ body: consentBody({ invite, phoneNumber: "+12125550123", expectedRosterPhoneNumber: "+12125550123" }) }),
    res,
  );
  assert.equal(res.statusCode, 503);
  assert.equal(sendCount, 0);
});

test("unauthenticated invitation preview does not expose roster phone or SMS consent", async (t) => {
  if (authRuntimeInfo.hasFirestore) return t.skip("Uses in-memory auth storage only.");
  const invite = await setupAcceptedInvite({ label: "preview" });
  process.env.SMS_INVITE_CONSENT_ENABLED = "true";
  t.after(() => delete process.env.SMS_INVITE_CONSENT_ENABLED);
  const res = createRes();
  await authHandlers.getInvitePreview(createReq({ query: { token: invite.token } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal("rosterPhoneNumber" in res.payload, false);
  assert.equal("smsConsentStatus" in res.payload, false);
  assert.equal(res.payload.smsInviteConsentEnabled, true);
});

test("accepted invited identity can load its prefilled SMS details", async (t) => {
  if (authRuntimeInfo.hasFirestore) return t.skip("Uses in-memory auth storage only.");
  const invite = await setupAcceptedInvite({ label: "private-context" });
  process.env.SMS_INVITE_CONSENT_ENABLED = "true";
  t.after(() => {
    delete process.env.SMS_INVITE_CONSENT_ENABLED;
    setVerifyIdTokenForServerTests(null);
  });
  const anonymous = createRes();
  await authHandlers.getInviteSmsContext(createReq({ body: { inviteToken: invite.token } }), anonymous);
  assert.equal(anonymous.statusCode, 401);
  assert.equal("rosterPhoneNumber" in (anonymous.payload || {}), false);
  await seedSmsConsentForServerTests({
    churchId: invite.churchId,
    phoneNumber: "+12125550123",
    status: "opted_in",
  });
  const res = createRes();
  await authHandlers.getInviteSmsContext(createReq({ body: {
    inviteToken: invite.token,
    idToken: "firebase-id-token",
  } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.rosterPhoneNumber, "+12125550123");
  assert.equal(res.payload.smsConsentStatus, "opted_in");
});

test("invitation signup sends one OTP, records provenance, and activates only after verification", async (t) => {
  if (authRuntimeInfo.hasFirestore) return t.skip("Uses in-memory auth storage only.");
  const invite = await setupAcceptedInvite({ label: "verify" });
  process.env.SMS_INVITE_CONSENT_ENABLED = "true";
  t.after(() => {
    delete process.env.SMS_INVITE_CONSENT_ENABLED;
    setVerifyIdTokenForServerTests(null);
  });
  sendCount = 0;
  const body = consentBody({
    invite,
    phoneNumber: "+12125550123",
    expectedRosterPhoneNumber: "+12125550123",
  });
  const start = createRes();
  await authHandlers.submitInviteSmsConsent(createReq({ body }), start);
  assert.equal(start.statusCode, 200);
  assert.equal(start.payload.outcome, "verification_required");
  assert.equal(sendCount, 1);
  const pending = await getSmsConsentForServerTests(invite.churchId, body.phoneNumber);
  assert.equal(pending.status, "pending");
  assert.equal(pending.source, "invite_signup");
  assert.equal(pending.signupOrigin, "church_invitation");
  assert.equal(pending.inviteId, invite.inviteId);
  assert.equal(pending.memberId, invite.memberId);
  assert.equal(pending.userId, invite.userId);
  assert.equal(pending.consentedAt, undefined);

  const retry = createRes();
  await authHandlers.submitInviteSmsConsent(createReq({ body }), retry);
  assert.equal(retry.payload.challengeId, start.payload.challengeId);
  assert.equal(sendCount, 1);

  const invalidVerify = createRes();
  await authHandlers.verifyInviteSmsConsent(
    createReq({ body: { ...body, code: "000000" } }),
    invalidVerify,
  );
  assert.equal(invalidVerify.statusCode, 400);
  assert.equal(
    (await getSmsConsentForServerTests(invite.churchId, body.phoneNumber)).status,
    "pending",
  );

  const verify = createRes();
  await authHandlers.verifyInviteSmsConsent(
    createReq({ body: { ...body, code: sentCode } }),
    verify,
  );
  assert.deepEqual(verify.payload, { success: true });
  const active = await getSmsConsentForServerTests(invite.churchId, body.phoneNumber);
  assert.equal(active.status, "opted_in");
  assert.ok(active.verifiedAt);
});

test("invitation fallback accepts a number when no roster phone is available", async (t) => {
  if (authRuntimeInfo.hasFirestore) return t.skip("Uses in-memory auth storage only.");
  const invite = await setupAcceptedInvite({ label: "fallback", phoneNumber: "" });
  process.env.SMS_INVITE_CONSENT_ENABLED = "true";
  t.after(() => {
    delete process.env.SMS_INVITE_CONSENT_ENABLED;
    setVerifyIdTokenForServerTests(null);
  });
  const body = consentBody({
    invite,
    phoneNumber: "+14155550101",
    expectedRosterPhoneNumber: "",
  });
  const res = createRes();
  await authHandlers.submitInviteSmsConsent(createReq({ body }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.outcome, "verification_required");
  const record = await getSmsConsentForServerTests(invite.churchId, body.phoneNumber);
  assert.equal(record.memberId, null);
  assert.equal(record.rosterPhoneSnapshot, null);
});

test("invitation signup preserves existing opted-in and opted-out consent", async (t) => {
  if (authRuntimeInfo.hasFirestore) return t.skip("Uses in-memory auth storage only.");
  const { seedSmsConsentForServerTests } = await import("../authService.js");
  const invite = await setupAcceptedInvite({ label: "existing" });
  process.env.SMS_INVITE_CONSENT_ENABLED = "true";
  t.after(() => {
    delete process.env.SMS_INVITE_CONSENT_ENABLED;
    setVerifyIdTokenForServerTests(null);
  });
  sendCount = 0;
  const body = consentBody({
    invite,
    phoneNumber: "+12125550123",
    expectedRosterPhoneNumber: "+12125550123",
  });
  await seedSmsConsentForServerTests({ churchId: invite.churchId, phoneNumber: body.phoneNumber, status: "opted_in" });
  const activeRes = createRes();
  await authHandlers.submitInviteSmsConsent(createReq({ body }), activeRes);
  assert.equal(activeRes.payload.outcome, "already_opted_in");
  assert.equal(sendCount, 0);

  await seedSmsConsentForServerTests({ churchId: invite.churchId, phoneNumber: body.phoneNumber, status: "opted_out", optedOutAt: new Date().toISOString() });
  const optedOutRes = createRes();
  await authHandlers.submitInviteSmsConsent(createReq({ body }), optedOutRes);
  assert.equal(optedOutRes.payload.outcome, "opted_out");
  assert.equal(sendCount, 0);
  const unchanged = await getSmsConsentForServerTests(invite.churchId, body.phoneNumber);
  assert.equal(unchanged.status, "opted_out");
});

test("invitation signup observes consent that becomes opted in between its read and upsert", async (t) => {
  if (authRuntimeInfo.hasFirestore) return t.skip("Uses in-memory auth storage only.");
  const invite = await setupAcceptedInvite({ label: "opted-in-read-race" });
  process.env.SMS_INVITE_CONSENT_ENABLED = "true";
  t.after(() => {
    delete process.env.SMS_INVITE_CONSENT_ENABLED;
    setVerifyIdTokenForServerTests(null);
    setAuthReadObserverForServerTests(null);
  });
  const body = consentBody({ invite, phoneNumber: "+12125550123", expectedRosterPhoneNumber: "+12125550123" });
  let raced = false;
  setAuthReadObserverForServerTests((event) => {
    if (raced || event.collectionName !== "smsConsents") return;
    raced = true;
    queueMicrotask(() => {
      void setDoc("smsConsents", event.id, { status: "opted_in" }, { merge: true });
    });
  });
  sendCount = 0;
  const result = createRes();
  await authHandlers.submitInviteSmsConsent(createReq({ body }), result);
  assert.equal(raced, true);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.payload, { success: true, outcome: "already_opted_in" });
  assert.equal(sendCount, 0);
});

test("Firestore consent upsert returns already opted in when its transaction sees a concurrent verification", async (t) => {
  if (authRuntimeInfo.hasFirestore) return t.skip("Uses a Firestore test double.");
  const invite = await setupAcceptedInvite({ label: "firestore-opted-in-read-race" });
  process.env.SMS_INVITE_CONSENT_ENABLED = "true";
  const firestore = createFirestoreMock();
  const phoneNumber = "+12125550123";
  const consentId = smsConsentIdForChurchPhone(invite.churchId, phoneNumber);
  firestore.seed("invites", invite.inviteId, {
    inviteId: invite.inviteId, churchId: invite.churchId, memberId: invite.memberId,
    email: invite.email, status: "accepted",
    tokenHash: createHash("sha256").update(invite.token).digest("hex"),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  firestore.seed("memberships", `${invite.churchId}_${invite.userId}`, {
    churchId: invite.churchId, userId: invite.userId, status: "active",
  });
  firestore.seed("teamRosterMembers", invite.memberId, {
    memberId: invite.memberId, churchId: invite.churchId, phoneNumber,
  });
  const originalCollection = firestore.collection.bind(firestore);
  let interleaved = false;
  firestore.collection = (collectionName) => {
    const collection = originalCollection(collectionName);
    if (collectionName !== "smsConsents") return collection;
    return {
      ...collection,
      doc(id) {
        const reference = collection.doc(id);
        return {
          ...reference,
          async get() {
            const snapshot = await reference.get();
            if (id === consentId && !interleaved) {
              interleaved = true;
              queueMicrotask(() => firestore.seed("smsConsents", consentId, {
                consentId, churchId: invite.churchId, phoneNumber, status: "opted_in",
              }));
            }
            return snapshot;
          },
        };
      },
    };
  };
  setServerFirestoreForTests(firestore);
  t.after(() => {
    delete process.env.SMS_INVITE_CONSENT_ENABLED;
    setVerifyIdTokenForServerTests(null);
    setServerFirestoreForTests(null);
  });
  sendCount = 0;
  const result = createRes();
  await authHandlers.submitInviteSmsConsent(createReq({ body: consentBody({
    invite, phoneNumber, expectedRosterPhoneNumber: phoneNumber,
  }) }), result);
  assert.equal(interleaved, true);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.payload, { success: true, outcome: "already_opted_in" });
  assert.equal(sendCount, 0);
});

test("a pre-send failure clears its unsent challenge so invite SMS can be retried immediately", async (t) => {
  if (authRuntimeInfo.hasFirestore) return t.skip("Uses in-memory auth storage only.");
  const invite = await setupAcceptedInvite({ label: "pre-send-challenge-cleanup" });
  process.env.SMS_INVITE_CONSENT_ENABLED = "true";
  const phoneNumber = "+12125550123";
  const consentId = smsConsentIdForChurchPhone(invite.churchId, phoneNumber);
  let failConfigRead = true;
  t.after(() => {
    delete process.env.SMS_INVITE_CONSENT_ENABLED;
    setVerifyIdTokenForServerTests(null);
    setAuthReadObserverForServerTests(null);
  });
  setAuthReadObserverForServerTests((event) => {
    if (failConfigRead && event.collectionName === COLLECTIONS.churchMessagingConfigs) {
      failConfigRead = false;
      throw new Error("Messaging configuration is temporarily unavailable.");
    }
  });
  const body = consentBody({ invite, phoneNumber, expectedRosterPhoneNumber: phoneNumber });
  sendCount = 0;
  const rejected = createRes();
  await authHandlers.submitInviteSmsConsent(createReq({ body }), rejected);
  assert.equal(rejected.statusCode, 500);
  assert.equal(rejected.payload.outcome, "rejected_before_send");
  assert.equal(sendCount, 0);
  const afterRejection = await getDoc(COLLECTIONS.smsConsents, consentId);
  assert.equal(afterRejection.status, "pending");
  assert.equal(afterRejection.verificationChallengeId, null);
  assert.equal(afterRejection.verificationCodeHash, null);

  const retried = createRes();
  await authHandlers.submitInviteSmsConsent(createReq({ body }), retried);
  assert.equal(retried.statusCode, 200);
  assert.equal(retried.payload.outcome, "verification_required");
  assert.equal(sendCount, 1);
});

test("an active challenge for a shared phone is preserved for the other invitee", async (t) => {
  if (authRuntimeInfo.hasFirestore) return t.skip("Uses in-memory auth storage only.");
  const first = await setupAcceptedInvite({ label: "shared-first", churchId: "invite_sms_shared" });
  const second = await setupAcceptedInvite({ label: "shared-second", churchId: "invite_sms_shared" });
  process.env.SMS_INVITE_CONSENT_ENABLED = "true";
  t.after(() => {
    delete process.env.SMS_INVITE_CONSENT_ENABLED;
    setVerifyIdTokenForServerTests(null);
  });
  setVerifyIdTokenForServerTests(async (idToken) => {
    if (idToken === "first-id-token") return { uid: first.userId, email: first.email };
    if (idToken === "second-id-token") return { uid: second.userId, email: second.email };
    throw new Error("Unexpected test identity token.");
  });
  sendCount = 0;
  const phoneNumber = "+12125550123";
  const firstStart = createRes();
  await authHandlers.submitInviteSmsConsent(createReq({ body: { ...consentBody({
    invite: first, phoneNumber, expectedRosterPhoneNumber: phoneNumber,
  }), idToken: "first-id-token" } }), firstStart);
  const secondStart = createRes();
  await authHandlers.submitInviteSmsConsent(createReq({ body: { ...consentBody({
    invite: second, phoneNumber, expectedRosterPhoneNumber: phoneNumber,
    challengeId: "c".repeat(32),
  }), idToken: "second-id-token" } }), secondStart);
  assert.equal(secondStart.payload.outcome, "verification_pending");
  assert.equal(secondStart.payload.challengeId, undefined);
  assert.equal(sendCount, 1);
  const consent = await getSmsConsentForServerTests(first.churchId, phoneNumber);
  assert.equal(consent.verificationChallengeId, firstStart.payload.challengeId);
  assert.equal(consent.inviteId, first.inviteId);
});

test("an expired web challenge can be replaced by invitation signup without losing prior evidence", async (t) => {
  if (authRuntimeInfo.hasFirestore) return t.skip("Uses in-memory auth storage only.");
  const invite = await setupAcceptedInvite({ label: "expired-web" });
  process.env.SMS_INVITE_CONSENT_ENABLED = "true";
  t.after(() => {
    delete process.env.SMS_INVITE_CONSENT_ENABLED;
    setVerifyIdTokenForServerTests(null);
  });
  const phoneNumber = "+12125550123";
  await seedSmsConsentForServerTests({ churchId: invite.churchId, phoneNumber, status: "pending" });
  const consentId = smsConsentIdForChurchPhone(invite.churchId, phoneNumber);
  await setDoc("smsConsents", consentId, {
    source: "web_form",
    consentSubmittedAt: "2026-01-01T00:00:00.000Z",
    consentText: "prior consent wording",
    consentVersion: "prior-version",
    verificationCodeHash: "expired-hash",
    verificationCodeSalt: "expired-salt",
    verificationExpiresAt: "2020-01-01T00:00:00.000Z",
    verificationChallengeId: "9".repeat(32),
  }, { merge: true });
  const start = createRes();
  await authHandlers.submitInviteSmsConsent(createReq({ body: consentBody({
    invite, phoneNumber, expectedRosterPhoneNumber: phoneNumber,
  }) }), start);
  assert.equal(start.statusCode, 200);
  assert.equal(start.payload.outcome, "verification_required");
  const consent = await getSmsConsentForServerTests(invite.churchId, phoneNumber);
  assert.equal(consent.source, "invite_signup");
  assert.equal(consent.verificationChallengeId, start.payload.challengeId);
  assert.equal(consent.previousConsentSubmission.consentSubmittedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(consent.previousConsentSubmission.consentText, "prior consent wording");
});

test("an expired invitation OTP can be renewed and its repeat request does not resend", async (t) => {
  if (authRuntimeInfo.hasFirestore) return t.skip("Uses in-memory auth storage only.");
  const invite = await setupAcceptedInvite({ label: "expired-invite" });
  process.env.SMS_INVITE_CONSENT_ENABLED = "true";
  t.after(() => {
    delete process.env.SMS_INVITE_CONSENT_ENABLED;
    setVerifyIdTokenForServerTests(null);
  });
  sendCount = 0;
  const phoneNumber = "+12125550123";
  const body = consentBody({ invite, phoneNumber, expectedRosterPhoneNumber: phoneNumber });
  await seedSmsConsentForServerTests({ churchId: invite.churchId, phoneNumber, status: "pending" });
  await setDoc("smsConsents", smsConsentIdForChurchPhone(invite.churchId, phoneNumber), {
    source: "invite_signup",
    inviteId: invite.inviteId,
    userId: invite.userId,
    memberId: invite.memberId,
    rosterPhoneSnapshot: phoneNumber,
    consentSubmittedAt: "2026-01-01T00:00:00.000Z",
    verificationCodeHash: "expired-hash",
    verificationCodeSalt: "expired-salt",
    verificationExpiresAt: "2020-01-01T00:00:00.000Z",
    verificationChallengeId: body.challengeId,
    verificationCancellationTokenHash: "c".repeat(64),
    verificationCancellationExpiresAt: "2020-01-01T00:00:00.000Z",
  }, { merge: true });

  const expiredVerify = createRes();
  await authHandlers.verifyInviteSmsConsent(createReq({ body: { ...body, code: "123456" } }), expiredVerify);
  assert.equal(expiredVerify.statusCode, 409);
  assert.equal(expiredVerify.payload.code, "sms_challenge_expired");

  const renewed = createRes();
  await authHandlers.submitInviteSmsConsent(createReq({ body }), renewed);
  assert.equal(renewed.payload.outcome, "verification_required");
  assert.equal(sendCount, 1);
  assert.equal(
    (await getSmsConsentForServerTests(invite.churchId, phoneNumber)).consentSubmittedAt,
    "2026-01-01T00:00:00.000Z",
  );
  const retry = createRes();
  await authHandlers.submitInviteSmsConsent(createReq({ body }), retry);
  assert.equal(retry.payload.challengeId, renewed.payload.challengeId);
  assert.equal(sendCount, 1);
});

test("Firestore transaction replaces an expired web challenge and retains its consent evidence", async (t) => {
  if (authRuntimeInfo.hasFirestore) return t.skip("Uses a Firestore test double.");
  const invite = await setupAcceptedInvite({ label: "firestore-expired-web" });
  process.env.SMS_INVITE_CONSENT_ENABLED = "true";
  const firestore = createFirestoreMock();
  const phoneNumber = "+12125550123";
  const consentId = smsConsentIdForChurchPhone(invite.churchId, phoneNumber);
  const inviteRecord = {
    inviteId: invite.inviteId,
    churchId: invite.churchId,
    memberId: invite.memberId,
    email: invite.email,
    status: "accepted",
    tokenHash: createHash("sha256").update(invite.token).digest("hex"),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  firestore.seed("invites", invite.inviteId, inviteRecord);
  firestore.seed("memberships", `${invite.churchId}_${invite.userId}`, {
    churchId: invite.churchId,
    userId: invite.userId,
    status: "active",
  });
  firestore.seed("teamRosterMembers", invite.memberId, {
    memberId: invite.memberId,
    churchId: invite.churchId,
    phoneNumber,
  });
  firestore.seed("smsConsents", consentId, {
    consentId,
    churchId: invite.churchId,
    phoneNumber,
    status: "pending",
    source: "web_form",
    consentSubmittedAt: "2026-01-01T00:00:00.000Z",
    consentText: "prior Firestore consent wording",
    consentVersion: "prior-version",
    verificationCodeHash: "expired-hash",
    verificationCodeSalt: "expired-salt",
    verificationExpiresAt: "2020-01-01T00:00:00.000Z",
    verificationChallengeId: "9".repeat(32),
  });
  setServerFirestoreForTests(firestore);
  t.after(() => {
    delete process.env.SMS_INVITE_CONSENT_ENABLED;
    setVerifyIdTokenForServerTests(null);
    setServerFirestoreForTests(null);
  });

  const start = createRes();
  await authHandlers.submitInviteSmsConsent(createReq({ body: consentBody({
    invite, phoneNumber, expectedRosterPhoneNumber: phoneNumber,
  }) }), start);
  const consent = await getSmsConsentForServerTests(invite.churchId, phoneNumber);
  assert.equal(start.statusCode, 200);
  assert.equal(start.payload.outcome, "verification_required");
  assert.equal(consent.source, "invite_signup");
  assert.equal(consent.verificationChallengeId, start.payload.challengeId);
  assert.equal(consent.previousConsentSubmission.consentText, "prior Firestore consent wording");
});

test("invitation cancellation is scoped to its own pending challenge and idempotent", async (t) => {
  if (authRuntimeInfo.hasFirestore) return t.skip("Uses in-memory auth storage only.");
  const invite = await setupAcceptedInvite({ label: "cancel-invite" });
  process.env.SMS_INVITE_CONSENT_ENABLED = "true";
  t.after(() => {
    delete process.env.SMS_INVITE_CONSENT_ENABLED;
    setVerifyIdTokenForServerTests(null);
  });
  const body = consentBody({
    invite,
    phoneNumber: "+12125550123",
    expectedRosterPhoneNumber: "+12125550123",
  });
  const start = createRes();
  await authHandlers.submitInviteSmsConsent(createReq({ body }), start);
  const cancelBody = { ...body, challengeId: start.payload.challengeId,
    cancellationToken: start.payload.cancellationToken };
  const cancelled = createRes();
  await authHandlers.cancelInviteSmsConsent(createReq({ body: cancelBody }), cancelled);
  assert.deepEqual(cancelled.payload, { success: true, cancelled: true });
  const retried = createRes();
  await authHandlers.cancelInviteSmsConsent(createReq({ body: cancelBody }), retried);
  assert.deepEqual(retried.payload, { success: true, cancelled: true });
  const consent = await getSmsConsentForServerTests(invite.churchId, body.phoneNumber);
  assert.equal(consent.status, "pending");
  assert.equal(consent.verificationCodeHash, null);

  const optedInInvite = await setupAcceptedInvite({ label: "cancel-established" });
  const activeBody = consentBody({
    invite: optedInInvite,
    phoneNumber: "+12125550123",
    expectedRosterPhoneNumber: "+12125550123",
  });
  await seedSmsConsentForServerTests({
    churchId: optedInInvite.churchId,
    phoneNumber: activeBody.phoneNumber,
    status: "opted_in",
  });
  const activeCancel = createRes();
  await authHandlers.cancelInviteSmsConsent(createReq({ body: activeBody }), activeCancel);
  assert.deepEqual(activeCancel.payload, { success: true, cancelled: false });
  assert.equal((await getSmsConsentForServerTests(optedInInvite.churchId, activeBody.phoneNumber)).status, "opted_in");
});

test("an uncertain invitation SMS send remains durable and is never blindly retried", async (t) => {
  if (authRuntimeInfo.hasFirestore) return t.skip("Uses in-memory auth storage only.");
  const invite = await setupAcceptedInvite({ label: "uncertain-delivery" });
  process.env.SMS_INVITE_CONSENT_ENABLED = "true";
  sendCount = 0;
  setSmsConsentSenderForServerTests(() => {
    sendCount += 1;
    throw Object.assign(new Error("socket timed out"), { code: "ETIMEDOUT" });
  });
  t.after(() => {
    delete process.env.SMS_INVITE_CONSENT_ENABLED;
    setVerifyIdTokenForServerTests(null);
    setSmsConsentSenderForServerTests(defaultSmsConsentSender);
  });
  const body = consentBody({ invite, phoneNumber: "+12125550123", expectedRosterPhoneNumber: "+12125550123" });

  const first = createRes();
  await authHandlers.submitInviteSmsConsent(createReq({ body }), first);
  assert.equal(first.statusCode, 202);
  assert.equal(first.payload.outcome, "delivery_uncertain");
  const record = await getSmsConsentForServerTests(invite.churchId, body.phoneNumber);
  assert.equal(record.verificationDeliveryStatus, "unknown");
  assert.ok(record.verificationCodeHash);

  const retry = createRes();
  await authHandlers.submitInviteSmsConsent(createReq({ body }), retry);
  assert.equal(retry.payload.outcome, "delivery_uncertain");
  assert.equal(sendCount, 1);
});

test("a definitive invitation SMS rejection can be safely retried with a fresh OTP", async (t) => {
  if (authRuntimeInfo.hasFirestore) return t.skip("Uses in-memory auth storage only.");
  const invite = await setupAcceptedInvite({ label: "definitive-delivery" });
  process.env.SMS_INVITE_CONSENT_ENABLED = "true";
  sendCount = 0;
  setSmsConsentSenderForServerTests(() => {
    sendCount += 1;
    throw Object.assign(new Error("provider rejected request"), { statusCode: 400, code: "21614" });
  });
  t.after(() => {
    delete process.env.SMS_INVITE_CONSENT_ENABLED;
    setVerifyIdTokenForServerTests(null);
    setSmsConsentSenderForServerTests(defaultSmsConsentSender);
  });
  const body = consentBody({ invite, phoneNumber: "+12125550123", expectedRosterPhoneNumber: "+12125550123" });

  const failed = createRes();
  await authHandlers.submitInviteSmsConsent(createReq({ body }), failed);
  assert.equal(failed.statusCode, 502);
  assert.equal(failed.payload.outcome, "delivery_failed");
  const rejectedRecord = await getSmsConsentForServerTests(invite.churchId, body.phoneNumber);
  assert.equal(rejectedRecord.verificationDeliveryStatus, "failed");
  assert.equal(rejectedRecord.verificationCodeHash, null);

  setSmsConsentSenderForServerTests(defaultSmsConsentSender);
  const retried = createRes();
  await authHandlers.submitInviteSmsConsent(createReq({ body }), retried);
  assert.equal(retried.payload.outcome, "verification_required");
  assert.equal(retried.payload.challengeId, body.challengeId);
  assert.equal(sendCount, 2);
  assert.equal((await getSmsConsentForServerTests(invite.churchId, body.phoneNumber)).verificationDeliveryStatus, "sent");
});

test("an explicitly uncertain provider result is persisted without another send", async (t) => {
  if (authRuntimeInfo.hasFirestore) return t.skip("Uses in-memory auth storage only.");
  const invite = await setupAcceptedInvite({ label: "uncertain-result" });
  process.env.SMS_INVITE_CONSENT_ENABLED = "true";
  sendCount = 0;
  setSmsConsentSenderForServerTests(() => {
    sendCount += 1;
    return { outcome: "unknown", provider: "test", method: "sms_otp" };
  });
  t.after(() => {
    delete process.env.SMS_INVITE_CONSENT_ENABLED;
    setVerifyIdTokenForServerTests(null);
    setSmsConsentSenderForServerTests(defaultSmsConsentSender);
  });
  const body = consentBody({ invite, phoneNumber: "+12125550123", expectedRosterPhoneNumber: "+12125550123" });

  const first = createRes();
  await authHandlers.submitInviteSmsConsent(createReq({ body }), first);
  assert.equal(first.statusCode, 202);
  assert.equal(first.payload.outcome, "delivery_uncertain");
  assert.equal((await getSmsConsentForServerTests(invite.churchId, body.phoneNumber)).verificationDeliveryStatus, "unknown");
  const retry = createRes();
  await authHandlers.submitInviteSmsConsent(createReq({ body }), retry);
  assert.equal(retry.payload.outcome, "delivery_uncertain");
  assert.equal(sendCount, 1);
});

test("changed roster phone blocks both challenge creation and verification activation", async (t) => {
  if (authRuntimeInfo.hasFirestore) return t.skip("Uses in-memory auth storage only.");
  const invite = await setupAcceptedInvite({ label: "changed" });
  sendCount = 0;
  process.env.SMS_INVITE_CONSENT_ENABLED = "true";
  t.after(() => {
    delete process.env.SMS_INVITE_CONSENT_ENABLED;
    setVerifyIdTokenForServerTests(null);
  });
  const body = consentBody({
    invite,
    phoneNumber: "+12125550123",
    expectedRosterPhoneNumber: "+12125550123",
  });
  await seedRosterMemberForServerTests({
    memberId: invite.memberId,
    churchId: invite.churchId,
    phoneNumber: "+12125550124",
  });
  const staleStart = createRes();
  await authHandlers.submitInviteSmsConsent(createReq({ body }), staleStart);
  assert.equal(staleStart.statusCode, 409);
  assert.equal(sendCount, 0);

  await seedRosterMemberForServerTests({
    memberId: invite.memberId,
    churchId: invite.churchId,
    phoneNumber: "+12125550123",
  });
  const start = createRes();
  await authHandlers.submitInviteSmsConsent(createReq({ body }), start);
  assert.equal(start.payload.outcome, "verification_required");
  await seedRosterMemberForServerTests({
    memberId: invite.memberId,
    churchId: invite.churchId,
    phoneNumber: "+12125550124",
  });
  const verify = createRes();
  await authHandlers.verifyInviteSmsConsent(
    createReq({ body: { ...body, code: sentCode } }),
    verify,
  );
  assert.equal(verify.statusCode, 409);
  const record = await getSmsConsentForServerTests(invite.churchId, body.phoneNumber);
  assert.equal(record.status, "pending");
});
