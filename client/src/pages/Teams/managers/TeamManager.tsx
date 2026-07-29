import { useContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Input from "../../../components/Input/Input";
import TextArea from "../../../components/TextArea/TextArea";
import DeleteModal from "../../../components/Modal/DeleteModal";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { useToast } from "../../../context/toastContext";
import {
  archiveTeam,
  createTeam,
  deleteTeam,
  updateTeam,
  type TeamPayload,
} from "../../../api/auth";
import type { TeamRecord, TeamPosition, TeamQualificationArea, TeamRole, TeamRosterMember } from "../../../api/authTypes";
import generateRandomId from "../../../utils/generateRandomId";
import CreatePanel from "../CreatePanel";
import EntityMultiSelect from "../EntityMultiSelect";
import EntityRow from "../components/EntityRow";
import FormActionButtons from "../components/FormActionButtons";
import EntityFormDangerActions from "../components/EntityFormDangerActions";
import TeamEditorRelatedSection from "../components/TeamEditorRelatedSection";
import TeamsReturnToolbar from "../components/TeamsReturnToolbar";
import PositionIconPicker from "../PositionIconPicker";
import { showApiErrorToast } from "../../../utils/apiErrorToast";
import { describeDeletionImpacts, memberName, sortPositionsByOrder } from "../teamsUtils";
import { formatTeamSaveToast } from "../teamsSaveToasts";
import {
  buildGroupsReturnTo,
  buildTeamsPositionsPath,
  buildTeamsQualificationsPath,
  buildTeamsRolesPath,
} from "../teamsReturnNavigation";
import { useTeamsRestoreOnMount, useTeamsReturnNavigation } from "../hooks/useTeamsReturnNavigation";
import { useTeamsNarrowViewport } from "../hooks/useTeamsNarrowViewport";
import type { TeamsData } from "../types";

// Key used to track an in-flight save for the create form, which has no team id
// yet. Existing teams are tracked by their own teamId.
const CREATE_SAVING_KEY = "__create__";

type TeamManagerProps = {
  teams: TeamRecord[];
  positions: TeamPosition[];
  roles: TeamRole[];
  qualificationAreas: TeamQualificationArea[];
  members: TeamRosterMember[];
  data: TeamsData;
  canEdit: boolean;
  onSaved: (team: TeamRecord, replaceId?: string) => void;
  onArchived: () => void;
  onRemoved: (teamId: string) => void;
};

const TeamManager = ({
  teams,
  positions,
  roles,
  qualificationAreas,
  members,
  data,
  canEdit,
  onSaved,
  onArchived,
  onRemoved,
}: TeamManagerProps) => {
  const context = useContext(GlobalInfoContext);
  const { showToast } = useToast();
  const churchId = context?.churchId || "";
  const [editing, setEditing] = useState<TeamRecord | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deleting, setDeleting] = useState<TeamRecord | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [draft, setDraft] = useState<TeamPayload>({
    name: "",
    description: "",
    icon: "",
    memberIds: [],
  });
  // Teams with a save currently in flight, keyed by teamId (or CREATE_SAVING_KEY
  // for a new team). Tracking per-editor keeps the Save spinner on the team
  // actually saving and lets editing continue back-to-back in the background.
  const [savingIds, setSavingIds] = useState<Set<string>>(() => new Set());
  const pendingEditTeamIdRef = useRef<string | null>(null);
  const { returnTo, finishEditing } = useTeamsReturnNavigation();
  const isNarrowViewport = useTeamsNarrowViewport();

  const editingTeamPositions = useMemo(() => {
    if (!editing) return [];
    return sortPositionsByOrder(
      positions.filter((position) => position.teamId === editing.teamId),
    );
  }, [editing, positions]);

  const editingTeamRoles = useMemo(() => {
    if (!editing) return [];
    return roles.filter((role) => role.teamId === editing.teamId);
  }, [editing, roles]);

  const editingTeamQualificationAreas = useMemo(() => {
    if (!editing) return [];
    return qualificationAreas.filter((area) => area.teamId === editing.teamId);
  }, [editing, qualificationAreas]);

  const reset = () => {
    setEditing(null);
    setShowCreate(false);
    setDraft({ name: "", description: "", icon: "", memberIds: [] });
  };

  const cancelEditing = () => {
    finishEditing(reset);
  };

  const startEditingTeam = useCallback((team: TeamRecord) => {
    setEditing(team);
    setShowCreate(true);
    setDraft({
      name: team.name,
      description: team.description || "",
      icon: team.icon || "",
      memberIds: team.memberIds || [],
    });
  }, []);

  useTeamsRestoreOnMount({
    onGroupsRestore: (restore) => {
      pendingEditTeamIdRef.current = restore.editTeamId;
    },
  });

  useEffect(() => {
    const editTeamId = pendingEditTeamIdRef.current;
    if (!editTeamId) return;
    const team = teams.find((item) => item.teamId === editTeamId);
    if (!team) return;
    pendingEditTeamIdRef.current = null;
    startEditingTeam(team);
  }, [startEditingTeam, teams]);

  const confirmDelete = async () => {
    if (!canEdit) return;
    if (!deleting) return;
    const team = deleting;
    if (team.teamId.startsWith("local-")) {
      onRemoved(team.teamId);
      setDeleting(null);
      return;
    }
    setDeleteBusy(true);
    onRemoved(team.teamId);
    try {
      await deleteTeam(churchId, team.teamId);
      setDeleting(null);
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not delete this team.");
      onSaved(team);
    } finally {
      setDeleteBusy(false);
    }
  };

  const submit = async () => {
    if (!canEdit) return;
    const wasEditing = editing;
    const savingKey = wasEditing?.teamId ?? CREATE_SAVING_KEY;
    // Ignore a repeat submit for the same editor while its save is pending —
    // this prevents a fast double-click on "Create" from making duplicates.
    if (savingIds.has(savingKey)) return;
    setSavingIds((prev) => new Set(prev).add(savingKey));
    const saveToastMessage = formatTeamSaveToast(wasEditing, draft, {
      memberNameById: new Map(
        members.map((member) => [member.memberId, memberName(member)]),
      ),
    });
    const localTeamId = wasEditing?.teamId || `local-team-${generateRandomId()}`;
    const optimisticTeam: TeamRecord = {
      churchId,
      teamId: localTeamId,
      name: draft.name.trim(),
      description: draft.description || "",
      icon: draft.icon || "",
      memberIds: draft.memberIds,
      archivedAt: wasEditing?.archivedAt || null,
    };
    const savedRecord = wasEditing
      ? { ...wasEditing, ...optimisticTeam }
      : optimisticTeam;
    onSaved(savedRecord);
    try {
      const response = wasEditing
        ? await updateTeam(churchId, wasEditing.teamId, draft)
        : await createTeam(churchId, draft);
      if (!wasEditing) {
        onSaved(response.team, localTeamId);
      }
      showToast(saveToastMessage, "success");
      // Cross-section return, or mobile where the form covers the list: close.
      // On desktop, keep the panel open for back-to-back editing.
      if (returnTo || isNarrowViewport) {
        finishEditing(reset);
      } else if (wasEditing) {
        // The operator may have switched to a different team while this save was
        // in flight. Only refresh the selected record if they're still on the
        // one we just saved, so the panel never rebinds to a stale team.
        setEditing((current) =>
          current?.teamId === wasEditing.teamId ? savedRecord : current,
        );
      } else {
        // Newly created: adopt the saved record so a subsequent Save updates it
        // instead of creating a duplicate — but only if the create form is still
        // the active editor and the operator hasn't selected another team.
        const created = response.team;
        setEditing((current) => (current === null ? created : current));
      }
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not save this team.");
      onArchived();
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(savingKey);
        return next;
      });
    }
  };

  // The panel shows one editor at a time; its Save state reflects only the team
  // currently open, so a background save elsewhere never spins or disables it.
  const currentEditorKey = editing ? editing.teamId : CREATE_SAVING_KEY;
  const isSavingCurrent = savingIds.has(currentEditorKey);

  const formatNameList = (names: string[]) =>
    names.length === 0 ? "None yet." : names.join(", ");

  return (
    <>
      <CreatePanel
        open={showCreate}
        onOpenCreate={() => {
          reset();
          setShowCreate(true);
        }}
        canEdit={canEdit}
        title={editing ? "Edit team" : "Create team"}
        sectionTitle="Teams"
        description="Organize members into scheduling teams."
        createLabel="Create team"
        listToolbar={
          returnTo && !showCreate ? (
            <TeamsReturnToolbar returnTo={returnTo} onBack={cancelEditing} />
          ) : null
        }
        list={
          <>
            {teams.length === 0 ? <p className="text-sm text-gray-300">No teams yet.</p> : null}
            {teams.map((team) => (
              <EntityRow
                key={team.teamId}
                title={team.name}
                subtitle={`${team.memberIds.length} members | ${positions.filter((position) => position.teamId === team.teamId).length} positions`}
                icon={team.icon}
                archived={Boolean(team.archivedAt)}
                canEdit={canEdit}
                onTitleClick={() => startEditingTeam(team)}
              />
            ))}
          </>
        }
        formHeaderActions={
          showCreate ? (
            <TeamsReturnToolbar returnTo={returnTo} onBack={cancelEditing}>
              {editing ? (
                <EntityFormDangerActions
                  archived={Boolean(editing.archivedAt)}
                  canEdit={canEdit}
                  archiveLabel="Archive team"
                  deleteLabel="Delete team"
                  menuLabel="Team actions"
                  onArchive={
                    editing.archivedAt
                      ? undefined
                      : async () => {
                        const archivedTeam = {
                          ...editing,
                          archivedAt: new Date().toISOString(),
                        };
                        onSaved(archivedTeam);
                        try {
                          await archiveTeam(churchId, editing.teamId);
                          finishEditing(reset);
                        } catch (error) {
                          showApiErrorToast(showToast, error, "Could not archive this team.");
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
            saveLabel="Save team"
            onSave={() => void submit()}
            onCancel={cancelEditing}
            disabled={!canEdit || !draft.name.trim() || isSavingCurrent}
            isLoading={isSavingCurrent}
          />
        }
      >
        <Input label="Name" value={draft.name} onChange={(name) => setDraft((d) => ({ ...d, name: String(name) }))} />
        <PositionIconPicker value={draft.icon || ""} onChange={(icon) => setDraft((d) => ({ ...d, icon }))} />
        <TextArea label="Description" value={draft.description || ""} textareaClassName="min-h-20" onChange={(description) => setDraft((d) => ({ ...d, description }))} />
        <EntityMultiSelect
          label="Members"
          options={members.map((member) => ({ id: member.memberId, label: memberName(member), archived: Boolean(member.archivedAt) }))}
          value={draft.memberIds}
          onChange={(memberIds) => setDraft((d) => ({ ...d, memberIds }))}
        />
        {editing ? (
          <div className="space-y-4">
            <TeamEditorRelatedSection
              title="Positions"
              summary={formatNameList(editingTeamPositions.map((position) => position.name))}
              editLabel="Edit positions"
              editPath={buildTeamsPositionsPath(editing.teamId)}
              returnTo={buildGroupsReturnTo(editing.teamId)}
            />
            <TeamEditorRelatedSection
              title="Team roles"
              summary={formatNameList(editingTeamRoles.map((role) => role.name))}
              editLabel="Edit roles"
              editPath={buildTeamsRolesPath(editing.teamId)}
              returnTo={buildGroupsReturnTo(editing.teamId)}
            />
            <TeamEditorRelatedSection
              title="Qualifications"
              summary={formatNameList(
                editingTeamQualificationAreas.map((area) => area.name),
              )}
              editLabel="Edit qualifications"
              editPath={buildTeamsQualificationsPath(editing.teamId)}
              returnTo={buildGroupsReturnTo(editing.teamId)}
            />
          </div>
        ) : null}
      </CreatePanel>
      <DeleteModal
        isOpen={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
        itemName={deleting?.name}
        isConfirming={deleteBusy}
        message="Permanently delete the team"
        impacts={deleting ? describeDeletionImpacts("team", deleting.teamId, data) : undefined}
        warningMessage="This cannot be undone. Archive instead if you only want to hide it."
      />
    </>
  );
};

export default TeamManager;
