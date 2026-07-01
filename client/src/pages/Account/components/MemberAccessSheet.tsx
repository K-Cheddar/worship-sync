import { Save } from "lucide-react";
import Button from "../../../components/Button/Button";
import Drawer from "../../../components/Drawer";
import Select from "../../../components/Select/Select";
import {
  updateChurchInviteAccess,
  updateChurchMemberAccess,
} from "../../../api/auth";
import type { TeamsPermission } from "../../../api/authTypes";
import { ACCOUNT_CONTROL_SELECT_CLASSNAME } from "../../Controller/AccountFormSections";
import { useAccountPage } from "../AccountPageContext";
import {
  inviteAccessDraftFromInvite,
  inviteAccessSelectOptions,
  resolveInviteAccessPayload,
  scopedTeamsHelperText,
} from "../accountInviteAccess";
import { memberAccessOptions, toMemberAccessOption } from "../accountUtils";
import { teamsPageAccessOptions } from "../accountTeamsAccess";
import type {
  AccessSheetTarget,
  InviteAccessDraft,
  InviteAccessOption,
  MemberAccessOption,
} from "../accountTypes";
import { cn } from "@/utils/cnHelper";

const MemberAccessSheet = () => {
  const {
    churchId,
    teams,
    memberActionLoading,
    accessSheetTarget,
    inviteAccessDraft,
    setMemberAccessDrafts,
    setMemberTeamsAccessDrafts,
    setMemberTeamScopeDrafts,
    setInviteAccessDraft,
    setInvitePendingAccessDrafts,
    runMemberAction,
    showStatus,
    refresh,
    closeAccessSheet,
    getMemberAccessValue,
    getMemberTeamsAccessValue,
    getMemberTeamScopeValue,
    getInvitePendingAccessValue,
    toTeamsAccessOption,
    buildTeamScopesPermissions,
    getEditableTeamScopeIds,
  } = useAccountPage();

  const target = accessSheetTarget;
  const isOpen = target !== null;

  if (!target) {
    return (
      <Drawer
        isOpen={false}
        onClose={closeAccessSheet}
        title="Edit access"
        position="right"
        size="lg"
        showBackdrop
        contentPadding="p-0"
        contentClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
      />
    );
  }

  const isMemberTarget = target.kind === "member";
  const isInviteDraftTarget = target.kind === "invite-draft";
  const isInviteTarget = target.kind === "invite";
  const member = isMemberTarget ? target.member : null;
  const invite = isInviteTarget ? target.invite : null;

  const memberUser = member?.user;
  const memberEmail = memberUser?.primaryEmail || memberUser?.email || "";
  const memberLabel = memberUser?.displayName || memberEmail || "Unknown user";
  const targetUserId = memberUser?.uid || member?.userId || "";
  const inviteDraft = invite ? getInvitePendingAccessValue(invite) : inviteAccessDraft;

  const selectedMemberAccess = member ? getMemberAccessValue(member) : "full";
  const selectedInviteAccess = inviteDraft.access;
  const selectedAccess = isMemberTarget ? selectedMemberAccess : selectedInviteAccess;
  const currentMemberAccess = member
    ? toMemberAccessOption(member.appAccess)
    : "full";
  const currentTeamsAccess = member
    ? toTeamsAccessOption(member.permissions, member.role)
    : inviteDraft.teamsAccess;
  const selectedTeamsAccess = member
    ? getMemberTeamsAccessValue(member)
    : inviteDraft.teamsAccess;
  const currentTeamScopeIds = member
    ? getEditableTeamScopeIds(member.permissions)
    : inviteDraft.teamScopeIds;
  const selectedTeamScopeIds = member
    ? getMemberTeamScopeValue(member)
    : inviteDraft.teamScopeIds;

  const inviteBaseline = invite ? inviteAccessDraftFromInvite(invite) : null;

  const memberAccessChanged =
    isMemberTarget && selectedMemberAccess !== currentMemberAccess;
  const memberTeamsAccessChanged =
    isMemberTarget && selectedTeamsAccess !== currentTeamsAccess;
  const memberTeamScopesChanged =
    isMemberTarget &&
    [...selectedTeamScopeIds].sort().join("|") !==
    [...currentTeamScopeIds].sort().join("|");
  const inviteAccessChanged =
    isInviteTarget &&
    inviteBaseline !== null &&
    JSON.stringify(inviteDraft) !== JSON.stringify(inviteBaseline);

  const hasChanges = isInviteDraftTarget
    ? true
    : isMemberTarget
      ? memberAccessChanged ||
      memberTeamsAccessChanged ||
      memberTeamScopesChanged
      : inviteAccessChanged;

  const saveAccessKey = member
    ? `save-access:${member.membershipId}`
    : invite
      ? `save-invite-access:${invite.inviteId}`
      : "save-invite-draft";
  const isSaving = Boolean(memberActionLoading[saveAccessKey]);
  const showPerTeamSection =
    selectedTeamsAccess !== "edit" &&
    teams.length > 0 &&
    (isMemberTarget || selectedInviteAccess !== "admin");
  const isAdminInviteAccess = !isMemberTarget && selectedInviteAccess === "admin";

  const headerTitle = isMemberTarget
    ? memberLabel
    : isInviteTarget
      ? invite?.email || "Pending invite"
      : "New invite";
  const headerEmail = isMemberTarget ? memberEmail : "";
  const headerDescription = isMemberTarget
    ? "Set WorshipSync app access and Teams permissions for this member."
    : isInviteTarget
      ? "Update access before this invite is accepted."
      : "Choose app access and Teams permissions for the new invite.";

  const clearMemberDrafts = (membershipId: string) => {
    setMemberAccessDrafts((prev) => {
      const next = { ...prev };
      delete next[membershipId];
      return next;
    });
    setMemberTeamsAccessDrafts((prev) => {
      const next = { ...prev };
      delete next[membershipId];
      return next;
    });
    setMemberTeamScopeDrafts((prev) => {
      const next = { ...prev };
      delete next[membershipId];
      return next;
    });
  };

  const handleClose = () => {
    if (member) {
      clearMemberDrafts(member.membershipId);
    }
    if (invite) {
      setInvitePendingAccessDrafts((prev) => {
        const next = { ...prev };
        delete next[invite.inviteId];
        return next;
      });
    }
    closeAccessSheet();
  };

  const updateInviteDraft = (patch: Partial<InviteAccessDraft>) => {
    if (isInviteDraftTarget) {
      setInviteAccessDraft((prev) => ({ ...prev, ...patch }));
      return;
    }
    if (invite) {
      setInvitePendingAccessDrafts((prev) => ({
        ...prev,
        [invite.inviteId]: {
          ...(prev[invite.inviteId] || getInvitePendingAccessValue(invite)),
          ...patch,
        },
      }));
    }
  };

  const handleSave = () => {
    if (isInviteDraftTarget) {
      closeAccessSheet();
      return;
    }

    if (isMemberTarget) {
      if (!targetUserId) {
        return;
      }
      void runMemberAction(saveAccessKey, async () => {
        await updateChurchMemberAccess(churchId, targetUserId, selectedMemberAccess, {
          teams: selectedTeamsAccess,
          teamScopes:
            selectedTeamsAccess === "edit"
              ? {}
              : buildTeamScopesPermissions(selectedTeamScopeIds),
        });
        clearMemberDrafts(member!.membershipId);
        showStatus(`Updated access for ${memberLabel}.`);
        await refresh();
        closeAccessSheet();
      });
      return;
    }

    if (invite) {
      void runMemberAction(saveAccessKey, async () => {
        await updateChurchInviteAccess(
          churchId,
          invite.inviteId,
          resolveInviteAccessPayload(inviteDraft),
        );
        setInvitePendingAccessDrafts((prev) => {
          const next = { ...prev };
          delete next[invite.inviteId];
          return next;
        });
        showStatus(`Updated access for ${invite.email}.`);
        await refresh();
        closeAccessSheet();
      });
    }
  };

  const handleAppAccessChange = (value: string) => {
    if (isMemberTarget && member) {
      setMemberAccessDrafts((prev) => ({
        ...prev,
        [member.membershipId]: value as MemberAccessOption,
      }));
      return;
    }

    const nextAccess = value as InviteAccessOption;
    updateInviteDraft({
      access: nextAccess,
      ...(nextAccess === "admin"
        ? { teamsAccess: "edit" as TeamsPermission, teamScopeIds: [] }
        : {}),
    });
  };

  const handleTeamsAccessChange = (value: TeamsPermission) => {
    if (isMemberTarget && member) {
      setMemberTeamsAccessDrafts((prev) => ({
        ...prev,
        [member.membershipId]: value,
      }));
      if (value === "edit") {
        setMemberTeamScopeDrafts((prev) => {
          const next = { ...prev };
          delete next[member.membershipId];
          return next;
        });
      }
      return;
    }

    updateInviteDraft({
      teamsAccess: value,
      ...(value === "edit" ? { teamScopeIds: [] } : {}),
    });
  };

  const handleTeamScopeToggle = (
    teamId: string,
    checked: boolean,
    baselineTeamScopeIds: string[],
  ) => {
    if (isMemberTarget && member) {
      setMemberTeamScopeDrafts((prev) => {
        const current = prev[member.membershipId] || baselineTeamScopeIds;
        const next = checked
          ? Array.from(new Set([...current, teamId]))
          : current.filter((id) => id !== teamId);
        return {
          ...prev,
          [member.membershipId]: next,
        };
      });
      return;
    }

    updateInviteDraft({
      teamScopeIds: checked
        ? Array.from(new Set([...selectedTeamScopeIds, teamId]))
        : selectedTeamScopeIds.filter((id) => id !== teamId),
    });
  };

  const appAccessFieldId = getAppAccessFieldId(target);
  const teamsAccessFieldId = getTeamsAccessFieldId(target);

  return (
    <Drawer
      isOpen={isOpen}
      onClose={handleClose}
      title="Edit access"
      position="right"
      size="lg"
      showBackdrop
      contentPadding="p-0"
      contentClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="space-y-1 border-b border-gray-700 px-5 py-4">
          <p className="text-base font-semibold text-white">{headerTitle}</p>
          {headerEmail ? (
            <p className="text-sm text-gray-400">{headerEmail}</p>
          ) : null}
          <p className="text-sm text-gray-300">{headerDescription}</p>
        </div>

        <div className="scrollbar-variable min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-white">App access</h3>
              <p className="mt-1 text-xs text-gray-400">
                Controls access to the controller and other WorshipSync surfaces.
              </p>
            </div>
            <Select
              id={appAccessFieldId}
              label="Access level"
              value={selectedAccess}
              options={
                isMemberTarget ? memberAccessOptions : inviteAccessSelectOptions
              }
              selectClassName={ACCOUNT_CONTROL_SELECT_CLASSNAME}
              onChange={handleAppAccessChange}
            />
          </section>

          <section className="space-y-3 border-t border-gray-700/70 pt-5">
            <div>
              <h3 className="text-sm font-semibold text-white">Teams</h3>
              <p className="mt-1 text-xs text-gray-400">
                Global access applies to the whole Teams area. Per-team checkboxes
                can grant edit access to specific teams without opening all of Teams.
              </p>
            </div>

            <Select
              id={teamsAccessFieldId}
              label="Global Teams access"
              value={isAdminInviteAccess ? "edit" : selectedTeamsAccess}
              options={teamsPageAccessOptions}
              selectClassName={ACCOUNT_CONTROL_SELECT_CLASSNAME}
              disabled={isAdminInviteAccess}
              onChange={(value) =>
                handleTeamsAccessChange(value as TeamsPermission)
              }
            />

            {selectedTeamsAccess === "edit" || isAdminInviteAccess ? (
              <p className="rounded-lg border border-cyan-500/30 bg-cyan-950/20 px-3 py-2 text-xs text-cyan-100/90">
                Edit all teams includes every team. Per-team rules are not used.
              </p>
            ) : null}

            {showPerTeamSection ? (
              <fieldset className="space-y-3 rounded-lg border border-gray-700 px-4 py-3">
                <legend className="px-1 text-sm font-medium text-gray-200">
                  Per-team edit access
                </legend>
                <p className="text-xs text-gray-400">
                  {scopedTeamsHelperText(
                    selectedTeamsAccess,
                    selectedTeamScopeIds.length > 0,
                  )}
                </p>
                <div className="flex flex-wrap gap-3">
                  {teams.map((team) => {
                    const checked = selectedTeamScopeIds.includes(team.teamId);
                    return (
                      <label
                        key={team.teamId}
                        className={cn(
                          "inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
                          checked
                            ? "border-cyan-500/40 bg-cyan-950/25 text-cyan-50"
                            : "border-gray-700 text-gray-200",
                        )}
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-cyan-500"
                          checked={checked}
                          onChange={(event) =>
                            handleTeamScopeToggle(
                              team.teamId,
                              event.target.checked,
                              currentTeamScopeIds,
                            )
                          }
                        />
                        <span>{team.name}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ) : null}
          </section>
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-gray-700 px-5 py-4">
          <Button type="button" variant="tertiary" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="cta"
            svg={Save}
            iconSize="sm"
            isLoading={isSaving}
            disabled={isSaving || !hasChanges}
            onClick={handleSave}
          >
            {isInviteDraftTarget ? "Apply access" : "Save access"}
          </Button>
        </div>
      </div>
    </Drawer>
  );
};

const getAppAccessFieldId = (target: AccessSheetTarget) => {
  if (target.kind === "member") {
    return `member-access-sheet-${target.member.membershipId}`;
  }
  if (target.kind === "invite") {
    return `invite-access-sheet-${target.invite.inviteId}`;
  }
  return "invite-draft-access-sheet";
};

const getTeamsAccessFieldId = (target: AccessSheetTarget) => {
  if (target.kind === "member") {
    return `member-teams-access-sheet-${target.member.membershipId}`;
  }
  if (target.kind === "invite") {
    return `invite-teams-access-sheet-${target.invite.inviteId}`;
  }
  return "invite-draft-teams-access-sheet";
};

export default MemberAccessSheet;
