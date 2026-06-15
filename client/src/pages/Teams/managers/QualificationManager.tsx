import { useContext, useMemo, useState } from "react";
import { Plus, Save } from "lucide-react";
import Button from "../../../components/Button/Button";
import Input from "../../../components/Input/Input";
import Select from "../../../components/Select/Select";
import TextArea from "../../../components/TextArea/TextArea";
import DeleteModal from "../../../components/Modal/DeleteModal";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { useToast } from "../../../context/toastContext";
import {
  archiveTeamQualificationArea,
  createTeamQualificationArea,
  createTeamQualificationLevel,
  deleteTeamQualificationArea,
  updateTeamQualificationArea,
  updateTeamQualificationLevel,
  type TeamQualificationAreaPayload,
  type TeamQualificationLevelPayload,
} from "../../../api/auth";
import type {
  TeamQualificationArea,
  TeamQualificationLevel,
  TeamRecord,
} from "../../../api/authTypes";
import generateRandomId from "../../../utils/generateRandomId";
import CreatePanel from "../CreatePanel";
import EntityListSearch from "../components/EntityListSearch";
import EntityRow from "../components/EntityRow";
import FormActionButtons from "../components/FormActionButtons";
import EntityFormDangerActions from "../components/EntityFormDangerActions";
import { showApiErrorToast } from "../../../utils/apiErrorToast";
import { isActive, qualificationAreaMatchesListQuery } from "../teamsUtils";

type QualificationManagerProps = {
  areas: TeamQualificationArea[];
  levels: TeamQualificationLevel[];
  teams: TeamRecord[];
  canEdit: boolean;
  onAreaSaved: (area: TeamQualificationArea, replaceId?: string) => void;
  onLevelSaved: (level: TeamQualificationLevel, replaceId?: string) => void;
  onArchived: () => void;
  onAreaRemoved: (areaId: string) => void;
};

const QualificationManager = ({
  areas,
  levels,
  teams,
  canEdit,
  onAreaSaved,
  onLevelSaved,
  onArchived,
  onAreaRemoved,
}: QualificationManagerProps) => {
  const context = useContext(GlobalInfoContext);
  const { showToast } = useToast();
  const churchId = context?.churchId || "";
  const activeTeams = useMemo(() => teams.filter(isActive), [teams]);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [editing, setEditing] = useState<TeamQualificationArea | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deleting, setDeleting] = useState<TeamQualificationArea | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [draft, setDraft] = useState<TeamQualificationAreaPayload>({
    teamId: "",
    name: "",
    description: "",
  });
  const [levelDrafts, setLevelDrafts] = useState<
    Record<string, TeamQualificationLevelPayload>
  >({});
  const [newLevelName, setNewLevelName] = useState("");
  const [newLevelRank, setNewLevelRank] = useState("1");
  const [levelSavingKey, setLevelSavingKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [listQuery, setListQuery] = useState("");

  const teamId = selectedTeamId || activeTeams[0]?.teamId || "";
  const teamAreas = areas.filter((area) => area.teamId === teamId);
  const filteredTeamAreas = useMemo(
    () =>
      teamAreas.filter((area) => qualificationAreaMatchesListQuery(area, listQuery)),
    [teamAreas, listQuery],
  );

  const areaLevels = useMemo(() => {
    if (!editing) return [];
    return levels
      .filter((level) => level.areaId === editing.areaId)
      .sort((a, b) => a.rank - b.rank);
  }, [editing, levels]);

  const levelCountByAreaId = useMemo(() => {
    const counts = new Map<string, number>();
    levels.forEach((level) => {
      counts.set(level.areaId, (counts.get(level.areaId) || 0) + 1);
    });
    return counts;
  }, [levels]);

  const resetLevelDrafts = (area: TeamQualificationArea) => {
    const areaLevelList = levels
      .filter((level) => level.areaId === area.areaId)
      .sort((a, b) => a.rank - b.rank);
    setLevelDrafts(
      Object.fromEntries(
        areaLevelList.map((level) => [
          level.levelId,
          {
            areaId: level.areaId,
            name: level.name,
            description: level.description || "",
            rank: level.rank,
          },
        ]),
      ),
    );
    setNewLevelName("");
    setNewLevelRank(String((areaLevelList.at(-1)?.rank || 0) + 1));
    setLevelSavingKey("");
  };

  const reset = () => {
    setEditing(null);
    setShowCreate(false);
    setDraft({ teamId: teamId, name: "", description: "" });
    setLevelDrafts({});
    setNewLevelName("");
    setNewLevelRank("1");
    setLevelSavingKey("");
  };

  const openAreaEditor = (area: TeamQualificationArea) => {
    setEditing(area);
    setSelectedTeamId(area.teamId);
    setShowCreate(true);
    setDraft({
      teamId: area.teamId,
      name: area.name,
      description: area.description || "",
    });
    resetLevelDrafts(area);
  };

  const confirmDelete = async () => {
    if (!canEdit || !deleting) return;
    const area = deleting;
    if (area.areaId.startsWith("local-")) {
      onAreaRemoved(area.areaId);
      setDeleting(null);
      return;
    }
    setDeleteBusy(true);
    onAreaRemoved(area.areaId);
    try {
      await deleteTeamQualificationArea(churchId, area.areaId);
      setDeleting(null);
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not delete this qualification area.");
      onAreaSaved(area);
    } finally {
      setDeleteBusy(false);
    }
  };

  const submitArea = async () => {
    if (!canEdit) return;
    const areaTeamId = editing?.teamId || teamId;
    if (!areaTeamId) {
      showToast("Create a team first, then add qualification areas.", "neutral");
      return;
    }
    setSaving(true);
    const localAreaId = editing?.areaId || `local-area-${generateRandomId()}`;
    const payload: TeamQualificationAreaPayload = {
      teamId: areaTeamId,
      name: draft.name.trim(),
      description: draft.description || "",
    };
    const optimisticArea: TeamQualificationArea = {
      churchId,
      areaId: localAreaId,
      teamId: areaTeamId,
      name: payload.name,
      description: payload.description,
      archivedAt: editing?.archivedAt || null,
    };
    onAreaSaved(editing ? { ...editing, ...optimisticArea } : optimisticArea);
    try {
      const response = editing
        ? await updateTeamQualificationArea(churchId, editing.areaId, payload)
        : await createTeamQualificationArea(churchId, payload);
      if (!editing) {
        onAreaSaved(response.area, localAreaId);
        setEditing(response.area);
        resetLevelDrafts(response.area);
      } else {
        setEditing(response.area);
        reset();
      }
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not save this qualification area.");
      onArchived();
    } finally {
      setSaving(false);
    }
  };

  const saveLevel = async (levelId?: string) => {
    if (!canEdit || !editing) return;
    const payload = levelId
      ? levelDrafts[levelId]
      : {
        areaId: editing.areaId,
        name: newLevelName.trim(),
        rank: Number(newLevelRank),
        description: "",
      };
    if (!payload?.areaId || !payload.name.trim() || !Number.isFinite(payload.rank)) {
      return;
    }
    const savingKey = levelId ? `level:${levelId}` : "level:new";
    setLevelSavingKey(savingKey);
    const localLevel: TeamQualificationLevel = {
      churchId,
      levelId: levelId || `local-level-${generateRandomId()}`,
      areaId: payload.areaId,
      name: payload.name.trim(),
      description: payload.description || "",
      rank: payload.rank,
      archivedAt: levelId
        ? levels.find((level) => level.levelId === levelId)?.archivedAt || null
        : null,
    };
    onLevelSaved(localLevel);
    try {
      const response = levelId
        ? await updateTeamQualificationLevel(churchId, levelId, payload)
        : await createTeamQualificationLevel(churchId, payload);
      if (!levelId) {
        onLevelSaved(response.level, localLevel.levelId);
        setNewLevelName("");
        setNewLevelRank(String(payload.rank + 1));
      }
      setLevelDrafts((current) => ({
        ...current,
        [response.level.levelId]: {
          areaId: response.level.areaId,
          name: response.level.name,
          description: response.level.description || "",
          rank: response.level.rank,
        },
      }));
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not save this qualification level.");
      onArchived();
    } finally {
      setLevelSavingKey("");
    }
  };

  return (
    <>
      <CreatePanel
        open={showCreate}
        onOpenCreate={() => {
          reset();
          setShowCreate(true);
        }}
        canEdit={canEdit}
        title={editing ? "Edit qualification area" : "Create qualification area"}
        sectionTitle="Qualifications"
        description="Define qualification areas and levels."
        createLabel="Create area"
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
              {teamAreas.length > 0 ? (
                <EntityListSearch
                  label="Qualification areas"
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
                Create a team first — qualification areas belong to a team.
              </p>
            ) : (
              <>
                {teamAreas.length === 0 ? (
                  <p className="text-sm text-gray-300">
                    No qualification areas in this team yet.
                  </p>
                ) : null}
                {teamAreas.length > 0 && filteredTeamAreas.length === 0 ? (
                  <p className="text-sm text-gray-300">No matches.</p>
                ) : null}
                {filteredTeamAreas.map((area) => {
                  const levelCount = levelCountByAreaId.get(area.areaId) || 0;
                  return (
                    <EntityRow
                      key={area.areaId}
                      title={area.name}
                      subtitle={
                        area.description ||
                        `${levelCount} level${levelCount === 1 ? "" : "s"}`
                      }
                      archived={Boolean(area.archivedAt)}
                      compact
                      canEdit={canEdit}
                      onTitleClick={() => openAreaEditor(area)}
                    />
                  );
                })}
              </>
            )}
          </>
        }
        formHeaderActions={
          editing ? (
            <EntityFormDangerActions
              archived={Boolean(editing.archivedAt)}
              canEdit={canEdit}
              archiveLabel="Archive area"
              deleteLabel="Delete area"
              menuLabel="Qualification area actions"
              onArchive={
                editing.archivedAt
                  ? undefined
                  : async () => {
                    const archivedArea = {
                      ...editing,
                      archivedAt: new Date().toISOString(),
                    };
                    onAreaSaved(archivedArea);
                    try {
                      await archiveTeamQualificationArea(churchId, editing.areaId);
                      reset();
                    } catch (error) {
                      showApiErrorToast(
                        showToast,
                        error,
                        "Could not archive this qualification area.",
                      );
                      onAreaSaved(editing);
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
            saveLabel="Save area"
            onSave={() => void submitArea()}
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
        <Input
          label="Area name"
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
        {editing ? (
          <fieldset className="space-y-2">
            <legend className="p-1 text-sm font-semibold">Qualification levels</legend>
            <div className="space-y-2 rounded-md border border-gray-700 bg-gray-950/60 p-2">
              {areaLevels.length === 0 ? (
                <p className="text-sm text-gray-400">No levels yet.</p>
              ) : null}
              {areaLevels.map((level) => {
                const levelDraft = levelDrafts[level.levelId] || {
                  areaId: level.areaId,
                  name: level.name,
                  description: level.description || "",
                  rank: level.rank,
                };
                return (
                  <div
                    key={level.levelId}
                    className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_5rem_auto]"
                  >
                    <Input
                      label="Level name"
                      hideLabel
                      value={levelDraft.name}
                      placeholder="Level 2"
                      onChange={(name) =>
                        setLevelDrafts((current) => ({
                          ...current,
                          [level.levelId]: { ...levelDraft, name: String(name) },
                        }))
                      }
                    />
                    <Input
                      label="Rank"
                      hideLabel
                      type="number"
                      value={levelDraft.rank}
                      onChange={(rank) =>
                        setLevelDrafts((current) => ({
                          ...current,
                          [level.levelId]: {
                            ...levelDraft,
                            rank: Number(rank),
                          },
                        }))
                      }
                    />
                    <Button
                      variant="tertiary"
                      svg={Save}
                      aria-label={`Save ${level.name}`}
                      isLoading={levelSavingKey === `level:${level.levelId}`}
                      onClick={() => void saveLevel(level.levelId)}
                    >
                      Save
                    </Button>
                  </div>
                );
              })}
              <div className="grid gap-2 border-t border-gray-800 pt-2 sm:grid-cols-[minmax(0,1fr)_5rem_auto]">
                <Input
                  label="New level"
                  hideLabel
                  value={newLevelName}
                  placeholder="New level"
                  onChange={(name) => setNewLevelName(String(name))}
                />
                <Input
                  label="Rank"
                  hideLabel
                  type="number"
                  value={newLevelRank}
                  onChange={(rank) => setNewLevelRank(String(rank))}
                />
                <Button
                  variant="secondary"
                  svg={Plus}
                  disabled={
                    !newLevelName.trim() || !Number.isFinite(Number(newLevelRank))
                  }
                  isLoading={levelSavingKey === "level:new"}
                  onClick={() => void saveLevel()}
                >
                  Add level
                </Button>
              </div>
            </div>
          </fieldset>
        ) : (
          <p className="rounded-md border border-gray-700 bg-gray-950/60 p-2 text-xs text-gray-400">
            Save this area first, then add qualification levels.
          </p>
        )}
      </CreatePanel>
      <DeleteModal
        isOpen={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
        itemName={deleting?.name}
        isConfirming={deleteBusy}
        message="Permanently delete the qualification area"
        warningMessage="This cannot be undone. Archive instead if you only want to hide it."
      />
    </>
  );
};

export default QualificationManager;
