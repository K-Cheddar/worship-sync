import type { TeamRecord, TeamSchedule } from "../../../api/authTypes";
import {
  findCrossTeamScheduleOccurrenceConflicts,
  formatCrossTeamScheduleConflictWarning,
  scheduleOccurrencesConflict,
} from "./scheduleConflicts";

const teams: TeamRecord[] = [
  {
    teamId: "worship",
    churchId: "church",
    name: "Worship",
    memberIds: ["member-a"],
  },
  {
    teamId: "production",
    churchId: "church",
    name: "Production",
    memberIds: ["member-a"],
  },
];

const schedule = (overrides: Partial<TeamSchedule> = {}): TeamSchedule => ({
  scheduleId: "schedule-a",
  churchId: "church",
  name: "Worship Schedule",
  teamId: "worship",
  startDate: "2026-07-01",
  endDate: "2026-07-31",
  serviceIds: ["svc-a"],
  occurrences: [
    {
      occurrenceId: "svc-a@2026-07-05T10:00:00.000Z",
      serviceId: "svc-a",
      serviceIds: ["svc-a"],
      name: "Morning",
      startsAt: "2026-07-05T10:00:00.000Z",
    },
  ],
  assignments: {},
  ...overrides,
});

describe("scheduleOccurrencesConflict", () => {
  it("matches combined service occurrences by shared service id and start time", () => {
    expect(
      scheduleOccurrencesConflict(
        {
          occurrenceId: "group-a@2026-07-05T10:00:00.000Z",
          serviceId: "svc-a",
          serviceIds: ["svc-a", "svc-b"],
          name: "Combined",
          startsAt: "2026-07-05T10:00:00.000Z",
        },
        {
          occurrenceId: "svc-b@2026-07-05T10:00:00.000Z",
          serviceId: "svc-b",
          serviceIds: ["svc-b"],
          name: "Second",
          startsAt: "2026-07-05T10:00:00.000Z",
        },
      ),
    ).toBe(true);
  });

  it("matches a joined occurrence with a standalone member at another time that day", () => {
    const joined = {
      occurrenceId: "group:weekend@2026-10-03",
      serviceId: "service-a",
      serviceIds: ["service-a", "service-b"],
      name: "Combined",
      startsAt: "2026-10-03T10:00:00.000Z",
    };
    const standalone = {
      occurrenceId: "service-b@2026-10-03T11:00:00.000Z",
      serviceId: "service-b",
      serviceIds: ["service-b"],
      name: "Second",
      startsAt: "2026-10-03T11:00:00.000Z",
    };

    expect(scheduleOccurrencesConflict(joined, standalone)).toBe(true);
    expect(scheduleOccurrencesConflict(standalone, joined)).toBe(true);
  });

  it("does not match joined and standalone occurrences on different dates", () => {
    expect(
      scheduleOccurrencesConflict(
        {
          occurrenceId: "group:weekend@2026-10-03",
          serviceId: "service-a",
          serviceIds: ["service-a", "service-b"],
          name: "Combined",
          startsAt: "2026-10-03T10:00:00.000Z",
        },
        {
          occurrenceId: "service-b@2026-10-10T11:00:00.000Z",
          serviceId: "service-b",
          serviceIds: ["service-b"],
          name: "Second",
          startsAt: "2026-10-10T11:00:00.000Z",
        },
      ),
    ).toBe(false);
  });

  it("does not match unrelated services on the same date", () => {
    expect(
      scheduleOccurrencesConflict(
        {
          occurrenceId: "group:weekend@2026-10-03",
          serviceId: "service-a",
          serviceIds: ["service-a", "service-b"],
          name: "Combined",
          startsAt: "2026-10-03T10:00:00.000Z",
        },
        {
          occurrenceId: "service-c@2026-10-03T11:00:00.000Z",
          serviceId: "service-c",
          serviceIds: ["service-c"],
          name: "Third",
          startsAt: "2026-10-03T11:00:00.000Z",
        },
      ),
    ).toBe(false);
  });

  it("continues to match a shared standalone service at the exact start time", () => {
    expect(
      scheduleOccurrencesConflict(
        {
          occurrenceId: "service-a@2026-10-03T10:00:00.000Z",
          serviceId: "service-a",
          name: "Morning",
          startsAt: "2026-10-03T10:00:00.000Z",
        },
        {
          occurrenceId: "legacy-service-a-occurrence",
          serviceId: "service-a",
          name: "Morning",
          startsAt: "2026-10-03T10:00:00.000Z",
        },
      ),
    ).toBe(true);
  });

  it("does not match the same service on a different date", () => {
    expect(
      scheduleOccurrencesConflict(
        {
          occurrenceId: "svc-a@2026-07-05T10:00:00.000Z",
          serviceId: "svc-a",
          name: "Morning",
          startsAt: "2026-07-05T10:00:00.000Z",
        },
        {
          occurrenceId: "svc-a@2026-07-12T10:00:00.000Z",
          serviceId: "svc-a",
          name: "Morning",
          startsAt: "2026-07-12T10:00:00.000Z",
        },
      ),
    ).toBe(false);
  });

  it("keeps standalone occurrences at different times on one date distinct", () => {
    expect(
      scheduleOccurrencesConflict(
        {
          occurrenceId: "svc-a@2026-07-05T10:00:00.000Z",
          serviceId: "svc-a",
          name: "Morning",
          startsAt: "2026-07-05T10:00:00.000Z",
        },
        {
          occurrenceId: "svc-a@2026-07-05T11:00:00.000Z",
          serviceId: "svc-a",
          name: "Morning",
          startsAt: "2026-07-05T11:00:00.000Z",
        },
      ),
    ).toBe(false);
  });

  it("matches legacy occurrences without startsAt only when schedule ranges overlap", () => {
    expect(
      scheduleOccurrencesConflict(
        {
          occurrenceId: "svc-a",
          serviceId: "svc-a",
          name: "",
          startsAt: "",
        },
        {
          occurrenceId: "svc-a",
          serviceId: "svc-a",
          name: "",
          startsAt: "",
        },
        { schedulesOverlap: true },
      ),
    ).toBe(true);
    expect(
      scheduleOccurrencesConflict(
        {
          occurrenceId: "svc-a",
          serviceId: "svc-a",
          name: "",
          startsAt: "",
        },
        {
          occurrenceId: "svc-a",
          serviceId: "svc-a",
          name: "",
          startsAt: "",
        },
        { schedulesOverlap: false },
      ),
    ).toBe(false);
  });
});

describe("findCrossTeamScheduleOccurrenceConflicts", () => {
  it("finds a standalone joined member so the cross-team warning can display", () => {
    const current = schedule({
      occurrences: [
        {
          occurrenceId: "group:weekend@2026-10-03",
          serviceId: "svc-a",
          serviceIds: ["svc-a", "svc-b"],
          name: "Combined",
          startsAt: "2026-10-03T10:00:00.000Z",
        },
      ],
    });
    const other = schedule({
      scheduleId: "schedule-b",
      name: "Production Schedule",
      teamId: "production",
      occurrences: [
        {
          occurrenceId: "svc-b@2026-10-03T11:00:00.000Z",
          serviceId: "svc-b",
          serviceIds: ["svc-b"],
          name: "Second",
          startsAt: "2026-10-03T11:00:00.000Z",
        },
      ],
      assignments: {
        "svc-b@2026-10-03T11:00:00.000Z": {
          "camera::0": { primaryMemberId: "member-a" },
        },
      },
    });

    const conflicts = findCrossTeamScheduleOccurrenceConflicts({
      schedule: current,
      occurrenceId: "group:weekend@2026-10-03",
      memberId: "member-a",
      schedules: [current, other],
      teams,
    });

    expect(conflicts).toEqual([
      expect.objectContaining({ scheduleId: "schedule-b", teamName: "Production" }),
    ]);
    expect(formatCrossTeamScheduleConflictWarning(conflicts)).toBe(
      "Also scheduled on Production",
    );
  });

  it("finds another active team schedule for the same service occurrence", () => {
    const current = schedule();
    const other = schedule({
      scheduleId: "schedule-b",
      name: "Production Schedule",
      teamId: "production",
      assignments: {
        "svc-a@2026-07-05T10:00:00.000Z": {
          "camera::0": { primaryMemberId: "member-a" },
        },
      },
    });

    const conflicts = findCrossTeamScheduleOccurrenceConflicts({
      schedule: current,
      occurrenceId: "svc-a@2026-07-05T10:00:00.000Z",
      memberId: "member-a",
      schedules: [current, other],
      teams,
    });

    expect(conflicts).toEqual([
      expect.objectContaining({
        scheduleId: "schedule-b",
        teamName: "Production",
      }),
    ]);
    expect(formatCrossTeamScheduleConflictWarning(conflicts)).toBe(
      "Also scheduled on Production",
    );
  });

  it("reports same-team schedules while ignoring archived and nonmatching occurrences", () => {
    const current = schedule({
      assignments: {
        "svc-a@2026-07-05T10:00:00.000Z": {
          "vocal::0": { primaryMemberId: "member-a" },
        },
      },
    });
    const sameTeam = schedule({
      scheduleId: "same-team",
      assignments: {
        "svc-a@2026-07-05T10:00:00.000Z": {
          "vocal::0": { primaryMemberId: "member-a" },
        },
      },
    });
    const archived = schedule({
      scheduleId: "archived",
      teamId: "production",
      archivedAt: "2026-07-01T00:00:00.000Z",
      assignments: {
        "svc-a@2026-07-05T10:00:00.000Z": {
          "camera::0": { primaryMemberId: "member-a" },
        },
      },
    });
    const differentDate = schedule({
      scheduleId: "different-date",
      teamId: "production",
      occurrences: [
        {
          occurrenceId: "svc-a@2026-07-12T10:00:00.000Z",
          serviceId: "svc-a",
          name: "Morning",
          startsAt: "2026-07-12T10:00:00.000Z",
        },
      ],
      assignments: {
        "svc-a@2026-07-12T10:00:00.000Z": {
          "camera::0": { primaryMemberId: "member-a" },
        },
      },
    });

    expect(
      findCrossTeamScheduleOccurrenceConflicts({
        schedule: current,
        occurrenceId: "svc-a@2026-07-05T10:00:00.000Z",
        memberId: "member-a",
        schedules: [current, sameTeam, archived, differentDate],
        teams,
      }),
    ).toEqual([
      expect.objectContaining({
        scheduleId: "same-team",
        kind: "other-schedule",
        positionId: "vocal",
      }),
    ]);
  });

  it("reports another position in the current schedule when the target cell is provided", () => {
    const current = schedule({
      assignments: {
        "svc-a@2026-07-05T10:00:00.000Z": {
          "vocal::0": { primaryMemberId: "member-a" },
          "keys::0": { primaryMemberId: "member-a" },
        },
      },
    });

    const conflicts = findCrossTeamScheduleOccurrenceConflicts({
      schedule: current,
      occurrenceId: "svc-a@2026-07-05T10:00:00.000Z",
      memberId: "member-a",
      cellKey: "vocal::0",
      schedules: [current],
      teams,
    });

    expect(conflicts).toEqual([
      expect.objectContaining({
        kind: "other-position",
        positionId: "keys",
      }),
    ]);
  });
});
