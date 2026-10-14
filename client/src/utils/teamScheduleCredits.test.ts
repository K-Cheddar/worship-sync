import type {
  TeamPosition,
  TeamRecord,
  TeamRosterMember,
  TeamSchedule,
} from "../api/authTypes";
import {
  buildTeamScheduleCreditEntries,
  findTeamScheduleCreditEntryForHeading,
  getGeneratedScheduleCreditId,
  resolveTeamScheduleCreditMatches,
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
  overrides: Partial<TeamRosterMember> = {},
): TeamRosterMember => ({
  memberId,
  churchId: "church-1",
  firstName,
  lastName,
  positionIds: [],
  blockoutDates: [],
  ...overrides,
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
    const { entries } = buildTeamScheduleCreditEntries({
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
        positionId: "audio",
        heading: "Audio Engineer",
        names: "",
        sourceLabel: "Media schedule: July Media - Sabbath Worship",
      },
      {
        positionId: "camera",
        heading: "Camera",
        names: "Alice Jones",
        sourceLabel: "Media schedule: July Media - Sabbath Worship",
      },
    ]);
  });

  it("uses the explicitly selected future service when another occurrence is in progress", () => {
    const { entries } = buildTeamScheduleCreditEntries({
      teams,
      positions,
      members,
      servicePlanKey: "service-2@2026-07-04",
      now: new Date("2026-07-04T11:30:00.000Z"),
      schedules: [
        schedule("2026-07-04T10:00:00.000Z", {
          "occ-1": { "camera::0": { primaryMemberId: "m1" } },
        }),
        schedule("2026-07-04T13:00:00.000Z", {
          "occ-next": { "camera::0": { primaryMemberId: "m2" } },
        }, {
          scheduleId: "schedule-2",
          occurrences: [{
            occurrenceId: "occ-next",
            serviceId: "service-2",
            name: "Afternoon Worship",
            startsAt: "2026-07-04T13:00:00.000Z",
          }],
        }),
      ],
    });

    const camera = entries.find((entry) => entry.heading === "Camera");
    expect(camera?.names).toBe("Bob Smith");
    expect(camera?.sourceLabel).toContain("Afternoon Worship");
  });

  it("rolls to the next upcoming occurrence after the three-hour window", () => {
    const { entries } = buildTeamScheduleCreditEntries({
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
        positionId: "audio",
        heading: "Audio Engineer",
        names: "",
        sourceLabel: "Media schedule: July Media - Afternoon Worship",
      },
      {
        positionId: "camera",
        heading: "Camera",
        names: "Bob Smith",
        sourceLabel: "Media schedule: July Media - Afternoon Worship",
      },
    ]);
  });

  it("groups multiple slots and includes shadows with full member names", () => {
    const { entries } = buildTeamScheduleCreditEntries({
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
        positionId: "audio",
        heading: "Audio Engineer",
        names: "Bob Smith",
        sourceLabel: "Media schedule: July Media - Sabbath Worship",
      },
      {
        positionId: "camera",
        heading: "Camera",
        names: "Alice Jones\nJordan Taylor\nJordan Smith\nBob Smith",
        sourceLabel: "Media schedule: July Media - Sabbath Worship",
      },
    ]);
  });

  it("omits last names for minors in generated schedule credits", () => {
    const { entries } = buildTeamScheduleCreditEntries({
      teams,
      positions,
      members: [
        member("minor", "Taylor", "Morgan", { isMinor: true }),
        member("adult", "Alex", "Rivera", { isMinor: false }),
      ],
      now: new Date("2026-07-04T10:30:00.000Z"),
      schedules: [
        schedule("2026-07-04T10:00:00.000Z", {
          "occ-1": {
            "camera::0": { primaryMemberId: "minor" },
            "camera::1": { primaryMemberId: "adult" },
          },
        }),
      ],
    });

    expect(entries.find((entry) => entry.heading === "Camera")?.names).toBe(
      "Taylor\nAlex Rivera",
    );
  });

  it("returns an empty list when there is no media team or target occurrence", () => {
    expect(
      buildTeamScheduleCreditEntries({
        teams: [team({ teamId: "team-other", name: "Worship Team" })],
        positions,
        members,
        schedules: [],
      }),
    ).toEqual({ entries: [], positions: [], availability: "missing" });

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
    ).toEqual({
      entries: [],
      positions: [
        { positionId: "audio", heading: "Audio Engineer" },
        { positionId: "camera", heading: "Camera" },
      ],
      availability: "missing",
    });
  });

  // An empty roster and a roster we never fetched look identical once the
  // summary is filtered out, and credits would go to air with names missing.
  it("reports an unloaded media schedule instead of writing blank credits", () => {
    const { assignments: _assignments, ...summary } = schedule(
      "2026-07-04T10:00:00.000Z",
      {
        "occ-1": {
          "camera::0": { primaryMemberId: "m1" },
        },
      },
    );

    expect(
      buildTeamScheduleCreditEntries({
        teams,
        positions,
        members,
        now: new Date("2026-07-04T10:30:00.000Z"),
        schedules: [{ ...summary, assignmentsOmitted: true }],
      }),
    ).toEqual({
      entries: [],
      positions: [
        { positionId: "audio", heading: "Audio Engineer" },
        { positionId: "camera", heading: "Camera" },
      ],
      availability: "unhydrated",
    });
  });

  it("treats a schedule without its assignments map as unhydrated", () => {
    const { assignments: _assignments, ...summary } = schedule(
      "2026-07-04T10:00:00.000Z",
      { "occ-1": { "camera::0": { primaryMemberId: "m1" } } },
    );

    const result = buildTeamScheduleCreditEntries({
      teams,
      positions,
      members,
      now: new Date("2026-07-04T10:30:00.000Z"),
      schedules: [summary],
    });

    expect(result.availability).toBe("unhydrated");
    expect(result.entries).toEqual([]);
    expect(result.positions).toHaveLength(2);
  });

  it("treats assignments that reference missing roster members as incomplete", () => {
    const result = buildTeamScheduleCreditEntries({
      teams,
      positions,
      members: [],
      now: new Date("2026-07-04T10:30:00.000Z"),
      schedules: [schedule("2026-07-04T10:00:00.000Z", {
        "occ-1": { "camera::0": { primaryMemberId: "missing-member" } },
      })],
    });

    expect(result.availability).toBe("incomplete");
    expect(result.entries).toEqual([]);
    expect(result.positions.map(({ heading }) => heading)).toEqual([
      "Audio Engineer",
      "Camera",
    ]);
  });

  it("reports hydrated empty assignments as loaded for every schedule position", () => {
    const result = buildTeamScheduleCreditEntries({
      teams,
      positions,
      members,
      now: new Date("2026-07-04T10:30:00.000Z"),
      schedules: [schedule("2026-07-04T10:00:00.000Z", { "occ-1": {} })],
    });

    expect(result.availability).toBe("loaded");
    expect(result.entries).toEqual([
      expect.objectContaining({ heading: "Audio Engineer", names: "" }),
      expect.objectContaining({ heading: "Camera", names: "" }),
    ]);
  });
});

describe("teamScheduleCreditHeadingMatches", () => {
  it("builds a stable generated credit ID from the schedule position identity", () => {
    expect(getGeneratedScheduleCreditId("camera::position/1")).toBe(
      "generated-schedule-camera%3A%3Aposition%2F1",
    );
    expect(getGeneratedScheduleCreditId("camera")).not.toBe(
      getGeneratedScheduleCreditId("audio"),
    );
  });

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
            positionId: "camera",
            heading: "Camera",
            names: "Alice Jones",
            sourceLabel: "Media schedule: July Media - Sabbath Worship",
          },
        ],
        "Camera Operators",
      ),
    ).toEqual({
      positionId: "camera",
      heading: "Camera",
      names: "Alice Jones",
      sourceLabel: "Media schedule: July Media - Sabbath Worship",
    });
  });

  it("uses a stable position ID before heading matching", () => {
    const entries = [
      { positionId: "audio-engineer", heading: "Audio Engineer", names: "Alex", sourceLabel: "Media schedule" },
      { positionId: "audio-technician", heading: "Audio Technician", names: "Jordan", sourceLabel: "Media schedule" },
    ];
    const resolution = resolveTeamScheduleCreditMatches(entries, [
      { id: getGeneratedScheduleCreditId("audio-engineer"), heading: "Audio" },
    ]);

    expect(resolution.matchedEntriesByCreditIndex.get(0)).toBe(0);
    expect(resolution.ambiguousCreditIndexes.size).toBe(0);
    expect(resolution.ambiguousEntryIndexes.size).toBe(0);
  });

  it("matches a unique exact heading one-to-one", () => {
    const entries = [
      { positionId: "camera", heading: "Camera", names: "Alice", sourceLabel: "Media schedule" },
    ];
    const resolution = resolveTeamScheduleCreditMatches(entries, [
      { id: "camera-credit", heading: "Camera" },
    ]);

    expect(resolution.matchedEntriesByCreditIndex.get(0)).toBe(0);
    expect(resolution.ambiguousCreditIndexes.size).toBe(0);
    expect(resolution.ambiguousEntryIndexes.size).toBe(0);
  });

  it("marks a credit matching multiple scheduled positions as ambiguous", () => {
    const entries = [
      { positionId: "audio-engineer", heading: "Audio Engineer", names: "Alex", sourceLabel: "Media schedule" },
      { positionId: "audio-technician", heading: "Audio Technician", names: "Jordan", sourceLabel: "Media schedule" },
    ];
    const resolution = resolveTeamScheduleCreditMatches(entries, [
      { id: "credit-audio", heading: "Audio" },
    ]);

    expect(resolution.matchedEntriesByCreditIndex.size).toBe(0);
    expect([...resolution.ambiguousCreditIndexes]).toEqual([0]);
    expect([...resolution.ambiguousEntryIndexes].sort()).toEqual([0, 1]);
    expect(findTeamScheduleCreditEntryForHeading(entries, "Audio")).toBeUndefined();
  });

  it("marks a scheduled position matching multiple credits as ambiguous", () => {
    const entries = [
      { positionId: "camera", heading: "Camera", names: "Alice", sourceLabel: "Media schedule" },
    ];
    const resolution = resolveTeamScheduleCreditMatches(entries, [
      { id: "camera-exact", heading: "Camera" },
      { id: "camera-operators", heading: "Camera Operators" },
    ]);

    expect(resolution.matchedEntriesByCreditIndex.size).toBe(0);
    expect([...resolution.ambiguousCreditIndexes].sort()).toEqual([0, 1]);
    expect([...resolution.ambiguousEntryIndexes]).toEqual([0]);
  });

  it("keeps match outcomes the same when credits and schedule entries are reordered", () => {
    const entries = [
      { positionId: "audio-engineer", heading: "Audio Engineer", names: "Alex", sourceLabel: "Media schedule" },
      { positionId: "audio-technician", heading: "Audio Technician", names: "Jordan", sourceLabel: "Media schedule" },
      { positionId: "camera", heading: "Camera", names: "Sam", sourceLabel: "Media schedule" },
    ];
    const credits = [
      { id: "audio", heading: "Audio" },
      { id: "camera-credit", heading: "Camera Operators" },
    ];
    const summarize = (
      scheduleEntries: typeof entries,
      existingCredits: typeof credits,
    ) => {
      const result = resolveTeamScheduleCreditMatches(scheduleEntries, existingCredits);
      return {
        matches: [...result.matchedEntriesByCreditIndex].map(([creditIndex, entryIndex]) => [
          existingCredits[creditIndex].id,
          scheduleEntries[entryIndex].positionId,
        ]).sort(),
        ambiguousCredits: [...result.ambiguousCreditIndexes]
          .map((index) => existingCredits[index].id).sort(),
        ambiguousEntries: [...result.ambiguousEntryIndexes]
          .map((index) => scheduleEntries[index].positionId).sort(),
      };
    };

    expect(summarize(entries, credits)).toEqual(
      summarize([...entries].reverse(), [...credits].reverse()),
    );
  });

  it("does not match a broader producer heading to a generic producer position", () => {
    expect(
      teamScheduleCreditHeadingMatches("Executive Producers", "Producer"),
    ).toBe(false);
  });
});
