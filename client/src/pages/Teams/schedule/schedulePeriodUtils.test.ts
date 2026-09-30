import type { TeamScheduleOccurrence, TeamScheduleSummary } from "../../../api/authTypes";
import { findReusablePeriodSchedule, rangeFromPreset } from "./schedulePeriodUtils";

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
  it("includes today through the end of next month for Upcoming", () => {
    expect(rangeFromPreset("upcoming", new Date(2026, 8, 29, 12))).toEqual({
      start: "2026-09-29",
      end: "2026-10-31",
    });
  });

  it("handles the December to January boundary for Upcoming", () => {
    expect(rangeFromPreset("upcoming", new Date(2026, 11, 31, 12))).toEqual({
      start: "2026-12-31",
      end: "2027-01-31",
    });
  });

  it("keeps This month as the full current calendar month", () => {
    expect(rangeFromPreset("thisMonth", new Date(2026, 8, 29, 12))).toEqual({
      start: "2026-09-01",
      end: "2026-09-30",
    });
  });
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

  it("ignores custom exact-range schedules when generated is also present", () => {
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

  it("does not adopt a custom schedule for normal period navigation", () => {
    expect(findReusablePeriodSchedule({
      schedules: [schedule({ source: "custom" })],
      ...target,
    })).toEqual({ schedule: null, ambiguous: false });
  });

  it("reuses equivalent source-less legacy schedules by service and occurrence identity", () => {
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
