import { useCallback, useContext, useMemo, useState } from "react";
import Input from "../../../components/Input/Input";
import Select from "../../../components/Select/Select";
import TextArea from "../../../components/TextArea/TextArea";
import DeleteModal from "../../../components/Modal/DeleteModal";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { useToast } from "../../../context/toastContext";
import {
  archiveTeamRole,
  createTeamRole,
  deleteTeamRole,
  updateTeamRole,
  type TeamRolePayload,
} from "../../../api/auth";
import type { TeamRecord, TeamRole } from "../../../api/authTypes";
import generateRandomId from "../../../utils/generateRandomId";
import CreatePanel from "../CreatePanel";
import EntityListSearch from "../components/EntityListSearch";
import EntityRow from "../components/EntityRow";
import TeamsReturnToolbar from "../components/TeamsReturnToolbar";
import TeamsSectionReturnPrompt from "../components/TeamsSectionReturnPrompt";
import FormActionButtons from "../components/FormActionButtons";
import EntityFormDangerActions from "../components/EntityFormDangerActions";
import { showApiErrorToast } from "../../../utils/apiErrorToast";
import { isActive, roleMatchesListQuery } from "../teamsUtils";
import { formatTeamRoleSaveToast } from "../teamsSaveToasts";
import { TEAMS_SECTION_PATHS } from "../teamsReturnNavigation";
import { useTeamsReturnNavigation } from "../hooks/useTeamsReturnNavigation";
import { useTeamsNarrowViewport } from "../hooks/useTeamsNarrowViewport";
import { useTeamsUnsavedChanges } from "../hooks/useTeamsUnsavedChanges";
import { useTeamsNavigationGuard } from "../TeamsNavigationGuardContext";
import { useTeamsTeamSearchParam } from "../hooks/useTeamsTeamSearchParam";

// Key used to track an in-flight save for the create form, which has no role id
// yet. Existing roles are tracked by their own roleId.
const CREATE_SAVING_KEY = "__create__";

type TeamRoleManagerProps = {
  roles: TeamRole[];
  teams: TeamRecord[];
  canEdit: boolean;
  onSaved: (role: TeamRole, replaceId?: string) => void;
  onArchived: () => void;
  onRemoved: (roleId: string) => void;
};

const TeamRoleManager = ({
  roles,
  teams,
  canEdit,
  onSaved,
  onArchived,
  onRemoved,
}: TeamRoleManagerProps) => {
  const context = useContext(GlobalInfoContext);
  const { showToast } = useToast();
  const churchId = context?.churchId || "";
  const activeTeams = useMemo(() => teams.filter(isActive), [teams]);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [editing, setEditing] = useState<TeamRole | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deleting, setDeleting] = useState<TeamRole | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [draft, setDraft] = useState<TeamRolePayload>({
    teamId: "",
    name: "",
    description: "",
  });
  // Roles with a save currently in flight, keyed by roleId (or CREATE_SAVING_KEY
  // for a new role). Tracking per-editor keeps the Save spinner on the role
  // actually saving and lets editing continue back-to-back in the background.
  const [savingIds, setSavingIds] = useState<Set<string>>(() => new Set());
  const [listQuery, setListQuery] = useState("");
  const { returnTo, finishEditing } = useTeamsReturnNavigation();
  const { requestDiscardAction } = useTeamsNavigationGuard();
  const isNarrowViewport = useTeamsNarrowViewport();

  const applyTeamId = useCallback((nextTeamId: string) => {
    setSelectedTeamId(nextTeamId);
  }, []);

  useTeamsTeamSearchParam(
    activeTeams.map((team) => team.teamId),
    applyTeamId,
  );

  const teamId = selectedTeamId || activeTeams[0]?.teamId || "";
  const teamRoles = roles.filter((role) => role.teamId === teamId);
  const filteredTeamRoles = useMemo(
    () => teamRoles.filter((role) => roleMatchesListQuery(role, listQuery)),
    [teamRoles, listQuery],
  );

  const reset = () => {
    setEditing(null);
    setShowCreate(false);
    setDraft({ teamId: teamId, name: "", description: "" });
  };

  const cancelEditing = () => {
    finishEditing(reset);
  };

  const openRoleEditor = (role: TeamRole) => {
    setEditing(role);
    setSelectedTeamId(role.teamId);
    setShowCreate(true);
    setDraft({
      teamId: role.teamId,
      name: role.name,
      description: role.description || "",
    });
  };

  const selectRole = (role: TeamRole) => {
    if (editing?.roleId === role.roleId) return;
    requestDiscardAction(() => openRoleEditor(role));
  };

  const confirmDelete = async () => {
    if (!canEdit || !deleting) return;
    const role = deleting;
    if (role.roleId.startsWith("local-")) {
      onRemoved(role.roleId);
      setDeleting(null);
      return;
    }
    setDeleteBusy(true);
    onRemoved(role.roleId);
    try {
      await deleteTeamRole(churchId, role.roleId);
      setDeleting(null);
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not delete this role.");
      onSaved(role);
    } finally {
      setDeleteBusy(false);
    }
  };

  const submit = async () => {
    if (!canEdit) return;
    const roleTeamId = editing?.teamId || teamId;
    if (!roleTeamId) {
      showToast("Create a team first, then add its roles.", "neutral");
      return;
    }
    const wasEditing = editing;
    const savingKey = wasEditing?.roleId ?? CREATE_SAVING_KEY;
    // Ignore a repeat submit for the same editor while its save is pending —
    // this prevents a fast double-click on "Create" from making duplicates.
    if (savingIds.has(savingKey)) return;
    setSavingIds((prev) => new Set(prev).add(savingKey));
    const localRoleId = wasEditing?.roleId || `local-role-${generateRandomId()}`;
    const payload: TeamRolePayload = {
      teamId: roleTeamId,
      name: draft.name.trim(),
      description: draft.description || "",
    };
    const saveToastMessage = formatTeamRoleSaveToast(wasEditing, payload);
    const optimisticRole: TeamRole = {
      churchId,
      roleId: localRoleId,
      teamId: roleTeamId,
      name: payload.name,
      description: payload.description,
      archivedAt: wasEditing?.archivedAt || null,
    };
    const savedRecord = wasEditing
      ? { ...wasEditing, ...optimisticRole }
      : optimisticRole;
    onSaved(savedRecord);
    try {
      const response = wasEditing
        ? await updateTeamRole(churchId, wasEditing.roleId, payload)
        : await createTeamRole(churchId, payload);
      if (!wasEditing) {
        onSaved(response.role, localRoleId);
      }
      showToast(saveToastMessage, "success");
      // Cross-section return, or mobile where the form covers the list: close.
      // On desktop, keep the panel open for back-to-back editing.
      if (returnTo || isNarrowViewport) {
        finishEditing(reset);
      } else if (wasEditing) {
        // The operator may have switched to a different role while this save was
        // in flight. Only refresh the selected record if they're still on the
        // one we just saved, so the panel never rebinds to a stale role.
        setEditing((current) =>
          current?.roleId === wasEditing.roleId ? savedRecord : current,
        );
      } else {
        // Newly created: adopt the saved record so a subsequent Save updates it
        // instead of creating a duplicate — but only if the create form is still
        // the active editor and the operator hasn't selected another role.
        const created = response.role;
        setEditing((current) => (current === null ? created : current));
      }
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not save this role.");
      onArchived();
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(savingKey);
        return next;
      });
    }
  };

  // The panel shows one editor at a time; its Save state reflects only the role
  // currently open, so a background save elsewhere never spins or disables it.
  const currentEditorKey = editing ? editing.roleId : CREATE_SAVING_KEY;
  const isSavingCurrent = savingIds.has(currentEditorKey);
  const hasPendingChanges = editing
    ? JSON.stringify(draft) !==
      JSON.stringify({
        teamId: editing.teamId,
        name: editing.name,
        description: editing.description || "",
      })
    : JSON.stringify(draft) !==
      JSON.stringify({ teamId, name: "", description: "" });
  useTeamsUnsavedChanges(hasPendingChanges);

  return (
    <>
      <CreatePanel
        open={showCreate}
        onOpenCreate={() => {
          reset();
          setShowCreate(true);
        }}
        canEdit={canEdit}
        title={editing ? "Edit role" : "Create role"}
        sectionTitle="Team roles"
        description="Define team roles for members."
        createLabel="Create role"
        scrollableList
        listToolbar={
          activeTeams.length === 0 ? (
            returnTo && !showCreate ? (
              <TeamsReturnToolbar returnTo={returnTo} onBack={() => finishEditing()} />
            ) : (
              <TeamsSectionReturnPrompt
                message="Create a team first — roles belong to a team."
                originSection={TEAMS_SECTION_PATHS.roles}
              />
            )
          ) : (
            <div className="space-y-3">
              {returnTo && !showCreate ? (
                <TeamsReturnToolbar returnTo={returnTo} onBack={() => finishEditing()} />
              ) : null}
              <Select
                label="Team"
                value={teamId}
                onChange={(value) => {
                  setSelectedTeamId(value);
                  if (editing) reset();
                }}
                options={activeTeams.map((team) => ({
                  label: team.name,
                  value: team.teamId,
                }))}
              />
              {teamRoles.length > 0 ? (
                <EntityListSearch
                  label="Roles"
                  value={listQuery}
                  onChange={setListQuery}
                />
              ) : null}
            </div>
          )
        }
        list={
          <>
            {activeTeams.length === 0 ? (
              <TeamsSectionReturnPrompt
                message="Create a team first — roles belong to a team."
                originSection={TEAMS_SECTION_PATHS.roles}
              />
            ) : (
              <>
                {teamRoles.length === 0 ? (
                  <p className="text-sm text-gray-300">No roles in this team yet.</p>
                ) : null}
                {teamRoles.length > 0 && filteredTeamRoles.length === 0 ? (
                  <p className="text-sm text-gray-300">No matches.</p>
                ) : null}
                {filteredTeamRoles.map((role) => (
                  <EntityRow
                    key={role.roleId}
                    title={role.name}
                    subtitle={role.description || undefined}
                    archived={Boolean(role.archivedAt)}
                    compact
                    canEdit={canEdit}
                    onTitleClick={() => selectRole(role)}
                  />
                ))}
              </>
            )}
          </>
        }
        formHeaderActions={
          editing || returnTo ? (
            <TeamsReturnToolbar returnTo={returnTo} onBack={cancelEditing}>
              {editing ? (
                <EntityFormDangerActions
                  archived={Boolean(editing.archivedAt)}
                  canEdit={canEdit}
                  archiveLabel="Archive role"
                  deleteLabel="Delete role"
                  menuLabel="Role actions"
                  onArchive={
                    editing.archivedAt
                      ? undefined
                      : async () => {
                        const archivedRole = {
                          ...editing,
                          archivedAt: new Date().toISOString(),
                        };
                        onSaved(archivedRole);
                        try {
                          await archiveTeamRole(churchId, editing.roleId);
                          finishEditing(reset);
                        } catch (error) {
                          showApiErrorToast(showToast, error, "Could not archive this role.");
                          onSaved(editing);
                        }
                      }
                  }
                  onDelete={() => setDeleting(editing)}
                />
              ) : null}
            </TeamsReturnToolbar>
          ) : null
        }
        formFooter={
          <FormActionButtons
            pinFooter
            saveLabel="Save role"
            onSave={() => void submit()}
            onCancel={cancelEditing}
            hasPendingChanges={hasPendingChanges}
            disabled={!canEdit || !draft.name.trim() || isSavingCurrent}
            isLoading={isSavingCurrent}
          />
        }
      >
        <p className="text-xs text-gray-400">
          Adding to{" "}
          <span className="font-semibold text-gray-200">
            {activeTeams.find((team) => team.teamId === (editing?.teamId || teamId))?.name ||
              "a team"}
          </span>
          .
        </p>
        <Input
          label="Name"
          value={draft.name}
          onChange={(name) => setDraft((current) => ({ ...current, name: String(name) }))}
        />
        <TextArea
          label="Description"
          value={draft.description || ""}
          textareaClassName="min-h-20"
          onChange={(description) =>
            setDraft((current) => ({ ...current, description }))
          }
        />
      </CreatePanel>
      <DeleteModal
        isOpen={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
        itemName={deleting?.name}
        isConfirming={deleteBusy}
        message="Permanently delete the role"
        warningMessage="This cannot be undone. Archive instead if you only want to hide it."
      />
    </>
  );
};

export default TeamRoleManager;
