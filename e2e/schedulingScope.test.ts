import { test } from "node:test";
import assert from "node:assert/strict";
import { assertOwnedRecord, assertSafeSchedule, assertSchedulingIdentity, assertSchedulingRecoveryManifest, assertSchedulingTeamPermission, schedulingMutationAllowed, SCHEDULING_OWNER } from "./schedulingScope";
import { E2E_CHURCH_ID, getE2EChurchId } from "./testChurch";

const scope = { churchId: "demo", teamId: "e2e-team", fixtureId: "fixture", runId: "run", positionId: "position", memberId: "member", serviceIds: ["service-a", "service-b"], scheduleId: "generated-owned", startDate: "2040-01-01", endDate: "2040-01-31" };
const record = { churchId: scope.churchId, teamId: scope.teamId, e2eFixture: { owner: SCHEDULING_OWNER, fixtureId: scope.fixtureId, runId: scope.runId } };
test("the built-in E2E church removes the manual variable and rejects attempts to redirect it", () => {
  assert.equal(E2E_CHURCH_ID, "demo");
  assert.equal(getE2EChurchId({}), "demo");
  assert.equal(getE2EChurchId({ E2E_DEMO_CHURCH_ID: "demo" }), "demo");
  assert.throws(() => getE2EChurchId({ E2E_DEMO_CHURCH_ID: "another-church" }), /deprecated.*always use church demo/i);
});
test("only an authenticated human account for demo with reserved-team edit access is accepted", () => {
  const auth = { churchId: "demo", sessionKind: "human", user: { uid: "e2e-user" }, permissions: { teamScopes: { [scope.teamId]: "edit" } } };
  assert.equal(assertSchedulingIdentity(auth), "e2e-user");
  assert.doesNotThrow(() => assertSchedulingTeamPermission(auth, scope.teamId));
  assert.throws(() => assertSchedulingIdentity({ ...auth, churchId: "another-church" }), /only church demo is authorized/);
  assert.throws(() => assertSchedulingIdentity(undefined), /missing or expired/);
  assert.throws(() => assertSchedulingIdentity({ ...auth, sessionKind: "workstation" }), /missing or expired/);
  assert.throws(() => assertSchedulingTeamPermission({ ...auth, permissions: {} }, scope.teamId), /needs edit access/);
  assert.doesNotThrow(() => assertSchedulingTeamPermission({ ...auth, role: "admin" }, scope.teamId));
});
test("recovery manifests retain the exact demo/team/run identity and recorded baseline", () => {
  const recovery = {
    owner: SCHEDULING_OWNER,
    userId: "e2e-user",
    scope: { ...scope, runId: "123e4567-e89b-42d3-a456-426614174000" },
    startedAt: "2040-01-01T00:00:00.000Z",
    baselineHash: "a".repeat(64),
    events: [],
  };
  assert.doesNotThrow(() => assertSchedulingRecoveryManifest(recovery, "e2e-user", scope));
  assert.throws(() => assertSchedulingRecoveryManifest({ ...recovery, scope: { ...recovery.scope, churchId: "another-church" } }, "e2e-user", scope), /church ID must be demo/);
  assert.throws(() => assertSchedulingRecoveryManifest({ ...recovery, scope: { ...recovery.scope, teamId: "another-team" } }, "e2e-user", scope), /identity or baseline is invalid/);
  assert.throws(() => assertSchedulingRecoveryManifest({ ...recovery, scope: { ...recovery.scope, runId: "not-a-run-id" } }, "e2e-user", scope), /identity or baseline is invalid/);
  assert.throws(() => assertSchedulingRecoveryManifest(recovery, "another-user", scope), /identity or baseline is invalid/);
  assert.throws(() => assertSchedulingRecoveryManifest({ ...recovery, owner: "foreign-owner" }, "e2e-user", scope), /identity or baseline is invalid/);
  assert.throws(() => assertSchedulingRecoveryManifest({ ...recovery, baselineHash: "invalid" }, "e2e-user", scope), /identity or baseline is invalid/);
});
test("names and dates cannot authorize cleanup; every ownership dimension is required", () => {
  assert.throws(() => assertOwnedRecord({ name: "WorshipSync E2E Scheduling", ...scope }, scope, "schedule", true), /ownership/);
  for (const key of ["churchId", "teamId"] as const) assert.throws(() => assertOwnedRecord({ ...record, [key]: "foreign" }, scope, "schedule", true), /ownership/);
  for (const key of ["owner", "fixtureId", "runId"]) assert.throws(() => assertOwnedRecord({ ...record, e2eFixture: { ...record.e2eFixture, [key]: "foreign" } }, scope, "schedule", true), /ownership/);
  assert.doesNotThrow(() => assertOwnedRecord(record, scope, "schedule", true));
});
test("adopted or published schedules are preserved with an exact ID diagnostic", () => {
  const schedule = { ...record, scheduleId: scope.scheduleId, published: false, serviceIds: ["service-a"], occurrences: [{ occurrenceId: "one", serviceId: "service-a" }], assignments: { one: { "position::0": { primaryMemberId: "member" } } } };
  assert.doesNotThrow(() => assertSafeSchedule(schedule, scope));
  for (const markerChange of [{ owner: "foreign-owner" }, { fixtureId: "foreign-fixture" }, { runId: "foreign-run" }]) {
    assert.throws(() => assertSafeSchedule({ ...schedule, e2eFixture: { ...record.e2eFixture, ...markerChange } }, scope), /ownership/);
  }
  for (const changed of [{ published: true }, { sentAt: "now" }, { serviceIds: ["foreign-service"] }, { assignments: { one: { "position::0": { primaryMemberId: "unowned-member" } } } }]) {
    assert.throws(() => assertSafeSchedule({ ...schedule, ...changed }, scope), /generated-owned/);
  }
});
test("mutation guard admits only exact test schedule operations and rejects external effects", () => {
  const root = "/api/churches/demo/team-schedules/";
  const ensure = { ...scope, occurrences: [{ serviceId: "service-a", serviceIds: ["service-a"], positionRequirements: [{ positionId: "position", count: 1 }] }] };
  assert.equal(schedulingMutationAllowed(root + "ensure", ensure, scope), true);
  for (const changed of [{ teamId: "foreign" }, { serviceIds: ["unowned"] }, { startDate: "2026-01-01" }, { publicationStatus: "published" }]) assert.equal(schedulingMutationAllowed(root + "ensure", { ...ensure, ...changed }, scope), false);
  for (const suffix of ["send", "publish", "link", "initial-sms-batch", "archive"]) assert.equal(schedulingMutationAllowed(root + scope.scheduleId + "/" + suffix, {}, scope), false);
  assert.equal(schedulingMutationAllowed(root + "foreign/delete", {}, scope), false);
  assert.equal(schedulingMutationAllowed("/api/churches/foreign/team-schedules/ensure", ensure, scope), false);
});
