import type { TeamPosition, TeamService } from "../../../api/authTypes";
import {
  buildTeamSchedulePeriod,
  findInitialTeamSchedulePeriod,
} from "./teamSchedulePeriod";

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

  it("chooses the current month when a relevant upcoming occurrence remains", () => {
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

    expect(result).toMatchObject({ start: "2026-09-01", end: "2026-09-30", preset: "thisMonth" });
    expect(result.nextOccurrence?.serviceId).toBe("september");
  });

  it("chooses next month when the relevant service is the first upcoming occurrence", () => {
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

    expect(result).toMatchObject({ start: "2026-10-01", end: "2026-10-31", preset: "nextMonth" });
    expect(result.nextOccurrence?.serviceId).toBe("october");
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

    expect(result.preset).toBe("thisMonth");
    expect(result.start).toBe("2026-09-01");
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
  });
});
