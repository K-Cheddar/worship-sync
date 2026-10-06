import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus, Save } from "lucide-react";
import Button from "../../../components/Button/Button";
import Input from "../../../components/Input/Input";
import TextArea from "../../../components/TextArea/TextArea";
import EntityIconPicker from "../EntityIconPicker";
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
import {
  EntityListFilterPanel,
  EntityListFilterFooter,
  EntityListFilterToolbar,
  type EntityListFilterState,
} from "../components/EntityListFilters";
import EntityRow from "../components/EntityRow";
import TeamsReturnToolbar from "../components/TeamsReturnToolbar";
import TeamsSectionReturnPrompt from "../components/TeamsSectionReturnPrompt";
import FormActionButtons from "../components/FormActionButtons";
import EntityFormDangerActions from "../components/EntityFormDangerActions";
import { showApiErrorToast } from "../../../utils/apiErrorToast";
import { isActive, qualificationAreaMatchesListQuery } from "../teamsUtils";
import { TEAMS_SECTION_PATHS } from "../teamsReturnNavigation";
import { useTeamsReturnNavigation } from "../hooks/useTeamsReturnNavigation";
import { useTeamsUnsavedChanges } from "../hooks/useTeamsUnsavedChanges";
import { useTeamsNavigationGuard } from "../TeamsNavigationGuardContext";
import { useTeamsTeamSearchParam } from "../hooks/useTeamsTeamSearchParam";

// Key used to track an in-flight save for the create form, which has no area id
// yet. Existing areas are tracked by their own areaId.
const CREATE_SAVING_KEY = "__create__";

type QualificationManagerProps = {
  areas: TeamQualificationArea[];
  levels: TeamQualificationLevel[];
  teams: TeamRecord[];
  canEditTeam: (teamId: string) => boolean;
  onAreaSaved: (area: TeamQualificationArea, replaceId?: string) => void;
  onLevelSaved: (level: TeamQualificationLevel, replaceId?: string) => void;
  onArchived: () => void;
  onAreaRemoved: (areaId: string) => void;
};

const QualificationManager = ({
  areas,
  levels,
  teams,
  canEditTeam,
  onAreaSaved,
  onLevelSaved,
  onArchived,
  onAreaRemoved,
}: QualificationManagerProps) => {
  const context = useContext(GlobalInfoContext);
  const { showToast } = useToast();
  const churchId = context?.churchId || "";
  const activeTeams = useMemo(() => teams.filter(isActive), [teams]);
  const editableTeams = useMemo(
    () => activeTeams.filter((team) => canEditTeam(team.teamId)),
    [activeTeams, canEditTeam],
  );
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [editing, setEditing] = useState<TeamQualificationArea | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deleting, setDeleting] = useState<TeamQualificationArea | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [draft, setDraft] = useState<TeamQualificationAreaPayload>({
    teamId: "",
    name: "",
    description: "",
    icon: "",
  });
  const [levelDrafts, setLevelDrafts] = useState<
    Record<string, TeamQualificationLevelPayload>
  >({});
  const [newLevelName, setNewLevelName] = useState("");
  const [newLevelRank, setNewLevelRank] = useState("1");
  const [levelSavingKey, setLevelSavingKey] = useState("");
  // Areas with a save currently in flight, keyed by areaId (or CREATE_SAVING_KEY
  // for a new area). Tracking per-editor keeps the Save spinner on the area
  // actually saving and lets editing continue back-to-back in the background.
  const [savingIds, setSavingIds] = useState<Set<string>>(() => new Set());
  const [listQuery, setListQuery] = useState("");
  const [listFilters, setListFilters] = useState<EntityListFilterState>({ teamIds: [], includeArchived: false });
  const [showFilters, setShowFilters] = useState(false);
  const { returnTo, finishEditing } = useTeamsReturnNavigation();
  const { requestDiscardAction } = useTeamsNavigationGuard();
  // Mirrors `editing` so an in-flight save can tell, on completion, whether the
  // operator has since switched areas — without rebinding the panel or clobbering
  // the other area's level drafts.
  const editingRef = useRef<TeamQualificationArea | null>(null);
  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  const applyTeamId = useCallback((nextTeamId: string) => {
    setSelectedTeamId(nextTeamId);
  }, []);

  useTeamsTeamSearchParam(
    activeTeams.map((team) => team.teamId),
    applyTeamId,
  );

  const teamId = selectedTeamId || activeTeams[0]?.teamId || "";
  const creationTeamId = canEditTeam(teamId)
    ? teamId
    : editableTeams[0]?.teamId || "";
  const canEditArea = editing
    ? canEditTeam(editing.teamId)
    : Boolean(creationTeamId && canEditTeam(creationTeamId));
  const teamAreas = areas.filter((area) =>
    (listFilters.teamIds.length === 0 || listFilters.teamIds.includes(area.teamId)) &&
    (listFilters.includeArchived || isActive(area)),
  );
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

  const levelsByAreaId = useMemo(() => {
    const levelsByArea = new Map<string, TeamQualificationLevel[]>();
    levels.forEach((level) => {
      const areaLevels = levelsByArea.get(level.areaId) || [];
      areaLevels.push(level);
      levelsByArea.set(level.areaId, areaLevels);
    });
    levelsByArea.forEach((areaLevels) => {
      areaLevels.sort((a, b) => a.rank - b.rank);
    });
    return levelsByArea;
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
    setDraft({ teamId: creationTeamId, name: "", description: "", icon: "" });
    setLevelDrafts({});
    setNewLevelName("");
    setNewLevelRank("1");
    setLevelSavingKey("");
  };

  const cancelEditing = () => {
    requestDiscardAction(reset);
  };

  const returnToOrigin = () => {
    requestDiscardAction(() => finishEditing(reset));
  };

  const openAreaEditor = (area: TeamQualificationArea) => {
    if (!canEditTeam(area.teamId)) return;
    setShowFilters(false);
    setEditing(area);
    setSelectedTeamId(area.teamId);
    setShowCreate(true);
    setDraft({
      teamId: area.teamId,
      name: area.name,
      description: area.description || "",
      icon: area.icon || "",
    });
    resetLevelDrafts(area);
  };

  const selectArea = (area: TeamQualificationArea) => {
    if (!canEditTeam(area.teamId)) return;
    if (editing?.areaId === area.areaId) return;
    requestDiscardAction(() => openAreaEditor(area));
  };

  const confirmDelete = async () => {
    if (!deleting || !canEditTeam(deleting.teamId)) return;
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
    const areaTeamId = editing?.teamId || creationTeamId;
    if (!areaTeamId) {
      showToast("Create a team first, then add qualification areas.", "neutral");
      return;
    }
    if (!canEditTeam(areaTeamId)) return;
    const wasEditing = editing;
    const savingKey = wasEditing?.areaId ?? CREATE_SAVING_KEY;
    // Ignore a repeat submit for the same editor while its save is pending —
    // this prevents a fast double-click on "Create" from making duplicates.
    if (savingIds.has(savingKey)) return;
    setSavingIds((prev) => new Set(prev).add(savingKey));
    const localAreaId = wasEditing?.areaId || `local-area-${generateRandomId()}`;
    const payload: TeamQualificationAreaPayload = {
      teamId: areaTeamId,
      name: draft.name.trim(),
      description: draft.description || "",
      icon: draft.icon || "",
    };
    const optimisticArea: TeamQualificationArea = {
      churchId,
      areaId: localAreaId,
      teamId: areaTeamId,
      name: payload.name,
      description: payload.description,
      icon: payload.icon,
      archivedAt: wasEditing?.archivedAt || null,
    };
    onAreaSaved(wasEditing ? { ...wasEditing, ...optimisticArea } : optimisticArea);
    try {
      const response = wasEditing
        ? await updateTeamQualificationArea(churchId, wasEditing.areaId, payload)
        : await createTeamQualificationArea(churchId, payload);
      if (!wasEditing) {
        onAreaSaved(response.area, localAreaId);
      }
      // Saving commits data; Back or Cancel is responsible for leaving this editor.
      if (wasEditing) {
        if (editingRef.current?.areaId === wasEditing.areaId) {
          setEditing(response.area);
        }
      } else if (editingRef.current === null) {
        // Newly created and still on the create form: adopt the created area so
        // its levels can be added and a subsequent Save updates it.
        setEditing(response.area);
        resetLevelDrafts(response.area);
      }
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not save this qualification area.");
      onArchived();
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(savingKey);
        return next;
      });
    }
  };

  // The panel shows one editor at a time; its Save state reflects only the area
  // currently open, so a background save elsewhere never spins or disables it.
  const currentEditorKey = editing ? editing.areaId : CREATE_SAVING_KEY;
  const isSavingCurrent = savingIds.has(currentEditorKey);
  const hasPendingAreaChanges = editing
    ? JSON.stringify(draft) !==
    JSON.stringify({
      teamId: editing.teamId,
      name: editing.name,
      description: editing.description || "",
      icon: editing.icon || "",
    })
    : JSON.stringify(draft) !==
    JSON.stringify({ teamId: creationTeamId, name: "", description: "", icon: "" });
  const savedLevelDrafts = editing
    ? Object.fromEntries(
      levels
        .filter((level) => level.areaId === editing.areaId)
        .sort((a, b) => a.rank - b.rank)
        .map((level) => [
          level.levelId,
          {
            areaId: level.areaId,
            name: level.name,
            description: level.description || "",
            rank: level.rank,
          },
        ]),
    )
    : {};
  const defaultNewLevelRank = editing
    ? String(
      Math.max(
        0,
        ...levels
          .filter((level) => level.areaId === editing.areaId)
          .map((level) => level.rank),
      ) + 1,
    )
    : "1";
  const hasPendingLevelChanges =
    JSON.stringify(levelDrafts) !== JSON.stringify(savedLevelDrafts) ||
    Boolean(newLevelName) ||
    newLevelRank !== defaultNewLevelRank;
  // The draft starts empty while the list is displayed, so it can differ from
  // the default team before an editor has ever been opened. Only an open form
  // represents work that the operator could discard.
  const hasPendingChanges =
    showCreate && (hasPendingAreaChanges || hasPendingLevelChanges);
  useTeamsUnsavedChanges(hasPendingChanges);

  const saveLevel = async (levelId?: string) => {
    if (!canEditArea || !editing || !canEditTeam(editing.teamId)) return;
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
          if (!creationTeamId) return;
          requestDiscardAction(() => {
            setShowFilters(false);
            setSelectedTeamId(creationTeamId);
            reset();
            setShowCreate(true);
          });
        }}
        canEdit={Boolean(editableTeams.length)}
        keepCreateActionVisible
        title={editing ? "Edit qualification area" : "Create qualification area"}
        sectionTitle="Qualifications"
        description="Define qualification areas and levels."
        createLabel="Create area"
        scrollableList
        listToolbar={
          activeTeams.length === 0 ? (
            returnTo && !showCreate ? (
              <TeamsReturnToolbar returnTo={returnTo} onBack={() => finishEditing()} />
            ) : null
          ) : (
            <div className="space-y-3">
              {returnTo && !showCreate ? (
                <TeamsReturnToolbar returnTo={returnTo} onBack={() => finishEditing()} />
              ) : null}
              <EntityListFilterToolbar entityLabel="Qualification areas" query={listQuery} onQueryChange={setListQuery} filters={listFilters} onFiltersChange={setListFilters} filtersOpen={showFilters} onFiltersOpenChange={setShowFilters} />
            </div>
          )
        }
        asideOpen={showFilters}
        asideTitle="Filter qualifications"
        asideHeaderActions={<Button variant="tertiary" onClick={() => setShowFilters(false)}>Close</Button>}
        aside={<EntityListFilterPanel entityLabel="qualification areas" filters={listFilters} onFiltersChange={setListFilters} teamOptions={activeTeams.map((team) => ({ id: team.teamId, label: team.name }))} />}
        asideFooter={<EntityListFilterFooter filters={listFilters} onClear={() => setListFilters({ teamIds: [], includeArchived: false })} onClose={() => setShowFilters(false)} />}
        list={
          <>
            {activeTeams.length === 0 ? (
              <TeamsSectionReturnPrompt
                message="Create a team first — qualification areas belong to a team."
                originSection={TEAMS_SECTION_PATHS.qualifications}
              />
            ) : (
              <>
                {teamAreas.length === 0 ? (
                  <p className="text-sm text-gray-300">
                    No qualification areas match the current filters.
                  </p>
                ) : null}
                {teamAreas.length > 0 && filteredTeamAreas.length === 0 ? (
                  <p className="text-sm text-gray-300">No matches.</p>
                ) : null}
                {filteredTeamAreas.map((area) => {
                  const areaLevels = levelsByAreaId.get(area.areaId) || [];
                  return (
                    <EntityRow
                      key={area.areaId}
                      title={area.name}
                      icon={area.icon || "Award"}
                      details={
                        <div className="mt-0.5 space-y-1">
                          {area.description ? (
                            <p className="text-xs text-gray-400">{area.description}</p>
                          ) : null}
                          <div className="text-xs">
                            <p className="text-gray-500">Levels</p>
                            {areaLevels.length > 0 ? (
                              <ol className="flex flex-wrap gap-x-3 gap-y-0.5 text-gray-400">
                                {areaLevels.map((level) => (
                                  <li key={level.levelId}>
                                    {level.rank} · {level.name}
                                  </li>
                                ))}
                              </ol>
                            ) : (
                              <p className="text-gray-500">No levels yet.</p>
                            )}
                          </div>
                        </div>
                      }
                      archived={Boolean(area.archivedAt)}
                      compact
                      canEdit={canEditTeam(area.teamId)}
                      onTitleClick={() => selectArea(area)}
                    />
                  );
                })}
              </>
            )}
          </>
        }
        formHeaderActions={
          editing || returnTo ? (
            <TeamsReturnToolbar returnTo={returnTo} onBack={returnToOrigin}>
              {editing ? (
                <EntityFormDangerActions
                  archived={Boolean(editing.archivedAt)}
                  canEdit={canEditArea}
                  archiveLabel="Archive area"
                  deleteLabel="Delete area"
                  menuLabel="Qualification area actions"
                  onArchive={
                    editing.archivedAt
                      ? undefined
                      : async () => {
                        if (!canEditTeam(editing.teamId)) return;
                        const archivedArea = {
                          ...editing,
                          archivedAt: new Date().toISOString(),
                        };
                        onAreaSaved(archivedArea);
                        try {
                          await archiveTeamQualificationArea(churchId, editing.areaId);
                          finishEditing(reset);
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
              ) : null}
            </TeamsReturnToolbar>
          ) : null
        }
        formFooter={
          <FormActionButtons
            pinFooter
            entityLabel="qualification area"
            isCreate={!editing}
            isSaving={isSavingCurrent}
            onSave={() => void submitArea()}
            onCancel={cancelEditing}
            hasPendingChanges={hasPendingChanges}
            disabled={!canEditArea || !draft.name.trim() || isSavingCurrent}
          />
        }
      >
        <p className="text-xs text-gray-400">
          Adding to{" "}
          <span className="font-semibold text-gray-200">
            {activeTeams.find((team) => team.teamId === (editing?.teamId || creationTeamId))?.name ||
              "a team"}
          </span>
          .
        </p>
        <Input
          label="Area name"
          value={draft.name}
          onChange={(name) => setDraft((current) => ({ ...current, name: String(name) }))}
        />
        <EntityIconPicker context="team" value={draft.icon || ""} fallbackIcon="Award" onChange={(icon) => setDraft((current) => ({ ...current, icon }))} />
        <TextArea
          label="Description"
          value={draft.description || ""}
          textareaClassName="min-h-20"
          onChange={(description) =>
            setDraft((current) => ({ ...current, description }))
          }
        />
        {editing ? (
          <fieldset disabled={!canEditArea} className="space-y-2">
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
                const hasPendingLevelChanges = JSON.stringify(levelDraft) !== JSON.stringify({
                  areaId: level.areaId,
                  name: level.name,
                  description: level.description || "",
                  rank: level.rank,
                });
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
                      onChange={(name) => {
                        setLevelDrafts((current) => ({
                          ...current,
                          [level.levelId]: { ...levelDraft, name: String(name) },
                        }));
                      }}
                    />
                    <Input
                      label="Rank"
                      hideLabel
                      type="number"
                      value={levelDraft.rank}
                      onChange={(rank) => {
                        setLevelDrafts((current) => ({
                          ...current,
                          [level.levelId]: {
                            ...levelDraft,
                            rank: Number(rank),
                          },
                        }));
                      }}
                    />
                    <Button
                      variant="tertiary"
                      aria-label={
                        levelSavingKey === `level:${level.levelId}`
                          ? `Saving ${level.name}`
                          : !hasPendingLevelChanges
                            ? `Saved ${level.name}`
                            : `Save ${level.name}`
                      }
                      aria-busy={levelSavingKey === `level:${level.levelId}` || undefined}
                      disabled={!canEditArea || levelSavingKey === `level:${level.levelId}` || !hasPendingLevelChanges}
                      svg={levelSavingKey === `level:${level.levelId}` || !hasPendingLevelChanges ? undefined : Save}
                      onClick={() => void saveLevel(level.levelId)}
                    >
                      {levelSavingKey === `level:${level.levelId}` ? "Saving…" : !hasPendingLevelChanges ? <><Check aria-hidden="true" className="size-4 shrink-0 text-emerald-300" />Saved</> : "Save"}
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
                  onChange={(name) => {
                    setNewLevelName(String(name));
                  }}
                />
                <Input
                  label="Rank"
                  hideLabel
                  type="number"
                  value={newLevelRank}
                  onChange={(rank) => {
                    setNewLevelRank(String(rank));
                  }}
                />
                <Button
                  variant="secondary"
                  svg={Plus}
                  aria-busy={levelSavingKey === "level:new" || undefined}
                  disabled={!canEditArea || levelSavingKey === "level:new" || !newLevelName.trim() || !Number.isFinite(Number(newLevelRank))}
                  onClick={() => void saveLevel()}
                >
                  {levelSavingKey === "level:new" ? "Creating…" : "Add level"}
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
