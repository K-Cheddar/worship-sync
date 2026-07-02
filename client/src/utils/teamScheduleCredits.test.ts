import type {
  TeamPosition,
  TeamRecord,
  TeamRosterMember,
  TeamSchedule,
} from "../api/authTypes";
import {
  buildTeamScheduleCreditEntries,
  findTeamScheduleCreditEntryForHeading,
  teamScheduleCreditHeadingMatches,
} from "./teamScheduleCredits";

const team = (overrides: Partial<TeamRecord> = {}): TeamRecord => ({
  teamId: "team-media",
  churchId: "church-1",
  name: "Media Team",
  memberIds: [],
  ...overrides,
});

const position = (
  positionId: string,
  name: string,
  order: number,
  overrides: Partial<TeamPosition> = {},
): TeamPosition => ({
  positionId,
  churchId: "church-1",
  teamId: "team-media",
  name,
  order,
  ...overrides,
});

const member = (
  memberId: string,
  firstName: string,
  lastName: string,
): TeamRosterMember => ({
  memberId,
  churchId: "church-1",
  firstName,
  lastName,
  positionIds: [],
  blockoutDates: [],
});

const schedule = (
  occurrenceStartsAt: string,
  assignments: TeamSchedule["assignments"],
  overrides: Partial<TeamSchedule> = {},
): TeamSchedule => ({
  scheduleId: "schedule-1",
  churchId: "church-1",
  name: "July Media",
  teamId: "team-media",
  serviceIds: ["service-1"],
  occurrences: [
    {
      occurrenceId: "occ-1",
      serviceId: "service-1",
      name: "Sabbath Worship",
      startsAt: occurrenceStartsAt,
    },
  ],
  assignments,
  ...overrides,
});

describe("buildTeamScheduleCreditEntries", () => {
  const teams = [team()];
  const positions = [
    position("camera", "Camera", 2),
    position("audio", "Audio Engineer", 1),
  ];
  const members = [
    member("m1", "Alice", "Jones"),
    member("m2", "Bob", "Smith"),
    member("m3", "Jordan", "Smith"),
    member("m4", "Jordan", "Taylor"),
  ];

  it("uses an in-progress occurrence inside the service window before the next upcoming one", () => {
    const entries = buildTeamScheduleCreditEntries({
      teams,
      positions,
      members,
      now: new Date("2026-07-04T11:30:00.000Z"),
      schedules: [
        schedule("2026-07-04T10:00:00.000Z", {
          "occ-1": {
            "camera::0": { primaryMemberId: "m1" },
          },
        }),
        schedule(
          "2026-07-04T13:00:00.000Z",
          {
            "occ-next": {
              "camera::0": { primaryMemberId: "m2" },
            },
          },
          {
            scheduleId: "schedule-2",
            occurrences: [
              {
                occurrenceId: "occ-next",
                serviceId: "service-2",
                name: "Afternoon Worship",
                startsAt: "2026-07-04T13:00:00.000Z",
              },
            ],
          },
        ),
      ],
    });

    expect(entries).toEqual([
      {
        heading: "Camera",
        names: "Alice",
        sourceLabel: "Media schedule: July Media - Sabbath Worship",
      },
    ]);
  });

  it("rolls to the next upcoming occurrence after the three-hour window", () => {
    const entries = buildTeamScheduleCreditEntries({
      teams,
      positions,
      members,
      now: new Date("2026-07-04T13:01:00.000Z"),
      schedules: [
        schedule("2026-07-04T10:00:00.000Z", {
          "occ-1": {
            "camera::0": { primaryMemberId: "m1" },
          },
        }),
        schedule(
          "2026-07-04T14:00:00.000Z",
          {
            "occ-next": {
              "camera::0": { primaryMemberId: "m2" },
            },
          },
          {
            scheduleId: "schedule-2",
            occurrences: [
              {
                occurrenceId: "occ-next",
                serviceId: "service-2",
                name: "Afternoon Worship",
                startsAt: "2026-07-04T14:00:00.000Z",
              },
            ],
          },
        ),
      ],
    });

    expect(entries).toEqual([
      {
        heading: "Camera",
        names: "Bob",
        sourceLabel: "Media schedule: July Media - Afternoon Worship",
      },
    ]);
  });

  it("groups multiple slots, includes shadows, and disambiguates duplicate first names", () => {
    const entries = buildTeamScheduleCreditEntries({
      teams,
      positions,
      members,
      now: new Date("2026-07-04T10:30:00.000Z"),
      schedules: [
        schedule("2026-07-04T10:00:00.000Z", {
          "occ-1": {
            "camera::1": {
              primaryMemberId: "m3",
              shadows: [{ memberId: "m2", kind: "reverse_shadow" }],
            },
            "camera::0": {
              primaryMemberId: "m1",
              shadows: [{ memberId: "m4", kind: "shadow" }],
            },
            "audio::0": { primaryMemberId: "m2" },
          },
        }),
      ],
    });

    expect(entries).toEqual([
      {
        heading: "Audio Engineer",
        names: "Bob",
        sourceLabel: "Media schedule: July Media - Sabbath Worship",
      },
      {
        heading: "Camera",
        names: "Alice\nJordan T.\nJordan S.\nBob",
        sourceLabel: "Media schedule: July Media - Sabbath Worship",
      },
    ]);
  });

  it("returns an empty list when there is no media team or target occurrence", () => {
    expect(
      buildTeamScheduleCreditEntries({
        teams: [team({ teamId: "team-other", name: "Worship Team" })],
        positions,
        members,
        schedules: [],
      }),
    ).toEqual([]);

    expect(
      buildTeamScheduleCreditEntries({
        teams,
        positions,
        members,
        now: new Date("2026-07-05T10:00:00.000Z"),
        schedules: [
          schedule("2026-07-04T10:00:00.000Z", {
            "occ-1": {
              "camera::0": { primaryMemberId: "m1" },
            },
          }),
        ],
      }),
    ).toEqual([]);
  });
});

describe("teamScheduleCreditHeadingMatches", () => {
  it("matches plural/generic credit headings to Teams position names", () => {
    expect(teamScheduleCreditHeadingMatches("Camera Operators", "Camera")).toBe(
      true,
    );
    expect(
      teamScheduleCreditHeadingMatches("Audio Engineers", "Audio Engineer"),
    ).toBe(true);
    expect(teamScheduleCreditHeadingMatches("Graphics Team", "Graphics")).toBe(
      true,
    );
    expect(
      findTeamScheduleCreditEntryForHeading(
        [
          {
            heading: "Camera",
            names: "Alice",
            sourceLabel: "Media schedule: July Media - Sabbath Worship",
          },
        ],
        "Camera Operators",
      ),
    ).toEqual({
      heading: "Camera",
      names: "Alice",
      sourceLabel: "Media schedule: July Media - Sabbath Worship",
    });
  });

  it("does not match a broader producer heading to a generic producer position", () => {
    expect(
      teamScheduleCreditHeadingMatches("Executive Producers", "Producer"),
    ).toBe(false);
  });
});
