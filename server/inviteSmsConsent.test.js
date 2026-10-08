process.env.WORSHIPSYNC_SERVER_TEST_SUPPORT = "1";
process.env.FIREBASE_PROJECT_ID = "";
process.env.FIREBASE_CLIENT_EMAIL = "";
process.env.FIREBASE_PRIVATE_KEY = "";

import test from "node:test";
import assert from "node:assert/strict";
import { setSmsConsentSenderForServerTests } from "./smsConsent.js";

const {
  authHandlers,
  authRuntimeInfo,
  getSmsConsentForServerTests,
  seedActiveHumanBearerForServerTests,
  seedPendingInviteForServerTests,
  seedRosterMemberForServerTests,
  setVerifyIdTokenForServerTests,
} = await import("../authService.js");

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

let sentCode = "";
let sendCount = 0;
setSmsConsentSenderForServerTests(({ code }) => {
  sentCode = code;
  sendCount += 1;
  return { provider: "test", method: "sms_otp" };
});

const setupAcceptedInvite = async ({
  label,
  memberId = `member-${label}`,
  phoneNumber = "+12125550123",
} = {}) => {
  const churchId = `invite_sms_${label}`;
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

test("invitation preview exposes the linked valid number and existing consent status", async (t) => {
  if (authRuntimeInfo.hasFirestore) return t.skip("Uses in-memory auth storage only.");
  const invite = await setupAcceptedInvite({ label: "preview" });
  process.env.SMS_INVITE_CONSENT_ENABLED = "true";
  t.after(() => delete process.env.SMS_INVITE_CONSENT_ENABLED);
  const res = createRes();
  await authHandlers.getInvitePreview(createReq({ query: { token: invite.token } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.rosterPhoneNumber, "+12125550123");
  assert.equal(res.payload.smsInviteConsentEnabled, true);
  assert.equal(res.payload.smsConsentStatus, "none");
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

test("changed roster phone blocks both challenge creation and verification activation", async (t) => {
  if (authRuntimeInfo.hasFirestore) return t.skip("Uses in-memory auth storage only.");
  const invite = await setupAcceptedInvite({ label: "changed" });
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
