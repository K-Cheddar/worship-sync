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
  archiveTeam,
  createTeamQualificationArea,
  createTeamQualificationLevel,
  createTeamRole,
  createTeam,
  deleteTeam,
  updateTeamQualificationArea,
  updateTeamQualificationLevel,
  updateTeamRole,
  updateTeam,
  type TeamQualificationAreaPayload,
  type TeamQualificationLevelPayload,
  type TeamPayload,
  type TeamRolePayload,
} from "../../../api/auth";
import type {
  TeamQualificationArea,
  TeamQualificationLevel,
  TeamRecord,
  TeamPosition,
  TeamRole,
  TeamRosterMember,
} from "../../../api/authTypes";
import generateRandomId from "../../../utils/generateRandomId";
import CreatePanel from "../CreatePanel";
import EntityMultiSelect from "../EntityMultiSelect";
import EntityRow from "../components/EntityRow";
import FormActionButtons from "../components/FormActionButtons";
import PositionIconPicker from "../PositionIconPicker";
import { showApiErrorToast } from "../../../utils/apiErrorToast";
import { describeDeletionImpacts, memberName } from "../teamsUtils";
import type { TeamsData } from "../types";

type TeamManagerProps = {
  teams: TeamRecord[];
  positions: TeamPosition[];
  members: TeamRosterMember[];
  data: TeamsData;
  canEdit: boolean;
  onSaved: (team: TeamRecord, replaceId?: string) => void;
  onArchived: () => void;
  onRemoved: (teamId: string) => void;
  onRoleSaved: (role: TeamRole, replaceId?: string) => void;
  onAreaSaved: (area: TeamQualificationArea, replaceId?: string) => void;
  onLevelSaved: (level: TeamQualificationLevel, replaceId?: string) => void;
};

const TeamManager = ({
  teams,
  positions,
  members,
  data,
  canEdit,
  onSaved,
  onArchived,
  onRemoved,
  onRoleSaved,
  onAreaSaved,
  onLevelSaved,
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
  const [roleDrafts, setRoleDrafts] = useState<Record<string, TeamRolePayload>>({});
  const [newRoleName, setNewRoleName] = useState("");
  const [areaDrafts, setAreaDrafts] = useState<
    Record<string, TeamQualificationAreaPayload>
  >({});
  const [newAreaName, setNewAreaName] = useState("");
  const [levelDrafts, setLevelDrafts] = useState<
    Record<string, TeamQualificationLevelPayload>
  >({});
  const [newLevelAreaId, setNewLevelAreaId] = useState("");
  const [newLevelName, setNewLevelName] = useState("");
  const [newLevelRank, setNewLevelRank] = useState("1");
  const [definitionSavingKey, setDefinitionSavingKey] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setEditing(null);
    setShowCreate(false);
    setDraft({ name: "", description: "", icon: "", memberIds: [] });
    setRoleDrafts({});
    setNewRoleName("");
    setAreaDrafts({});
    setNewAreaName("");
    setLevelDrafts({});
    setNewLevelAreaId("");
    setNewLevelName("");
    setNewLevelRank("1");
    setDefinitionSavingKey("");
  };

  const startEditingTeam = (team: TeamRecord) => {
    const teamRoles = data.teamRoles.filter((role) => role.teamId === team.teamId);
    const teamAreas = data.qualificationAreas.filter(
      (area) => area.teamId === team.teamId,
    );
    const teamAreaIdSet = new Set(teamAreas.map((area) => area.areaId));
    const teamLevels = data.qualificationLevels.filter((level) =>
      teamAreaIdSet.has(level.areaId),
    );
    setEditing(team);
    setShowCreate(true);
    setDraft({
      name: team.name,
      description: team.description || "",
      icon: team.icon || "",
      memberIds: team.memberIds || [],
    });
    setRoleDrafts(
      Object.fromEntries(
        teamRoles.map((role) => [
          role.roleId,
          {
            teamId: team.teamId,
            name: role.name,
            description: role.description || "",
          },
        ]),
      ),
    );
    setAreaDrafts(
      Object.fromEntries(
        teamAreas.map((area) => [
          area.areaId,
          {
            teamId: team.teamId,
            name: area.name,
            description: area.description || "",
          },
        ]),
      ),
    );
    setLevelDrafts(
      Object.fromEntries(
        teamLevels.map((level) => [
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
    setNewLevelAreaId(teamAreas[0]?.areaId || "");
  };

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

  const selectedTeamRoles = useMemo(
    () =>
      editing
        ? data.teamRoles.filter((role) => role.teamId === editing.teamId)
        : [],
    [data.teamRoles, editing],
  );
  const selectedTeamAreas = useMemo(
    () =>
      editing
        ? data.qualificationAreas.filter((area) => area.teamId === editing.teamId)
        : [],
    [data.qualificationAreas, editing],
  );
  const selectedTeamAreaIds = useMemo(
    () => new Set(selectedTeamAreas.map((area) => area.areaId)),
    [selectedTeamAreas],
  );
  const selectedTeamLevels = useMemo(
    () =>
      data.qualificationLevels
        .filter((level) => selectedTeamAreaIds.has(level.areaId))
        .sort((a, b) => a.rank - b.rank),
    [data.qualificationLevels, selectedTeamAreaIds],
  );

  const saveRole = async (roleId?: string) => {
    if (!canEdit) return;
    if (!editing) return;
    const savingKey = roleId ? `role:${roleId}` : "role:new";
    const payload = roleId
      ? roleDrafts[roleId]
      : { teamId: editing.teamId, name: newRoleName.trim(), description: "" };
    if (!payload?.name.trim()) return;
    setDefinitionSavingKey(savingKey);
    const localRole: TeamRole = {
      churchId,
      roleId: roleId || `local-role-${generateRandomId()}`,
      teamId: editing.teamId,
      name: payload.name.trim(),
      description: payload.description || "",
      archivedAt: roleId
        ? data.teamRoles.find((role) => role.roleId === roleId)?.archivedAt || null
        : null,
    };
    onRoleSaved(localRole);
    try {
      const response = roleId
        ? await updateTeamRole(churchId, roleId, payload)
        : await createTeamRole(churchId, payload);
      if (!roleId) {
        onRoleSaved(response.role, localRole.roleId);
      }
      if (!roleId) setNewRoleName("");
      setRoleDrafts((current) => ({
        ...current,
        [response.role.roleId]: {
          teamId: response.role.teamId,
          name: response.role.name,
          description: response.role.description || "",
        },
      }));
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not save this role.");
      onArchived();
    } finally {
      setDefinitionSavingKey("");
    }
  };

  const saveArea = async (areaId?: string) => {
    if (!canEdit) return;
    if (!editing) return;
    const savingKey = areaId ? `area:${areaId}` : "area:new";
    const payload = areaId
      ? areaDrafts[areaId]
      : { teamId: editing.teamId, name: newAreaName.trim(), description: "" };
    if (!payload?.name.trim()) return;
    setDefinitionSavingKey(savingKey);
    const localArea: TeamQualificationArea = {
      churchId,
      areaId: areaId || `local-area-${generateRandomId()}`,
      teamId: editing.teamId,
      name: payload.name.trim(),
      description: payload.description || "",
      archivedAt: areaId
        ? data.qualificationAreas.find((area) => area.areaId === areaId)
            ?.archivedAt || null
        : null,
    };
    onAreaSaved(localArea);
    try {
      const response = areaId
        ? await updateTeamQualificationArea(churchId, areaId, payload)
        : await createTeamQualificationArea(churchId, payload);
      if (!areaId) {
        onAreaSaved(response.area, localArea.areaId);
      }
      if (!areaId) {
        setNewAreaName("");
        setNewLevelAreaId((current) => current || response.area.areaId);
      }
      setAreaDrafts((current) => ({
        ...current,
        [response.area.areaId]: {
          teamId: response.area.teamId,
          name: response.area.name,
          description: response.area.description || "",
        },
      }));
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not save this qualification area.");
      onArchived();
    } finally {
      setDefinitionSavingKey("");
    }
  };

  const saveLevel = async (levelId?: string) => {
    if (!canEdit) return;
    const payload = levelId
      ? levelDrafts[levelId]
      : {
          areaId: newLevelAreaId,
          name: newLevelName.trim(),
          rank: Number(newLevelRank),
          description: "",
        };
    if (!payload?.areaId || !payload.name.trim() || !Number.isFinite(payload.rank)) {
      return;
    }
    const savingKey = levelId ? `level:${levelId}` : "level:new";
    setDefinitionSavingKey(savingKey);
    const localLevel: TeamQualificationLevel = {
      churchId,
      levelId: levelId || `local-level-${generateRandomId()}`,
      areaId: payload.areaId,
      name: payload.name.trim(),
      description: payload.description || "",
      rank: payload.rank,
      archivedAt: levelId
        ? data.qualificationLevels.find((level) => level.levelId === levelId)
            ?.archivedAt || null
        : null,
    };
    onLevelSaved(localLevel);
    try {
      const response = levelId
        ? await updateTeamQualificationLevel(churchId, levelId, payload)
        : await createTeamQualificationLevel(churchId, payload);
      if (!levelId) {
        onLevelSaved(response.level, localLevel.levelId);
      }
      if (!levelId) {
        setNewLevelName("");
        setNewLevelRank("1");
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
      setDefinitionSavingKey("");
    }
  };

  const submit = async () => {
    if (!canEdit) return;
    setSaving(true);
    const localTeamId = editing?.teamId || `local-team-${generateRandomId()}`;
    const optimisticTeam: TeamRecord = {
      churchId,
      teamId: localTeamId,
      name: draft.name.trim(),
      description: draft.description || "",
      icon: draft.icon || "",
      memberIds: draft.memberIds,
      archivedAt: editing?.archivedAt || null,
    };
    onSaved(editing ? { ...editing, ...optimisticTeam } : optimisticTeam);
    try {
      const response = editing
        ? await updateTeam(churchId, editing.teamId, draft)
        : await createTeam(churchId, draft);
      if (!editing) {
        onSaved(response.team, localTeamId);
      }
      reset();
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not save this team.");
      onArchived();
    } finally {
      setSaving(false);
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
        title={editing ? "Edit team" : "Create team"}
        sectionTitle="Teams"
        description="Organize members into scheduling teams."
        createLabel="Create team"
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
                onEdit={() => startEditingTeam(team)}
                onArchive={async () => {
                  if (!canEdit) return;
                  const archivedTeam = { ...team, archivedAt: new Date().toISOString() };
                  onSaved(archivedTeam);
                  try {
                    await archiveTeam(churchId, team.teamId);
                  } catch (error) {
                    showApiErrorToast(showToast, error, "Could not archive this team.");
                    onSaved(team);
                  }
                }}
                onDelete={() => setDeleting(team)}
              />
            ))}
          </>
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
          <>
            <fieldset className="space-y-2">
              <legend className="p-1 text-sm font-semibold">Team roles</legend>
              <div className="space-y-2 rounded-md border border-gray-700 bg-gray-950/60 p-2">
                {selectedTeamRoles.length === 0 ? (
                  <p className="text-sm text-gray-400">No roles yet.</p>
                ) : null}
                {selectedTeamRoles.map((role) => {
                  const roleDraft = roleDrafts[role.roleId] || {
                    teamId: editing.teamId,
                    name: role.name,
                    description: role.description || "",
                  };
                  return (
                    <div key={role.roleId} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <Input
                        label="Role name"
                        hideLabel
                        value={roleDraft.name}
                        placeholder="Media Director"
                        onChange={(name) =>
                          setRoleDrafts((current) => ({
                            ...current,
                            [role.roleId]: { ...roleDraft, name: String(name) },
                          }))
                        }
                      />
                      <Button
                        variant="tertiary"
                        svg={Save}
                        aria-label={`Save ${role.name}`}
                        isLoading={definitionSavingKey === `role:${role.roleId}`}
                        onClick={() => void saveRole(role.roleId)}
                      >
                        Save
                      </Button>
                    </div>
                  );
                })}
                <div className="grid gap-2 border-t border-gray-800 pt-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <Input
                    label="New role"
                    hideLabel
                    value={newRoleName}
                    placeholder="New role"
                    onChange={(name) => setNewRoleName(String(name))}
                  />
                  <Button
                    variant="secondary"
                    svg={Plus}
                    disabled={!newRoleName.trim()}
                    isLoading={definitionSavingKey === "role:new"}
                    onClick={() => void saveRole()}
                  >
                    Add role
                  </Button>
                </div>
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="p-1 text-sm font-semibold">Qualification areas</legend>
              <div className="space-y-2 rounded-md border border-gray-700 bg-gray-950/60 p-2">
                {selectedTeamAreas.length === 0 ? (
                  <p className="text-sm text-gray-400">No qualification areas yet.</p>
                ) : null}
                {selectedTeamAreas.map((area) => {
                  const areaDraft = areaDrafts[area.areaId] || {
                    teamId: editing.teamId,
                    name: area.name,
                    description: area.description || "",
                  };
                  return (
                    <div key={area.areaId} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <Input
                        label="Area name"
                        hideLabel
                        value={areaDraft.name}
                        placeholder="Camera"
                        onChange={(name) =>
                          setAreaDrafts((current) => ({
                            ...current,
                            [area.areaId]: { ...areaDraft, name: String(name) },
                          }))
                        }
                      />
                      <Button
                        variant="tertiary"
                        svg={Save}
                        aria-label={`Save ${area.name}`}
                        isLoading={definitionSavingKey === `area:${area.areaId}`}
                        onClick={() => void saveArea(area.areaId)}
                      >
                        Save
                      </Button>
                    </div>
                  );
                })}
                <div className="grid gap-2 border-t border-gray-800 pt-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <Input
                    label="New area"
                    hideLabel
                    value={newAreaName}
                    placeholder="New area"
                    onChange={(name) => setNewAreaName(String(name))}
                  />
                  <Button
                    variant="secondary"
                    svg={Plus}
                    disabled={!newAreaName.trim()}
                    isLoading={definitionSavingKey === "area:new"}
                    onClick={() => void saveArea()}
                  >
                    Add area
                  </Button>
                </div>
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="p-1 text-sm font-semibold">Qualification levels</legend>
              <div className="space-y-2 rounded-md border border-gray-700 bg-gray-950/60 p-2">
                {selectedTeamLevels.length === 0 ? (
                  <p className="text-sm text-gray-400">No qualification levels yet.</p>
                ) : null}
                {selectedTeamLevels.map((level) => {
                  const levelDraft = levelDrafts[level.levelId] || {
                    areaId: level.areaId,
                    name: level.name,
                    description: level.description || "",
                    rank: level.rank,
                  };
                  return (
                    <div key={level.levelId} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5rem_auto]">
                      <Select
                        label="Area"
                        hideLabel
                        value={levelDraft.areaId}
                        options={selectedTeamAreas.map((area) => ({
                          value: area.areaId,
                          label: area.name,
                        }))}
                        onChange={(areaId) =>
                          setLevelDrafts((current) => ({
                            ...current,
                            [level.levelId]: { ...levelDraft, areaId },
                          }))
                        }
                      />
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
                            [level.levelId]: { ...levelDraft, rank: Number(rank) },
                          }))
                        }
                      />
                      <Button
                        variant="tertiary"
                        svg={Save}
                        aria-label={`Save ${level.name}`}
                        isLoading={definitionSavingKey === `level:${level.levelId}`}
                        onClick={() => void saveLevel(level.levelId)}
                      >
                        Save
                      </Button>
                    </div>
                  );
                })}
                <div className="grid gap-2 border-t border-gray-800 pt-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5rem_auto]">
                  <Select
                    label="Area"
                    hideLabel
                    value={newLevelAreaId}
                    options={selectedTeamAreas.map((area) => ({
                      value: area.areaId,
                      label: area.name,
                    }))}
                    onChange={setNewLevelAreaId}
                    disabled={selectedTeamAreas.length === 0}
                  />
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
                      !newLevelAreaId ||
                      !newLevelName.trim() ||
                      !Number.isFinite(Number(newLevelRank))
                    }
                    isLoading={definitionSavingKey === "level:new"}
                    onClick={() => void saveLevel()}
                  >
                    Add level
                  </Button>
                </div>
              </div>
            </fieldset>
          </>
        ) : (
          <p className="rounded-md border border-gray-700 bg-gray-950/60 p-2 text-xs text-gray-400">
            Save this team before adding roles and qualification levels.
          </p>
        )}
        <p className="rounded-md border border-gray-700 bg-gray-950/60 p-2 text-xs text-gray-400">
          Positions belong to this team — add and manage them on the{" "}
          <span className="font-semibold text-gray-200">Positions</span> tab.
        </p>
        <FormActionButtons
          saveLabel="Save team"
          onSave={() => void submit()}
          onCancel={reset}
          disabled={!canEdit || !draft.name.trim()}
          isLoading={saving}
        />
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
