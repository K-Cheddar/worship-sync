import type {
  TeamPosition,
  TeamRecord,
  TeamRosterMember,
  TeamSchedule,
  TeamScheduleOccurrence,
  TeamService,
} from "../../../api/authTypes";
import {
  getOccurrenceAssignmentSummary,
  getScheduledMicrophoneHolders,
  getTeamMicrophoneRows,
  groupAssignmentSummaryByTeam,
  summarizeNeededPositions,
} from "./teamsAssignmentsSummary";

const occurrence: TeamScheduleOccurrence = {
  occurrenceId: "service-1@2026-07-26T14:00:00.000Z",
  serviceId: "service-1",
  name: "Sunday Service",
  startsAt: "2026-07-26T14:00:00.000Z",
};

const services: TeamService[] = [
  {
    id: "service-1",
    serviceId: "service-1",
    churchId: "church-1",
    name: "Sunday Service",
    timerType: "countdown",
    reccurence: "weekly",
    dayOfWeek: 0,
    time: "10:00",
    positionRequirements: [
      { positionId: "position-vocal", count: 2 },
      { positionId: "position-keys", count: 1 },
    ],
  },
];

const teams: TeamRecord[] = [
  {
    teamId: "team-1",
    churchId: "church-1",
    name: "Worship",
    memberIds: [],
  },
  {
    teamId: "team-2",
    churchId: "church-1",
    name: "Technical",
    memberIds: [],
  },
];

const positions: TeamPosition[] = [
  {
    positionId: "position-vocal",
    churchId: "church-1",
    teamId: "team-1",
    name: "Vocal",
  },
  {
    positionId: "position-keys",
    churchId: "church-1",
    teamId: "team-1",
    name: "Keys",
  },
  {
    positionId: "position-foh",
    churchId: "church-1",
    teamId: "team-2",
    name: "Front of House Audio",
  },
];

const members: TeamRosterMember[] = [
  {
    memberId: "member-1",
    churchId: "church-1",
    firstName: "Avery",
    lastName: "Stone",
    positionIds: [],
    blockoutDates: [],
  },
  {
    memberId: "member-2",
    churchId: "church-1",
    firstName: "Morgan",
    lastName: "Lee",
    positionIds: [],
    blockoutDates: [],
  },
  {
    memberId: "member-3",
    churchId: "church-1",
    firstName: "Casey",
    lastName: "Ng",
    positionIds: [],
    blockoutDates: [],
  },
];

const schedule = (
  assignments: TeamSchedule["assignments"],
  overrides: Partial<TeamSchedule> = {},
): TeamSchedule => ({
  scheduleId: "schedule-1",
  churchId: "church-1",
  name: "July",
  teamId: "team-1",
  serviceIds: ["service-1"],
  occurrences: [occurrence],
  assignments,
  ...overrides,
});

const summaryFor = (schedules: TeamSchedule[]) =>
  getOccurrenceAssignmentSummary({
    occurrence,
    schedules,
    positions,
    members,
    teams,
    services,
  });

describe("getOccurrenceAssignmentSummary", () => {
  it("lists every required slot, with assigned members resolved to names", () => {
    const rows = summaryFor([
      schedule({
        [occurrence.occurrenceId]: {
          "position-vocal::0": { primaryMemberId: "member-2" },
          "position-keys::0": { primaryMemberId: "member-1" },
        },
      }),
    ]);

    expect(
      rows.map((row) => ({
        slotLabel: row.slotLabel,
        memberName: row.memberName,
      })),
    ).toEqual([
      { slotLabel: "Vocal 1", memberName: "Morgan Lee" },
      // Required by the service, nobody assigned yet.
      { slotLabel: "Vocal 2", memberName: null },
      { slotLabel: "Keys", memberName: "Avery Stone" },
    ]);
  });

  it("carries the schedule and cell key so a row can deep-link into the grid", () => {
    const [row] = summaryFor([
      schedule({
        [occurrence.occurrenceId]: {
          "position-vocal::0": { primaryMemberId: "member-2" },
        },
      }),
    ]);

    expect(row).toMatchObject({
      teamId: "team-1",
      teamName: "Worship",
      scheduleId: "schedule-1",
      occurrenceId: occurrence.occurrenceId,
      positionId: "position-vocal",
      columnKey: "position-vocal::0",
    });
  });

  it("treats a cell with no assigned member as an unfilled slot", () => {
    const rows = summaryFor([
      schedule({
        [occurrence.occurrenceId]: {
          "position-keys::0": {},
        },
      }),
    ]);

    expect(
      rows.find((row) => row.positionId === "position-keys")?.memberName,
    ).toBeNull();
  });

  it("falls back to one slot per team position when nothing is required", () => {
    // The service's requirements are all team-1 positions, so for team-2's
    // schedule they scope out and every team position gets a single slot.
    const rows = summaryFor([
      schedule({}, { scheduleId: "schedule-2", teamId: "team-2" }),
    ]).filter((row) => row.teamId === "team-2");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      teamName: "Technical",
      slotLabel: "Front of House Audio",
      memberName: null,
    });
  });

  it("ignores the assignments of a schedule that does not cover this occurrence", () => {
    const rows = summaryFor([
      schedule(
        {
          "other-occurrence": {
            "position-vocal::0": { primaryMemberId: "member-1" },
          },
        },
        {
          occurrences: [
            {
              ...occurrence,
              occurrenceId: "other-occurrence",
              startsAt: "2026-08-02T14:00:00.000Z",
            },
          ],
        },
      ),
    ]);

    // Nobody is carried over from the other date; what remains is what the
    // service itself requires, with no schedule to attribute it to.
    expect(rows.every((row) => row.memberName === null)).toBe(true);
    expect(rows.every((row) => row.scheduleId === null)).toBe(true);
  });

  it("lists what the service requires for a team with no schedule on this date", () => {
    const rows = summaryFor([]);

    expect(
      rows.map((row) => ({
        teamName: row.teamName,
        slotLabel: row.slotLabel,
        columnKey: row.columnKey,
        scheduleId: row.scheduleId,
      })),
    ).toEqual([
      {
        teamName: "Worship",
        slotLabel: "Vocal 1",
        columnKey: "position-vocal::0",
        scheduleId: null,
      },
      {
        teamName: "Worship",
        slotLabel: "Vocal 2",
        columnKey: "position-vocal::1",
        scheduleId: null,
      },
      {
        teamName: "Worship",
        slotLabel: "Keys",
        columnKey: "position-keys::0",
        scheduleId: null,
      },
    ]);
  });

  it("prefers a combined occurrence's merged requirements over the service's", () => {
    const rows = getOccurrenceAssignmentSummary({
      occurrence: {
        ...occurrence,
        occurrenceId: "group:group-1@2026-07-26",
        groupId: "group-1",
        serviceIds: ["service-1"],
        positionRequirements: [{ positionId: "position-keys", count: 1 }],
      },
      schedules: [],
      positions,
      members,
      teams,
      services,
    });

    expect(rows.map((row) => row.slotLabel)).toEqual(["Keys"]);
  });

  it("does not repeat a team that already has a schedule covering this date", () => {
    const rows = summaryFor([
      schedule({
        [occurrence.occurrenceId]: {
          "position-vocal::0": { primaryMemberId: "member-2" },
        },
      }),
    ]);

    // team-1 is scheduled, so its requirements come from the schedule only.
    expect(rows.every((row) => row.scheduleId === "schedule-1")).toBe(true);
    expect(rows).toHaveLength(3);
  });

  it("shows nothing when the service requires no positions and nothing is scheduled", () => {
    expect(
      getOccurrenceAssignmentSummary({
        occurrence,
        schedules: [],
        positions,
        members,
        teams,
        services: [{ ...services[0], positionRequirements: [] }],
      }),
    ).toEqual([]);
  });

  it("matches a schedule whose stored occurrence id has drifted, by date and service", () => {
    // Re-combining services re-keys occurrence ids; the schedule still covers
    // this date, so its assignments must keep showing.
    const driftedId = "service-1@2026-07-26T14:00:00.001Z";
    const rows = summaryFor([
      schedule(
        {
          [driftedId]: {
            "position-vocal::0": { primaryMemberId: "member-2" },
          },
        },
        { occurrences: [{ ...occurrence, occurrenceId: driftedId }] },
      ),
    ]);

    expect(rows[0]).toMatchObject({
      memberName: "Morgan Lee",
      // The schedule's own id, so focusing this cell targets a row that exists.
      occurrenceId: driftedId,
    });
  });

  it("keeps an assigned member whose slot is no longer required", () => {
    // The service now requires 2 vocals; someone is still assigned to a third.
    const rows = summaryFor([
      schedule({
        [occurrence.occurrenceId]: {
          "position-vocal::2": { primaryMemberId: "member-3" },
        },
      }),
    ]);

    expect(rows.map((row) => row.memberName)).toEqual([
      null,
      null,
      null,
      "Casey Ng",
    ]);
    expect(rows[3].columnKey).toBe("position-vocal::2");
  });

  it("shows an archived schedule's assignments without padding the unfilled count", () => {
    const rows = summaryFor([
      schedule(
        {
          [occurrence.occurrenceId]: {
            "position-vocal::0": { primaryMemberId: "member-2" },
          },
        },
        { archivedAt: "2026-07-01T00:00:00.000Z" },
      ),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].memberName).toBe("Morgan Lee");
  });

  it("combines schedules from different teams that both cover this occurrence", () => {
    const rows = summaryFor([
      schedule({
        [occurrence.occurrenceId]: {
          "position-vocal::0": { primaryMemberId: "member-2" },
        },
      }),
      schedule(
        {
          [occurrence.occurrenceId]: {
            "position-foh::0": { primaryMemberId: "member-3" },
          },
        },
        { scheduleId: "schedule-2", teamId: "team-2" },
      ),
    ]);

    expect(
      rows.filter((row) => row.memberName).map((row) => row.memberName),
    ).toEqual(["Morgan Lee", "Casey Ng"]);
  });
});

describe("summarizeNeededPositions", () => {
  it("collapses repeated slots of a position into one entry with a count", () => {
    expect(summarizeNeededPositions(summaryFor([]))).toEqual([
      { positionId: "position-vocal", positionName: "Vocal", count: 2 },
      { positionId: "position-keys", positionName: "Keys", count: 1 },
    ]);
  });
});

describe("groupAssignmentSummaryByTeam", () => {
  it("names the schedule when one team has two of them over the same date", () => {
    // Two schedules for the same team and date render as two identically
    // titled blocks with different fill counts, which reads as a duplicate
    // until each says which schedule it came from.
    const schedules = [
      schedule({
        [occurrence.occurrenceId]: {
          "position-vocal::0": { primaryMemberId: "member-2" },
        },
      }),
      schedule({}, { scheduleId: "schedule-dup", name: "July (rebuild)" }),
    ];

    const groups = groupAssignmentSummaryByTeam(
      summaryFor(schedules),
      schedules,
    );
    const worship = groups.filter((group) => group.teamName === "Worship");

    expect(worship).toHaveLength(2);
    expect(worship.map((group) => group.scheduleName).sort()).toEqual([
      "July",
      "July (rebuild)",
    ]);
  });

  it("leaves the schedule name off when a team only has one", () => {
    const schedules = [
      schedule({
        [occurrence.occurrenceId]: {
          "position-vocal::0": { primaryMemberId: "member-2" },
        },
      }),
    ];

    const groups = groupAssignmentSummaryByTeam(
      summaryFor(schedules),
      schedules,
    );

    expect(groups.every((group) => group.scheduleName === undefined)).toBe(
      true,
    );
  });

  it("splits filled from unfilled under each team, in team name order", () => {
    const groups = groupAssignmentSummaryByTeam(
      summaryFor([
        schedule({
          [occurrence.occurrenceId]: {
            "position-vocal::0": { primaryMemberId: "member-2" },
          },
        }),
        schedule(
          {
            [occurrence.occurrenceId]: {
              "position-foh::0": { primaryMemberId: "member-3" },
            },
          },
          { scheduleId: "schedule-2", teamId: "team-2" },
        ),
      ]),
    );

    expect(
      groups.map((group) => ({
        teamName: group.teamName,
        scheduleId: group.scheduleId,
        filled: group.filled.map((row) => row.memberName),
        unfilled: group.unfilled.map((row) => row.slotLabel),
      })),
    ).toEqual([
      {
        teamName: "Technical",
        scheduleId: "schedule-2",
        filled: ["Casey Ng"],
        unfilled: [],
      },
      {
        teamName: "Worship",
        scheduleId: "schedule-1",
        filled: ["Morgan Lee"],
        unfilled: ["Vocal 2", "Keys"],
      },
    ]);
  });

  it("keeps a team's schedules apart so each links to its own grid", () => {
    const groups = groupAssignmentSummaryByTeam(
      summaryFor([
        schedule({
          [occurrence.occurrenceId]: {
            "position-vocal::0": { primaryMemberId: "member-2" },
          },
        }),
        schedule(
          {
            [occurrence.occurrenceId]: {
              "position-keys::0": { primaryMemberId: "member-1" },
            },
          },
          { scheduleId: "schedule-2" },
        ),
      ]),
    );

    expect(groups.map((group) => group.scheduleId)).toEqual([
      "schedule-1",
      "schedule-2",
    ]);
  });
});

describe("getTeamMicrophoneRows", () => {
  const microphoneTeams: TeamRecord[] = [
    { ...teams[0], usesMicrophoneAssignments: true },
    teams[1],
  ];

  it("keeps scheduled slots on teams that use microphone assignments", () => {
    const rows = getTeamMicrophoneRows(
      summaryFor([
        schedule({
          [occurrence.occurrenceId]: {
            "position-vocal::0": { primaryMemberId: "member-2" },
          },
        }),
      ]),
      microphoneTeams,
    );

    expect(rows.map((row) => row.slotLabel)).toEqual([
      "Vocal 1",
      "Vocal 2",
      "Keys",
    ]);
  });

  it("drops teams that have not opted in, and slots with no schedule", () => {
    // team-2 has no schedule for this date, so its required Front of House
    // slot has no cell to write a microphone to.
    const rows = getTeamMicrophoneRows(summaryFor([]), microphoneTeams);

    expect(rows).toEqual([]);
  });
});

describe("getScheduledMicrophoneHolders", () => {
  it("lists every holder of a microphone so the plan can warn about sharing", () => {
    const holders = getScheduledMicrophoneHolders(
      summaryFor([
        schedule(
          {
            [occurrence.occurrenceId]: {
              "position-vocal::0": { primaryMemberId: "member-2" },
              "position-keys::0": { primaryMemberId: "member-1" },
            },
          },
          {
            microphoneAssignments: {
              [occurrence.occurrenceId]: {
                "position-vocal::0": ["mic-lead"],
                "position-keys::0": ["mic-lead", "mic-orange"],
              },
            },
          },
        ),
      ]),
      [{ ...teams[0], usesMicrophoneAssignments: true }, teams[1]],
    );

    expect(Object.fromEntries(holders)).toEqual({
      "mic-lead": ["Morgan Lee", "Avery Stone"],
      "mic-orange": ["Avery Stone"],
    });
  });

  it("falls back to the slot label when nobody is assigned yet", () => {
    const holders = getScheduledMicrophoneHolders(
      summaryFor([
        schedule(
          { [occurrence.occurrenceId]: {} },
          {
            microphoneAssignments: {
              [occurrence.occurrenceId]: { "position-keys::0": ["mic-lead"] },
            },
          },
        ),
      ]),
      [{ ...teams[0], usesMicrophoneAssignments: true }, teams[1]],
    );

    expect(holders.get("mic-lead")).toEqual(["Keys"]);
  });
});
