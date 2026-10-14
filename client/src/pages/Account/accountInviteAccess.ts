import type { MemberPermissions, TeamsPermission } from "../../api/authTypes";
import type {
  InviteAccessDraft,
  InviteAccessOption,
  InviteRecord,
} from "./accountTypes";
import {
  buildTeamScopesPermissions,
  getEditableTeamScopeIds,
  toTeamsAccessOption,
} from "./accountTeamsAccess";
import { toMemberAccessOption } from "./accountUtils";
import { toServicesAccessOption } from "./accountServicesAccess";

export const DEFAULT_INVITE_ACCESS_DRAFT: InviteAccessDraft = {
  role: "member",
  controllerAccess: "full",
  teamsAccess: "none",
  servicesAccess: "none",
  teamScopeIds: [],
};

export const inviteAccessOptions: {
  value: InviteAccessOption;
  label: string;
}[] = [
  { value: "none", label: "None" },
  { value: "view", label: "View" },
  { value: "music", label: "Music" },
  { value: "full", label: "Full" },
];

export const inviteAccessSelectOptions = inviteAccessOptions.map(
  ({ value, label }) => ({ value, label }),
);

export const inviteAccessDraftFromInvite = (
  invite: Pick<InviteRecord, "role" | "controllerAccess" | "appAccess" | "permissions">,
): InviteAccessDraft => ({
  role: invite.role === "admin" ? "admin" : "member",
  controllerAccess:
    invite.role === "admin"
      ? "full"
      : toMemberAccessOption(invite.controllerAccess ?? invite.appAccess),
  teamsAccess: toTeamsAccessOption(invite.permissions, invite.role),
  servicesAccess: toServicesAccessOption(invite.permissions, invite.role),
  teamScopeIds: getEditableTeamScopeIds(invite.permissions),
});

export const buildPermissionsFromAccessDraft = (
  draft: Pick<
    InviteAccessDraft,
    "role" | "teamsAccess" | "servicesAccess" | "teamScopeIds"
  >,
): MemberPermissions => {
  return {
    teams: draft.role === "admin" ? "edit" : draft.teamsAccess,
    services: draft.role === "admin" ? "edit" : draft.servicesAccess,
    teamScopes:
      draft.role === "admin" || draft.teamsAccess === "edit"
        ? {}
        : buildTeamScopesPermissions(draft.teamScopeIds),
  };
};

export const resolveInviteAccessPayload = (
  draft: InviteAccessDraft,
): {
  role: string;
  controllerAccess: string;
  appAccess: string;
  permissions: MemberPermissions;
} => {
  const controllerAccess = draft.role === "admin" ? "full" : draft.controllerAccess;
  return {
    role: draft.role,
    controllerAccess,
    // Keep the old value aligned during rollout for older clients.
    appAccess: controllerAccess === "none" ? "member" : controllerAccess,
    permissions: buildPermissionsFromAccessDraft(draft),
  };
};

export const getInviteAccessSummaryLabel = (draft: InviteAccessDraft) => {
  if (draft.role === "admin") {
    return "Admin";
  }
  const parts = [
    draft.controllerAccess === "none" ? "No controller access" : `${draft.controllerAccess[0].toUpperCase()}${draft.controllerAccess.slice(1)} controller`,
  ];
  if (draft.teamsAccess === "edit") parts.push("Edit all teams");
  else if (draft.teamsAccess === "view") parts.push("View all teams");
  else if (draft.teamScopeIds.length > 0) parts.push("Selected team manager");
  if (draft.servicesAccess === "edit") parts.push("Edit services");
  else if (draft.servicesAccess === "view") parts.push("View services");
  return parts.join(" · ");
};

export const scopedTeamsHelperText = (
  _teamsAccess: TeamsPermission,
  _hasScopedTeams: boolean,
) => {
  return "Team membership gives read-only access automatically. Select teams here to let this person manage them. They don't need to be on a team's roster.";
};
