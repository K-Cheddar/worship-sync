import assert from "node:assert/strict";
import test from "node:test";
import { resolveOccurrenceIdentity } from "../shared/teamScheduleOccurrences.ts";
import {
  createHistoricalIdentityEvidenceIndex,
  projectVolunteerAvailabilityResponse,
} from "./volunteerAvailabilityProjection.js";

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

test("projects the same canonical output when standalone aliases appear first", () => {
  const groupedFirst = project();
  const standaloneFirst = projectVolunteerAvailabilityResponse({
    form: { ...form, availabilityOccurrences: [form.availabilityOccurrences[1], form.availabilityOccurrences[2], form.availabilityOccurrences[0]] },
    member: {},
    serviceTimeZone: "America/New_York",
    services,
    schedules,
  });

  assert.deepEqual(standaloneFirst, groupedFirst);
  assert.deepEqual(standaloneFirst.occurrences.map(({ occurrenceId }) => occurrenceId), [
    groupOccurrenceId,
    independentOccurrenceId,
  ]);
});

test("reconciles interleaved grouped/standalone pairs in service-date order", () => {
  const dates = ["2026-11-07", "2026-11-14", "2026-11-21", "2026-11-28"];
  const occurrences = dates.flatMap((serviceDate) => [
    {
      occurrenceId: `${memberServiceId}@${serviceDate}`,
      serviceId: memberServiceId,
      name: "Sabbath Service",
      startsAt: `${serviceDate}T14:00:00.000Z`,
      serviceDate,
    },
    {
      occurrenceId: `group:${groupId}@${serviceDate}`,
      serviceId: memberServiceId,
      name: "Sabbath Service & 2nd service",
      startsAt: `${serviceDate}T14:00:00.000Z`,
      serviceDate,
    },
  ]).reverse();
  const schedule = {
    scheduleId: "interleaved-november-snapshot",
    teamId: "team-1",
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
    dates.map((serviceDate) => `group:${groupId}@${serviceDate}`));
  assert.deepEqual(result.occurrences.map(({ responseOccurrenceIds }) => responseOccurrenceIds),
    dates.map((serviceDate) => [`group:${groupId}@${serviceDate}`, `${memberServiceId}@${serviceDate}`]));
});

test("maps multiple proven standalone aliases to one grouped canonical occurrence", () => {
  const thirdServiceId = "third-service";
  const groupedId = `group:${groupId}@${date}`;
  const secondOccurrenceId = `${secondServiceId}@${date}`;
  const sourceOccurrences = [
    { occurrenceId: secondOccurrenceId, serviceId: secondServiceId, name: "Second service", startsAt: "2026-11-07T14:00:00.000Z", serviceDate: date },
    { occurrenceId: groupedId, serviceId: memberServiceId, name: "Sabbath Service & 2nd service & 3rd service", startsAt: "2026-11-07T14:00:00.000Z", serviceDate: date },
    { occurrenceId: `${thirdServiceId}@${date}`, serviceId: thirdServiceId, name: "Third service", startsAt: "2026-11-07T14:00:00.000Z", serviceDate: date },
  ];
  const result = projectVolunteerAvailabilityResponse({
    form: { ...form, availabilityOccurrences: sourceOccurrences },
    member: {},
    serviceTimeZone: "America/New_York",
    services: [
      ...services,
      { serviceId: thirdServiceId, serviceGroupId: groupId },
    ],
    schedules: [{
      teamId: "team-1",
      occurrences: [
        { occurrenceId: groupedId, serviceId: memberServiceId, serviceIds: [memberServiceId, secondServiceId, thirdServiceId], groupId, startsAt: "2026-11-07T14:00:00.000Z", serviceDate: date },
        { occurrenceId: memberOccurrenceId, serviceId: memberServiceId, serviceIds: [memberServiceId], startsAt: "2026-11-07T14:00:00.000Z", serviceDate: date },
        { occurrenceId: secondOccurrenceId, serviceId: secondServiceId, serviceIds: [secondServiceId], startsAt: "2026-11-07T14:00:00.000Z", serviceDate: date },
        { occurrenceId: `${thirdServiceId}@${date}`, serviceId: thirdServiceId, serviceIds: [thirdServiceId], startsAt: "2026-11-07T14:00:00.000Z", serviceDate: date },
      ],
    }],
  });

  assert.deepEqual(result.occurrences.map(({ occurrenceId, responseOccurrenceIds }) => ({ occurrenceId, responseOccurrenceIds })), [{
    occurrenceId: groupedId,
    responseOccurrenceIds: [groupedId, secondOccurrenceId, `${thirdServiceId}@${date}`],
  }]);
});

test("resolves schedule identity once per row and reuses it across a larger form", () => {
  const dates = Array.from({ length: 28 }, (_, index) => `2026-11-${String(index + 1).padStart(2, "0")}`);
  const scheduleOccurrences = dates.flatMap((serviceDate) => [
    { occurrenceId: `group:${groupId}@${serviceDate}`, serviceId: memberServiceId, serviceIds: [memberServiceId, secondServiceId], groupId, startsAt: `${serviceDate}T14:00:00.000Z`, serviceDate },
    { occurrenceId: `${memberServiceId}@${serviceDate}`, serviceId: memberServiceId, serviceIds: [memberServiceId], startsAt: `${serviceDate}T14:00:00.000Z`, serviceDate },
  ]);
  let identityResolutionCount = 0;
  const evidence = createHistoricalIdentityEvidenceIndex({
    form,
    schedules: [{ teamId: "team-1", occurrences: scheduleOccurrences }],
    timeZone: "America/New_York",
    resolveIdentity: (...args) => {
      identityResolutionCount += 1;
      return resolveOccurrenceIdentity(...args);
    },
  });

  dates.forEach((serviceDate) => assert.equal(evidence.provesAlias({
    groupId,
    serviceId: memberServiceId,
    serviceDate,
  }), true));
  assert.equal(identityResolutionCount, scheduleOccurrences.length);
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

