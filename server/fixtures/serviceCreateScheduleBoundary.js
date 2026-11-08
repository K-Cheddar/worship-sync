// Isolated companion for the real ServiceManager/Redux persistence integration
// test. Only transport is simulated: these are the production auth/Teams handlers
// and their authoritative service reader. Never load developer credentials.
process.env.WORSHIPSYNC_SERVER_TEST_SUPPORT = "1";
process.env.FIREBASE_PROJECT_ID = "";
process.env.FIREBASE_CLIENT_EMAIL = "";
process.env.FIREBASE_PRIVATE_KEY = "";
process.env.RESEND_API_KEY = "";

import assert from "node:assert/strict";
import { buildTeamSchedulePeriod } from "../../client/src/pages/Teams/schedule/teamSchedulePeriod.ts";
import { oneTimeServiceInstant } from "../../shared/teamScheduleOccurrences.ts";

const { authHandlers, COLLECTIONS, getDoc, setDoc, queryDocs,
  seedActiveHumanBearerForServerTests, seedChurchServiceTimesForServerTests,
} = await import("../../authService.js");
const input = JSON.parse(await new Promise((resolve) => {
  let text = "";
  process.stdin.on("data", (chunk) => { text += chunk; });
  process.stdin.on("end", () => resolve(text));
}));
const churchId = "church-main";
const session = { save: callback => callback?.() };
const { humanApiToken } = await seedActiveHumanBearerForServerTests({
  req: { session }, userId: "boundary-admin", email: "boundary@example.com", churchId, role: "admin",
});
const headers = { authorization: `Bearer ${humanApiToken}` };
const call = async (handler, body = {}, params = {}) => {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
  await handler({ body, params: { churchId, ...params }, headers, session, get: key => headers[key.toLowerCase()], cookies: {} }, res);
  return res;
};
const me = await call(authHandlers.getAuthMe);
headers["x-csrf-token"] = me.payload.csrfToken;
await setDoc(COLLECTIONS.churches, churchId, { serviceTimeZone: "America/New_York" }, { merge: true });
await setDoc(COLLECTIONS.teams, "boundary-media", { churchId, teamId: "boundary-media", name: "Media", memberIds: ["boundary-member"] });
await setDoc(COLLECTIONS.teamPositions, "boundary-camera", { churchId, teamId: "boundary-media", positionId: "boundary-camera", name: "Camera" });
await setDoc(COLLECTIONS.teamRosterMembers, "boundary-member", { churchId, memberId: "boundary-member", firstName: "Test", lastName: "Member", positionIds: ["boundary-camera"], blockoutDates: [] });
const period = (services, occurrences) => ({
  name: "November 2026", teamId: "boundary-media", startDate: "2026-11-01", endDate: "2026-11-30",
  // A stale caller cannot override the authoritative church timezone.
  timeZone: "Pacific/Honolulu", serviceIds: services.map(service => service.id),
  occurrences: occurrences || buildTeamSchedulePeriod({ services: services.map(service => ({ ...service, serviceId: service.id, churchId })), positions: [{ positionId: "boundary-camera", churchId, teamId: "boundary-media", name: "Camera" }], teamId: "boundary-media", startDate: "2026-11-01", endDate: "2026-11-30", timeZone: "America/New_York" }).occurrences,
});
seedChurchServiceTimesForServerTests({ churchId, services: input.before });
const initial = await call(authHandlers.ensureTeamScheduleForPeriod, period(input.before));
assert.equal(initial.statusCode, 200, JSON.stringify(initial.payload));
const scheduleId = initial.payload.schedule.scheduleId;
const notificationHistory = { churchId, scheduleId, deliveryId: "boundary-history", status: "delivered", createdAt: "2026-10-30T12:00:00.000Z" };
await setDoc(COLLECTIONS.notificationDeliveries, notificationHistory.deliveryId, notificationHistory);
const savedNotificationHistory = await getDoc(COLLECTIONS.notificationDeliveries, notificationHistory.deliveryId);
const existingId = initial.payload.schedule.occurrences[0].occurrenceId;
const assignment = (serviceId, memberId) => call(authHandlers.updateTeamScheduleAssignment, {
  serviceId, memberId, positionSlotKey: "boundary-camera::0", serviceDate: "2026-11-07",
}, { scheduleId });
assert.equal((await assignment(existingId, "boundary-member")).statusCode, 200);
await setDoc(COLLECTIONS.teamSchedules, scheduleId, {
  microphoneAssignments: { [existingId]: { "boundary-camera::0": ["test-mic"] } },
  iemAssignments: { [existingId]: { "boundary-camera::0": ["test-iem"] } },
  published: true, publishedAt: "2026-10-30T12:00:00.000Z", publicLinkToken: "test-link",
  sentAt: "2026-10-30T12:00:00.000Z", notificationHistory: [{ id: "test-history" }],
}, { merge: true });
const before = await getDoc(COLLECTIONS.teamSchedules, scheduleId);
const pending = await call(authHandlers.ensureTeamScheduleForPeriod, period(input.committed, input.optimisticOccurrences));
assert.equal(pending.statusCode, 400);
assert.deepEqual(await getDoc(COLLECTIONS.teamSchedules, scheduleId), before);
assert.equal((await assignment(existingId, "boundary-member")).statusCode, 200);

seedChurchServiceTimesForServerTests({ churchId, services: input.committed });
const committed = await call(authHandlers.ensureTeamScheduleForPeriod, period(input.committed, input.optimisticOccurrences));
assert.equal(committed.statusCode, 200, JSON.stringify(committed.payload));
assert.equal(committed.payload.schedule.scheduleId, scheduleId);
const after = await getDoc(COLLECTIONS.teamSchedules, scheduleId);
for (const key of ["assignments", "microphoneAssignments", "iemAssignments", "published", "publishedAt", "publicLinkToken", "sentAt", "notificationHistory", "createdAt", "createdByUid"]) assert.deepEqual(after[key], before[key], key);

// Independent process/host timezone reconstructs the browser model from only
// committed JSON, with no optimistic Redux state or per-tab date cache.
const reloadBody = period(JSON.parse(JSON.stringify(input.committed)));
const reloaded = await call(authHandlers.ensureTeamScheduleForPeriod, reloadBody);
assert.equal(reloaded.statusCode, 200, JSON.stringify(reloaded.payload));
assert.deepEqual(reloaded.payload.schedule.occurrences, after.occurrences);
const newRow = after.occurrences.find(row => row.serviceId === input.createdId);
assert.equal(newRow.startsAt, "2026-11-07T21:30:00.000Z");
assert.equal((await assignment(newRow.occurrenceId, "boundary-member")).statusCode, 200);
assert.equal((await assignment(existingId, "")).statusCode, 200);
assert.equal((await assignment("unreconciled@2026-11-07", "boundary-member")).statusCode, 400);
const tampered = await call(authHandlers.ensureTeamScheduleForPeriod, {
  ...reloadBody, occurrences: reloadBody.occurrences.map(row => row.serviceId === input.createdId ? { ...row, startsAt: "2026-11-07T20:30:00.000Z" } : row),
});
assert.equal(tampered.statusCode, 400);
assert.match(tampered.payload.errorMessage, new RegExp(input.createdId));
assert.match(tampered.payload.errorMessage, /Service setup.*try again/);
const badExisting = await call(authHandlers.ensureTeamScheduleForPeriod, {
  ...reloadBody, occurrences: reloadBody.occurrences.map(row => row.serviceId === "existing-one-time" ? { ...row, startsAt: "2026-11-07T14:00:00.000Z" } : row),
});
assert.equal(badExisting.statusCode, 400);
assert.match(badExisting.payload.errorMessage, /Existing one-time.*existing-one-time/);
assert.doesNotMatch(badExisting.payload.errorMessage, /Book Launch/);
// Reopen data written by the old picker as well as canonical new writes.
const legacyServices = input.committed.map(service => service.id === input.createdId
  ? { ...service, dateTimeISO: "2026-11-07T16:30" } : service);
seedChurchServiceTimesForServerTests({ churchId, services: legacyServices });
const legacyReload = await call(authHandlers.ensureTeamScheduleForPeriod, period(legacyServices));
assert.equal(legacyReload.statusCode, 200, JSON.stringify(legacyReload.payload));
assert.equal(legacyReload.payload.schedule.scheduleId, scheduleId);
const schedules = await queryDocs(COLLECTIONS.teamSchedules, [{ field: "churchId", value: churchId }]);
assert.equal(schedules.length, 1);
const claims = await queryDocs(COLLECTIONS.teamScheduleOccurrenceOwners, [{ field: "churchId", value: churchId }]);
assert.equal(claims.length, 2);
assert.ok(claims.every(claim => claim.scheduleId === scheduleId && claim.teamId === "boundary-media"));
assert.deepEqual(await getDoc(COLLECTIONS.notificationDeliveries, notificationHistory.deliveryId), savedNotificationHistory);
console.log("BOUNDARY_RESULT=" + JSON.stringify({
  hostTimeZone: process.env.TZ, pendingStatus: pending.statusCode, committedStatus: committed.statusCode,
  reloadStatus: reloaded.statusCode, scheduleCount: schedules.length,
  services: input.committed.map(service => ({ serviceId: service.id, recurrence: service.reccurence,
    storedDateTimeISO: service.dateTimeISO, serverInstant: oneTimeServiceInstant(service.dateTimeISO, "America/New_York")?.toISOString() })),
}));
