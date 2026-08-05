import {
  emptyScheduleBrowserFilters,
  filterSchedulesForBrowser,
  type ScheduleBrowserFilters,
} from "./scheduleBrowserFilters";

const team = (teamId: string, name: string) => ({ teamId, name });

const schedule = (
  scheduleId: string,
  name: string,
  teamId: string,
  {
    startDate,
    endDate,
    archivedAt,
  }: { startDate?: string; endDate?: string; archivedAt?: string } = {},
) => ({
  scheduleId,
  name,
  teamId,
  ...(startDate ? { startDate } : {}),
  ...(endDate ? { endDate } : {}),
  ...(archivedAt ? { archivedAt } : {}),
});

const teams = [team("team-media", "Media"), team("team-music", "Praise Team")];

const schedules = [
  schedule("s-aug-media", "August 2026", "team-media", {
    startDate: "2026-08-01",
    endDate: "2026-08-31",
  }),
  schedule("s-aug-music", "August 2026", "team-music", {
    startDate: "2026-08-01",
    endDate: "2026-08-31",
  }),
  schedule("s-jul-media", "July 2026", "team-media", {
    startDate: "2026-07-01",
    endDate: "2026-07-31",
    archivedAt: "2026-08-01",
  }),
  schedule("s-undated", "Legacy schedule", "team-media"),
];

const run = (overrides: Partial<ScheduleBrowserFilters> = {}) =>
  filterSchedulesForBrowser({
    schedules,
    teams,
    filters: { ...emptyScheduleBrowserFilters, ...overrides },
  }).map((row) => row.schedule.scheduleId);

describe("filterSchedulesForBrowser", () => {
  it("hides archived schedules by default and sorts newest first", () => {
    expect(run()).toEqual(["s-aug-media", "s-aug-music", "s-undated"]);
  });

  it("can show only archived schedules", () => {
    expect(run({ status: "archived" })).toEqual(["s-jul-media"]);
  });

  it("can show every schedule regardless of status", () => {
    expect(run({ status: "all" })).toEqual([
      "s-aug-media",
      "s-aug-music",
      "s-jul-media",
      "s-undated",
    ]);
  });

  it("filters by team", () => {
    expect(run({ teamId: "team-music" })).toEqual(["s-aug-music"]);
  });

  it("matches the search against the team name as well as the schedule name", () => {
    expect(run({ search: "praise" })).toEqual(["s-aug-music"]);
    expect(run({ search: "august" })).toEqual(["s-aug-media", "s-aug-music"]);
  });

  it("filters by an overlapping date window", () => {
    expect(run({ status: "all", startDate: "2026-07-01", endDate: "2026-07-15" }))
      // The undated legacy schedule cannot be excluded on dates.
      .toEqual(["s-jul-media", "s-undated"]);
  });

  it("keeps undated schedules out of the way at the end of the list", () => {
    const rows = filterSchedulesForBrowser({
      schedules,
      teams,
      filters: { ...emptyScheduleBrowserFilters, status: "all" },
    });
    expect(rows[rows.length - 1].schedule.scheduleId).toBe("s-undated");
  });

  it("reports the team name alongside each match", () => {
    const rows = filterSchedulesForBrowser({
      schedules,
      teams,
      filters: { ...emptyScheduleBrowserFilters, teamId: "team-music" },
    });
    expect(rows[0].teamName).toBe("Praise Team");
  });
});
