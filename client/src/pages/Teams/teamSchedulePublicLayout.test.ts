import {
  readTeamSchedulePublicLayout,
  TEAM_SCHEDULE_PUBLIC_LAYOUT_STORAGE_KEY,
  writeTeamSchedulePublicLayout,
} from "./teamSchedulePublicLayout";

describe("teamSchedulePublicLayout", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to byDate when nothing is stored", () => {
    expect(readTeamSchedulePublicLayout()).toBe("byDate");
  });

  it("reads and writes a valid layout preference", () => {
    writeTeamSchedulePublicLayout("byDate");
    expect(localStorage.getItem(TEAM_SCHEDULE_PUBLIC_LAYOUT_STORAGE_KEY)).toBe(
      "byDate",
    );
    expect(readTeamSchedulePublicLayout()).toBe("byDate");
  });

  it("falls back to byDate for unknown stored values", () => {
    localStorage.setItem(TEAM_SCHEDULE_PUBLIC_LAYOUT_STORAGE_KEY, "spiral");
    expect(readTeamSchedulePublicLayout()).toBe("byDate");
  });
});
