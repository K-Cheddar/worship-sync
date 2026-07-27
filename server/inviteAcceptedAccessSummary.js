const APP_ACCESS_LABELS = {
  full: "Full access",
  music: "Music access",
  view: "View access",
};

const getEditableTeamScopeIds = (permissions) =>
  Object.entries(permissions?.teamScopes || {})
    .filter(([, permission]) => permission === "edit")
    .map(([teamId]) => String(teamId || "").trim())
    .filter(Boolean)
    .sort();

/**
 * Builds human-readable permission lines for the invite-accepted admin email.
 * Labels match Account people access copy where practical.
 *
 * @param {{
 *   role?: string,
 *   appAccess?: string,
 *   permissions?: { teams?: string, teamScopes?: Record<string, string> },
 *   scopedTeamNames?: string[],
 * }} params
 * @returns {string[]}
 */
export const buildInviteAcceptedAccessLines = ({
  role,
  appAccess,
  permissions,
  scopedTeamNames = [],
} = {}) => {
  const isAdmin = role === "admin";
  const accessLabel = isAdmin
    ? "Admin"
    : APP_ACCESS_LABELS[appAccess] || APP_ACCESS_LABELS.full;
  const teamsAccess = isAdmin ? "edit" : permissions?.teams || "none";
  const scopedIds = isAdmin ? [] : getEditableTeamScopeIds(permissions);
  const names = scopedTeamNames
    .map((name) => String(name || "").trim())
    .filter(Boolean);
  const hasScopedEdit = scopedIds.length > 0;
  const namedScopedEdit = names.length > 0;

  let teamsLabel = "No Teams access";
  if (isAdmin || teamsAccess === "edit") {
    teamsLabel = "Edit all teams";
  } else if (!hasScopedEdit) {
    teamsLabel = teamsAccess === "view" ? "View all teams" : "No Teams access";
  } else if (namedScopedEdit) {
    const scopedEditLabel = `Can edit ${names.join(", ")}`;
    teamsLabel =
      teamsAccess === "view"
        ? `View all teams · ${scopedEditLabel}`
        : `${scopedEditLabel} only`;
  } else if (teamsAccess === "view") {
    teamsLabel = "View all teams + per-team edit";
  } else {
    teamsLabel = "Per-team edit only";
  }

  return [`Access: ${accessLabel}`, `Teams: ${teamsLabel}`];
};

export const listEditableTeamScopeIds = getEditableTeamScopeIds;
