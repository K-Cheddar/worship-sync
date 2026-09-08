import type { TeamSchedule, TeamService } from "../../../api/authTypes";
import {
  formatSuggestedScheduleName,
  getCalendarMonthRange,
  getCreateScheduleDefaultRange,
  getCreateScheduleDefaultServiceIds,
  getMostRecentTeamSchedule,
  resolveScheduleNameForSave,
  teamHasScheduleOverlappingRange,
} from "./scheduleCreateDefaults";

const schedule = (
  overrides: Partial<TeamSchedule> &
    Pick<TeamSchedule, "scheduleId" | "teamId">,
): TeamSchedule => ({
  churchId: "church-1",
  name: overrides.name || overrides.scheduleId,
  startDate: "2026-09-01",
  endDate: "2026-09-30",
  serviceIds: ["svc-sunday"],
  occurrences: [],
  assignments: {},
  archivedAt: null,
  ...overrides,
});

const weeklyService = (
  overrides: Partial<TeamService> & Pick<TeamService, "serviceId" | "name">,
): TeamService => ({
  id: overrides.serviceId,
  churchId: "church-1",
  reccurence: "weekly",
  dayOfWeek: 6,
  time: "10:00",
  ...overrides,
});

describe("getCalendarMonthRange", () => {
  it("returns the calendar month for the given offset", () => {
    const now = new Date(2026, 8, 7); // Sep 7, 2026
    expect(getCalendarMonthRange(0, now)).toEqual({
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });
    expect(getCalendarMonthRange(1, now)).toEqual({
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });
  });
});

describe("teamHasScheduleOverlappingRange", () => {
  it("matches active same-team schedules that overlap the month", () => {
    const schedules = [
      schedule({
        scheduleId: "sep-media",
        teamId: "team-media",
        startDate: "2026-09-01",
        endDate: "2026-09-30",
      }),
      schedule({
        scheduleId: "sep-other",
        teamId: "team-other",
        startDate: "2026-09-01",
        endDate: "2026-09-30",
      }),
      schedule({
        scheduleId: "sep-archived",
        teamId: "team-media",
        startDate: "2026-09-01",
        endDate: "2026-09-30",
        archivedAt: "2026-09-01T00:00:00.000Z",
      }),
    ];
    const range = { startDate: "2026-09-01", endDate: "2026-09-30" };
    expect(
      teamHasScheduleOverlappingRange({
        schedules,
        teamId: "team-media",
        range,
      }),
    ).toBe(true);
    expect(
      teamHasScheduleOverlappingRange({
        schedules,
        teamId: "team-other",
        range,
      }),
    ).toBe(true);
    expect(
      teamHasScheduleOverlappingRange({
        schedules,
        teamId: "team-missing",
        range,
      }),
    ).toBe(false);
  });
});

describe("getCreateScheduleDefaultRange", () => {
  const now = new Date(2026, 8, 7);

  it("uses the current month when the team has no overlapping schedule", () => {
    expect(
      getCreateScheduleDefaultRange({
        teamId: "team-media",
        schedules: [
          schedule({
            scheduleId: "aug",
            teamId: "team-media",
            startDate: "2026-08-01",
            endDate: "2026-08-31",
          }),
        ],
        now,
      }),
    ).toEqual({ startDate: "2026-09-01", endDate: "2026-09-30" });
  });

  it("uses next month when the team already has a schedule overlapping this month", () => {
    expect(
      getCreateScheduleDefaultRange({
        teamId: "team-media",
        schedules: [
          schedule({
            scheduleId: "sep",
            teamId: "team-media",
            startDate: "2026-09-01",
            endDate: "2026-09-30",
          }),
        ],
        now,
      }),
    ).toEqual({ startDate: "2026-10-01", endDate: "2026-10-31" });
  });
});

describe("getMostRecentTeamSchedule / default service ids", () => {
  const services = [
    weeklyService({ serviceId: "svc-sunday", name: "Sabbath", dayOfWeek: 6 }),
    weeklyService({
      serviceId: "svc-second",
      name: "2nd",
      dayOfWeek: 6,
      time: "11:00",
    }),
    weeklyService({
      serviceId: "svc-wed",
      name: "Power Up",
      dayOfWeek: 3,
      time: "19:00",
    }),
  ];

  it("prefers services from the most recent team schedule that still occur in range", () => {
    const schedules = [
      schedule({
        scheduleId: "older",
        teamId: "team-media",
        startDate: "2026-07-01",
        endDate: "2026-07-31",
        serviceIds: ["svc-sunday", "svc-wed"],
      }),
      schedule({
        scheduleId: "newer",
        teamId: "team-media",
        startDate: "2026-08-01",
        endDate: "2026-08-31",
        serviceIds: ["svc-sunday", "svc-second"],
      }),
    ];
    expect(
      getMostRecentTeamSchedule({
        schedules,
        teamId: "team-media",
      })?.scheduleId,
    ).toBe("newer");

    expect(
      getCreateScheduleDefaultServiceIds({
        teamId: "team-media",
        schedules,
        services,
        range: { startDate: "2026-09-01", endDate: "2026-09-30" },
      }),
    ).toEqual(["svc-sunday", "svc-second"]);
  });

  it("falls back to all in-range services when the team has no prior schedule", () => {
    expect(
      getCreateScheduleDefaultServiceIds({
        teamId: "team-media",
        schedules: [],
        services,
        range: { startDate: "2026-09-01", endDate: "2026-09-30" },
      }),
    ).toEqual(["svc-sunday", "svc-second", "svc-wed"]);
  });
});

describe("formatSuggestedScheduleName / resolveScheduleNameForSave", () => {
  it("names a clean calendar month", () => {
    expect(formatSuggestedScheduleName("2026-10-01", "2026-10-31")).toBe(
      "October 2026",
    );
  });

  it("names a non-month range with a short label", () => {
    expect(formatSuggestedScheduleName("2026-09-15", "2026-10-14")).toMatch(
      /Sep.*15.*Oct.*14.*2026/i,
    );
  });

  it("keeps a typed name and fills from dates when blank", () => {
    expect(
      resolveScheduleNameForSave({
        name: "  Special series  ",
        startDate: "2026-10-01",
        endDate: "2026-10-31",
      }),
    ).toBe("Special series");
    expect(
      resolveScheduleNameForSave({
        name: "   ",
        startDate: "2026-10-01",
        endDate: "2026-10-31",
      }),
    ).toBe("October 2026");
  });
});
