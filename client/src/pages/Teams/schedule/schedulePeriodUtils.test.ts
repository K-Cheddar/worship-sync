import type { TeamSchedule, TeamScheduleOccurrence, TeamScheduleSummary } from "../../../api/authTypes";
import {
  filterOccurrencesToRange,
  findOverlappingPeriodSchedules,
  findReusablePeriodSchedule,
  rangeFromPreset,
  resolveDisplayedPeriodRange,
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
  occurrences: [occurrence],
};
type TestSchedule = TeamScheduleSummary & Pick<Partial<TeamSchedule>, "assignments">;
const schedule = (changes: Partial<TestSchedule> = {}): TestSchedule => ({
  scheduleId: "schedule-1",
  churchId: target.churchId,
  name: "October",
  teamId: target.teamId,
  startDate: target.startDate,
  endDate: target.endDate,
  serviceIds: ["service"],
  occurrences: target.occurrences,
  ...changes,
});

describe("rangeFromPreset", () => {
  it("keeps This month as the full current calendar month", () => {
    expect(rangeFromPreset("thisMonth", new Date(2026, 8, 29, 12))).toEqual({
      start: "2026-09-01",
      end: "2026-09-30",
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

  it("does not use a partial custom December schedule as the full-period default", () => {
    const decemberSchedule = schedule({
      scheduleId: "saved-december-5-to-28",
      startDate: "2026-12-05",
      endDate: "2026-12-28",
      source: "custom",
    });
    const upcomingTarget = {
      ...target,
      startDate: "2026-12-01",
      endDate: "2026-12-31",
      visibleStartDate: "2026-12-01",
      visibleEndDate: "2026-12-31",
      legacyOccurrenceDate: "2026-12-05",
    };

    expect(findReusablePeriodSchedule({ schedules: [decemberSchedule], ...upcomingTarget })).toEqual({
      schedule: null,
      ambiguous: false,
    });
  });

  it("reuses legacy rolling generated records without dropping their assignments", () => {
    const legacyRollingRecord = schedule({
      scheduleId: "generated_old-rolling-key",
      source: "generated-period",
      generatedPeriodKey: "old-rolling-key",
      startDate: "2026-09-29",
      endDate: "2026-10-05",
      assignmentCounts: { byMemberId: { member: 1 }, byPositionId: { camera: 1 } },
    });

    expect(findReusablePeriodSchedule({
      schedules: [legacyRollingRecord],
      ...target,
      startDate: "2026-09-01",
      visibleStartDate: "2026-10-01",
      visibleEndDate: "2026-10-31",
      legacyOccurrenceDate: "2026-10-03",
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

  it("chooses a stable populated candidate when several legitimate schedules overlap", () => {
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
    })).toEqual({ schedule: populatedA, ambiguous: false });
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

  it("does not select a schedule when Upcoming has no visible team occurrences", () => {
    expect(findReusablePeriodSchedule({
      schedules: [schedule({ source: "generated-period", generatedPeriodKey: "period-key", scheduleId: "generated_period-key" })],
      ...target,
      occurrences: [],
    })).toEqual({ schedule: null, ambiguous: false });
  });

  it("prefers a populated generated period over a populated source-less legacy copy", () => {
    const generated = schedule({
      scheduleId: "generated_current-key",
      source: "generated-period",
      generatedPeriodKey: "current-key",
      assignmentCounts: { byMemberId: { generatedMember: 1 }, byPositionId: { camera: 1 } },
    });
    const legacy = schedule({
      scheduleId: "legacy",
      assignmentCounts: { byMemberId: { legacyMember: 1 }, byPositionId: { camera: 1 } },
    });
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

  it("prefers the exact monthly period over a populated broader legacy period", () => {
    const generated = schedule({
      scheduleId: "generated_current-key",
      source: "generated-period",
      generatedPeriodKey: "current-key",
      assignments: { [occurrence.occurrenceId]: { "position::0": { primaryMemberId: "generated-member" } } },
    });
    const widerLegacy = schedule({
      scheduleId: "legacy-wider-period",
      startDate: "2026-09-01",
      endDate: "2026-11-30",
      assignments: { [occurrence.occurrenceId]: { "position::0": { primaryMemberId: "legacy-member" } } },
    });
    expect(findReusablePeriodSchedule({ schedules: [generated, widerLegacy], ...target })).toEqual({
      schedule: generated,
      ambiguous: false,
    });
  });

  it("prefers the canonical generated schedule over an empty custom match", () => {
    const generated = schedule({
      scheduleId: "generated_current-key",
      source: "generated-period",
      generatedPeriodKey: "current-key",
    });
    const custom = schedule({ scheduleId: "custom", source: "custom" });
    expect(findReusablePeriodSchedule({ schedules: [custom, generated], ...target })).toEqual({
      schedule: generated,
      ambiguous: false,
    });
  });

  it("ignores generated records whose key and schedule id disagree", () => {
    const invalidGenerated = schedule({
      scheduleId: "generated_another-key",
      source: "generated-period",
      generatedPeriodKey: "period-key",
    });
    const legacy = schedule({ scheduleId: "legacy" });
    expect(findReusablePeriodSchedule({ schedules: [invalidGenerated, legacy], ...target }).schedule?.scheduleId).toBe("generated_another-key");
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

  it("adopts populated custom schedules containing the visible occurrences", () => {
    const custom = schedule({
      scheduleId: "custom-october",
      source: "custom",
      assignments: { [occurrence.occurrenceId]: { "position::0": { primaryMemberId: "member" } } },
    });
    expect(findReusablePeriodSchedule({ schedules: [custom], ...target })).toEqual({
      schedule: custom,
      ambiguous: false,
    });
  });

  it("reuses a populated schedule after all service identities are replaced", () => {
    const savedOccurrences = [3, 10, 17, 24, 31].map((day) => ({
      ...occurrence,
      occurrenceId: `old-service@2026-10-${String(day).padStart(2, "0")}T10:00:00.000Z`,
      startsAt: `2026-10-${String(day).padStart(2, "0")}T10:00:00.000Z`,
    }));
    const custom = schedule({
      scheduleId: "custom-october-drifted",
      source: "custom",
      serviceIds: ["old-service"],
      occurrences: savedOccurrences,
      assignments: { [savedOccurrences[0].occurrenceId]: { "position::0": { primaryMemberId: "member" } } },
    });
    const currentOccurrences = [3, 7, 10, 14, 17, 24, 31].map((day) => ({
      ...occurrence,
      occurrenceId: `new-service@2026-10-${String(day).padStart(2, "0")}T11:00:00.000Z`,
      serviceId: "new-service",
      startsAt: `2026-10-${String(day).padStart(2, "0")}T11:00:00.000Z`,
    }));

    const result = findReusablePeriodSchedule({
      schedules: [custom],
      ...target,
      occurrences: currentOccurrences,
      visibleStartDate: "2026-10-01",
      visibleEndDate: "2026-10-31",
    });

    expect(result).toEqual({ schedule: custom, ambiguous: false });
    expect(result.schedule?.occurrences).toEqual(savedOccurrences);
    expect((result.schedule as TeamSchedule).assignments).toEqual(custom.assignments);
  });

  it("reuses a saved period when current Setup has no occurrences", () => {
    const custom = schedule({
      source: "custom",
      occurrences: [occurrence],
      assignments: { [occurrence.occurrenceId]: { "position::0": { primaryMemberId: "member" } } },
    });
    expect(findReusablePeriodSchedule({
      schedules: [custom],
      ...target,
      occurrences: [],
      visibleStartDate: "2026-10-01",
      visibleEndDate: "2026-10-31",
    })).toEqual({ schedule: custom, ambiguous: false });
  });

  it("does not use a one-day schedule to fill a full-month period", () => {
    const occurrenceDateOnly = schedule({
      scheduleId: "different-range",
      source: "custom",
      startDate: "2026-10-03",
      endDate: "2026-10-03",
      assignmentCounts: { byMemberId: { member: 1 }, byPositionId: { camera: 1 } },
    });
    expect(findReusablePeriodSchedule({ schedules: [occurrenceDateOnly], ...target })).toEqual({
      schedule: null,
      ambiguous: false,
    });
  });

  it("prefers a populated custom schedule over an empty generated schedule", () => {
    const generated = schedule({
      scheduleId: "generated_current-key",
      source: "generated-period",
      generatedPeriodKey: "current-key",
    });
    const custom = schedule({
      scheduleId: "custom",
      source: "custom",
      assignments: { [occurrence.occurrenceId]: { "position::0": { primaryMemberId: "member" } } },
    });
    expect(findReusablePeriodSchedule({ schedules: [generated, custom], ...target })).toEqual({
      schedule: custom,
      ambiguous: false,
    });
  });

  it("prefers a canonical generated schedule among multiple populated exact candidates", () => {
    const generated = schedule({
      scheduleId: "generated_current-key",
      source: "generated-period",
      generatedPeriodKey: "current-key",
      assignments: { [occurrence.occurrenceId]: { "position::0": { primaryMemberId: "member-a" } } },
    });
    const custom = schedule({
      scheduleId: "custom",
      source: "custom",
      assignments: { [occurrence.occurrenceId]: { "position::0": { primaryMemberId: "member-b" } } },
    });
    expect(findReusablePeriodSchedule({ schedules: [generated, custom], ...target })).toEqual({
      schedule: generated,
      ambiguous: false,
    });
  });

  it("adopts populated source-less legacy schedules with a wider stored range", () => {
    const legacy = schedule({
      scheduleId: "legacy-wide",
      startDate: "2026-09-01",
      endDate: "2026-11-30",
      assignmentCounts: { byMemberId: { member: 1 }, byPositionId: { camera: 1 } },
    });
    expect(findReusablePeriodSchedule({ schedules: [legacy], ...target })).toEqual({
      schedule: legacy,
      ambiguous: false,
    });
  });

  it("reuses source-less legacy schedules by covered dates despite occurrence identity drift", () => {
    const legacy = schedule();
    expect(findReusablePeriodSchedule({ schedules: [legacy], ...target }).schedule).toBe(legacy);
    expect(findReusablePeriodSchedule({
      schedules: [schedule({ occurrences: [{ ...occurrence, occurrenceId: "other@date" }] })],
      ...target,
    }).schedule?.scheduleId).toBe("schedule-1");
  });

  it("chooses a stable populated source-less legacy candidate", () => {
    const schedules = [
      schedule({
        scheduleId: "a",
        assignmentCounts: { byMemberId: { memberA: 1 }, byPositionId: { camera: 1 } },
      }),
      schedule({
        scheduleId: "b",
        assignmentCounts: { byMemberId: { memberB: 1 }, byPositionId: { camera: 1 } },
      }),
    ];
    expect(findReusablePeriodSchedule({ schedules, ...target })).toEqual({
      schedule: schedules[0],
      ambiguous: false,
    });
  });
});

describe("findOverlappingPeriodSchedules", () => {
  const range = { start: "2026-10-01", end: "2026-10-31" };
  const schedules = [
    schedule({ scheduleId: "month", name: "October 2026" }),
    schedule({ scheduleId: "single", name: "Youth Sabbath", startDate: "2026-10-10", endDate: "2026-10-10" }),
    schedule({ scheduleId: "event", name: "Fall Revival", startDate: "2026-10-18", endDate: "2026-10-24" }),
    schedule({ scheduleId: "quarter", name: "Quarter 4", startDate: "2026-10-01", endDate: "2026-12-31" }),
    schedule({ scheduleId: "september", startDate: "2026-09-01", endDate: "2026-09-30" }),
    schedule({ scheduleId: "archived", startDate: "2026-10-05", endDate: "2026-10-06", archivedAt: "2026-09-01" }),
  ];

  const getOverlaps = (items: TeamScheduleSummary[]) => findOverlappingPeriodSchedules({
    schedules: items,
    churchId: target.churchId,
    teamId: target.teamId,
    range,
  });

  it("shows no switcher choice when zero or one active saved schedule overlaps", () => {
    expect(getOverlaps([schedules[4]])).toHaveLength(0);
    expect(getOverlaps([schedules[0]])).toHaveLength(1);
  });

  it("includes every active saved schedule that overlaps, including single-day and wider ranges", () => {
    expect(getOverlaps(schedules).map(({ scheduleId }) => scheduleId)).toEqual([
      "month", "quarter", "single", "event",
    ]);
  });

  it("does not count archived overlapping schedules", () => {
    expect(getOverlaps([schedules[0], schedules[5]])).toEqual([schedules[0]]);
  });
});

describe("resolveDisplayedPeriodRange", () => {
  const quarterlySchedule = schedule({
    startDate: "2026-10-01",
    endDate: "2026-12-31",
    occurrences: [3, 10, 17].map((day) => ({
      ...occurrence,
      occurrenceId: `service@2026-10-${String(day).padStart(2, "0")}T10:00:00.000Z`,
      startsAt: `2026-10-${String(day).padStart(2, "0")}T10:00:00.000Z`,
    })),
  });

  it("keeps a Custom selection narrow while reusing the quarterly schedule", () => {
    const selectedRange = { start: "2026-10-05", end: "2026-10-12" };
    const match = findReusablePeriodSchedule({
      schedules: [quarterlySchedule],
      ...target,
      visibleStartDate: selectedRange.start,
      visibleEndDate: selectedRange.end,
    });
    const displayedRange = resolveDisplayedPeriodRange({
      preset: "custom",
      selectedRange,
      scheduleRange: { start: quarterlySchedule.startDate!, end: quarterlySchedule.endDate! },
    });

    expect(match.schedule).toBe(quarterlySchedule);
    expect(displayedRange).toEqual(selectedRange);
    expect(filterOccurrencesToRange(quarterlySchedule.occurrences!, displayedRange).map((item) => item.startsAt)).toEqual([
      "2026-10-10T10:00:00.000Z",
    ]);
  });

  it("keeps This month on October while reusing the quarterly schedule", () => {
    const selectedRange = { start: "2026-10-01", end: "2026-10-31" };
    const match = findReusablePeriodSchedule({
      schedules: [quarterlySchedule],
      ...target,
      visibleStartDate: selectedRange.start,
      visibleEndDate: selectedRange.end,
    });
    const displayedRange = resolveDisplayedPeriodRange({
      preset: "thisMonth",
      selectedRange,
      scheduleRange: { start: quarterlySchedule.startDate!, end: quarterlySchedule.endDate! },
    });

    expect(match.schedule).toBe(quarterlySchedule);
    expect(displayedRange).toEqual(selectedRange);
    expect(filterOccurrencesToRange(quarterlySchedule.occurrences!, displayedRange)).toHaveLength(3);
  });

  it("keeps Upcoming on its selected range while explicit history uses full saved bounds", () => {
    const scheduleRange = { start: "2026-10-01", end: "2026-12-31" };
    const selectedRange = { start: "2026-10-05", end: "2026-10-12" };
    expect(resolveDisplayedPeriodRange({ preset: "upcoming", selectedRange, scheduleRange })).toEqual(selectedRange);
    expect(resolveDisplayedPeriodRange({ preset: "custom", selectedRange, scheduleRange, viewingSavedSchedule: true })).toEqual(scheduleRange);
  });

  it("keeps Upcoming's selected range when a schedule is deliberately switched", () => {
    const scheduleRange = { start: "2026-10-01", end: "2026-12-31" };
    const selectedRange = { start: "2026-10-01", end: "2026-10-31" };
    expect(resolveDisplayedPeriodRange({
      preset: "upcoming",
      selectedRange,
      scheduleRange,
    })).toEqual(selectedRange);
    expect(filterOccurrencesToRange(quarterlySchedule.occurrences!, selectedRange)).toHaveLength(3);
  });
});
