import type {
  MemberPermissions,
  TeamsPermission,
  TeamRecord,
} from "../../api/authTypes";

export type TeamsPageAccessOption = TeamsPermission;

export const teamsPageAccessOptions: {
  value: TeamsPageAccessOption;
  label: string;
}[] = [
  { value: "none", label: "No global Teams access" },
  { value: "view", label: "View all teams" },
  { value: "edit", label: "Edit all teams" },
];

const teamsPageAccessLabels: Record<TeamsPageAccessOption, string> = {
  none: "No global Teams access",
  view: "View all teams",
  edit: "Edit all teams",
};

export const getTeamsPageAccessLabel = (access: TeamsPageAccessOption) =>
  teamsPageAccessLabels[access];

export const toTeamsAccessOption = (
  permissions?: MemberPermissions,
  role?: string,
): TeamsPermission => {
  if (role === "admin") {
    return "edit";
  }
  return permissions?.teams || "none";
};

export const getEditableTeamScopeIds = (permissions?: MemberPermissions) =>
  Object.entries(permissions?.teamScopes || {})
    .filter(([, permission]) => permission === "edit")
    .map(([teamId]) => teamId)
    .sort();

export const buildTeamScopesPermissions = (teamIds: string[]) =>
  Object.fromEntries(teamIds.map((teamId) => [teamId, "edit" as const]));

export const getScopedEditTeamNames = (
  scopedTeamIds: string[],
  teams: TeamRecord[],
) => {
  const nameById = new Map(teams.map((team) => [team.teamId, team.name]));
  return scopedTeamIds
    .map((teamId) => nameById.get(teamId) || teamId)
    .filter(Boolean);
};

export const formatMemberTeamsAccessSummary = (
  teamsAccess: TeamsPageAccessOption,
  scopedTeamIds: string[],
  teams: TeamRecord[],
): string => {
  const scopedTeamNames = getScopedEditTeamNames(scopedTeamIds, teams);

  if (teamsAccess === "edit") {
    return "Edit all teams";
  }

  if (scopedTeamNames.length === 0) {
    if (teamsAccess === "view") {
      return "View all teams (read-only)";
    }
    return "No Teams access";
  }

  const scopedEditLabel = `Can edit ${scopedTeamNames.join(", ")}`;

  if (teamsAccess === "none") {
    return `${scopedEditLabel} only`;
  }

  return `View all teams · ${scopedEditLabel}`;
};
