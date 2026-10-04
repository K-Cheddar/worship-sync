import type { TeamPosition, TeamScheduleOccurrence, TeamService } from "../../../api/authTypes";
import {
  buildTeamSchedulePeriod,
  findInitialTeamSchedulePeriod,
} from "./teamSchedulePeriod";
import { rangeFromPreset } from "./schedulePeriodUtils";

const service = (changes: Partial<TeamService>): TeamService => ({
  id: changes.serviceId || "service",
  serviceId: changes.serviceId || "service",
  churchId: "church-1",
  name: "Service",
  timerType: "countdown",
  reccurence: "one_time",
  dateTimeISO: "2026-10-03T10:00:00.000Z",
  ...changes,
});

const positions: TeamPosition[] = [
  { positionId: "camera", churchId: "church-1", teamId: "media", name: "Camera" },
  { positionId: "director", churchId: "church-1", teamId: "media", name: "Director" },
  { positionId: "vocal", churchId: "church-1", teamId: "worship", name: "Vocal" },
];

const range = { startDate: "2026-09-01", endDate: "2026-10-31" };

describe("buildTeamSchedulePeriod", () => {
  it("returns requirements, service IDs, and occurrences from one team-filtered set", () => {
    const services = [
      service({ serviceId: "media-service", positionRequirements: [{ positionId: "camera", count: 1 }] }),
      service({ serviceId: "worship-service", positionRequirements: [{ positionId: "vocal", count: 1 }] }),
      service({ serviceId: "unassigned-service" }),
    ];
    const media = buildTeamSchedulePeriod({ services, positions, teamId: "media", ...range });
    const worship = buildTeamSchedulePeriod({ services, positions, teamId: "worship", ...range });

    expect(media.serviceIds).toEqual(["media-service"]);
    expect(media.occurrences).toHaveLength(1);
    expect(media.requirementsByOccurrence.get(media.occurrences[0].occurrenceId)).toEqual([
      { positionId: "camera", count: 1 },
    ]);
    expect(worship.serviceIds).toEqual(["worship-service"]);
    expect(worship.occurrences).toHaveLength(1);
  });

  it("filters unrelated group services before grouping team occurrences", () => {
    const grouped = buildTeamSchedulePeriod({
      services: [
        service({
          serviceId: "media-part",
          serviceGroupId: "combined",
          positionRequirements: [{ positionId: "camera", count: 1 }],
        }),
        service({
          serviceId: "worship-part",
          serviceGroupId: "combined",
          positionRequirements: [{ positionId: "vocal", count: 1 }],
        }),
      ],
      positions,
      teamId: "media",
      startDate: "2026-10-03",
      endDate: "2026-10-03",
    });

    expect(grouped.occurrences).toHaveLength(1);
    expect(grouped.occurrences[0]).toMatchObject({
      occurrenceId: "media-part@2026-10-03T10:00:00.000Z",
      serviceId: "media-part",
    });
    expect(grouped.serviceIds).toEqual(["media-part"]);
    expect(grouped.requirementsByOccurrence.get(grouped.occurrences[0].occurrenceId)).toEqual([
      { positionId: "camera", count: 1 },
    ]);
  });

  it("does not pull an unrelated same-date group member into the team occurrence", () => {
    const generated = buildTeamSchedulePeriod({
      services: [
        service({
          serviceId: "sabbath-school",
          name: "Sabbath School",
          serviceGroupId: "sabbath-morning",
          reccurence: "weekly",
          dayOfWeek: 6,
          time: "10:00",
        }),
        service({
          serviceId: "worship-experience",
          name: "Worship Experience",
          serviceGroupId: "sabbath-morning",
          reccurence: "weekly",
          dayOfWeek: 6,
          time: "11:00",
          positionRequirements: [{ positionId: "vocal", count: 1 }],
        }),
      ],
      positions,
      teamId: "worship",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });

    expect(generated.serviceIds).toEqual(["worship-experience"]);
    expect(generated.occurrences).toHaveLength(5);
    expect(generated.occurrences.every((occurrence) => occurrence.serviceId === "worship-experience")).toBe(true);
    expect(generated.occurrences.every((occurrence) => occurrence.name === "Worship Experience")).toBe(true);
    expect(generated.occurrences.every((occurrence) => new Date(occurrence.startsAt).getHours() === 11)).toBe(true);
    expect(generated.requirementsByOccurrence.get(generated.occurrences[0].occurrenceId)).toEqual([
      { positionId: "vocal", count: 1 },
    ]);
  });

  it("includes newly staffed services when generating a new Media period", () => {
    const generated = buildTeamSchedulePeriod({
      services: [
        service({
          serviceId: "sabbath-service",
          reccurence: "weekly",
          dayOfWeek: 6,
          time: "10:00",
          positionRequirements: [{ positionId: "camera", count: 1 }],
        }),
        service({
          serviceId: "media-special-a",
          dateTimeISO: "2026-10-04T10:00:00.000Z",
          positionRequirements: [{ positionId: "camera", count: 1 }],
        }),
        service({
          serviceId: "media-special-b",
          dateTimeISO: "2026-10-18T10:00:00.000Z",
          positionRequirements: [{ positionId: "camera", count: 1 }],
        }),
      ],
      positions,
      teamId: "media",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });

    expect(generated.occurrences).toHaveLength(7);
    expect(generated.serviceIds).toEqual(["sabbath-service", "media-special-a", "media-special-b"]);
  });

  it("keeps an occurrence with an explicitly added team slot even without requirements", () => {
    const generated = buildTeamSchedulePeriod({
      services: [service({ serviceId: "legacy" })],
      positions,
      teamId: "media",
      startDate: "2026-10-03",
      endDate: "2026-10-03",
      additionalPositionSlots: { "legacy@2026-10-03T10:00:00.000Z": ["camera::0"] },
    });

    expect(generated.occurrences).toHaveLength(1);
    expect(generated.requirementsByOccurrence.get(generated.occurrences[0].occurrenceId)).toEqual([]);
  });

  it("does not treat an occurrence override for another team as this team's need", () => {
    const generated = buildTeamSchedulePeriod({
      services: [service({
        serviceId: "override",
        positionRequirements: [{ positionId: "camera", count: 1 }],
      })],
      positions,
      teamId: "worship",
      startDate: "2026-10-03",
      endDate: "2026-10-03",
    });

    expect(generated.occurrences).toEqual([]);
    expect(generated.serviceIds).toEqual([]);
  });
});

describe("findInitialTeamSchedulePeriod", () => {
  const now = new Date("2026-09-29T12:00:00.000Z");

  it("uses the full month containing the next relevant service", () => {
    const result = findInitialTeamSchedulePeriod({
      services: [service({
        serviceId: "september",
        dateTimeISO: "2026-09-30T10:00:00.000Z",
        positionRequirements: [{ positionId: "camera", count: 1 }],
      })],
      positions,
      teamId: "media",
      now,
    });

    expect(result).toMatchObject({ start: "2026-09-01", end: "2026-09-30", preset: "upcoming" });
    expect(result.nextOccurrence?.serviceId).toBe("september");
  });

  it("uses the month of the next relevant service", () => {
    const result = findInitialTeamSchedulePeriod({
      services: [
        service({
          serviceId: "past",
          dateTimeISO: "2026-09-27T10:00:00.000Z",
          positionRequirements: [{ positionId: "camera", count: 1 }],
        }),
        service({
          serviceId: "october",
          dateTimeISO: "2026-10-03T10:00:00.000Z",
          positionRequirements: [{ positionId: "camera", count: 1 }],
        }),
      ],
      positions,
      teamId: "media",
      now,
    });

    expect(result).toMatchObject({ start: "2026-10-01", end: "2026-10-31", preset: "upcoming" });
    expect(result.nextOccurrence?.serviceId).toBe("october");
  });

  it("uses the occurrence calendar month in the requested timezone when UTC is in the next month", () => {
    const startsAt = "2026-10-01T05:00:00.000Z";
    const result = findInitialTeamSchedulePeriod({
      services: [service({
        serviceId: "late-september",
        dateTimeISO: "2026-09-30T22:00:00-07:00",
        positionRequirements: [{ positionId: "camera", count: 1 }],
      })],
      positions,
      teamId: "media",
      now: new Date("2026-10-01T02:00:00.000Z"),
      timeZone: "America/Los_Angeles",
    });

    expect(result).toMatchObject({ start: "2026-09-01", end: "2026-09-30" });
    expect(result.nextOccurrence).toMatchObject({
      occurrenceId: `late-september@${startsAt}`,
      startsAt,
    });
    expect(result.period.occurrences.map((occurrence) => occurrence.occurrenceId)).toContain(
      `late-september@${startsAt}`,
    );
  });

  it("uses the occurrence calendar month when UTC is in the prior month", () => {
    const startsAt = "2026-09-30T15:30:00.000Z";
    const result = findInitialTeamSchedulePeriod({
      services: [service({
        serviceId: "october-service",
        dateTimeISO: "2026-10-01T00:30:00+09:00",
        positionRequirements: [{ positionId: "camera", count: 1 }],
      })],
      positions,
      teamId: "media",
      now: new Date("2026-09-30T10:00:00.000Z"),
      timeZone: "Asia/Tokyo",
    });

    expect(result).toMatchObject({ start: "2026-10-01", end: "2026-10-31" });
    expect(result.nextOccurrence).toMatchObject({
      occurrenceId: `october-service@${startsAt}`,
      startsAt,
    });
    expect(result.period.occurrences.map((occurrence) => occurrence.occurrenceId)).toContain(
      `october-service@${startsAt}`,
    );
  });

  it("orders saved occurrences by their parsed timestamps across offset formats", () => {
    const earlier = {
      occurrenceId: "earlier-offset@2026-10-01T01:00:00.000Z",
      serviceId: "earlier-offset",
      name: "Earlier",
      startsAt: "2026-10-01T01:00:00.000Z",
      positionRequirements: [{ positionId: "camera", count: 1 }],
    } satisfies TeamScheduleOccurrence;
    const later = {
      occurrenceId: "later-offset@2026-10-01T00:00:00-07:00",
      serviceId: "later-offset",
      name: "Later",
      startsAt: "2026-10-01T00:00:00-07:00",
      positionRequirements: [{ positionId: "camera", count: 1 }],
    } satisfies TeamScheduleOccurrence;
    const result = findInitialTeamSchedulePeriod({
      services: [],
      positions,
      teamId: "media",
      schedules: [{
        scheduleId: "saved-offsets",
        churchId: "church-1",
        name: "Saved services",
        teamId: "media",
        startDate: "2026-10-01",
        endDate: "2026-10-31",
        serviceIds: [],
        occurrences: [later, earlier],
        assignments: {},
        source: "custom",
      }],
      now: new Date("2026-09-30T00:00:00.000Z"),
      timeZone: "UTC",
    });

    expect(result.nextOccurrence?.occurrenceId).toBe(earlier.occurrenceId);
  });

  it("moves to December after the last relevant November occurrence", () => {
    const result = findInitialTeamSchedulePeriod({
      services: [
        service({
          serviceId: "last-november",
          dateTimeISO: "2026-11-28T10:00:00.000Z",
          positionRequirements: [{ positionId: "camera", count: 1 }],
        }),
        service({
          serviceId: "next-december",
          dateTimeISO: "2026-12-05T10:00:00.000Z",
          positionRequirements: [{ positionId: "camera", count: 1 }],
        }),
      ],
      positions,
      teamId: "media",
      now: new Date("2026-11-29T12:00:00.000Z"),
    });

    expect(result).toMatchObject({
      start: "2026-12-01",
      end: "2026-12-31",
      nextOccurrence: { serviceId: "next-december" },
    });
  });

  it("keeps October as Upcoming mid-month when the next team service is October 17", () => {
    const savedOccurrence: TeamScheduleOccurrence = {
      occurrenceId: "october-service@2026-10-17T10:00:00.000Z",
      serviceId: "october-service",
      name: "October service",
      startsAt: "2026-10-17T10:00:00.000Z",
      positionRequirements: [{ positionId: "camera", count: 1 }],
    };
    const result = findInitialTeamSchedulePeriod({
      services: [service({
        serviceId: "october-service",
        dateTimeISO: savedOccurrence.startsAt,
        positionRequirements: [{ positionId: "camera", count: 1 }],
      })],
      positions,
      teamId: "media",
      schedules: [{
        scheduleId: "custom-october",
        churchId: "church-1",
        name: "October",
        teamId: "media",
        startDate: "2026-10-01",
        endDate: "2026-10-31",
        serviceIds: ["october-service"],
        occurrences: [savedOccurrence],
        assignments: { [savedOccurrence.occurrenceId]: { "camera::0": { primaryMemberId: "member-1" } } },
        source: "custom",
      }],
      now: new Date("2026-10-15T12:00:00.000Z"),
    });

    expect(result).toMatchObject({ start: "2026-10-01", end: "2026-10-31" });
    expect(result.nextOccurrence).toMatchObject({
      occurrenceId: savedOccurrence.occurrenceId,
      startsAt: savedOccurrence.startsAt,
    });
  });

  it("uses a saved team-staffed occurrence even when current setup differs", () => {
    const savedOccurrence: TeamScheduleOccurrence = {
      occurrenceId: "legacy-service@2026-12-05T10:00:00.000Z",
      serviceId: "legacy-service",
      name: "Saved December service",
      startsAt: "2026-12-05T10:00:00.000Z",
      positionRequirements: [{ positionId: "camera", count: 1 }],
    };
    const result = findInitialTeamSchedulePeriod({
      services: [service({
        serviceId: "new-setup-service",
        dateTimeISO: "2027-01-09T10:00:00.000Z",
        positionRequirements: [{ positionId: "camera", count: 1 }],
      })],
      positions,
      teamId: "media",
      schedules: [{
        scheduleId: "custom-december",
        churchId: "church-1",
        name: "Saved December",
        teamId: "media",
        startDate: "2026-12-01",
        endDate: "2026-12-31",
        serviceIds: ["legacy-service"],
        occurrences: [savedOccurrence],
        assignments: { [savedOccurrence.occurrenceId]: { "camera::0": { primaryMemberId: "member-1" } } },
        source: "custom",
      }],
      now: new Date("2026-11-29T12:00:00.000Z"),
    });

    expect(result.start).toBe("2026-12-01");
    expect(result.nextOccurrence).toEqual(savedOccurrence);
    expect(result.period.occurrences).toEqual([]);
  });

  it("opens October when the next relevant service is October 3", () => {
    const result = findInitialTeamSchedulePeriod({
      services: [service({
        serviceId: "october",
        dateTimeISO: "2026-10-03T10:00:00.000Z",
        positionRequirements: [{ positionId: "camera", count: 1 }],
      })],
      positions,
      teamId: "media",
      now: new Date("2026-09-30T12:00:00.000Z"),
    });

    expect(result).toMatchObject({ start: "2026-10-01", end: "2026-10-31", preset: "upcoming" });
    expect(result.period.occurrences.map((item) => item.occurrenceId)).toContain(
      "october@2026-10-03T10:00:00.000Z",
    );
  });

  it("includes a generated occurrence today only while its actual start time is future", () => {
    const result = findInitialTeamSchedulePeriod({
      services: [
        service({
          serviceId: "already-started",
          dateTimeISO: "2026-09-29T08:00:00.000Z",
          positionRequirements: [{ positionId: "camera", count: 1 }],
        }),
        service({
          serviceId: "later-today",
          dateTimeISO: "2026-09-29T13:00:00.000Z",
          positionRequirements: [{ positionId: "camera", count: 1 }],
        }),
      ],
      positions,
      teamId: "media",
      now: new Date("2026-09-29T12:00:00.000Z"),
    });

    expect(result.preset).toBe("upcoming");
    expect(result.start).toBe("2026-09-01");
    expect(result.nextOccurrence?.serviceId).toBe("later-today");
  });

  it("moves to the next month's relevant occurrence after the final service today", () => {
    const services = [
      service({
        serviceId: "final-today",
        dateTimeISO: "2026-10-31T11:00:00.000Z",
        positionRequirements: [{ positionId: "camera", count: 1 }],
      }),
      service({
        serviceId: "next-month",
        dateTimeISO: "2026-11-07T11:00:00.000Z",
        positionRequirements: [{ positionId: "camera", count: 1 }],
      }),
    ];
    const before = findInitialTeamSchedulePeriod({
      services,
      positions,
      teamId: "media",
      now: new Date("2026-10-31T10:59:59.000Z"),
    });
    const after = findInitialTeamSchedulePeriod({
      services,
      positions,
      teamId: "media",
      now: new Date("2026-10-31T11:00:01.000Z"),
    });

    expect(before.nextOccurrence?.serviceId).toBe("final-today");
    expect(before.start).toBe("2026-10-01");
    expect(after.nextOccurrence?.serviceId).toBe("next-month");
    expect(after.start).toBe("2026-11-01");
  });

  it("uses actual start timestamps for persisted team-slot occurrences too", () => {
    const occurrenceId = "saved@2026-10-31T11:00:00.000Z";
    const result = findInitialTeamSchedulePeriod({
      services: [],
      positions,
      teamId: "media",
      schedules: [{
        scheduleId: "saved-quarter",
        churchId: "church-1",
        teamId: "media",
        name: "Saved schedule",
        startDate: "2026-10-01",
        endDate: "2026-12-31",
        serviceIds: ["saved"],
        occurrences: [{ occurrenceId, serviceId: "saved", name: "Saved", startsAt: "2026-10-31T11:00:00.000Z" }],
        assignments: {},
        additionalPositionSlots: { [occurrenceId]: ["camera::0"] },
      }],
      now: new Date("2026-10-31T11:00:01.000Z"),
    });

    expect(result.nextOccurrence).toBeNull();
    expect(result.start).toBe("2026-10-01");
  });

  it("ignores occurrences that do not require a position on this team", () => {
    const result = findInitialTeamSchedulePeriod({
      services: [service({
        serviceId: "media-only",
        dateTimeISO: "2026-09-29T08:00:00.000Z",
        positionRequirements: [{ positionId: "camera", count: 1 }],
      })],
      positions,
      teamId: "worship",
      now,
    });

    expect(result.nextOccurrence).toBeNull();
    expect(result.start).toBe("2026-09-01");
    expect(result.period.occurrences).toEqual([]);
  });

  it("omits earlier services from today's window while keeping the next relevant service", () => {
    const result = findInitialTeamSchedulePeriod({
      services: [
        service({
          serviceId: "past-september",
          dateTimeISO: "2026-09-06T10:00:00.000Z",
          positionRequirements: [{ positionId: "camera", count: 1 }],
        }),
        service({
          serviceId: "upcoming-september",
          dateTimeISO: "2026-09-20T10:00:00.000Z",
          positionRequirements: [{ positionId: "camera", count: 1 }],
        }),
      ],
      positions,
      teamId: "media",
      now: new Date("2026-09-10T12:00:00.000Z"),
    });

    expect(result.start).toBe("2026-09-01");
    expect(result.period.occurrences.map((item) => item.serviceId)).toEqual(["past-september", "upcoming-september"]);
    expect(result.nextOccurrence?.serviceId).toBe("upcoming-september");
  });

  it("does not let another team's unrelated services move the empty upcoming window", () => {
    const result = findInitialTeamSchedulePeriod({
      services: [service({
        serviceId: "worship-only",
        dateTimeISO: "2026-10-03T10:00:00.000Z",
        positionRequirements: [{ positionId: "keys", count: 1 }],
      })],
      positions,
      teamId: "media",
      now,
    });

    expect(result).toMatchObject({ start: "2026-09-01", end: "2026-09-30", preset: "upcoming", nextOccurrence: null });
    expect(result.period.occurrences).toEqual([]);
  });

  it.each([
    ["month", "2026-10-08T10:00:00.000Z", "2026-10-01", "2026-10-31"],
    ["cross-month custom", "2026-10-15T10:00:00.000Z", "2026-09-15", "2026-12-15"],
    ["quarterly", "2026-10-20T10:00:00.000Z", "2026-10-01", "2026-12-31"],
  ])("finds a team slot in a %s schedule inside Upcoming", (_label, startsAt, startDate, endDate) => {
    const occurrenceId = `manual@${startsAt}`;
    const result = findInitialTeamSchedulePeriod({
      services: [service({ serviceId: "manual", dateTimeISO: startsAt })],
      positions,
      teamId: "media",
      schedules: [{
        scheduleId: "custom-period",
        churchId: "church-1",
        teamId: "media",
        name: "Custom period",
        serviceIds: ["manual"],
        startDate,
        endDate,
        occurrences: [{ occurrenceId, serviceId: "manual", name: "Service", startsAt }],
        assignments: {},
        additionalPositionSlots: { [occurrenceId]: ["camera::0"] },
      }],
      now,
    });

    expect(result.nextOccurrence?.occurrenceId).toBe(occurrenceId);
    expect(result.end).toBe("2026-10-31");
  });

  it("ignores past and other-team slots but honors a future team slot", () => {
    const pastId = "past@2026-09-20T10:00:00.000Z";
    const futureId = "future@2026-11-08T10:00:00.000Z";
    const schedule = (scheduleId: string, teamId: string, occurrenceId: string, startsAt: string) => ({
      scheduleId,
      churchId: "church-1",
      teamId,
      name: scheduleId,
      serviceIds: [occurrenceId.split("@")[0]],
      startDate: "2026-09-01",
      endDate: "2026-12-31",
      occurrences: [{ occurrenceId, serviceId: occurrenceId.split("@")[0], name: "Service", startsAt }],
      assignments: {},
      additionalPositionSlots: { [occurrenceId]: [teamId === "media" ? "camera::0" : "vocal::0"] },
    });
    const result = findInitialTeamSchedulePeriod({
      services: [
        service({ serviceId: "past", dateTimeISO: "2026-09-20T10:00:00.000Z" }),
        service({ serviceId: "future", dateTimeISO: "2026-11-08T10:00:00.000Z" }),
      ],
      positions,
      teamId: "media",
      schedules: [
        schedule("past-schedule", "media", pastId, "2026-09-20T10:00:00.000Z"),
        schedule("future-schedule", "media", futureId, "2026-11-08T10:00:00.000Z"),
        schedule("worship-schedule", "worship", "unrelated@2026-10-04T10:00:00.000Z", "2026-10-04T10:00:00.000Z"),
      ],
      now,
    });

    expect(result.nextOccurrence?.occurrenceId).toBe(futureId);
    expect(result.start).toBe("2026-11-01");
    expect(result.end).toBe("2026-11-30");
  });

  it("keeps explicit This month selection on its full calendar range", () => {
    expect(rangeFromPreset("thisMonth", now)).toEqual({ start: "2026-09-01", end: "2026-09-30" });
  });
});
