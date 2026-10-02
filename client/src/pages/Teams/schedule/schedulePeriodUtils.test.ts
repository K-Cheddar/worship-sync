import type { TeamScheduleOccurrence, TeamScheduleSummary } from "../../../api/authTypes";
import {
  filterOccurrencesToRange,
  findReusablePeriodSchedule,
  persistedScheduleRange,
  rangeFromPreset,
} from "./schedulePeriodUtils";

const occurrence: TeamScheduleOccurrence = {
  occurrenceId: "service@2026-10-03T10:00:00.000Z",
  serviceId: "service",
  name: "Service",
  startsAt: "2026-10-03T10:00:00.000Z",
};
const target = {
  churchId: "church-1",
  teamId: "team-1",
  startDate: "2026-10-01",
  endDate: "2026-10-31",
  serviceIds: ["service"],
  occurrences: [occurrence],
};
const schedule = (changes: Partial<TeamScheduleSummary> = {}): TeamScheduleSummary => ({
  scheduleId: "schedule-1",
  churchId: target.churchId,
  name: "October",
  teamId: target.teamId,
  startDate: target.startDate,
  endDate: target.endDate,
  serviceIds: target.serviceIds,
  occurrences: target.occurrences,
  ...changes,
});

describe("rangeFromPreset", () => {
  it("includes today through 30 days from today for Upcoming", () => {
    expect(rangeFromPreset("upcoming", new Date(2026, 8, 29, 12))).toEqual({
      start: "2026-09-29",
      end: "2026-10-29",
    });
  });

  it("handles the December to January boundary for Upcoming", () => {
    expect(rangeFromPreset("upcoming", new Date(2026, 11, 31, 12))).toEqual({
      start: "2026-12-31",
      end: "2027-01-30",
    });
  });

  it("keeps This month as the full current calendar month", () => {
    expect(rangeFromPreset("thisMonth", new Date(2026, 8, 29, 12))).toEqual({
      start: "2026-09-01",
      end: "2026-09-30",
    });
  });
});

describe("persistedScheduleRange", () => {
  it("keeps Upcoming identity on calendar bounds while its visible start advances", () => {
    const dayOne = persistedScheduleRange("upcoming", { start: "2026-09-29", end: "2026-10-29" });
    const dayTwo = persistedScheduleRange("upcoming", { start: "2026-09-30", end: "2026-10-30" });

    expect(dayOne).toEqual({ start: "2026-09-01", end: "2026-10-31" });
    expect(dayTwo).toEqual(dayOne);
    expect(persistedScheduleRange("upcoming", { start: "2026-10-01", end: "2026-10-31" })).toEqual({
      start: "2026-10-01",
      end: "2026-10-31",
    });
  });

  it("preserves explicit full-month and custom ranges", () => {
    expect(persistedScheduleRange("thisMonth", { start: "2026-09-01", end: "2026-09-30" })).toEqual({
      start: "2026-09-01",
      end: "2026-09-30",
    });
    expect(persistedScheduleRange("custom", { start: "2026-09-29", end: "2026-10-03" })).toEqual({
      start: "2026-09-29",
      end: "2026-10-03",
    });
  });
});

it("filters past occurrences from the visible Upcoming range", () => {
  const septemberOccurrence = { ...occurrence, occurrenceId: "service@2026-09-29T10:00:00.000Z", startsAt: "2026-09-29T10:00:00.000Z" };
  expect(filterOccurrencesToRange([septemberOccurrence, occurrence], {
    start: "2026-09-30",
    end: "2026-10-31",
  })).toEqual([occurrence]);
});

describe("findReusablePeriodSchedule", () => {
  it("reuses an exact generated-period schedule", () => {
    const generated = schedule({
      scheduleId: "generated_period-key",
      source: "generated-period",
      generatedPeriodKey: "period-key",
    });
    expect(findReusablePeriodSchedule({ schedules: [generated], ...target })).toEqual({
      schedule: generated,
      ambiguous: false,
    });
  });

  it("reuses the same generated schedule on the first day of a new month", () => {
    const septemberCreatedSchedule = schedule({
      scheduleId: "generated_stable-september-window",
      source: "generated-period",
      generatedPeriodKey: "stable-september-window",
      startDate: "2026-09-01",
      endDate: "2026-10-31",
    });
    const dayTwoTarget = {
      ...target,
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      visibleStartDate: "2026-10-01",
      visibleEndDate: "2026-10-31",
    };

    expect(findReusablePeriodSchedule({ schedules: [septemberCreatedSchedule], ...dayTwoTarget })).toEqual({
      schedule: septemberCreatedSchedule,
      ambiguous: false,
    });
  });

  it("reuses legacy rolling generated records without dropping their assignments", () => {
    const legacyRollingRecord = schedule({
      scheduleId: "generated_old-rolling-key",
      source: "generated-period",
      generatedPeriodKey: "old-rolling-key",
      startDate: "2026-09-29",
      endDate: "2026-10-31",
      assignmentCounts: { byMemberId: { member: 1 }, byPositionId: { camera: 1 } },
    });

    expect(findReusablePeriodSchedule({
      schedules: [legacyRollingRecord],
      ...target,
      startDate: "2026-09-01",
      visibleStartDate: "2026-09-29",
    })).toEqual({ schedule: legacyRollingRecord, ambiguous: false });
  });

  it("prefers the sole populated overlapping generated schedule", () => {
    const empty = schedule({
      scheduleId: "generated_empty-window",
      generatedPeriodKey: "empty-window",
      source: "generated-period",
      startDate: "2026-09-01",
      endDate: "2026-10-31",
    });
    const populated = schedule({
      scheduleId: "generated_populated-window",
      generatedPeriodKey: "populated-window",
      source: "generated-period",
      startDate: "2026-09-01",
      endDate: "2026-10-31",
      assignmentCounts: { byMemberId: { member: 1 }, byPositionId: { camera: 1 } },
    });

    expect(findReusablePeriodSchedule({
      schedules: [empty, populated],
      ...target,
      startDate: "2026-10-01",
      visibleStartDate: "2026-10-01",
    })).toEqual({ schedule: populated, ambiguous: false });
  });

  it("surfaces multiple populated overlapping schedules as ambiguous", () => {
    const populatedA = schedule({
      scheduleId: "generated_populated-a",
      generatedPeriodKey: "populated-a",
      source: "generated-period",
      startDate: "2026-09-01",
      endDate: "2026-10-31",
      assignmentCounts: { byMemberId: { memberA: 1 }, byPositionId: { camera: 1 } },
    });
    const populatedB = schedule({
      scheduleId: "generated_populated-b",
      generatedPeriodKey: "populated-b",
      source: "generated-period",
      startDate: "2026-09-01",
      endDate: "2026-10-31",
      assignmentCounts: { byMemberId: { memberB: 1 }, byPositionId: { camera: 1 } },
    });

    expect(findReusablePeriodSchedule({
      schedules: [populatedA, populatedB],
      ...target,
      startDate: "2026-10-01",
      visibleStartDate: "2026-10-01",
    })).toEqual({ schedule: null, ambiguous: true });
  });

  it("does not cross-wire schedules from another team", () => {
    const otherTeam = schedule({
      teamId: "worship",
      scheduleId: "generated_other-team",
      source: "generated-period",
      generatedPeriodKey: "other-team",
    });
    expect(findReusablePeriodSchedule({ schedules: [otherTeam], ...target })).toEqual({
      schedule: null,
      ambiguous: false,
    });
  });

  it("reuses a saved schedule when current services generate no visible occurrences", () => {
    const saved = schedule({
      source: "generated-period",
      generatedPeriodKey: "period-key",
      scheduleId: "generated_period-key",
      assignmentCounts: { byMemberId: { member: 1 }, byPositionId: { camera: 1 } },
    });
    expect(findReusablePeriodSchedule({
      schedules: [saved],
      ...target,
      occurrences: [],
    })).toEqual({ schedule: saved, ambiguous: false });
  });

  it("prefers a generated period over an equivalent legacy schedule", () => {
    const generated = schedule({
      scheduleId: "generated_current-key",
      source: "generated-period",
      generatedPeriodKey: "current-key",
    });
    const legacy = schedule({ scheduleId: "legacy" });
    expect(findReusablePeriodSchedule({ schedules: [legacy, generated], ...target })).toEqual({
      schedule: generated,
      ambiguous: false,
    });
  });

  it("reuses an old-key generated period ahead of an equivalent legacy schedule", () => {
    const oldGenerated = schedule({
      scheduleId: "generated_old-key",
      source: "generated-period",
      generatedPeriodKey: "old-key",
    });
    const legacy = schedule({ scheduleId: "legacy" });
    expect(findReusablePeriodSchedule({ schedules: [legacy, oldGenerated], ...target })).toEqual({
      schedule: oldGenerated,
      ambiguous: false,
    });
  });

  it("prefers a populated custom schedule over an empty generated copy", () => {
    const generated = schedule({
      scheduleId: "generated_current-key",
      source: "generated-period",
      generatedPeriodKey: "current-key",
    });
    const custom = schedule({
      scheduleId: "custom",
      source: "custom",
      assignmentCounts: { byMemberId: { member: 1 }, byPositionId: { camera: 1 } },
    });
    expect(findReusablePeriodSchedule({ schedules: [custom, generated], ...target })).toEqual({
      schedule: custom,
      ambiguous: false,
    });
  });

  it("keeps populated custom and generated schedules ambiguous", () => {
    const generated = schedule({
      scheduleId: "generated_current-key",
      source: "generated-period",
      generatedPeriodKey: "current-key",
      assignmentCounts: { byMemberId: { generatedMember: 1 }, byPositionId: { camera: 1 } },
    });
    const custom = schedule({
      scheduleId: "custom",
      source: "custom",
      assignmentCounts: { byMemberId: { customMember: 1 }, byPositionId: { camera: 1 } },
    });
    expect(findReusablePeriodSchedule({ schedules: [generated, custom], ...target })).toEqual({
      schedule: null,
      ambiguous: true,
    });
  });

  it("keeps competing populated custom and legacy schedules ambiguous", () => {
    const custom = schedule({
      source: "custom",
      assignmentCounts: { byMemberId: { customMember: 1 }, byPositionId: { camera: 1 } },
    });
    const legacy = schedule({
      scheduleId: "legacy",
      assignmentCounts: { byMemberId: { legacyMember: 1 }, byPositionId: { camera: 1 } },
    });
    expect(findReusablePeriodSchedule({ schedules: [custom, legacy], ...target })).toEqual({
      schedule: null,
      ambiguous: true,
    });
  });

  it("ignores generated records whose key and schedule id disagree", () => {
    const invalidGenerated = schedule({
      scheduleId: "generated_another-key",
      source: "generated-period",
      generatedPeriodKey: "period-key",
    });
    const legacy = schedule({ scheduleId: "legacy" });
    expect(findReusablePeriodSchedule({ schedules: [invalidGenerated, legacy], ...target })).toEqual({
      schedule: legacy,
      ambiguous: false,
    });
  });

  it("does not reuse a generated record whose stored period differs from the target", () => {
    const otherPeriod = schedule({
      scheduleId: "generated_other-period-key",
      source: "generated-period",
      generatedPeriodKey: "other-period-key",
      startDate: "2026-11-01",
      endDate: "2026-11-30",
    });
    const legacy = schedule({ scheduleId: "legacy" });
    expect(findReusablePeriodSchedule({ schedules: [otherPeriod, legacy], ...target })).toEqual({
      schedule: legacy,
      ambiguous: false,
    });
  });

  it("adopts a populated custom schedule for normal period navigation", () => {
    const custom = schedule({
      source: "custom",
      assignmentCounts: { byMemberId: { member: 1 }, byPositionId: { camera: 1 } },
    });
    expect(findReusablePeriodSchedule({
      schedules: [custom],
      ...target,
    })).toEqual({ schedule: custom, ambiguous: false });
  });

  it("reuses source-less legacy schedules only when their stored identity is equivalent", () => {
    const legacy = schedule();
    expect(findReusablePeriodSchedule({ schedules: [legacy], ...target }).schedule).toBe(legacy);
    expect(findReusablePeriodSchedule({
      schedules: [schedule({ occurrences: [{ ...occurrence, occurrenceId: "other@date" }] })],
      ...target,
    }).schedule).toBeNull();
  });

  it("does not choose among multiple equivalent legacy schedules", () => {
    const schedules = [schedule({ scheduleId: "a" }), schedule({ scheduleId: "b" })];
    expect(findReusablePeriodSchedule({ schedules, ...target })).toEqual({
      schedule: null,
      ambiguous: true,
    });
  });
});
