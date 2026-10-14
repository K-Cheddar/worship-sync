const APP_ACCESS_LABELS = {
  full: "Full access",
  music: "Music access",
  view: "View access",
  none: "None",
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
 *   controllerAccess?: string,
 *   appAccess?: string,
 *   permissions?: { teams?: string, services?: string, teamScopes?: Record<string, string> },
 *   scopedTeamNames?: string[],
 * }} params
 * @returns {string[]}
 */
export const buildInviteAcceptedAccessLines = ({
  role,
  controllerAccess,
  appAccess,
  permissions,
  scopedTeamNames = [],
} = {}) => {
  const isAdmin = role === "admin";
  const normalizedControllerAccess =
    controllerAccess || (appAccess === "member" ? "none" : appAccess) || "full";
  const accessLabel = isAdmin
    ? "Admin"
    : normalizedControllerAccess === "none"
      ? "None"
      : APP_ACCESS_LABELS[normalizedControllerAccess] || APP_ACCESS_LABELS.full;
  const teamsAccess = isAdmin ? "edit" : permissions?.teams || "none";
  const servicesAccess = isAdmin ? "edit" : permissions?.services || "none";
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

  const servicesLabel =
    servicesAccess === "edit"
      ? "Edit services and plans"
      : servicesAccess === "view"
        ? "View services"
        : "No service access";

  return [
    `${isAdmin ? "Role" : "Controller"}: ${accessLabel}`,
    `Teams: ${teamsLabel}`,
    `Services: ${servicesLabel}`,
  ];
};

export const listEditableTeamScopeIds = getEditableTeamScopeIds;
