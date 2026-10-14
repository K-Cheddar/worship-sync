import test from "node:test";
import assert from "node:assert/strict";
import {
  buildScheduleInitialSmsMessage,
  getScheduleAssignedMemberIds,
  getScheduleMemberAssignments,
  mapWithConcurrency,
  scheduleInitialSmsIdempotencyKey,
} from "./scheduleInitialSms.js";

const positions = [
  { positionId: "camera", churchId: "church-a", teamId: "team-a", name: "Camera" },
  { positionId: "audio", churchId: "church-a", teamId: "team-a", name: "Audio" },
  { positionId: "foreign", churchId: "church-a", teamId: "team-b", name: "Other team" },
];

test("schedule recipient reads preserve order with bounded concurrency", async () => {
  let active = 0;
  let maximumActive = 0;
  const results = await mapWithConcurrency(["first", "second", "third", "fourth"], 2, async (value) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    return value.toUpperCase();
  });
  assert.deepEqual(results, ["FIRST", "SECOND", "THIRD", "FOURTH"]);
  assert.equal(maximumActive, 2);
});

test("grouping keeps each assigned member once with all positions and services from the selected schedule", () => {
  const schedule = {
    churchId: "church-a",
    teamId: "team-a",
    occurrences: [
      { occurrenceId: "service-1", name: "Morning service", serviceDate: "2026-10-04", startsAt: "2026-10-04T14:00:00.000Z" },
      { occurrenceId: "combined", name: "Combined service", serviceDate: "2026-10-11", startsAt: "2026-10-11T14:00:00.000Z", groupId: "combined" },
    ],
    assignments: {
      "service-1": { "camera::0": "member-a", "camera::1": { primaryMemberId: "member-a" }, "audio::0": { primaryMemberId: "member-b" }, "foreign::0": "member-c" },
      combined: { "audio::0": "member-a" },
    },
  };
  assert.deepEqual(getScheduleAssignedMemberIds(schedule), ["member-a", "member-b", "member-c"]);
  const grouped = getScheduleMemberAssignments({ schedule, memberId: "member-a", positions });
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].serviceName, "Morning service");
  assert.deepEqual(grouped[0].positions.map(({ positionName }) => positionName), ["Camera", "Camera"]);
  assert.equal(grouped[1].serviceName, "Combined service");
  assert.deepEqual(getScheduleMemberAssignments({ schedule, memberId: "member-c", positions }), [], "foreign Team assignments do not enter this schedule's grouped message");
});

test("personalized schedule SMS includes every assignment, local service dates, positions, one link, and opt-out language", () => {
  const message = buildScheduleInitialSmsMessage({
    churchName: "First Church",
    timeZone: "America/Los_Angeles",
    responseUrl: "https://example.test/schedule-response/member-token",
    assignments: [
      { occurrenceId: "one", serviceName: "Morning worship", serviceDate: "2026-10-04", startsAt: "2026-10-04T14:00:00.000Z", positions: [{ positionId: "camera", positionName: "Camera" }, { positionId: "camera", positionName: "Camera" }] },
      { occurrenceId: "two", serviceName: "Evening worship", serviceDate: "2026-10-11", startsAt: "2026-10-11T14:00:00.000Z", positions: [{ positionId: "audio", positionName: "Audio" }] },
    ],
  });
  assert.match(message, /First Church: Your schedule is ready/);
  assert.match(message, /Morning worship · Sun, Oct 4 — Camera \(2\)/);
  assert.match(message, /Evening worship · Sun, Oct 11 — Audio/);
  assert.equal((message.match(/schedule-response\/member-token/g) || []).length, 1);
  assert.match(message, /Reply STOP to opt out\./);
});

test("fallback dates use the church timezone and initial identity is independent of assignment and schedule metadata", () => {
  const message = buildScheduleInitialSmsMessage({
    churchName: "First Church",
    timeZone: "America/Los_Angeles",
    responseUrl: "https://example.test/schedule-response/token",
    assignments: [{ occurrenceId: "one", serviceName: "Service", serviceDate: "", startsAt: "2026-10-04T01:00:00.000Z", positions: [] }],
  });
  assert.match(message, /Service · Sat, Oct 3/);
  assert.equal(
    scheduleInitialSmsIdempotencyKey("schedule-a", "member-a"),
    scheduleInitialSmsIdempotencyKey("schedule-a", "member-a"),
  );
  assert.notEqual(scheduleInitialSmsIdempotencyKey("schedule-a", "member-a"), scheduleInitialSmsIdempotencyKey("schedule-b", "member-a"));
});
