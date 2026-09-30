import type { TeamPosition, TeamService } from "../../../api/authTypes";
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

  it("keeps a grouped occurrence when any grouped service needs this team", () => {
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
    expect(grouped.serviceIds).toEqual(["media-part", "worship-part"]);
    expect(grouped.requirementsByOccurrence.get(grouped.occurrences[0].occurrenceId)).toEqual([
      { positionId: "camera", count: 1 },
    ]);
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

  it("starts today and includes the next relevant service in the upcoming window", () => {
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

    expect(result).toMatchObject({ start: "2026-09-29", end: "2026-09-30", preset: "upcoming" });
    expect(result.nextOccurrence?.serviceId).toBe("september");
  });

  it("starts today and includes the next month's relevant service", () => {
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

    expect(result).toMatchObject({ start: "2026-09-29", end: "2026-10-31", preset: "upcoming" });
    expect(result.nextOccurrence?.serviceId).toBe("october");
  });

  it("keeps an October 3 occurrence in the normal window on September 30", () => {
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

    expect(result).toMatchObject({ start: "2026-09-30", end: "2026-10-31", preset: "upcoming" });
    expect(result.period.occurrences.map((item) => item.occurrenceId)).toContain(
      "october@2026-10-03T10:00:00.000Z",
    );
  });

  it("counts today's occurrence as upcoming", () => {
    const result = findInitialTeamSchedulePeriod({
      services: [service({
        serviceId: "today",
        dateTimeISO: "2026-09-29T08:00:00.000Z",
        positionRequirements: [{ positionId: "camera", count: 1 }],
      })],
      positions,
      teamId: "media",
      now,
    });

    expect(result.preset).toBe("upcoming");
    expect(result.start).toBe("2026-09-29");
    expect(result.nextOccurrence?.serviceId).toBe("today");
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
    expect(result.start).toBe("2026-09-29");
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

    expect(result.start).toBe("2026-09-10");
    expect(result.period.occurrences.map((item) => item.serviceId)).toEqual(["upcoming-september"]);
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

    expect(result).toMatchObject({ start: "2026-09-29", preset: "upcoming", nextOccurrence: null });
    expect(result.period.occurrences).toEqual([]);
  });

  it.each([
    ["month", "2026-11-08T10:00:00.000Z", "2026-11-01", "2026-11-30"],
    ["cross-month custom", "2026-11-08T10:00:00.000Z", "2026-09-15", "2026-12-15"],
    ["quarterly", "2026-11-08T10:00:00.000Z", "2026-10-01", "2026-12-31"],
  ])("finds a team slot in a %s schedule", (_label, startsAt, startDate, endDate) => {
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
    expect(result.end).toBe("2026-11-30");
  });

  it("ignores past and other-team explicit slots while selecting the next future team slot", () => {
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
    expect(result.period.occurrences.map(({ occurrenceId }) => occurrenceId)).toEqual([futureId]);
  });

  it("keeps explicit This month selection on its full calendar range", () => {
    expect(rangeFromPreset("thisMonth", now)).toEqual({ start: "2026-09-01", end: "2026-09-30" });
  });
});
