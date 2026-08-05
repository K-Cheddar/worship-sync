import {
  BROWSE_ALL_SCHEDULES_VALUE,
  buildSchedulePickerOptions,
  CURRENT_SCHEDULE_GROUP_SUFFIX,
  UNASSIGNED_SCHEDULE_GROUP,
} from "./schedulePickerOptions";

const team = (teamId: string, name: string) => ({ teamId, name });

const schedule = (
  scheduleId: string,
  name: string,
  teamId: string,
  { archivedAt, startDate }: { archivedAt?: string; startDate?: string } = {},
) => ({
  scheduleId,
  name,
  teamId,
  ...(archivedAt ? { archivedAt } : {}),
  ...(startDate ? { startDate } : {}),
});

describe("buildSchedulePickerOptions", () => {
  it("groups schedules by team when more than one team has schedules", () => {
    const options = buildSchedulePickerOptions({
      teams: [team("team-media", "Media"), team("team-music", "Music")],
      schedules: [
        schedule("s-1", "August 2026", "team-music"),
        schedule("s-2", "August 2026", "team-media"),
      ],
    });

    expect(options).toEqual([
      { label: "August 2026", value: "s-2", group: "Media" },
      { label: "August 2026", value: "s-1", group: "Music" },
    ]);
  });

  it("keeps team order from the teams list rather than sorting alphabetically", () => {
    const options = buildSchedulePickerOptions({
      teams: [team("team-music", "Music"), team("team-media", "Media")],
      schedules: [
        schedule("s-1", "August 2026", "team-media"),
        schedule("s-2", "August 2026", "team-music"),
      ],
    });

    expect(options.map((option) => option.group)).toEqual(["Music", "Media"]);
  });

  it("omits group headings when every schedule belongs to one team", () => {
    const options = buildSchedulePickerOptions({
      teams: [team("team-media", "Media"), team("team-music", "Music")],
      schedules: [
        schedule("s-1", "August 2026", "team-media", { startDate: "2026-08-01" }),
        schedule("s-2", "September 2026", "team-media", {
          startDate: "2026-09-01",
        }),
      ],
    });

    expect(options).toEqual([
      { label: "September 2026", value: "s-2", group: undefined },
      { label: "August 2026", value: "s-1", group: undefined },
    ]);
  });

  it("sorts schedules with an unknown team last under a fallback heading", () => {
    const options = buildSchedulePickerOptions({
      teams: [team("team-media", "Media")],
      schedules: [
        schedule("s-1", "August 2026", "team-deleted"),
        schedule("s-2", "August 2026", "team-media"),
      ],
    });

    expect(options).toEqual([
      { label: "August 2026", value: "s-2", group: "Media" },
      {
        label: "August 2026",
        value: "s-1",
        group: UNASSIGNED_SCHEDULE_GROUP,
      },
    ]);
  });

  // Newest-first replaces the previous insertion-order listing: with a schedule
  // per team per month, the month an operator is working on must lead the list
  // rather than sitting at the bottom behind a year of history.
  it("lists a team's schedules newest first by date", () => {
    const options = buildSchedulePickerOptions({
      teams: [team("team-media", "Media")],
      schedules: [
        schedule("s-jul", "July 2026", "team-media", { startDate: "2026-07-01" }),
        schedule("s-sep", "September 2026", "team-media", {
          startDate: "2026-09-01",
        }),
        schedule("s-aug", "August 2026", "team-media", { startDate: "2026-08-01" }),
      ],
    });

    expect(options.map((option) => option.value)).toEqual([
      "s-sep",
      "s-aug",
      "s-jul",
    ]);
  });

  it("hides archived schedules unless asked for", () => {
    const schedules = [
      schedule("s-1", "August 2026", "team-media", { startDate: "2026-08-01" }),
      schedule("s-old", "July 2026", "team-media", {
        startDate: "2026-07-01",
        archivedAt: "2026-08-01",
      }),
    ];

    // The archived one is hidden, so the browse entry appears to reach it.
    const withoutArchived = buildSchedulePickerOptions({
      teams: [team("team-media", "Media")],
      schedules,
    });
    expect(withoutArchived.map((option) => option.value)).toEqual([
      "s-1",
      BROWSE_ALL_SCHEDULES_VALUE,
    ]);

    const withArchived = buildSchedulePickerOptions({
      teams: [team("team-media", "Media")],
      schedules,
      includeArchived: true,
    });
    expect(withArchived.map((option) => option.label)).toEqual([
      "August 2026",
      "July 2026 (archived)",
    ]);
  });

  it("still lists the open schedule when it is archived", () => {
    const options = buildSchedulePickerOptions({
      teams: [team("team-media", "Media")],
      schedules: [
        schedule("s-1", "August 2026", "team-media", { startDate: "2026-08-01" }),
        schedule("s-old", "July 2026", "team-media", {
          startDate: "2026-07-01",
          archivedAt: "2026-08-01",
        }),
      ],
      selectedScheduleId: "s-old",
    });

    expect(options.map((option) => option.value)).toEqual(["s-1", "s-old"]);
  });

  it("caps each team at the most recent schedules and offers the full list", () => {
    const schedules = Array.from({ length: 9 }, (_, index) =>
      schedule(`s-${index}`, `Month ${index}`, "team-media", {
        startDate: `2026-0${index + 1}-01`,
      }),
    );

    const options = buildSchedulePickerOptions({
      teams: [team("team-media", "Media")],
      schedules,
      maxPerTeam: 3,
    });

    expect(options.map((option) => option.value)).toEqual([
      "s-8",
      "s-7",
      "s-6",
      BROWSE_ALL_SCHEDULES_VALUE,
    ]);
  });

  it("keeps the open schedule listed even when it falls outside the cap", () => {
    const schedules = Array.from({ length: 9 }, (_, index) =>
      schedule(`s-${index}`, `Month ${index}`, "team-media", {
        startDate: `2026-0${index + 1}-01`,
      }),
    );

    const options = buildSchedulePickerOptions({
      teams: [team("team-media", "Media")],
      schedules,
      selectedScheduleId: "s-0",
      maxPerTeam: 3,
    });

    expect(options.map((option) => option.value)).toContain("s-0");
  });

  it("narrows to a single team when a team filter is set", () => {
    const options = buildSchedulePickerOptions({
      teams: [team("team-media", "Media"), team("team-music", "Praise Team")],
      schedules: [
        schedule("s-media", "August 2026", "team-media", {
          startDate: "2026-08-01",
        }),
        schedule("s-music", "August 2026", "team-music", {
          startDate: "2026-08-01",
        }),
      ],
      teamId: "team-music",
    });

    // Only one team left, so the group heading is dropped as noise.
    expect(options).toEqual([
      { label: "August 2026", value: "s-music", group: undefined },
      { label: "Browse all schedules…", value: BROWSE_ALL_SCHEDULES_VALUE },
    ]);
  });

  it("still lists the open schedule when it belongs to a filtered-out team", () => {
    const options = buildSchedulePickerOptions({
      teams: [team("team-media", "Media"), team("team-music", "Praise Team")],
      schedules: [
        schedule("s-media", "August 2026", "team-media", {
          startDate: "2026-08-01",
        }),
        schedule("s-music", "August 2026", "team-music", {
          startDate: "2026-08-01",
        }),
      ],
      teamId: "team-music",
      selectedScheduleId: "s-media",
    });

    // Both end up listed, so nothing is hidden and no browse entry is needed.
    // The pinned one says why it is there rather than reading as a filter leak.
    expect(options).toEqual([
      {
        label: "August 2026",
        value: "s-media",
        group: `Media${CURRENT_SCHEDULE_GROUP_SUFFIX}`,
      },
      { label: "August 2026", value: "s-music", group: "Praise Team" },
    ]);
  });

  it("keeps the open schedule's heading when it is the only entry left", () => {
    const options = buildSchedulePickerOptions({
      teams: [team("team-media", "Media"), team("team-music", "Praise Team")],
      schedules: [
        schedule("s-media", "August 2026", "team-media", {
          startDate: "2026-08-01",
        }),
      ],
      teamId: "team-music",
      selectedScheduleId: "s-media",
    });

    expect(options).toEqual([
      {
        label: "August 2026",
        value: "s-media",
        group: `Media${CURRENT_SCHEDULE_GROUP_SUFFIX}`,
      },
    ]);
  });

  it("leaves the heading alone when the open schedule matches the filter", () => {
    const options = buildSchedulePickerOptions({
      teams: [team("team-media", "Media"), team("team-music", "Praise Team")],
      schedules: [
        schedule("s-media", "August 2026", "team-media", {
          startDate: "2026-08-01",
        }),
        schedule("s-media-2", "July 2026", "team-media", {
          startDate: "2026-07-01",
        }),
      ],
      teamId: "team-media",
      selectedScheduleId: "s-media",
    });

    // One team left and nothing pinned, so headings stay off entirely.
    expect(options.map((option) => option.group)).toEqual([undefined, undefined]);
  });

  it("omits the browse entry when nothing is hidden", () => {
    const options = buildSchedulePickerOptions({
      teams: [team("team-media", "Media")],
      schedules: [
        schedule("s-1", "August 2026", "team-media", { startDate: "2026-08-01" }),
      ],
    });

    expect(
      options.some((option) => option.value === BROWSE_ALL_SCHEDULES_VALUE),
    ).toBe(false);
  });
});
