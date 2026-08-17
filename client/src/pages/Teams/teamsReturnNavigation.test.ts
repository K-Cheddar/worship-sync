import {
  TEAMS_RETURN_STORAGE_KEY,
  TEAMS_SECTION_PATHS,
  buildGroupsReturnTo,
  buildPlansReturnTo,
  buildPlanToScheduleNavigationState,
  buildScheduleReturnTo,
  buildSectionReturnTo,
  buildTeamScopedReturnTo,
  buildTeamsMemberEditPath,
  buildTeamsPositionEditPath,
  buildTeamsQualificationsPath,
  buildTeamsReturnNavigationState,
  buildTeamsRolesPath,
  buildTeamsRestoreNavigationState,
  clearPersistedTeamsReturnTo,
  clearTeamsRestoreFromState,
  persistTeamsReturnTo,
  readPersistedTeamsReturnTo,
  readTeamsRestore,
  readTeamsReturnTo,
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

describe("teamsReturnNavigation readers and builders", () => {
  it("reads returnTo and restore payloads from navigation state", () => {
    expect(readTeamsReturnTo(null)).toBeNull();
    expect(readTeamsReturnTo({ teamsReturnTo: { label: "x" } })).toBeNull();
    expect(
      readTeamsReturnTo({
        teamsReturnTo: {
          label: "Back",
          pathname: TEAMS_SECTION_PATHS.schedules,
        },
      }),
    ).toEqual({
      label: "Back",
      pathname: TEAMS_SECTION_PATHS.schedules,
    });

    expect(readTeamsRestore(null)).toBeNull();
    expect(readTeamsRestore({ teamsRestore: { kind: "unknown" } })).toBeNull();
    expect(
      readTeamsRestore({
        teamsRestore: { kind: "schedule", scheduleId: "s1" },
      }),
    ).toEqual({ kind: "schedule", scheduleId: "s1" });
    expect(
      readTeamsRestore({
        teamsRestore: { kind: "groups", editTeamId: "t1" },
      }),
    ).toEqual({ kind: "groups", editTeamId: "t1" });
    expect(
      readTeamsRestore({
        teamsRestore: {
          kind: "plans",
          serviceId: "svc",
          occurrenceId: "occ",
          date: "2026-08-01",
        },
      }),
    ).toEqual({
      kind: "plans",
      serviceId: "svc",
      occurrenceId: "occ",
      date: "2026-08-01",
    });
    expect(
      readTeamsRestore({
        teamsRestore: {
          kind: "teamScoped",
          section: "positions",
          teamId: "t1",
        },
      }),
    ).toEqual({ kind: "teamScoped", section: "positions", teamId: "t1" });
  });

  it("builds section, plans, groups, and team-scoped return targets", () => {
    expect(buildSectionReturnTo(TEAMS_SECTION_PATHS.members).pathname).toBe(
      TEAMS_SECTION_PATHS.members,
    );
    expect(
      buildScheduleReturnTo({
        scheduleId: "s1",
        activeSlot: { occurrenceId: "occ-1", columnKey: "p1::0" },
        slotPickerMode: "replace",
        membersPanelOpen: true,
      }).restore,
    ).toEqual({
      kind: "schedule",
      scheduleId: "s1",
      activeSlot: { occurrenceId: "occ-1", columnKey: "p1::0" },
      slotPickerMode: "replace",
      membersPanelOpen: true,
    });
    expect(
      buildPlansReturnTo({
        serviceId: "svc",
        occurrenceId: "occ",
        date: "2026-08-01",
      }).restore,
    ).toEqual({
      kind: "plans",
      serviceId: "svc",
      occurrenceId: "occ",
      date: "2026-08-01",
    });
    expect(buildGroupsReturnTo("team-1").restore).toEqual({
      kind: "groups",
      editTeamId: "team-1",
    });
    expect(buildTeamScopedReturnTo("roles", "team-2").restore).toEqual({
      kind: "teamScoped",
      section: "roles",
      teamId: "team-2",
    });
    expect(buildTeamsMemberEditPath("m1")).toContain("editMember=m1");
    expect(buildTeamsRolesPath("t1")).toContain("teamId=t1");
    expect(buildTeamsQualificationsPath("t1")).toContain("teamId=t1");
  });

  it("builds and clears restore-only navigation state", () => {
    const withRestore = buildTeamsRestoreNavigationState({
      kind: "schedule",
      scheduleId: "s1",
    });
    expect(withRestore.teamsRestore).toEqual({
      kind: "schedule",
      scheduleId: "s1",
    });
    expect(
      clearTeamsRestoreFromState({
        teamsReturnTo: {
          label: "Back",
          pathname: TEAMS_SECTION_PATHS.schedules,
        },
        teamsRestore: { kind: "schedule", scheduleId: "s1" },
      }),
    ).toEqual({
      teamsReturnTo: {
        label: "Back",
        pathname: TEAMS_SECTION_PATHS.schedules,
      },
    });
    expect(
      buildPlanToScheduleNavigationState({
        returnTo: buildPlansReturnTo({
          serviceId: "svc",
          occurrenceId: "occ",
          date: "2026-08-01",
        }),
        restore: { kind: "schedule", scheduleId: "s1" },
      }).teamsRestore,
    ).toEqual({ kind: "schedule", scheduleId: "s1" });
  });
});
