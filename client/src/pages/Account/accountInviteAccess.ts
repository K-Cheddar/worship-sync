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

export const DEFAULT_INVITE_ACCESS_DRAFT: InviteAccessDraft = {
  access: "full",
  teamsAccess: "none",
  teamScopeIds: [],
};

export const inviteAccessOptions: {
  value: InviteAccessOption;
  label: string;
  role: string;
  appAccess: string;
}[] = [
  { value: "full", label: "Full access", role: "member", appAccess: "full" },
  { value: "music", label: "Music access", role: "member", appAccess: "music" },
  { value: "view", label: "View access", role: "member", appAccess: "view" },
  { value: "admin", label: "Admin", role: "admin", appAccess: "full" },
];

export const inviteAccessSelectOptions = inviteAccessOptions.map(
  ({ value, label }) => ({ value, label }),
);

export const toInviteAccessOption = (
  role?: string,
  appAccess?: string,
): InviteAccessOption => {
  if (role === "admin") {
    return "admin";
  }
  return toMemberAccessOption(appAccess);
};

export const inviteAccessDraftFromInvite = (
  invite: Pick<InviteRecord, "role" | "appAccess" | "permissions">,
): InviteAccessDraft => ({
  access: toInviteAccessOption(invite.role, invite.appAccess),
  teamsAccess: toTeamsAccessOption(invite.permissions, invite.role),
  teamScopeIds: getEditableTeamScopeIds(invite.permissions),
});

export const buildPermissionsFromAccessDraft = (
  draft: Pick<InviteAccessDraft, "access" | "teamsAccess" | "teamScopeIds">,
): MemberPermissions => ({
  teams: draft.access === "admin" ? "edit" : draft.teamsAccess,
  teamScopes:
    draft.access === "admin" || draft.teamsAccess === "edit"
      ? {}
      : buildTeamScopesPermissions(draft.teamScopeIds),
});

export const resolveInviteAccessPayload = (
  draft: InviteAccessDraft,
): {
  role: string;
  appAccess: string;
  permissions: MemberPermissions;
} => {
  const selectedInviteOption =
    inviteAccessOptions.find((option) => option.value === draft.access) ||
    inviteAccessOptions[0];
  return {
    role: selectedInviteOption.role,
    appAccess: selectedInviteOption.appAccess,
    permissions: buildPermissionsFromAccessDraft(draft),
  };
};

export const getInviteAccessSummaryLabel = (draft: InviteAccessDraft) => {
  const accessLabel =
    inviteAccessOptions.find((option) => option.value === draft.access)
      ?.label || "Full access";
  if (draft.access === "admin") {
    return `${accessLabel} · Edit all teams`;
  }
  if (draft.teamsAccess === "edit") {
    return `${accessLabel} · Edit all teams`;
  }
  if (draft.teamsAccess === "view") {
    if (draft.teamScopeIds.length > 0) {
      return `${accessLabel} · View all teams + per-team edit`;
    }
    return `${accessLabel} · View all teams`;
  }
  if (draft.teamScopeIds.length > 0) {
    return `${accessLabel} · Per-team edit only`;
  }
  return `${accessLabel} · No Teams access`;
};

export const scopedTeamsHelperText = (
  teamsAccess: TeamsPermission,
  hasScopedTeams: boolean,
) => {
  if (teamsAccess === "none" && hasScopedTeams) {
    return "This person can open Teams only for checked teams. Global Teams access stays off.";
  }
  if (teamsAccess === "view" && hasScopedTeams) {
    return "They can view every team, and edit only the checked teams below.";
  }
  if (teamsAccess === "none") {
    return "Check teams below to grant per-team edit access without enabling global Teams access.";
  }
  return "Optional. Add edit access for specific teams without changing global access above.";
};
