import {
  mergeCurrentServiceSchedules,
} from "./CurrentServiceWorkspace";
import type { TeamSchedule, TeamScheduleSummary } from "../../api/authTypes";

const summary = (scheduleId: string): TeamScheduleSummary => ({
  scheduleId,
  churchId: "church-1",
  teamId: `team-${scheduleId}`,
  name: "Sunday",
  startDate: "2026-08-01",
  endDate: "2026-08-01",
  serviceIds: ["service-1"],
  assignmentsOmitted: true,
});

const detail = (scheduleId: string): TeamSchedule => ({
  ...summary(scheduleId),
  assignmentsOmitted: false,
  assignments: {},
});

describe("mergeCurrentServiceSchedules", () => {
  it("applies live schedule updates and removals over a bootstrap response", () => {
    const schedules = [summary("schedule-1"), summary("schedule-2")];
    const overrides = new Map<string, TeamSchedule | null>([
      ["schedule-1", detail("schedule-1")],
      ["schedule-2", null],
    ]);

    expect(mergeCurrentServiceSchedules(schedules, overrides)).toEqual([
      detail("schedule-1"),
    ]);
  });

  it("retains a live schedule that was created after bootstrap started", () => {
    const created = detail("schedule-created");
    const overrides = new Map<string, TeamSchedule | null>([
      [created.scheduleId, created],
    ]);

    expect(mergeCurrentServiceSchedules([summary("schedule-1")], overrides)).toEqual([
      summary("schedule-1"),
      created,
    ]);
  });
});
