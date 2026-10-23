process.env.WORSHIPSYNC_SERVER_TEST_SUPPORT = "1";
process.env.FIREBASE_PROJECT_ID = "";
process.env.FIREBASE_CLIENT_EMAIL = "";
process.env.FIREBASE_PRIVATE_KEY = "";
process.env.RESEND_API_KEY = "";

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
const { authHandlers, COLLECTIONS, seedActiveHumanBearerForServerTests,
  setServerFirestoreForTests, setDoc } = await import("../authService.js");
import { createVolunteerContactIndex } from "./volunteerContactIndex.js";
const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const response = () => ({
  statusCode: 200, payload: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.payload = payload; return this; },
  set() { return this; }, clearCookie() { return this; },
});

test("Firestore roster entry points maintain indexed contact ownership on create, edit, archive and church moves", { skip: !enabled }, async () => {
  const previousSecret = process.env.AUTH_VOLUNTEER_PORTAL_SECRET;
  const secret = "synthetic-roster-writer-index-secret-only";
  process.env.AUTH_VOLUNTEER_PORTAL_SECRET = secret;
  const suffix = randomUUID();
  const app = initializeApp({ projectId: "demo-worshipsync" }, suffix);
  const db = getFirestore(app); setServerFirestoreForTests(db);
  const churchId = `index_writer_${suffix}`;
  const coverageCollection = `index_coverage_${suffix}`;
  const index = createVolunteerContactIndex({ db, memberCollection: COLLECTIONS.teamRosterMembers, coverageCollection, secret });
  const session = { destroy(callback) { callback?.(); } };
  const req = (headers = {}, body = {}, memberId) => ({ headers, body, params: { churchId, memberId }, session });
  let memberId;
  try {
    const { humanApiToken } = await seedActiveHumanBearerForServerTests({ req: req(), userId: `index_user_${suffix}`,
      email: `${suffix}@example.test`, churchId, role: "admin" });
    const headers = { authorization: `Bearer ${humanApiToken}` };
    const me = response(); await authHandlers.getAuthMe(req(headers), me);
    headers["x-csrf-token"] = me.payload.csrfToken;
    await index.backfillChurch(churchId);
    const created = response();
    await authHandlers.createTeamRosterMember(req(headers, { firstName: "Indexed", lastName: "Member", email: "first@example.test", phoneNumber: "2125550123" }), created);
    assert.equal(created.statusCode, 200, JSON.stringify(created.payload));
    memberId = created.payload.member.memberId;
    const identity = { churchId, memberId };
    assert.equal(await index.hasUniqueOwner(identity, "email", "first@example.test"), true);
    const updated = response();
    // Explicit teamMemberships exercises the separate nested-map persistence path.
    await authHandlers.updateTeamRosterMember(req(headers, { firstName: "Indexed", lastName: "Member", email: "second@example.test", teamMemberships: {} }, memberId), updated);
    assert.equal(updated.statusCode, 200, JSON.stringify(updated.payload));
    assert.equal(await index.hasUniqueOwner(identity, "email", "first@example.test"), false);
    assert.equal(await index.hasUniqueOwner(identity, "email", "second@example.test"), true);
    const team = response(); await authHandlers.createTeam(req(headers, { name: "Index import team", memberIds: [] }), team);
    assert.equal(team.statusCode, 200, JSON.stringify(team.payload));
    const destinationTeamId = team.payload.team.teamId;
    const csv = `First Name,Last Name,Email,WorshipSync Member ID\nIndexed,Member,imported@example.test,${memberId}\nNew,Member,new@example.test,\n`;
    const inspected = response(); await authHandlers.inspectPortableImport(req(headers, { type: "members", csv }), inspected);
    const mapping = inspected.payload.mapping;
    const preview = response(); await authHandlers.previewPortableImport(req(headers, { type: "members", csv, mapping, destinationTeamId }), preview);
    assert.equal(preview.statusCode, 200, JSON.stringify(preview.payload));
    const committed = response(); await authHandlers.commitPortableImport(req(headers, {
      type: "members", previewToken: preview.payload.previewToken,
      previewCsvHash: createHash("sha256").update(csv).digest("hex"), mapping, destinationTeamId,
      approvedRows: preview.payload.rows.map(({ row, action, matchedId, record, expectedStateHash }) => ({ row, action, recordId: matchedId || undefined, record, expectedStateHash })),
    }), committed);
    assert.equal(committed.statusCode, 200, JSON.stringify(committed.payload));
    assert.equal(committed.payload.summary.updated, 1, JSON.stringify(committed.payload));
    assert.equal(committed.payload.summary.created, 1, JSON.stringify(committed.payload));
    assert.equal(await index.hasUniqueOwner(identity, "email", "second@example.test"), false);
    assert.equal(await index.hasUniqueOwner(identity, "email", "imported@example.test"), true);
    const newId = committed.payload.results.find((row) => row.status === "created").id;
    assert.equal(await index.hasUniqueOwner({ churchId, memberId: newId }, "email", "new@example.test"), true);
    // Return to the contact used by the archive/move assertions below.
    await setDoc(COLLECTIONS.teamRosterMembers, memberId, { email: "second@example.test" }, { merge: true });
    const archived = response(); await authHandlers.archiveTeamRosterMember(req(headers, {}, memberId), archived);
    assert.equal(archived.statusCode, 200, JSON.stringify(archived.payload));
    assert.equal(await index.hasUniqueOwner(identity, "email", "second@example.test"), false);
    await setDoc(COLLECTIONS.teamRosterMembers, memberId, { archivedAt: null }, { merge: true });
    assert.equal(await index.hasUniqueOwner(identity, "email", "second@example.test"), true);
    await setDoc(COLLECTIONS.teamRosterMembers, memberId, { churchId: `${churchId}_moved` }, { merge: true });
    assert.equal(await index.hasUniqueOwner(identity, "email", "second@example.test"), false);
    // Indexed query still has exactly one owner in the original church: no
    // stale ownership keys survive the move alongside the new keys.
    await setDoc(COLLECTIONS.teamRosterMembers, `${memberId}_replacement`, { churchId, memberId: `${memberId}_replacement`, email: "second@example.test" });
    assert.equal(await index.hasUniqueOwner({ churchId, memberId: `${memberId}_replacement` }, "email", "second@example.test"), true);
  } finally {
    if (memberId) await Promise.all([memberId, `${memberId}_replacement`].map((id) => db.collection(COLLECTIONS.teamRosterMembers).doc(id).delete()));
    for (const name of [COLLECTIONS.teamRosterMembers, COLLECTIONS.teams, COLLECTIONS.portableImportCreates]) {
      const rows = await db.collection(name).where("churchId", "==", churchId).get();
      await Promise.all(rows.docs.map((row) => row.ref.delete()));
    }
    await db.recursiveDelete(db.collection(coverageCollection));
    setServerFirestoreForTests(null); await db.terminate(); await deleteApp(app);
    if (previousSecret === undefined) delete process.env.AUTH_VOLUNTEER_PORTAL_SECRET;
    else process.env.AUTH_VOLUNTEER_PORTAL_SECRET = previousSecret;
  }
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
    const duplicateRef = db.collection(COLLECTIONS.teamRosterMembers).doc(`${memberId}_duplicate`);
    refs.push(duplicateRef);
    await duplicateRef.set({ ...member, memberId: duplicateRef.id });
    for (const handler of [authHandlers.getMyTeamAssignments, authHandlers.updateMyBlockoutDates]) {
      const ambiguous = response();
      await handler(request(headers, { blockoutDates: [], expectedUpdatedAt: member.updatedAt }), ambiguous);
      assert.equal(ambiguous.statusCode, 409, JSON.stringify(ambiguous.payload));
      assert.match(ambiguous.payload.errorMessage, /account.*link|link.*account/i);
    }
    assert.deepEqual((await refs[1].get()).data(), member);
    await duplicateRef.delete();
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
  const previousSecret = process.env.AUTH_VOLUNTEER_PORTAL_SECRET;
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
    const configuredSecret = process.env.AUTH_VOLUNTEER_PORTAL_SECRET;
    const previousHumanSecret = process.env.AUTH_SESSION_SECRET;
    process.env.AUTH_SESSION_SECRET = "synthetic-shared-secret-must-be-rejected";
    for (const invalid of [undefined, "short", process.env.AUTH_SESSION_SECRET]) {
      if (invalid === undefined) delete process.env.AUTH_VOLUNTEER_PORTAL_SECRET;
      else process.env.AUTH_VOLUNTEER_PORTAL_SECRET = invalid;
      const failed = res(); await authHandlers.prepareVolunteerPersonalAccess(req(humanHeaders), failed);
      assert.equal(failed.statusCode, 503);
      assert.equal(failed.payload.url, undefined);
      const publicFailure = res(); await authHandlers.getVolunteerPersonalSession(req(), publicFailure);
      assert.equal(publicFailure.statusCode, 503);
    }
    if (previousHumanSecret === undefined) delete process.env.AUTH_SESSION_SECRET;
    else process.env.AUTH_SESSION_SECRET = previousHumanSecret;
    process.env.AUTH_VOLUNTEER_PORTAL_SECRET = configuredSecret;
    for (const invalid of ["0", "not-a-number"]) {
      process.env.AUTH_VOLUNTEER_ACCESS_DAYS = invalid;
      const failed = res(); await authHandlers.prepareVolunteerPersonalAccess(req(humanHeaders), failed);
      assert.equal(failed.statusCode, 503);
    }
    delete process.env.AUTH_VOLUNTEER_ACCESS_DAYS;
    const status = res(); await authHandlers.getVolunteerPersonalAccessStatus(req(humanHeaders), status);
    assert.equal(status.statusCode, 200);
    assert.equal(status.payload.status, "none");
    assert.equal(Object.hasOwn(status.payload, "enabled"), false);
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
    // Exercise both HTTP identity adapters against the same real documents and
    // force a second page. A coexisting admin session must not widen the cookie scope.
    const bulkRefs = [];
    for (let i = 0; i < 26; i++) {
      const id = `${scheduleId}_bulk_${String(i).padStart(2, "0")}`;
      const data = { ...schedule, scheduleId: id, responses: {
        [occurrenceId]: { other: { memberId: `${memberId}_other`, response: "legacy-value", metadata: { retain: [1, 2] } } },
        past: { own: { memberId, response: "pending", metadata: "preserve past" } },
      }, occurrences: [...schedule.occurrences, { occurrenceId: "past", startsAt: "2000-01-01T00:00:00Z" }],
      assignments: { ...schedule.assignments, past: { own: memberId } } };
      await seed(COLLECTIONS.teamSchedules, id, data);
      bulkRefs.push({ ref: db.collection(COLLECTIONS.teamSchedules).doc(id), data });
    }
    const runPages = async (handler, requestHeaders) => {
      let cursor; const pages = [];
      do {
        const result = res(); await handler(req(requestHeaders, { afterScheduleId: cursor, memberId: "forged", churchId: "forged" }), result);
        assert.equal(result.statusCode, 200, JSON.stringify(result.payload));
        assert.equal(result.payload.failedScheduleCount, 0);
        assert.ok(result.payload.schedules.length <= 25);
        pages.push(result.payload); cursor = result.payload.hasMore ? result.payload.nextCursor : null;
      } while (cursor);
      return pages;
    };
    const personalPages = await runPages(authHandlers.acceptVolunteerPersonalUnanswered, headers);
    assert.equal(personalPages.length, 2);
    assert.equal(personalPages.reduce((n, row) => n + row.newlyAccepted, 0), 27);
    const personalResponses = await Promise.all(bulkRefs.map(async ({ ref, data }) => {
      const saved = (await ref.get()).data().responses;
      assert.deepEqual(saved.past, data.responses.past);
      assert.deepEqual(saved[occurrenceId].other, data.responses[occurrenceId].other);
      assert.equal(saved[occurrenceId].own.response, "accepted");
      return saved;
    }));
    assert.equal((await db.collection(COLLECTIONS.teamSchedules).doc(`${scheduleId}_draft`).get()).get(`responses.${occurrenceId}.own`), undefined);
    await Promise.all(bulkRefs.map(({ ref, data }) => ref.set(data)));
    await db.collection(COLLECTIONS.teamSchedules).doc(scheduleId).set(schedule);
    const roster = db.collection(COLLECTIONS.teamRosterMembers).doc(memberId);
    await roster.update({ userId: `portal_admin_${suffix}` });
    const humanPages = await runPages(authHandlers.acceptPendingMyAssignments, humanHeaders);
    assert.deepEqual(humanPages.map((row) => row.newlyAccepted), personalPages.map((row) => row.newlyAccepted));
    for (const [index, { ref }] of bulkRefs.entries()) {
      const saved = (await ref.get()).data().responses;
      // Newly written response time is naturally later in the second HTTP run.
      saved[occurrenceId].own.respondedAt = personalResponses[index][occurrenceId].own.respondedAt;
      assert.deepEqual(saved, personalResponses[index]);
    }
    await roster.update({ userId: "" });

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
    if (previousSecret === undefined) delete process.env.AUTH_VOLUNTEER_PORTAL_SECRET; else process.env.AUTH_VOLUNTEER_PORTAL_SECRET = previousSecret;
  }
});
