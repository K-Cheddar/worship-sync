import type { TeamPosition, TeamSchedule, TeamService } from "../../../api/authTypes";
import { setServerTimeOffset } from "../../../utils/serverTime";
import { generateScheduleOccurrences } from "../../../utils/teamScheduleOccurrences";
import {
  formatSuggestedScheduleName,
  getCreateScheduleDefaultRange,
  getCreateScheduleDefaultServiceIds,
  getMostRecentTeamSchedule,
  resolveScheduleNameForSave,
} from "./scheduleCreateDefaults";

afterEach(() => {
  jest.useRealTimers();
  setServerTimeOffset(0);
});

const schedule = (
  overrides: Partial<TeamSchedule> &
    Pick<TeamSchedule, "scheduleId" | "teamId">,
): TeamSchedule => ({
  churchId: "church-1",
  name: overrides.name || overrides.scheduleId,
  startDate: "2026-09-01",
  endDate: "2026-09-30",
  serviceIds: ["svc-sunday"],
  occurrences: generateScheduleOccurrences({
    services: [weeklyService({ serviceId: "svc-media", name: "Media service" })],
    serviceIds: ["svc-media"],
    startDate: overrides.startDate || "2026-09-01",
    endDate: overrides.endDate || "2026-09-30",
  }),
  assignments: {},
  archivedAt: null,
  ...overrides,
});

const weeklyService = (
  overrides: Partial<TeamService> & Pick<TeamService, "serviceId" | "name">,
): TeamService => ({
  id: overrides.serviceId,
  timerType: "countdown",
  churchId: "church-1",
  reccurence: "weekly",
  dayOfWeek: 6,
  time: "10:00",
  ...overrides,
});

describe("getCreateScheduleDefaultRange", () => {
  const positions: TeamPosition[] = [
    { positionId: "camera", churchId: "church-1", teamId: "team-media", name: "Camera" },
    { positionId: "vocal", churchId: "church-1", teamId: "team-worship", name: "Vocal" },
  ];
  const mediaService = weeklyService({
    serviceId: "svc-media",
    name: "Media service",
    reccurence: "weekly",
    dayOfWeek: 6,
    positionRequirements: [{ positionId: "camera", count: 1 }],
  });
  const resolve = ({
    now = new Date(2026, 8, 29, 12),
    services = [mediaService],
    schedules = [] as TeamSchedule[],
  }: {
    now?: Date;
    services?: TeamService[];
    schedules?: TeamSchedule[];
  } = {}) => getCreateScheduleDefaultRange({
    churchId: "church-1",
    teamId: "team-media",
    services,
    positions,
    schedules,
    now,
  });

  it("uses next month when the team's next relevant service is next month", () => {
    expect(resolve()).toEqual({ startDate: "2026-10-01", endDate: "2026-10-31" });
  });

  it("uses the current Upcoming period when it has no existing schedule", () => {
    expect(resolve({ now: new Date(2026, 9, 2, 12) })).toEqual({
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });
  });

  it("uses the server-aligned month when the device and server dates differ", () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 9, 31, 23, 30));
    setServerTimeOffset(2 * 60 * 60 * 1000);

    expect(getCreateScheduleDefaultRange({
      churchId: "church-1",
      teamId: "team-media",
      services: [],
      positions,
      schedules: [],
    })).toEqual({
      startDate: "2026-11-01",
      endDate: "2026-11-30",
    });

  });

  it("advances past a fully covered Upcoming period", () => {
    expect(resolve({
      schedules: [schedule({
        scheduleId: "october",
        teamId: "team-media",
        startDate: "2026-10-01",
        endDate: "2026-10-31",
      })],
    })).toEqual({ startDate: "2026-11-01", endDate: "2026-11-30" });
  });

  it("keeps October when a newly relevant service is missing from its saved schedule", () => {
    expect(resolve({
      now: new Date(2026, 9, 2, 12),
      services: [mediaService, weeklyService({
        serviceId: "svc-extra", name: "Extra service", dayOfWeek: 3,
        positionRequirements: [{ positionId: "camera", count: 1 }],
      })],
      schedules: [schedule({ scheduleId: "october", teamId: "team-media", startDate: "2026-10-01", endDate: "2026-10-31" })],
    })).toEqual({ startDate: "2026-10-01", endDate: "2026-10-31" });
  });

  it("continues advancing while successive Upcoming periods are fully covered", () => {
    expect(resolve({
      schedules: [
        schedule({
          scheduleId: "october",
          teamId: "team-media",
          startDate: "2026-10-01",
          endDate: "2026-10-31",
        }),
        schedule({
          scheduleId: "november",
          teamId: "team-media",
          startDate: "2026-11-01",
          endDate: "2026-11-30",
        }),
      ],
    })).toEqual({ startDate: "2026-12-01", endDate: "2026-12-31" });
  });

  it("keeps the Upcoming period when a schedule only partially overlaps it", () => {
    expect(resolve({
      schedules: [schedule({
        scheduleId: "partial-october",
        teamId: "team-media",
        startDate: "2026-10-05",
        endDate: "2026-10-30",
      })],
    })).toEqual({ startDate: "2026-10-01", endDate: "2026-10-31" });
  });

  it("ignores schedules for another team", () => {
    expect(resolve({
      schedules: [schedule({
        scheduleId: "other-team-october",
        teamId: "team-worship",
        startDate: "2026-10-01",
        endDate: "2026-10-31",
      })],
    })).toEqual({ startDate: "2026-10-01", endDate: "2026-10-31" });
  });

  it("does not let services irrelevant to the team determine Upcoming", () => {
    const irrelevantEarlierService = weeklyService({
      serviceId: "svc-worship",
      name: "Worship service",
      reccurence: "weekly",
      dayOfWeek: 3,
      positionRequirements: [{ positionId: "vocal", count: 1 }],
    });
    const laterRelevantService = weeklyService({
      serviceId: "svc-media-november",
      name: "November media service",
      reccurence: "one_time",
      dateTimeISO: "2026-11-07T10:00:00.000Z",
      positionRequirements: [{ positionId: "camera", count: 1 }],
    });
    expect(resolve({ services: [irrelevantEarlierService, laterRelevantService] })).toEqual({
      startDate: "2026-11-01",
      endDate: "2026-11-30",
    });
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

  it("filters prior services against the resolved create range", () => {
    const range = {
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    };
    const schedules = [schedule({
      scheduleId: "recent",
      teamId: "team-media",
      serviceIds: ["svc-sunday", "svc-next-month"],
    })];
    const servicesWithLaterOnly = [
      ...services,
      weeklyService({
        serviceId: "svc-next-month",
        name: "November only",
        reccurence: "one_time",
        dateTimeISO: "2026-11-07T10:00:00.000Z",
      }),
    ];

    expect(getCreateScheduleDefaultServiceIds({
      teamId: "team-media",
      schedules,
      services: servicesWithLaterOnly,
      range,
    })).toEqual(["svc-sunday"]);
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
