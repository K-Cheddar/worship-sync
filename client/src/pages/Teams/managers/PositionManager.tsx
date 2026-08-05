import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useSearchParams } from "react-router-dom";
import Input from "../../../components/Input/Input";
import Select from "../../../components/Select/Select";
import TextArea from "../../../components/TextArea/TextArea";
import DeleteModal from "../../../components/Modal/DeleteModal";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { useToast } from "../../../context/toastContext";
import {
  archiveTeamPosition,
  createTeamPosition,
  deleteTeamPosition,
  updateTeamPosition,
} from "../../../api/auth";
import type { TeamRecord, TeamPosition } from "../../../api/authTypes";
import generateRandomId from "../../../utils/generateRandomId";
import CreatePanel from "../CreatePanel";
import EntityListSearch from "../components/EntityListSearch";
import EntityRow from "../components/EntityRow";
import TeamsCrossSectionLink from "../components/TeamsCrossSectionLink";
import TeamsReturnToolbar from "../components/TeamsReturnToolbar";
import TeamsSectionReturnPrompt from "../components/TeamsSectionReturnPrompt";
import SortablePositionRow from "../components/SortablePositionRow";
import FormActionButtons from "../components/FormActionButtons";
import EntityFormDangerActions from "../components/EntityFormDangerActions";
import PositionIconPicker from "../PositionIconPicker";
import { useSensors } from "../../../utils/dndUtils";
import { showApiErrorToast } from "../../../utils/apiErrorToast";
import {
  describeDeletionImpacts,
  isActive,
  positionMatchesListQuery,
} from "../teamsUtils";
import { formatPositionSaveToast } from "../teamsSaveToasts";
import {
  TEAMS_POSITION_EDIT_SEARCH_PARAM,
  TEAMS_SECTION_PATHS,
  buildTeamsPositionEditPath,
  buildTeamsPositionsPath,
  buildTeamsQualificationsPath,
} from "../teamsReturnNavigation";
import { useTeamsReturnNavigation } from "../hooks/useTeamsReturnNavigation";
import { useTeamsNarrowViewport } from "../hooks/useTeamsNarrowViewport";
import { useTeamsUnsavedChanges } from "../hooks/useTeamsUnsavedChanges";
import { useTeamsNavigationGuard } from "../TeamsNavigationGuardContext";
import { useTeamsTeamSearchParam } from "../hooks/useTeamsTeamSearchParam";
import type { TeamsData } from "../types";

type PositionDraft = {
  name: string;
  description: string;
  icon: string;
  qualificationAreaId: string;
};

// Key used to track an in-flight save for the create form, which has no
// position id yet. Existing positions are tracked by their own positionId.
const CREATE_SAVING_KEY = "__create__";

// Radix Select forbids an empty-string item value, so "no area picked" needs
// its own sentinel distinct from the draft's real (empty-string) value.
const NO_QUALIFICATION_AREA_VALUE = "__none__";

type PositionManagerProps = {
  positions: TeamPosition[];
  teams: TeamRecord[];
  data: TeamsData;
  canEdit: boolean;
  onSaved: (position: TeamPosition, replaceId?: string) => void;
  onArchived: () => void;
  onRemoved: (positionId: string) => void;
  onReordered: (teamId: string, orderedPositionIds: string[]) => void;
};

const PositionManager = ({
  positions,
  teams,
  data,
  canEdit,
  onSaved,
  onArchived,
  onRemoved,
  onReordered,
}: PositionManagerProps) => {
  const context = useContext(GlobalInfoContext);
  const { showToast } = useToast();
  const churchId = context?.churchId || "";
  const sensors = useSensors();
  const activeTeams = useMemo(() => teams.filter(isActive), [teams]);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [editing, setEditing] = useState<TeamPosition | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deleting, setDeleting] = useState<TeamPosition | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [draft, setDraft] = useState<PositionDraft>({
    name: "",
    description: "",
    icon: "",
    qualificationAreaId: "",
  });
  // Positions with a save currently in flight, keyed by positionId (or
  // CREATE_SAVING_KEY for a new position). Tracking per-editor keeps the Save
  // spinner on the position actually saving and lets editing continue
  // back-to-back while a background save resolves.
  const [savingIds, setSavingIds] = useState<Set<string>>(() => new Set());
  const [listQuery, setListQuery] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const { returnTo, finishEditing } = useTeamsReturnNavigation();
  const { requestDiscardAction } = useTeamsNavigationGuard();
  const isNarrowViewport = useTeamsNarrowViewport();
  const pendingEditPositionIdRef = useRef<string | null>(null);

  const applyTeamId = useCallback((nextTeamId: string) => {
    setSelectedTeamId(nextTeamId);
  }, []);

  useTeamsTeamSearchParam(
    activeTeams.map((team) => team.teamId),
    applyTeamId,
  );

  // Default the selected team to the first active team once teams load.
  const teamId = selectedTeamId || activeTeams[0]?.teamId || "";
  const teamQualificationAreaOptions = useMemo(
    () =>
      data.qualificationAreas
        .filter((area) => area.teamId === teamId && isActive(area))
        .map((area) => ({ label: area.name, value: area.areaId })),
    [data.qualificationAreas, teamId],
  );

  const teamPositions = positions.filter((position) => position.teamId === teamId);
  const filteredTeamPositions = useMemo(
    () =>
      teamPositions.filter((position) => positionMatchesListQuery(position, listQuery)),
    [teamPositions, listQuery],
  );

  // Reordering acts on the full team list, so disable it while a search filter
  // is narrowing what's shown.
  const canReorder = canEdit && !listQuery.trim() && teamPositions.length > 1;

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!canEdit) return;
      if (!over || active.id === over.id) return;
      const ids = teamPositions.map((position) => position.positionId);
      const oldIndex = ids.indexOf(String(active.id));
      const newIndex = ids.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) return;
      onReordered(teamId, arrayMove(ids, oldIndex, newIndex));
    },
    [canEdit, onReordered, teamId, teamPositions],
  );

  const reset = () => {
    setEditing(null);
    setShowCreate(false);
    setDraft({ name: "", description: "", icon: "", qualificationAreaId: "" });
  };

  const cancelEditing = () => {
    finishEditing(reset);
  };

  const confirmDelete = async () => {
    if (!canEdit) return;
    if (!deleting) return;
    const position = deleting;
    if (position.positionId.startsWith("local-")) {
      onRemoved(position.positionId);
      setDeleting(null);
      return;
    }
    setDeleteBusy(true);
    onRemoved(position.positionId);
    try {
      await deleteTeamPosition(churchId, position.positionId);
      setDeleting(null);
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not delete this position.");
      onSaved(position);
    } finally {
      setDeleteBusy(false);
    }
  };

  const submit = async () => {
    if (!canEdit) return;
    const positionTeamId = editing?.teamId || teamId;
    if (!positionTeamId) {
      showToast("Create a team first, then add its positions.", "neutral");
      return;
    }
    const wasEditing = editing;
    const savingKey = wasEditing?.positionId ?? CREATE_SAVING_KEY;
    // Ignore a repeat submit for the same editor while its save is pending —
    // this prevents a fast double-click on "Create" from making duplicates.
    if (savingIds.has(savingKey)) return;
    setSavingIds((prev) => new Set(prev).add(savingKey));
    const localPositionId = wasEditing?.positionId || `local-position-${generateRandomId()}`;
    const payload = {
      name: draft.name.trim(),
      description: draft.description || "",
      icon: draft.icon || "",
      qualificationAreaId: draft.qualificationAreaId || undefined,
      teamId: positionTeamId,
    };
    const saveToastMessage = formatPositionSaveToast(wasEditing, payload);
    const optimisticPosition: TeamPosition = {
      churchId,
      positionId: localPositionId,
      teamId: positionTeamId,
      name: payload.name,
      description: payload.description,
      icon: payload.icon,
      qualificationAreaId: payload.qualificationAreaId,
      archivedAt: wasEditing?.archivedAt || null,
    };
    const savedRecord = wasEditing
      ? { ...wasEditing, ...optimisticPosition }
      : optimisticPosition;
    onSaved(savedRecord);
    try {
      const response = wasEditing
        ? await updateTeamPosition(churchId, wasEditing.positionId, payload)
        : await createTeamPosition(churchId, payload);
      if (!wasEditing) {
        onSaved(response.position, localPositionId);
      }
      showToast(saveToastMessage, "success");
      // Cross-section return, or mobile where the form covers the list: close.
      // On desktop, keep the panel open for back-to-back editing.
      if (returnTo || isNarrowViewport) {
        finishEditing(reset);
      } else if (wasEditing) {
        // The operator may have switched to a different position while this save
        // was in flight. Only refresh the selected record if they're still on
        // the one we just saved; otherwise leave their current edit untouched so
        // the panel never rebinds to a stale position and overwrites another.
        setEditing((current) =>
          current?.positionId === wasEditing.positionId ? savedRecord : current,
        );
      } else {
        // Newly created: adopt the saved record so a subsequent Save updates it
        // instead of creating a duplicate — but only if the create form is still
        // the active editor and the operator hasn't selected another position.
        const created = response.position;
        setEditing((current) => (current === null ? created : current));
      }
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not save this position.");
      onArchived();
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(savingKey);
        return next;
      });
    }
  };

  // The panel shows one editor at a time; its Save state reflects only the
  // position currently open, so a background save elsewhere never spins or
  // disables this button.
  const currentEditorKey = editing ? editing.positionId : CREATE_SAVING_KEY;
  const isSavingCurrent = savingIds.has(currentEditorKey);
  const hasPendingChanges = editing
    ? JSON.stringify(draft) !==
      JSON.stringify({
        name: editing.name,
        description: editing.description || "",
        icon: editing.icon || "",
        qualificationAreaId: editing.qualificationAreaId || "",
      })
    : JSON.stringify(draft) !==
      JSON.stringify({ name: "", description: "", icon: "", qualificationAreaId: "" });
  // A save already in flight for this editor is not an unsaved change: the
  // operator committed it, and `editing` only catches up when the response
  // lands. Without this, switching positions mid-save falsely prompts to
  // discard work that is already on its way to the server.
  useTeamsUnsavedChanges(hasPendingChanges && !isSavingCurrent);

  const openPositionEditor = useCallback((position: TeamPosition) => {
    setEditing(position);
    setSelectedTeamId(position.teamId);
    setShowCreate(true);
    setDraft({
      name: position.name,
      description: position.description || "",
      icon: position.icon || "",
      qualificationAreaId: position.qualificationAreaId || "",
    });
  }, []);

  const selectPosition = useCallback((position: TeamPosition) => {
    if (editing?.positionId === position.positionId) return;
    requestDiscardAction(() => openPositionEditor(position));
  }, [editing?.positionId, openPositionEditor, requestDiscardAction]);

  useEffect(() => {
    if (!canEdit) return;
    const editPositionId = searchParams.get(TEAMS_POSITION_EDIT_SEARCH_PARAM)?.trim();
    if (!editPositionId) return;
    pendingEditPositionIdRef.current = editPositionId;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete(TEAMS_POSITION_EDIT_SEARCH_PARAM);
    setSearchParams(nextParams, { replace: true });
  }, [canEdit, searchParams, setSearchParams]);

  useEffect(() => {
    const editPositionId = pendingEditPositionIdRef.current;
    if (!editPositionId) return;
    const position = positions.find((item) => item.positionId === editPositionId);
    if (!position) return;
    pendingEditPositionIdRef.current = null;
    openPositionEditor(position);
  }, [openPositionEditor, positions]);

  const positionRowProps = (position: TeamPosition) => ({
    title: position.name,
    subtitle: position.description || undefined,
    icon: position.icon,
    archived: Boolean(position.archivedAt),
    compact: true,
    canEdit,
    onTitleClick: () => selectPosition(position),
  });

  return (
    <>
      <CreatePanel
        open={showCreate}
        onOpenCreate={() => {
          reset();
          setShowCreate(true);
        }}
        canEdit={canEdit}
        title={editing ? "Edit position" : "Create position"}
        sectionTitle="Positions"
        description="Define roles and position requirements."
        createLabel="Create position"
        scrollableList
        listToolbar={
          activeTeams.length === 0 ? (
            returnTo && !showCreate ? (
              <TeamsReturnToolbar returnTo={returnTo} onBack={() => finishEditing()} />
            ) : (
              <TeamsSectionReturnPrompt
                message="Create a team first — positions belong to a team."
                originSection={TEAMS_SECTION_PATHS.positions}
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
              {teamPositions.length > 0 ? (
                <EntityListSearch
                  label="Positions"
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
                message="Create a team first — positions belong to a team."
                originSection={TEAMS_SECTION_PATHS.positions}
              />
            ) : (
              <>
                {teamPositions.length === 0 ? (
                  <p className="text-sm text-gray-300">No positions in this team yet.</p>
                ) : null}
                {teamPositions.length > 0 && filteredTeamPositions.length === 0 ? (
                  <p className="text-sm text-gray-300">No matches.</p>
                ) : null}
                {canReorder ? (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext
                      items={teamPositions.map((position) => position.positionId)}
                      strategy={verticalListSortingStrategy}
                    >
                      {filteredTeamPositions.map((position) => (
                        <SortablePositionRow
                          key={position.positionId}
                          id={position.positionId}
                          {...positionRowProps(position)}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                ) : (
                  filteredTeamPositions.map((position) => (
                    <EntityRow
                      key={position.positionId}
                      {...positionRowProps(position)}
                    />
                  ))
                )}
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
                  archiveLabel="Archive position"
                  deleteLabel="Delete position"
                  menuLabel="Position actions"
                  onArchive={
                    editing.archivedAt
                      ? undefined
                      : async () => {
                        const archivedPosition = {
                          ...editing,
                          archivedAt: new Date().toISOString(),
                        };
                        onSaved(archivedPosition);
                        try {
                          await archiveTeamPosition(churchId, editing.positionId);
                          finishEditing(reset);
                        } catch (error) {
                          showApiErrorToast(showToast, error, "Could not archive this position.");
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
            saveLabel="Save position"
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
        <Input label="Name" value={draft.name} onChange={(name) => setDraft((d) => ({ ...d, name: String(name) }))} />
        <PositionIconPicker value={draft.icon || ""} onChange={(icon) => setDraft((d) => ({ ...d, icon }))} />
        <TextArea label="Description" value={draft.description || ""} textareaClassName="min-h-24" onChange={(description) => setDraft((d) => ({ ...d, description }))} />
        <div>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="min-w-0 flex-1">
              <Select
                label="Qualification area (optional)"
                value={draft.qualificationAreaId || NO_QUALIFICATION_AREA_VALUE}
                onChange={(value) =>
                  setDraft((d) => ({
                    ...d,
                    qualificationAreaId: value === NO_QUALIFICATION_AREA_VALUE ? "" : value,
                  }))
                }
                options={[
                  { label: "None", value: NO_QUALIFICATION_AREA_VALUE },
                  ...teamQualificationAreaOptions,
                ]}
              />
            </div>
            {teamId ? (
              <TeamsCrossSectionLink
                to={buildTeamsQualificationsPath(teamId)}
                returnTo={
                  editing
                    ? {
                      label: "Back to position",
                      pathname: buildTeamsPositionEditPath(
                        editing.positionId,
                        editing.teamId,
                      ),
                    }
                    : {
                      label: "Back to positions",
                      pathname: buildTeamsPositionsPath(teamId),
                    }
                }
                className="mb-1 shrink-0"
              >
                Edit qualifications
              </TeamsCrossSectionLink>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-gray-400">
            When this position needs more than one person per service, auto-fill uses this
            area&apos;s levels to avoid pairing two lowest-level people together.
          </p>
          {teamQualificationAreaOptions.length === 0 && teamId ? (
            <p className="mt-1 text-xs text-amber-200/90">
              No qualification areas on this team yet. Use Edit qualifications to add one.
            </p>
          ) : null}
        </div>
      </CreatePanel>
      <DeleteModal
        isOpen={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
        itemName={deleting?.name}
        isConfirming={deleteBusy}
        message="Permanently delete the position"
        impacts={deleting ? describeDeletionImpacts("position", deleting.positionId, data) : undefined}
        warningMessage="This cannot be undone. Archive instead if you only want to hide it."
      />
    </>
  );
};

export default PositionManager;
