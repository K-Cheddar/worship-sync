process.env.WORSHIPSYNC_SERVER_TEST_SUPPORT = "1";
process.env.FIREBASE_PROJECT_ID = "";
process.env.FIREBASE_CLIENT_EMAIL = "";
process.env.FIREBASE_PRIVATE_KEY = "";
process.env.RESEND_API_KEY = "";

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
const { authHandlers, COLLECTIONS, seedActiveHumanBearerForServerTests,
  setServerFirestoreForTests } = await import("../authService.js");
const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const response = () => ({
  statusCode: 200, payload: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.payload = payload; return this; },
  set() { return this; }, clearCookie() { return this; },
});

test("Firestore human availability operation shares the recipient transaction and preserves unrelated fields", { skip: !enabled }, async () => {
  const app = initializeApp({ projectId: "demo-worshipsync" }, `volunteer-api-${randomUUID()}`);
  const db = getFirestore(app);
  setServerFirestoreForTests(db);
  const suffix = randomUUID();
  const churchId = `volunteer_church_${suffix}`;
  const memberId = `volunteer_member_${suffix}`;
  const teamId = `volunteer_team_${suffix}`;
  const formId = `volunteer_form_${suffix}`;
  const recipientId = `volunteer_recipient_${suffix}`;
  const session = { destroy(callback) { callback?.(); } };
  const request = (headers = {}, body = {}) => ({ headers, body, params: { churchId }, session });
  const refs = [
    db.collection(COLLECTIONS.churches).doc(churchId),
    db.collection(COLLECTIONS.teamRosterMembers).doc(memberId),
    db.collection(COLLECTIONS.teams).doc(teamId),
    db.collection(COLLECTIONS.teamIntakeForms).doc(formId),
    db.collection(COLLECTIONS.teamIntakeRecipients).doc(recipientId),
  ];
  let submissionId;
  try {
    const userId = `volunteer_user_${suffix}`;
    const { humanApiToken } = await seedActiveHumanBearerForServerTests({
      req: request(), userId, email: `${suffix}@example.test`, churchId,
      role: "member", permissions: { teams: "none" },
    });
    const headers = { authorization: `Bearer ${humanApiToken}` };
    const me = response();
    await authHandlers.getAuthMe(request(headers), me);
    headers["x-csrf-token"] = me.payload.csrfToken;
    await Promise.all([
      refs[0].set({ churchId, serviceTimeZone: "UTC" }),
      refs[1].set({ churchId, memberId, userId, firstName: "Volunteer", lastName: "Member",
        archivedAt: null, positionIds: ["position"], notes: "private", updatedAt: "before",
        serviceAvailability: { elsewhere: "unavailable" } }),
      refs[2].set({ churchId, teamId, memberIds: [memberId], archivedAt: null }),
      refs[3].set({ churchId, formId, name: "Availability", active: true,
        purpose: "team_availability", teamIds: [teamId], enabledFields: ["availability"],
        startDate: "2099-11-01", endDate: "2099-11-30", responseDeadline: "2099-11-01",
        availabilityOccurrences: [{ occurrenceId: "own", startsAt: "2099-11-08T14:00:00.000Z" }] }),
      refs[4].set({ churchId, recipientId, formId, memberId, revokedAt: null }),
    ]);
    const read = response();
    await authHandlers.getMyVolunteerAvailability(request(headers), read);
    assert.equal(read.statusCode, 200);
    assert.equal(read.payload.requests.length, 1);
    assert.doesNotMatch(JSON.stringify(read.payload), /private|elsewhere/);
    const saved = response();
    await authHandlers.submitMyVolunteerAvailability(request(headers, {
      recipientId, occurrenceAvailability: { own: "unavailable", outside: "available" },
    }), saved);
    assert.equal(saved.statusCode, 200, JSON.stringify(saved.payload));
    submissionId = saved.payload.submissionId;
    const member = (await refs[1].get()).data();
    assert.deepEqual(member.serviceAvailability, { elsewhere: "unavailable", own: "unavailable" });
    assert.deepEqual(member.positionIds, ["position"]);
    assert.equal(member.notes, "private");
    await refs[4].update({ revokedAt: "revoked" });
    const revoked = response();
    await authHandlers.submitMyVolunteerAvailability(request(headers, {
      recipientId, occurrenceAvailability: { own: "available" },
    }), revoked);
    assert.equal(revoked.statusCode, 404);
    assert.equal((await refs[1].get()).data().serviceAvailability.own, "unavailable");
  } finally {
    if (submissionId) refs.push(db.collection(COLLECTIONS.teamIntakeSubmissions).doc(submissionId));
    await Promise.all(refs.map((ref) => ref.delete()));
    setServerFirestoreForTests(null);
    await db.terminate();
    await deleteApp(app);
  }
});

test("Firestore portal uses isolated cookies, CSRF and safe shared projections; revocation blocks reads and writes", { skip: !enabled }, async () => {
  const previousEnabled = process.env.AUTH_VOLUNTEER_PORTAL_ENABLED;
  const previousSecret = process.env.AUTH_VOLUNTEER_PORTAL_SECRET;
  process.env.AUTH_VOLUNTEER_PORTAL_ENABLED = "true";
  process.env.AUTH_VOLUNTEER_PORTAL_SECRET = "synthetic-portal-integration-test-secret-only";
  const app = initializeApp({ projectId: "demo-worshipsync" }, `portal-api-${randomUUID()}`);
  const db = getFirestore(app); setServerFirestoreForTests(db);
  const suffix = randomUUID();
  const churchId = `portal_church_${suffix}`;
  const memberId = `portal_member_${suffix}`;
  const scheduleId = `portal_schedule_${suffix}`;
  const refs = [];
  const seed = async (collection, id, data) => { const ref = db.collection(collection).doc(id); refs.push(ref); await ref.set(data); };
  const session = { destroy(callback) { callback?.(); } };
  const req = (headers = {}, body = {}) => ({ headers, body, params: { churchId, memberId }, session });
  const res = () => ({ ...response(), cookies: [], cookie(name, value, options) { this.cookies.push({ name, value, options }); return this; } });
  try {
    const { humanApiToken } = await seedActiveHumanBearerForServerTests({ req: req(),
      userId: `portal_admin_${suffix}`, email: `${suffix}@example.test`, churchId, role: "admin" });
    const humanHeaders = { authorization: `Bearer ${humanApiToken}` };
    const me = res(); await authHandlers.getAuthMe(req(humanHeaders), me);
    humanHeaders["x-csrf-token"] = me.payload.csrfToken;
    await seed(COLLECTIONS.churches, churchId, { churchId, name: "Portal Church", serviceTimeZone: "UTC" });
    await seed(COLLECTIONS.teamRosterMembers, memberId, { memberId, churchId, firstName: "Volunteer", lastName: "Member",
      notes: "PRIVATE-NOTE", email: "PRIVATE-EMAIL", phoneNumber: "PRIVATE-PHONE", blockoutDates: [], updatedAt: "baseline" });
    await seed(COLLECTIONS.teamRosterMembers, `${memberId}_other`, { memberId: `${memberId}_other`, churchId,
      firstName: "Teammate", lastName: "PrivateSurname", notes: "TEAMMATE-PRIVATE" });
    const occurrenceId = "service@2099-11-01T14:00:00.000Z";
    const schedule = { scheduleId, churchId, teamId: "team", occurrences: [{ occurrenceId, serviceId: "service", serviceIds: ["service"],
      startsAt: "2099-11-01T14:00:00.000Z", name: "Sunday" }],
      assignments: { [occurrenceId]: { own: memberId, other: `${memberId}_other` } },
      responses: { [occurrenceId]: { other: { memberId: `${memberId}_other`, response: "declined", respondedAt: "TEAMMATE-RESPONSE" } } } };
    await seed(COLLECTIONS.teamSchedules, scheduleId, schedule);
    await seed(COLLECTIONS.teamSchedules, `${scheduleId}_draft`, { ...schedule, scheduleId: `${scheduleId}_draft`, published: false });
    await seed(COLLECTIONS.servicePlans, `${scheduleId}_plan`, { planId: `${scheduleId}_plan`, churchId, serviceId: "service",
      date: "2099-11-01", name: "Service plan", published: true, publicLinkToken: "PRIVATE-TEAM-TOKEN",
      sections: [{ name: "Welcome", elements: [{ title: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Welcome" }] }] }, notes: "PRIVATE-PLAN-NOTE" }] }] });
    const prepared = res(); await authHandlers.prepareVolunteerPersonalAccess(req(humanHeaders), prepared);
    assert.equal(prepared.statusCode, 200, JSON.stringify(prepared.payload));
    const token = new URL(prepared.payload.url).hash.slice(1);
    const origin = new URL(prepared.payload.url).origin;
    const redemption = res(); await authHandlers.redeemVolunteerPersonalAccess(req({ origin }, { token }), redemption);
    assert.equal(redemption.statusCode, 200);
    assert.equal(redemption.cookies.length, 1);
    assert.deepEqual({ ...redemption.cookies[0].options, expires: undefined }, { httpOnly: true, secure: true, sameSite: "strict", path: "/", expires: undefined });
    const cookie = `${redemption.cookies[0].name}=${redemption.cookies[0].value}`;
    const headers = { ...humanHeaders, cookie, origin };
    const portalSession = res(); await authHandlers.getVolunteerPersonalSession(req(headers), portalSession);
    headers["x-volunteer-csrf"] = portalSession.payload.csrfToken;
    const loaded = res(); await authHandlers.getVolunteerPersonalSchedule(req(headers), loaded);
    assert.equal(loaded.statusCode, 200);
    assert.equal(loaded.payload.member.memberId, memberId);
    assert.equal(loaded.payload.occurrences.length, 1);
    assert.equal(loaded.payload.occurrences[0].serving.length, 2);
    assert.doesNotMatch(JSON.stringify(loaded.payload), /PRIVATE|TEAMMATE-RESPONSE|PrivateSurname|_draft/);
    const account = res(); await authHandlers.getMyTeamAssignments(req(humanHeaders), account);
    assert.equal(account.payload.member, null);
    const noCsrf = res(); await authHandlers.respondToVolunteerPersonalAssignment(req({ cookie, origin }, {
      scheduleId, occurrenceId, cellKey: "own", response: "accepted", memberId: "forged" }), noCsrf);
    assert.equal(noCsrf.statusCode, 403);
    const answer = res(); await authHandlers.respondToVolunteerPersonalAssignment(req(headers, {
      scheduleId, occurrenceId, cellKey: "own", response: "accepted", memberId: "forged" }), answer);
    assert.equal(answer.statusCode, 200);
    const timeOff = res(); await authHandlers.saveVolunteerPersonalBlockouts(req(headers, {
      blockoutDates: [{ startDate: "2099-11-01", endDate: "2099-11-01" }], expectedUpdatedAt: "baseline" }), timeOff);
    assert.equal(timeOff.statusCode, 200);
    assert.doesNotMatch(JSON.stringify(timeOff.payload), /PRIVATE/);
    const revoked = res(); await authHandlers.revokeVolunteerPersonalAccess(req(humanHeaders), revoked);
    assert.equal(revoked.statusCode, 200);
    const after = res(); await authHandlers.getVolunteerPersonalSchedule(req(headers), after);
    assert.equal(after.statusCode, 401);
    const afterWrite = res(); await authHandlers.acceptVolunteerPersonalUnanswered(req(headers), afterWrite);
    assert.equal(afterWrite.statusCode, 401);
  } finally {
    // All records are synthetic, in the demo emulator only.
    for (const name of ["volunteerPersonalAccess", "volunteerPersonalCredentials", "volunteerPersonalSessions"]) {
      const rows = await db.collection(name).where("churchId", "==", churchId).get();
      refs.push(...rows.docs.map((row) => row.ref));
    }
    await Promise.all(refs.map((ref) => ref.delete()));
    setServerFirestoreForTests(null); await db.terminate(); await deleteApp(app);
    if (previousEnabled === undefined) delete process.env.AUTH_VOLUNTEER_PORTAL_ENABLED; else process.env.AUTH_VOLUNTEER_PORTAL_ENABLED = previousEnabled;
    if (previousSecret === undefined) delete process.env.AUTH_VOLUNTEER_PORTAL_SECRET; else process.env.AUTH_VOLUNTEER_PORTAL_SECRET = previousSecret;
  }
});
