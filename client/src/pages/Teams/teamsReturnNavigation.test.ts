import {
  TEAMS_RETURN_STORAGE_KEY,
  TEAMS_SECTION_PATHS,
  buildScheduleReturnTo,
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

  it("stores destination pathname when building return navigation state", () => {
    const returnTo = buildScheduleReturnTo({ scheduleId: "sched-1" });

    buildTeamsReturnNavigationState(returnTo, TEAMS_SECTION_PATHS.members);

    expect(readPersistedTeamsReturnTo(TEAMS_SECTION_PATHS.members)).toEqual(
      returnTo,
    );
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

  it("clearPersistedTeamsReturnTo removes stored navigation", () => {
    const returnTo = buildScheduleReturnTo({ scheduleId: "sched-1" });
    persistTeamsReturnTo(returnTo, TEAMS_SECTION_PATHS.members);

    clearPersistedTeamsReturnTo();

    expect(readPersistedTeamsReturnTo(TEAMS_SECTION_PATHS.members)).toBeNull();
  });
});
