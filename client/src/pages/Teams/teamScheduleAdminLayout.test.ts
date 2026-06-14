import {
  readTeamScheduleAdminLayout,
  TEAM_SCHEDULE_ADMIN_LAYOUT_STORAGE_KEY,
  writeTeamScheduleAdminLayout,
} from "./teamScheduleAdminLayout";

describe("teamScheduleAdminLayout", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to the by-position layout when nothing is stored", () => {
    expect(readTeamScheduleAdminLayout()).toBe("transpose");
  });

  it("reads and writes a valid layout preference", () => {
    writeTeamScheduleAdminLayout("grid");
    expect(localStorage.getItem(TEAM_SCHEDULE_ADMIN_LAYOUT_STORAGE_KEY)).toBe(
      "grid",
    );
    expect(readTeamScheduleAdminLayout()).toBe("grid");
  });

  it("falls back to by-position for layouts the admin no longer offers", () => {
    localStorage.setItem(TEAM_SCHEDULE_ADMIN_LAYOUT_STORAGE_KEY, "byDate");
    expect(readTeamScheduleAdminLayout()).toBe("transpose");
  });

  it("falls back to by-position for unknown stored values", () => {
    localStorage.setItem(TEAM_SCHEDULE_ADMIN_LAYOUT_STORAGE_KEY, "zigzag");
    expect(readTeamScheduleAdminLayout()).toBe("transpose");
  });
});
