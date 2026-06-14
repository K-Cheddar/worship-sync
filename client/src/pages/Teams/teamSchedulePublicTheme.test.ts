import {
  readTeamSchedulePublicTheme,
  TEAM_SCHEDULE_PUBLIC_THEME_STORAGE_KEY,
  writeTeamSchedulePublicTheme,
} from "./teamSchedulePublicTheme";

describe("teamSchedulePublicTheme", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to dark when nothing is stored", () => {
    expect(readTeamSchedulePublicTheme()).toBe("dark");
  });

  it("reads and writes the light theme preference", () => {
    writeTeamSchedulePublicTheme("light");
    expect(localStorage.getItem(TEAM_SCHEDULE_PUBLIC_THEME_STORAGE_KEY)).toBe(
      "light",
    );
    expect(readTeamSchedulePublicTheme()).toBe("light");
  });

  it("falls back to dark for unknown stored values", () => {
    localStorage.setItem(TEAM_SCHEDULE_PUBLIC_THEME_STORAGE_KEY, "sepia");
    expect(readTeamSchedulePublicTheme()).toBe("dark");
  });
});
