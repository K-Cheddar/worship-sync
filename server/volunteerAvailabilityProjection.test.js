import assert from "node:assert/strict";
import test from "node:test";
import { projectVolunteerAvailabilityResponse } from "./volunteerAvailabilityProjection.js";

const date = "2026-11-07";
const groupId = "1jrege3bu2c6hs0lrc7c";
const memberServiceId = "1j8r6dqu4anb91e4jac8";
const secondServiceId = "second-service";
const groupOccurrenceId = `group:${groupId}@${date}`;
const memberOccurrenceId = `${memberServiceId}@${date}`;
const independentOccurrenceId = `independent-service@${date}`;
const form = {
  teamIds: ["team-1"],
  availabilityOccurrences: [
    { occurrenceId: groupOccurrenceId, serviceId: memberServiceId, name: "Sabbath Service & 2nd service", startsAt: "2026-11-07T14:00:00.000Z", serviceDate: date },
    { occurrenceId: memberOccurrenceId, serviceId: memberServiceId, name: "Sabbath Service", startsAt: "2026-11-07T14:00:00.000Z", serviceDate: date },
    { occurrenceId: independentOccurrenceId, serviceId: "independent-service", name: "Independent Service", startsAt: "2026-11-07T17:00:00.000Z", serviceDate: date },
  ],
};
const services = [
  { serviceId: memberServiceId, serviceGroupId: groupId },
  { serviceId: secondServiceId, serviceGroupId: groupId },
  { serviceId: "independent-service", serviceGroupId: "another-group" },
];
const schedules = [{
  scheduleId: "schedule-1",
  teamId: "team-1",
  occurrences: [
    { occurrenceId: groupOccurrenceId, serviceId: memberServiceId, serviceIds: [memberServiceId, secondServiceId], groupId, startsAt: "2026-11-07T14:00:00.000Z", serviceDate: date },
    { occurrenceId: memberOccurrenceId, serviceId: memberServiceId, serviceIds: [memberServiceId], startsAt: "2026-11-07T14:00:00.000Z", serviceDate: date },
  ],
}];

const project = (member = {}) => projectVolunteerAvailabilityResponse({
  form,
  member,
  serviceTimeZone: "America/New_York",
  services,
  schedules,
});

test("projects the confirmed grouped/standalone identity pair but retains independent same-day service", () => {
  const result = project();
  assert.deepEqual(result.occurrences.map(({ occurrenceId }) => occurrenceId), [
    groupOccurrenceId,
    independentOccurrenceId,
  ]);
  assert.deepEqual(result.occurrences[0].responseOccurrenceIds, [groupOccurrenceId, memberOccurrenceId]);
  assert.deepEqual(result.availability, {});
  assert.deepEqual(result.unansweredOccurrenceIds, [groupOccurrenceId, independentOccurrenceId]);
});

test("uses archived historical snapshots to reconcile the reported November dates", () => {
  const dates = ["2026-11-07", "2026-11-14", "2026-11-21", "2026-11-28"];
  const occurrences = dates.flatMap((serviceDate) => [
    {
      occurrenceId: `group:${groupId}@${serviceDate}`,
      serviceId: memberServiceId,
      name: "Sabbath Service & 2nd service",
      startsAt: `${serviceDate}T14:00:00.000Z`,
      serviceDate,
    },
    {
      occurrenceId: `${memberServiceId}@${serviceDate}`,
      serviceId: memberServiceId,
      name: "Sabbath Service",
      startsAt: `${serviceDate}T14:00:00.000Z`,
      serviceDate,
    },
  ]);
  const schedule = {
    scheduleId: "archived-november-snapshot",
    teamId: "team-1",
    archivedAt: "2026-11-20T18:00:00.000Z",
    occurrences: dates.flatMap((serviceDate) => [
      {
        occurrenceId: `group:${groupId}@${serviceDate}`,
        serviceId: memberServiceId,
        serviceIds: [memberServiceId, secondServiceId],
        groupId,
        startsAt: `${serviceDate}T14:00:00.000Z`,
        serviceDate,
      },
      {
        occurrenceId: `${memberServiceId}@${serviceDate}`,
        serviceId: memberServiceId,
        serviceIds: [memberServiceId],
        startsAt: `${serviceDate}T14:00:00.000Z`,
        serviceDate,
      },
    ]),
  };
  const result = projectVolunteerAvailabilityResponse({
    form: { ...form, availabilityOccurrences: occurrences },
    member: {},
    serviceTimeZone: "America/New_York",
    services,
    schedules: [schedule],
  });

  assert.deepEqual(result.occurrences.map(({ occurrenceId }) => occurrenceId),
    dates.map((serviceDate) => `group:${groupId}@${serviceDate}`),
  );
  assert.deepEqual(result.occurrences.map(({ responseOccurrenceIds }) => responseOccurrenceIds),
    dates.map((serviceDate) => [
      `group:${groupId}@${serviceDate}`,
      `${memberServiceId}@${serviceDate}`,
    ]),
  );
});

test("preserves both raw revisions and projects a single matching saved answer", () => {
  const result = project({
    serviceAvailability: { [memberOccurrenceId]: "unavailable" },
    serviceAvailabilityRevisions: { [groupOccurrenceId]: 4, [memberOccurrenceId]: 7 },
  });
  assert.deepEqual(result.availability, { [groupOccurrenceId]: "unavailable" });
  assert.deepEqual(result.availabilityRevision, {
    [groupOccurrenceId]: 4,
    [memberOccurrenceId]: 7,
    [independentOccurrenceId]: 0,
  });
  assert.equal(result.conflictingOccurrenceIds.length, 0);
});

test("does not choose between conflicting historical answers", () => {
  const result = project({
    serviceAvailability: {
      [groupOccurrenceId]: "available",
      [memberOccurrenceId]: "unavailable",
    },
  });
  assert.equal(result.availability[groupOccurrenceId], undefined);
  assert.deepEqual(result.conflictingOccurrenceIds, [groupOccurrenceId]);
  assert.deepEqual(result.unansweredOccurrenceIds, [groupOccurrenceId, independentOccurrenceId]);
  assert.equal(result.occurrences[0].hasConflictingAnswers, true);
});

test("keeps exact occurrence rows separate when group evidence is absent or ambiguous", () => {
  const noSavedSchedule = projectVolunteerAvailabilityResponse({
    form, member: {}, serviceTimeZone: "America/New_York", services, schedules: [],
  });
  assert.equal(noSavedSchedule.occurrences.length, 3);

  const conflictingMembership = projectVolunteerAvailabilityResponse({
    form,
    member: {},
    serviceTimeZone: "America/New_York",
    services,
    schedules: [...schedules, {
      scheduleId: "schedule-2",
      teamId: "team-1",
      occurrences: [{
        occurrenceId: groupOccurrenceId,
        serviceId: memberServiceId,
        serviceIds: [memberServiceId, "different-second-service"],
        groupId,
        startsAt: "2026-11-07T14:00:00.000Z",
        serviceDate: date,
      }],
    }],
  });
  assert.equal(conflictingMembership.occurrences.length, 3);
});

test("keeps an issued pair separate when the saved standalone belongs to another team", () => {
  const otherTeamSchedule = schedules.map((schedule) => ({ ...schedule, teamId: "other-team" }));
  const result = projectVolunteerAvailabilityResponse({
    form, member: {}, serviceTimeZone: "America/New_York", services, schedules: otherTeamSchedule,
  });
  assert.equal(result.occurrences.length, 3);
});

