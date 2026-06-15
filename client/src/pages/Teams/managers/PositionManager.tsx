import { useCallback, useContext, useMemo, useState } from "react";
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
import type { TeamsData } from "../types";

type PositionDraft = { name: string; description: string; icon: string };

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
  const [draft, setDraft] = useState<PositionDraft>({ name: "", description: "", icon: "" });
  const [saving, setSaving] = useState(false);
  const [listQuery, setListQuery] = useState("");

  // Default the selected team to the first active team once teams load.
  const teamId = selectedTeamId || activeTeams[0]?.teamId || "";
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
    setDraft({ name: "", description: "", icon: "" });
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
    setSaving(true);
    const localPositionId = editing?.positionId || `local-position-${generateRandomId()}`;
    const payload = {
      name: draft.name.trim(),
      description: draft.description || "",
      icon: draft.icon || "",
      teamId: positionTeamId,
    };
    const optimisticPosition: TeamPosition = {
      churchId,
      positionId: localPositionId,
      teamId: positionTeamId,
      name: payload.name,
      description: payload.description,
      icon: payload.icon,
      archivedAt: editing?.archivedAt || null,
    };
    onSaved(editing ? { ...editing, ...optimisticPosition } : optimisticPosition);
    try {
      const response = editing
        ? await updateTeamPosition(churchId, editing.positionId, payload)
        : await createTeamPosition(churchId, payload);
      if (!editing) {
        onSaved(response.position, localPositionId);
      }
      reset();
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not save this position.");
      onArchived();
    } finally {
      setSaving(false);
    }
  };

  const openPositionEditor = (position: TeamPosition) => {
    setEditing(position);
    setSelectedTeamId(position.teamId);
    setShowCreate(true);
    setDraft({
      name: position.name,
      description: position.description || "",
      icon: position.icon || "",
    });
  };

  const positionRowProps = (position: TeamPosition) => ({
    title: position.name,
    subtitle: position.description || undefined,
    icon: position.icon,
    archived: Boolean(position.archivedAt),
    compact: true,
    canEdit,
    onTitleClick: () => openPositionEditor(position),
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
          activeTeams.length === 0 ? null : (
            <div className="space-y-3">
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
              <p className="text-sm text-gray-300">
                Create a team first — positions belong to a team.
              </p>
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
          editing ? (
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
                      reset();
                    } catch (error) {
                      showApiErrorToast(showToast, error, "Could not archive this position.");
                      onSaved(editing);
                    }
                  }
              }
              onDelete={() => setDeleting(editing)}
            />
          ) : null
        }
        formFooter={
          <FormActionButtons
            pinFooter
            saveLabel="Save position"
            onSave={() => void submit()}
            onCancel={reset}
            disabled={!canEdit || !draft.name.trim()}
            isLoading={saving}
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
