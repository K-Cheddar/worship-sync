process.env.WORSHIPSYNC_SERVER_TEST_SUPPORT = "1";
process.env.FIREBASE_PROJECT_ID = "";
process.env.FIREBASE_CLIENT_EMAIL = "";
process.env.FIREBASE_PRIVATE_KEY = "";
process.env.RESEND_API_KEY = "";

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const {
  authHandlers,
  COLLECTIONS,
  seedActiveHumanBearerForServerTests,
  seedChurchServiceTimesForServerTests,
  setDoc,
  setServerFirestoreForTests,
} = await import("../authService.js");

const emulatorEnabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const projectId = "demo-worshipsync";
const createSession = () => ({ destroy(callback) { callback?.(); } });
const createReq = ({ params = {}, headers = {}, session = createSession(), body = {} } = {}) => ({
  params,
  headers,
  session,
  body,
});
const createRes = () => ({
  statusCode: 200,
  payload: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.payload = payload; return this; },
  send(payload) { this.body = payload; return this; },
  set() { return this; },
  clearCookie() { return this; },
});

const withFirestore = async (task) => {
  const app = initializeApp({ projectId }, `team-schedule-ownership-${randomUUID()}`);
  const db = getFirestore(app);
  setServerFirestoreForTests(db);
  try {
    await task(db);
  } finally {
    setServerFirestoreForTests(null);
    await db.terminate();
    await deleteApp(app);
  }
};

const createContext = async (suffix) => {
  const session = createSession();
  const churchId = `schedule_ownership_church_${suffix}`;
  const { humanApiToken } = await seedActiveHumanBearerForServerTests({
    req: createReq({ session }),
    userId: `schedule_ownership_admin_${suffix}`,
    email: `schedule-ownership-${suffix}@example.test`,
    churchId,
    role: "admin",
  });
  await setDoc(COLLECTIONS.churches, churchId, { serviceTimeZone: "UTC" }, { merge: true });
  const meRes = createRes();
  await authHandlers.getAuthMe(createReq({
    session,
    headers: { authorization: `Bearer ${humanApiToken}` },
  }), meRes);
  return {
    churchId,
    headers: {
      authorization: `Bearer ${humanApiToken}`,
      "x-csrf-token": String(meRes.payload?.csrfToken || ""),
    },
    session,
  };
};

const callHandler = async (handler, { context, params = {}, body = {} }) => {
  const response = createRes();
  await handler(createReq({
    params: { churchId: context.churchId, ...params },
    headers: context.headers,
    session: context.session,
    body,
  }), response);
  return response;
};

const createFixture = async (suffix, services) => {
  const context = await createContext(suffix);
  const teamId = `schedule_ownership_team_${suffix}`;
  await setDoc(COLLECTIONS.teams, teamId, {
    teamId,
    churchId: context.churchId,
    name: "Media",
    memberIds: [],
    archivedAt: null,
  });
  seedChurchServiceTimesForServerTests({ churchId: context.churchId, services });
  return { context, teamId };
};

const occurrence = (serviceId, startsAt) => ({
  occurrenceId: `${serviceId}@${startsAt}`,
  serviceId,
  name: serviceId,
  startsAt,
  positionRequirements: [],
});
const service = (serviceId, startsAt) => ({
  id: serviceId,
  serviceId,
  name: serviceId,
  reccurence: "one_time",
  dateTimeISO: startsAt,
});
const periodBody = (teamId, startDate, endDate, occurrences) => ({
  name: "October",
  teamId,
  startDate,
  endDate,
  timeZone: "UTC",
  serviceIds: [...new Set(occurrences.map((item) => item.serviceId))],
  occurrences,
});

const schedulesForChurch = async (db, churchId) => {
  const snapshot = await db.collection(COLLECTIONS.teamSchedules)
    .where("churchId", "==", churchId)
    .get();
  return snapshot.docs.map((doc) => ({ scheduleId: doc.id, ...doc.data() }));
};
const ownersForChurch = async (db, churchId) => {
  const snapshot = await db.collection(COLLECTIONS.teamScheduleOccurrenceOwners)
    .where("churchId", "==", churchId)
    .get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
};

test("Firestore emulator gives overlapping service occurrences one owner and rejects conflicts atomically", { skip: !emulatorEnabled }, async () => {
  await withFirestore(async (db) => {
    const suffix = randomUUID();
    const startsAt = "2026-10-10T12:00:00.000Z";
    const fixture = await createFixture(suffix, [service("combined", startsAt)]);
    const event = occurrence("combined", startsAt);
    const firstBody = periodBody(fixture.teamId, "2026-10-01", "2026-10-15", [event]);
    const secondBody = periodBody(fixture.teamId, "2026-10-10", "2026-10-31", [event]);

    const results = await Promise.all([
      callHandler(authHandlers.ensureTeamScheduleForPeriod, { context: fixture.context, body: firstBody }),
      callHandler(authHandlers.ensureTeamScheduleForPeriod, { context: fixture.context, body: secondBody }),
    ]);
    assert.deepEqual(results.map(({ statusCode }) => statusCode).sort(), [200, 409]);

    const schedules = await schedulesForChurch(db, fixture.context.churchId);
    const claims = await ownersForChurch(db, fixture.context.churchId);
    assert.equal(schedules.length, 1);
    assert.equal(claims.length, 1);
    assert.equal(claims[0].scheduleId, schedules[0].scheduleId);
    assert.equal(claims[0].logicalOccurrenceId, "combined@2026-10-10");

    const beforeSchedule = await db.collection(COLLECTIONS.teamSchedules)
      .doc(schedules[0].scheduleId).get();
    const beforeClaim = await db.collection(COLLECTIONS.teamScheduleOccurrenceOwners)
      .doc(claims[0].id).get();
    const duplicate = await callHandler(authHandlers.createTeamSchedule, {
      context: fixture.context,
      body: { ...firstBody, name: "Rejected duplicate" },
    });
    assert.equal(duplicate.statusCode, 409);
    assert.match(duplicate.payload.errorMessage, /already owned/i);
    assert.deepEqual((await db.collection(COLLECTIONS.teamSchedules)
      .doc(schedules[0].scheduleId).get()).data(), beforeSchedule.data());
    assert.deepEqual((await db.collection(COLLECTIONS.teamScheduleOccurrenceOwners)
      .doc(claims[0].id).get()).data(), beforeClaim.data());
    assert.equal((await schedulesForChurch(db, fixture.context.churchId)).length, 1);
    assert.equal((await ownersForChurch(db, fixture.context.churchId)).length, 1);
  });
});

test("Firestore emulator reuses populated legacy schedules and reconciles ownership claims idempotently", { skip: !emulatorEnabled }, async () => {
  await withFirestore(async (db) => {
    const suffix = randomUUID();
    const firstOccurrence = occurrence("service-a", "2026-10-10T12:00:00.000Z");
    const secondOccurrence = occurrence("service-b", "2026-10-17T12:00:00.000Z");
    const fixture = await createFixture(suffix, [
      service("service-a", firstOccurrence.startsAt),
      service("service-b", secondOccurrence.startsAt),
    ]);
    const legacySchedule = {
      scheduleId: `legacy-october-${suffix}`,
      churchId: fixture.context.churchId,
      name: "Legacy October",
      teamId: fixture.teamId,
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      serviceIds: ["service-a"],
      occurrences: [firstOccurrence],
      assignments: { [firstOccurrence.occurrenceId]: { "camera::0": { primaryMemberId: "member-preserved" } } },
      microphoneAssignments: { [firstOccurrence.occurrenceId]: { "camera::0": ["mic-preserved"] } },
      publicLinkToken: `legacy-public-${suffix}`,
    };
    await db.collection(COLLECTIONS.teamSchedules).doc(legacySchedule.scheduleId).set(legacySchedule);
    const body = periodBody(fixture.teamId, "2026-10-01", "2026-10-31", [firstOccurrence, secondOccurrence]);

    const ensured = await callHandler(authHandlers.ensureTeamScheduleForPeriod, {
      context: fixture.context,
      body,
    });
    assert.equal(ensured.statusCode, 200, JSON.stringify(ensured.payload));
    assert.equal(ensured.payload.schedule.scheduleId, legacySchedule.scheduleId);
    assert.equal(ensured.payload.created, false);
    assert.deepEqual(ensured.payload.schedule.assignments, legacySchedule.assignments);
    assert.deepEqual(ensured.payload.schedule.microphoneAssignments, legacySchedule.microphoneAssignments);
    assert.equal(ensured.payload.schedule.publicLinkToken, legacySchedule.publicLinkToken);
    assert.equal((await schedulesForChurch(db, fixture.context.churchId)).length, 1);

    const afterEnsure = (await db.collection(COLLECTIONS.teamSchedules)
      .doc(legacySchedule.scheduleId).get()).data();
    const firstClaims = await ownersForChurch(db, fixture.context.churchId);
    assert.equal(firstClaims.length, 2);
    assert.ok(firstClaims.every(({ scheduleId }) => scheduleId === legacySchedule.scheduleId));
    const repeated = await callHandler(authHandlers.ensureTeamScheduleForPeriod, {
      context: fixture.context,
      body,
    });
    assert.equal(repeated.statusCode, 200);
    assert.equal(repeated.payload.created, false);
    assert.deepEqual((await db.collection(COLLECTIONS.teamSchedules)
      .doc(legacySchedule.scheduleId).get()).data(), afterEnsure);
    assert.deepEqual(await ownersForChurch(db, fixture.context.churchId), firstClaims);

    const updated = await callHandler(authHandlers.updateTeamSchedule, {
      context: fixture.context,
      params: { scheduleId: legacySchedule.scheduleId },
      body: {
        ...repeated.payload.schedule,
        name: "Legacy October updated",
        serviceIds: ["service-b"],
        occurrences: [secondOccurrence],
        assignments: {},
      },
    });
    assert.equal(updated.statusCode, 200, JSON.stringify(updated.payload));
    assert.deepEqual(updated.payload.schedule.occurrences.map(({ occurrenceId }) => occurrenceId), [secondOccurrence.occurrenceId]);
    const reconciledClaims = await ownersForChurch(db, fixture.context.churchId);
    assert.equal(reconciledClaims.length, 1);
    assert.equal(reconciledClaims[0].scheduleId, legacySchedule.scheduleId);
    assert.equal(reconciledClaims[0].occurrenceId, secondOccurrence.occurrenceId);
  });
});
