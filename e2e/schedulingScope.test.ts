import { test } from "node:test";
import assert from "node:assert/strict";
import { assertOwnedRecord, assertSafeSchedule, schedulingMutationAllowed, SCHEDULING_OWNER } from "./schedulingScope";

const scope = { churchId: "demo", teamId: "e2e-team", fixtureId: "fixture", runId: "run", positionId: "position", memberId: "member", serviceIds: ["service-a", "service-b"], scheduleId: "generated-owned", startDate: "2040-01-01", endDate: "2040-01-31" };
const record = { churchId: scope.churchId, teamId: scope.teamId, e2eFixture: { owner: SCHEDULING_OWNER, fixtureId: scope.fixtureId, runId: scope.runId } };
test("names and dates cannot authorize cleanup; every ownership dimension is required", () => {
  assert.throws(() => assertOwnedRecord({ name: "WorshipSync E2E Scheduling", ...scope }, scope, "schedule", true), /ownership/);
  for (const key of ["churchId", "teamId"] as const) assert.throws(() => assertOwnedRecord({ ...record, [key]: "foreign" }, scope, "schedule", true), /ownership/);
  for (const key of ["owner", "fixtureId", "runId"]) assert.throws(() => assertOwnedRecord({ ...record, e2eFixture: { ...record.e2eFixture, [key]: "foreign" } }, scope, "schedule", true), /ownership/);
  assert.doesNotThrow(() => assertOwnedRecord(record, scope, "schedule", true));
});
test("adopted or published schedules are preserved with an exact ID diagnostic", () => {
  const schedule = { ...record, scheduleId: scope.scheduleId, published: false, serviceIds: ["service-a"], occurrences: [{ occurrenceId: "one", serviceId: "service-a" }], assignments: { one: { "position::0": { primaryMemberId: "member" } } } };
  assert.doesNotThrow(() => assertSafeSchedule(schedule, scope));
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
