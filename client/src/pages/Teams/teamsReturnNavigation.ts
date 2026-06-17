import type { ScheduleFocusedCell } from "./schedule/scheduleUtils";

export const TEAMS_RETURN_TO_STATE_KEY = "teamsReturnTo";
export const TEAMS_RESTORE_STATE_KEY = "teamsRestore";
export const TEAMS_RETURN_STORAGE_KEY = "worship-sync:teams-return-to";

/** Shared deep-link param for team-scoped sections (positions, roles, qualifications). */
export const TEAMS_TEAM_SEARCH_PARAM = "teamId";
export const TEAMS_MEMBER_EDIT_SEARCH_PARAM = "editMember";

export const TEAMS_SECTION_PATHS = {
  schedules: "/teams/schedules",
  members: "/teams/members",
  positions: "/teams/positions",
  groups: "/teams/groups",
  roles: "/teams/roles",
  qualifications: "/teams/qualifications",
  services: "/teams/services",
  forms: "/teams/forms",
} as const;

export type TeamsSectionPath =
  (typeof TEAMS_SECTION_PATHS)[keyof typeof TEAMS_SECTION_PATHS];

export type TeamsScheduleRestore = {
  kind: "schedule";
  scheduleId: string;
  activeSlot?: ScheduleFocusedCell;
  slotPickerMode?: "assign" | "replace";
  membersPanelOpen?: boolean;
};

export type TeamsGroupsRestore = {
  kind: "groups";
  editTeamId: string;
};

export type TeamsTeamScopedSection = "positions" | "roles" | "qualifications";

export type TeamsTeamScopedRestore = {
  kind: "teamScoped";
  section: TeamsTeamScopedSection;
  teamId?: string;
};

export type TeamsRestoreState =
  | TeamsScheduleRestore
  | TeamsGroupsRestore
  | TeamsTeamScopedRestore;

export type TeamsReturnTo = {
  label: string;
  pathname: TeamsSectionPath | string;
  restore?: TeamsRestoreState;
};

export type TeamsReturnNavigationState = {
  [TEAMS_RETURN_TO_STATE_KEY]?: TeamsReturnTo;
  [TEAMS_RESTORE_STATE_KEY]?: TeamsRestoreState;
};

type PersistedTeamsReturnNavigation = {
  returnTo: TeamsReturnTo;
  destinationPathname: string;
};

const isPersistedTeamsReturnNavigation = (
  value: unknown,
): value is PersistedTeamsReturnNavigation => {
  if (!value || typeof value !== "object") return false;
  const record = value as PersistedTeamsReturnNavigation;
  return (
    Boolean(record.destinationPathname) &&
    Boolean(record.returnTo?.pathname) &&
    Boolean(record.returnTo?.label)
  );
};

const SECTION_BACK_LABELS: Record<TeamsSectionPath, string> = {
  [TEAMS_SECTION_PATHS.schedules]: "Back to schedule",
  [TEAMS_SECTION_PATHS.members]: "Back to members",
  [TEAMS_SECTION_PATHS.positions]: "Back to positions",
  [TEAMS_SECTION_PATHS.groups]: "Back to teams",
  [TEAMS_SECTION_PATHS.roles]: "Back to team roles",
  [TEAMS_SECTION_PATHS.qualifications]: "Back to qualifications",
  [TEAMS_SECTION_PATHS.services]: "Back to services",
  [TEAMS_SECTION_PATHS.forms]: "Back to forms",
};

export const readTeamsReturnTo = (state: unknown): TeamsReturnTo | null => {
  if (!state || typeof state !== "object") return null;
  const returnTo = (state as TeamsReturnNavigationState)[
    TEAMS_RETURN_TO_STATE_KEY
  ];
  if (!returnTo?.pathname || !returnTo.label) return null;
  return returnTo;
};

export const readTeamsRestore = (state: unknown): TeamsRestoreState | null => {
  if (!state || typeof state !== "object") return null;
  const restore = (state as TeamsReturnNavigationState)[
    TEAMS_RESTORE_STATE_KEY
  ];
  if (!restore || typeof restore !== "object" || !("kind" in restore))
    return null;
  if (restore.kind === "schedule" && typeof restore.scheduleId === "string") {
    return restore;
  }
  if (restore.kind === "groups" && typeof restore.editTeamId === "string") {
    return restore;
  }
  if (
    restore.kind === "teamScoped" &&
    (restore.section === "positions" ||
      restore.section === "roles" ||
      restore.section === "qualifications")
  ) {
    return restore;
  }
  return null;
};

export const persistTeamsReturnTo = (
  returnTo: TeamsReturnTo,
  destinationPathname: string,
) => {
  try {
    const payload: PersistedTeamsReturnNavigation = {
      returnTo,
      destinationPathname,
    };
    sessionStorage.setItem(TEAMS_RETURN_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage may be unavailable in private mode.
  }
};

export const readPersistedTeamsReturnTo = (
  currentPathname: string,
): TeamsReturnTo | null => {
  try {
    const raw = sessionStorage.getItem(TEAMS_RETURN_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isPersistedTeamsReturnNavigation(parsed)) {
      clearPersistedTeamsReturnTo();
      return null;
    }
    if (parsed.destinationPathname !== currentPathname) {
      clearPersistedTeamsReturnTo();
      return null;
    }
    return parsed.returnTo;
  } catch {
    return null;
  }
};

export const clearPersistedTeamsReturnTo = () => {
  try {
    sessionStorage.removeItem(TEAMS_RETURN_STORAGE_KEY);
  } catch {
    // ignore
  }
};

export const buildTeamsReturnNavigationState = (
  returnTo: TeamsReturnTo,
  destinationPathname: string,
): TeamsReturnNavigationState => {
  persistTeamsReturnTo(returnTo, destinationPathname);
  return { [TEAMS_RETURN_TO_STATE_KEY]: returnTo };
};

/** Pathname portion of a Teams route (`/teams/members`, not query params). */
export const teamsRoutePathname = (to: string) => to.split("?")[0] ?? to;

export const buildTeamsRestoreNavigationState = (
  restore: TeamsRestoreState,
): TeamsReturnNavigationState => ({
  [TEAMS_RESTORE_STATE_KEY]: restore,
});

export const clearTeamsRestoreFromState = (
  state: unknown,
): TeamsReturnNavigationState | undefined => {
  if (!state || typeof state !== "object") return undefined;
  const nextState = { ...(state as TeamsReturnNavigationState) };
  delete nextState[TEAMS_RESTORE_STATE_KEY];
  return Object.keys(nextState).length > 0 ? nextState : undefined;
};

export const buildSectionReturnTo = (
  pathname: TeamsSectionPath,
  label = SECTION_BACK_LABELS[pathname],
): TeamsReturnTo => ({
  label,
  pathname,
});

export const buildScheduleReturnTo = ({
  scheduleId,
  activeSlot,
  slotPickerMode,
  membersPanelOpen,
  label = SECTION_BACK_LABELS[TEAMS_SECTION_PATHS.schedules],
}: {
  scheduleId: string;
  activeSlot?: ScheduleFocusedCell;
  slotPickerMode?: "assign" | "replace";
  membersPanelOpen?: boolean;
  label?: string;
}): TeamsReturnTo => ({
  label,
  pathname: TEAMS_SECTION_PATHS.schedules,
  restore: {
    kind: "schedule",
    scheduleId,
    activeSlot,
    slotPickerMode,
    membersPanelOpen,
  },
});

export const buildGroupsReturnTo = (editTeamId: string): TeamsReturnTo => ({
  label: SECTION_BACK_LABELS[TEAMS_SECTION_PATHS.groups],
  pathname: TEAMS_SECTION_PATHS.groups,
  restore: {
    kind: "groups",
    editTeamId,
  },
});

export const buildTeamScopedReturnTo = (
  section: TeamsTeamScopedSection,
  teamId: string,
): TeamsReturnTo => ({
  label: SECTION_BACK_LABELS[TEAMS_SECTION_PATHS[section]],
  pathname: TEAMS_SECTION_PATHS[section],
  restore: {
    kind: "teamScoped",
    section,
    teamId,
  },
});

export const buildTeamsMemberEditPath = (memberId: string) =>
  `${TEAMS_SECTION_PATHS.members}?${TEAMS_MEMBER_EDIT_SEARCH_PARAM}=${encodeURIComponent(memberId)}`;

export const buildTeamsTeamScopedPath = (
  section: TeamsTeamScopedSection,
  teamId: string,
) =>
  `${TEAMS_SECTION_PATHS[section]}?${TEAMS_TEAM_SEARCH_PARAM}=${encodeURIComponent(teamId)}`;

export const buildTeamsPositionsPath = (teamId: string) =>
  buildTeamsTeamScopedPath("positions", teamId);

export const buildTeamsRolesPath = (teamId: string) =>
  buildTeamsTeamScopedPath("roles", teamId);

export const buildTeamsQualificationsPath = (teamId: string) =>
  buildTeamsTeamScopedPath("qualifications", teamId);

export const teamScopedSectionPath = (section: TeamsTeamScopedSection) =>
  TEAMS_SECTION_PATHS[section];
