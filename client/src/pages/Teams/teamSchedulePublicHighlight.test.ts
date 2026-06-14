import {
  readTeamSchedulePublicHighlight,
  TEAM_SCHEDULE_PUBLIC_HIGHLIGHT_STORAGE_KEY,
  writeTeamSchedulePublicHighlight,
} from "./teamSchedulePublicHighlight";

describe("teamSchedulePublicHighlight", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to empty when nothing is stored", () => {
    expect(readTeamSchedulePublicHighlight()).toBe("");
  });

  it("reads and writes a highlighted member id", () => {
    writeTeamSchedulePublicHighlight("member_42");
    expect(
      localStorage.getItem(TEAM_SCHEDULE_PUBLIC_HIGHLIGHT_STORAGE_KEY),
    ).toBe("member_42");
    expect(readTeamSchedulePublicHighlight()).toBe("member_42");
  });

  it("clears storage when highlight is removed", () => {
    writeTeamSchedulePublicHighlight("member_42");
    writeTeamSchedulePublicHighlight("");
    expect(
      localStorage.getItem(TEAM_SCHEDULE_PUBLIC_HIGHLIGHT_STORAGE_KEY),
    ).toBeNull();
    expect(readTeamSchedulePublicHighlight()).toBe("");
  });
});
