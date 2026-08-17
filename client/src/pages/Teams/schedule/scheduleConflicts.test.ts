import type { TeamRecord, TeamSchedule } from "../../../api/authTypes";
import {
  findCrossTeamScheduleOccurrenceConflicts,
  formatCrossTeamScheduleConflictWarning,
  scheduleDateRangesOverlap,
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

describe("scheduleDateRangesOverlap", () => {
  it("treats missing bounds as overlapping and compares inclusive ranges", () => {
    expect(scheduleDateRangesOverlap(null, { startDate: "2026-07-01" })).toBe(
      true,
    );
    expect(
      scheduleDateRangesOverlap(
        { startDate: "2026-07-01", endDate: "2026-07-31" },
        { startDate: "2026-07-15", endDate: "2026-07-20" },
      ),
    ).toBe(true);
    expect(
      scheduleDateRangesOverlap(
        { startDate: "2026-07-01", endDate: "2026-07-10" },
        { startDate: "2026-08-01", endDate: "2026-08-31" },
      ),
    ).toBe(false);
  });
});

describe("scheduleOccurrencesConflict", () => {
  it("returns false when either occurrence is missing", () => {
    expect(scheduleOccurrencesConflict(undefined, undefined)).toBe(false);
  });

  it("matches identical occurrence ids when both have startsAt", () => {
    expect(
      scheduleOccurrencesConflict(
        {
          occurrenceId: "same",
          serviceId: "svc-a",
          name: "",
          startsAt: "2026-07-05T10:00:00.000Z",
        },
        {
          occurrenceId: "same",
          serviceId: "svc-b",
          name: "",
          startsAt: "2026-07-05T10:00:00.000Z",
        },
      ),
    ).toBe(true);
  });
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

  it("ignores the current schedule, same-team schedules, archived schedules, and nonmatching occurrences", () => {
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
    ).toEqual([]);
  });

  it("returns empty for missing schedule/member and formats multi-team warnings", () => {
    expect(
      findCrossTeamScheduleOccurrenceConflicts({
        schedule: null,
        occurrenceId: "x",
        memberId: "member-a",
        schedules: [],
        teams,
      }),
    ).toEqual([]);
    expect(
      findCrossTeamScheduleOccurrenceConflicts({
        schedule: schedule(),
        occurrenceId: "missing",
        memberId: "member-a",
        schedules: [],
        teams,
      }),
    ).toEqual([]);
    expect(formatCrossTeamScheduleConflictWarning([])).toBe("");
    expect(
      formatCrossTeamScheduleConflictWarning([
        {
          memberId: "m1",
          scheduleId: "s1",
          scheduleName: "A",
          teamId: "t1",
          teamName: "Worship",
          occurrenceId: "o1",
        },
        {
          memberId: "m1",
          scheduleId: "s2",
          scheduleName: "B",
          teamId: "t2",
          teamName: "Production",
          occurrenceId: "o2",
        },
        {
          memberId: "m1",
          scheduleId: "s3",
          scheduleName: "C",
          teamId: "t3",
          teamName: "Kids",
          occurrenceId: "o3",
        },
      ]),
    ).toBe("Also scheduled on Worship, Production +1 more");
  });

  it("uses serviceIds fallbacks when a schedule has no occurrences list", () => {
    const current = schedule({
      occurrences: undefined as never,
      serviceIds: ["svc-a"],
    });
    const other = schedule({
      scheduleId: "schedule-b",
      teamId: "production",
      name: "",
      occurrences: undefined as never,
      serviceIds: ["svc-a"],
      assignments: {
        "svc-a": { "camera::0": { primaryMemberId: "member-a" } },
      },
    });
    const conflicts = findCrossTeamScheduleOccurrenceConflicts({
      schedule: current,
      occurrenceId: "svc-a",
      memberId: "member-a",
      schedules: [other],
      teams: [{ ...teams[1], name: "" }],
    });
    expect(conflicts[0]?.teamName).toBe("another team");
    expect(conflicts[0]?.scheduleName).toBe("Schedule");
  });
});
