import {
  TEAMS_RETURN_STORAGE_KEY,
  TEAMS_SECTION_PATHS,
  buildScheduleReturnTo,
  buildTeamsPositionEditPath,
  buildTeamsReturnNavigationState,
  clearPersistedTeamsReturnTo,
  persistTeamsReturnTo,
  readPersistedTeamsReturnTo,
  teamsRoutePathname,
} from "./teamsReturnNavigation";

describe("teamsReturnNavigation persistence", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("scopes persisted returnTo to the destination section pathname", () => {
    const returnTo = buildScheduleReturnTo({ scheduleId: "sched-1" });

    persistTeamsReturnTo(returnTo, TEAMS_SECTION_PATHS.members);

    expect(readPersistedTeamsReturnTo(TEAMS_SECTION_PATHS.members)).toEqual(
      returnTo,
    );
    expect(
      readPersistedTeamsReturnTo(TEAMS_SECTION_PATHS.positions),
    ).toBeNull();
    expect(sessionStorage.getItem(TEAMS_RETURN_STORAGE_KEY)).toBeNull();
  });

  it("builds return navigation state without persisting it", () => {
    const returnTo = buildScheduleReturnTo({ scheduleId: "sched-1" });

    expect(buildTeamsReturnNavigationState(returnTo)).toEqual({
      teamsReturnTo: returnTo,
    });

    expect(readPersistedTeamsReturnTo(TEAMS_SECTION_PATHS.members)).toBeNull();
  });

  it("clears legacy unscoped sessionStorage payloads", () => {
    sessionStorage.setItem(
      TEAMS_RETURN_STORAGE_KEY,
      JSON.stringify({
        label: "Back to schedule",
        pathname: TEAMS_SECTION_PATHS.schedules,
      }),
    );

    expect(readPersistedTeamsReturnTo(TEAMS_SECTION_PATHS.members)).toBeNull();
    expect(sessionStorage.getItem(TEAMS_RETURN_STORAGE_KEY)).toBeNull();
  });

  it("extracts route pathname without query params", () => {
    expect(
      teamsRoutePathname(`${TEAMS_SECTION_PATHS.positions}?teamId=team-1`),
    ).toBe(TEAMS_SECTION_PATHS.positions);
  });

  it("builds a position edit path with team and position params", () => {
    expect(buildTeamsPositionEditPath("pos-1", "team-1")).toBe(
      `${TEAMS_SECTION_PATHS.positions}?teamId=team-1&editPosition=pos-1`,
    );
  });

  it("clearPersistedTeamsReturnTo removes stored navigation", () => {
    const returnTo = buildScheduleReturnTo({ scheduleId: "sched-1" });
    persistTeamsReturnTo(returnTo, TEAMS_SECTION_PATHS.members);

    clearPersistedTeamsReturnTo();

    expect(readPersistedTeamsReturnTo(TEAMS_SECTION_PATHS.members)).toBeNull();
  });
});
