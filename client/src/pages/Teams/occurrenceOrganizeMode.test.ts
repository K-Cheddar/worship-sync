import {
  readPlansOrganizeMode,
  readScheduleOrganizeMode,
  TEAMS_PLANS_ORGANIZE_STORAGE_KEY,
  TEAM_SCHEDULE_ORGANIZE_STORAGE_KEY,
  writePlansOrganizeMode,
  writeScheduleOrganizeMode,
} from "./occurrenceOrganizeMode";

describe("occurrenceOrganizeMode", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults plans to by date and schedule to by service", () => {
    expect(readPlansOrganizeMode()).toBe("byDate");
    expect(readScheduleOrganizeMode()).toBe("byService");
  });

  it("persists plans and schedule preferences independently", () => {
    writePlansOrganizeMode("byService");
    writeScheduleOrganizeMode("byDate");

    expect(localStorage.getItem(TEAMS_PLANS_ORGANIZE_STORAGE_KEY)).toBe(
      "byService",
    );
    expect(localStorage.getItem(TEAM_SCHEDULE_ORGANIZE_STORAGE_KEY)).toBe(
      "byDate",
    );
    expect(readPlansOrganizeMode()).toBe("byService");
    expect(readScheduleOrganizeMode()).toBe("byDate");
  });

  it("ignores invalid stored values", () => {
    localStorage.setItem(TEAMS_PLANS_ORGANIZE_STORAGE_KEY, "by-week");
    localStorage.setItem(TEAM_SCHEDULE_ORGANIZE_STORAGE_KEY, "by-week");
    expect(readPlansOrganizeMode()).toBe("byDate");
    expect(readScheduleOrganizeMode()).toBe("byService");
  });
});
