import type { TeamScheduleOccurrence, TeamScheduleSummary } from "../../../api/authTypes";
import { findReusablePeriodSchedule } from "./schedulePeriodUtils";

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
