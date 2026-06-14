import { Save } from "lucide-react";
import Button from "../../../components/Button/Button";
import Drawer from "../../../components/Drawer";
import Select from "../../../components/Select/Select";
import { updateChurchMemberAccess } from "../../../api/auth";
import type { TeamsPermission } from "../../../api/authTypes";
import { ACCOUNT_CONTROL_SELECT_CLASSNAME } from "../../Controller/AccountFormSections";
import { useAccountPage } from "../AccountPageContext";
import { memberAccessOptions, toMemberAccessOption } from "../accountUtils";
import { teamsPageAccessOptions } from "../accountTeamsAccess";
import type { Member, MemberAccessOption } from "../accountTypes";
import { cn } from "@/utils/cnHelper";

type MemberAccessSheetProps = {
  member: Member | null;
  isOpen: boolean;
  onClose: () => void;
};

const scopedTeamsHelperText = (
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

const MemberAccessSheet = ({ member, isOpen, onClose }: MemberAccessSheetProps) => {
  const {
    churchId,
    teams,
    memberActionLoading,
    setMemberAccessDrafts,
    setMemberTeamsAccessDrafts,
    setMemberTeamScopeDrafts,
    runMemberAction,
    showStatus,
    refresh,
    getMemberAccessValue,
    getMemberTeamsAccessValue,
    getMemberTeamScopeValue,
    toTeamsAccessOption,
    buildTeamScopesPermissions,
    getEditableTeamScopeIds,
  } = useAccountPage();

  if (!member) {
    return (
      <Drawer
        isOpen={isOpen}
        onClose={onClose}
        title="Edit access"
        position="right"
        size="lg"
        showBackdrop
        contentPadding="p-0"
        contentClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
      />
    );
  }

  const memberUser = member.user;
  const memberEmail = memberUser?.primaryEmail || memberUser?.email || "";
  const memberLabel = memberUser?.displayName || memberEmail || "Unknown user";
  const targetUserId = memberUser?.uid || member.userId;
  const currentAccess = toMemberAccessOption(member.appAccess);
  const selectedAccess = getMemberAccessValue(member);
  const currentTeamsAccess = toTeamsAccessOption(member.permissions, member.role);
  const selectedTeamsAccess = getMemberTeamsAccessValue(member);
  const currentTeamScopeIds = getEditableTeamScopeIds(member.permissions);
  const selectedTeamScopeIds = getMemberTeamScopeValue(member);
  const accessChanged = selectedAccess !== currentAccess;
  const teamsAccessChanged = selectedTeamsAccess !== currentTeamsAccess;
  const teamScopesChanged =
    [...selectedTeamScopeIds].sort().join("|") !== currentTeamScopeIds.join("|");
  const hasChanges = accessChanged || teamsAccessChanged || teamScopesChanged;
  const saveAccessKey = `save-access:${member.membershipId}`;
  const isSaving = Boolean(memberActionLoading[saveAccessKey]);
  const showPerTeamSection = selectedTeamsAccess !== "edit" && teams.length > 0;

  const clearDrafts = () => {
    setMemberAccessDrafts((prev) => {
      const next = { ...prev };
      delete next[member.membershipId];
      return next;
    });
    setMemberTeamsAccessDrafts((prev) => {
      const next = { ...prev };
      delete next[member.membershipId];
      return next;
    });
    setMemberTeamScopeDrafts((prev) => {
      const next = { ...prev };
      delete next[member.membershipId];
      return next;
    });
  };

  const handleClose = () => {
    clearDrafts();
    onClose();
  };

  const handleSave = () => {
    if (!targetUserId) {
      return;
    }

    void runMemberAction(saveAccessKey, async () => {
      await updateChurchMemberAccess(churchId, targetUserId, selectedAccess, {
        teams: selectedTeamsAccess,
        teamScopes:
          selectedTeamsAccess === "edit"
            ? {}
            : buildTeamScopesPermissions(selectedTeamScopeIds),
      });
      clearDrafts();
      showStatus(`Updated access for ${memberLabel}.`);
      await refresh();
      onClose();
    });
  };

  const handleTeamsAccessChange = (value: TeamsPermission) => {
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
  };

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
          <p className="text-base font-semibold text-white">{memberLabel}</p>
          {memberEmail ? (
            <p className="text-sm text-gray-400">{memberEmail}</p>
          ) : null}
          <p className="text-sm text-gray-300">
            Set WorshipSync app access and Teams permissions for this member.
          </p>
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
              id={`member-access-sheet-${member.membershipId}`}
              label="Access level"
              value={selectedAccess}
              options={memberAccessOptions}
              selectClassName={ACCOUNT_CONTROL_SELECT_CLASSNAME}
              onChange={(value) =>
                setMemberAccessDrafts((prev) => ({
                  ...prev,
                  [member.membershipId]: value as MemberAccessOption,
                }))
              }
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
              id={`member-teams-access-sheet-${member.membershipId}`}
              label="Global Teams access"
              value={selectedTeamsAccess}
              options={teamsPageAccessOptions}
              selectClassName={ACCOUNT_CONTROL_SELECT_CLASSNAME}
              onChange={(value) =>
                handleTeamsAccessChange(value as TeamsPermission)
              }
            />

            {selectedTeamsAccess === "edit" ? (
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
                          onChange={(event) => {
                            setMemberTeamScopeDrafts((prev) => {
                              const current =
                                prev[member.membershipId] || currentTeamScopeIds;
                              const next = event.target.checked
                                ? Array.from(new Set([...current, team.teamId]))
                                : current.filter((teamId) => teamId !== team.teamId);
                              return {
                                ...prev,
                                [member.membershipId]: next,
                              };
                            });
                          }}
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
            Save access
          </Button>
        </div>
      </div>
    </Drawer>
  );
};

export default MemberAccessSheet;
