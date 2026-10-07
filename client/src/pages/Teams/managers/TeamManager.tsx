import { useContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, UserPlus } from "lucide-react";
import Button from "../../../components/Button/Button";
import Input from "../../../components/Input/Input";
import TextArea from "../../../components/TextArea/TextArea";
import DeleteModal from "../../../components/Modal/DeleteModal";
import Modal from "../../../components/Modal/Modal";
import { GlobalInfoContext } from "../../../context/globalInfo";
import Checkbox from "../../../components/Checkbox/Checkbox";
import { useToast } from "../../../context/toastContext";
import {
  archiveTeam,
  createTeam,
  deleteTeam,
  updateTeam,
  addTeamRosterMemberToTeam,
  removeTeamRosterMemberFromTeam,
  searchTeamRosterCandidates,
  type TeamRosterCandidate,
  type TeamPayload,
} from "../../../api/auth";
import type { TeamRecord, TeamPosition, TeamQualificationArea, TeamRole, TeamRosterMember } from "../../../api/authTypes";
import generateRandomId from "../../../utils/generateRandomId";
import CreatePanel from "../CreatePanel";
import PortableDataActions from "../../../components/PortableDataTransfer/PortableDataActions";
import EntityMultiSelect from "../EntityMultiSelect";
import EntityRow from "../components/EntityRow";
import FormActionButtons from "../components/FormActionButtons";
import EntityFormDangerActions from "../components/EntityFormDangerActions";
import {
  EntityListFilterPanel,
  EntityListFilterFooter,
  EntityListFilterToolbar,
  type EntityListFilterState,
} from "../components/EntityListFilters";
import TeamEditorRelatedSection from "../components/TeamEditorRelatedSection";
import TeamsReturnToolbar from "../components/TeamsReturnToolbar";
import EntityIconPicker from "../EntityIconPicker";
import { showApiErrorToast } from "../../../utils/apiErrorToast";
import EntityIconBadge from "../../../components/icons/EntityIconBadge";
import MemberAvatar from "../../../components/MemberAvatar/MemberAvatar";
import { describeDeletionImpacts, memberName, normalizeSafeRosterMember, sortPositionsByOrder } from "../teamsUtils";
import { TEAMS_SECTION_PATHS } from "../teamsReturnNavigation";
import {
  buildGroupsReturnTo,
  buildTeamsPositionsPath,
  buildTeamsQualificationsPath,
  buildTeamsRolesPath,
} from "../teamsReturnNavigation";
import { useTeamsRestoreOnMount, useTeamsReturnNavigation } from "../hooks/useTeamsReturnNavigation";
import { useTeamsUnsavedChanges } from "../hooks/useTeamsUnsavedChanges";
import { useTeamsNavigationGuard } from "../TeamsNavigationGuardContext";
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
  canEditTeams: boolean;
  canEditTeam: (teamId: string) => boolean;
  onSaved: (team: TeamRecord, replaceId?: string) => void;
  onArchived: () => void;
  onRemoved: (teamId: string) => void;
  onTeamRosterSaved?: (team: TeamRecord) => void;
  onRosterMemberSaved?: (member: TeamRosterMember) => void;
  onRosterMemberRemoved?: (memberId: string) => void;
  onRosterMutationReconcile?: (memberId: string) => void;
  onImported?: () => void;
};

const TeamManager = ({
  teams,
  positions,
  roles,
  qualificationAreas,
  members,
  data,
  canEditTeams,
  canEditTeam,
  onSaved,
  onArchived,
  onRemoved,
  onTeamRosterSaved = () => {},
  onRosterMemberSaved = () => {},
  onRosterMemberRemoved = () => {},
  onRosterMutationReconcile = () => {},
  onImported,
}: TeamManagerProps) => {
  const context = useContext(GlobalInfoContext);
  const { showToast } = useToast();
  const churchId = context?.churchId || "";
  const navigate = useNavigate();
  const [editing, setEditing] = useState<TeamRecord | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [listQuery, setListQuery] = useState("");
  const [listFilters, setListFilters] = useState<EntityListFilterState>({ teamIds: [], includeArchived: false });
  const [showFilters, setShowFilters] = useState(false);
  const [deleting, setDeleting] = useState<TeamRecord | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [rosterPickerTeam, setRosterPickerTeam] = useState<TeamRecord | null>(null);
  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidates, setCandidates] = useState<TeamRosterCandidate[]>([]);
  const [candidateBusy, setCandidateBusy] = useState(false);
  const [candidateError, setCandidateError] = useState("");
  const candidateRequestSequenceRef = useRef(0);
  const [rosterMutationMember, setRosterMutationMember] = useState<TeamRosterMember | null>(null);
  const [rosterMutationBusy, setRosterMutationBusy] = useState(false);
  const [draft, setDraft] = useState<TeamPayload>({
    name: "",
    description: "",
    icon: "",
    memberIds: [],
    usesMicrophoneAssignments: false,
    usesIemAssignments: false,
  });
  // Teams with a save currently in flight, keyed by teamId (or CREATE_SAVING_KEY
  // for a new team). Tracking per-editor keeps the Save spinner on the team
  // actually saving and lets editing continue back-to-back in the background.
  const [savingIds, setSavingIds] = useState<Set<string>>(() => new Set());
  const pendingEditTeamIdRef = useRef<string | null>(null);
  const { returnTo, finishEditing } = useTeamsReturnNavigation();
  const { requestDiscardAction } = useTeamsNavigationGuard();
  const currentEditingTeam = editing
    ? teams.find((team) => team.teamId === editing.teamId) || editing
    : null;
  const canEditCurrentTeam = editing
    ? canEditTeam(editing.teamId)
    : canEditTeams;

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

  const filteredTeams = useMemo(
    () => teams.filter((team) =>
      (listFilters.includeArchived || !team.archivedAt) &&
      (!listQuery.trim() || team.name.toLowerCase().includes(listQuery.trim().toLowerCase())),
    ),
    [listFilters.includeArchived, listQuery, teams],
  );

  const reset = () => {
    setEditing(null);
    setShowCreate(false);
    setDraft({
      name: "",
      description: "",
      icon: "",
      memberIds: [],
      usesMicrophoneAssignments: false,
      usesIemAssignments: false,
    });
  };

  const cancelEditing = () => {
    requestDiscardAction(() => finishEditing(reset));
  };

  const startEditingTeam = useCallback((team: TeamRecord) => {
    setEditing(team);
    setShowCreate(true);
    setDraft({
      name: team.name,
      description: team.description || "",
      icon: team.icon || "",
      memberIds: team.memberIds || [],
      usesMicrophoneAssignments: Boolean(team.usesMicrophoneAssignments),
      usesIemAssignments: Boolean(team.usesIemAssignments),
    });
  }, []);

  const selectTeam = useCallback((team: TeamRecord) => {
    if (editing?.teamId === team.teamId) return;
    requestDiscardAction(() => startEditingTeam(team));
  }, [editing?.teamId, requestDiscardAction, startEditingTeam]);

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
    if (!canEditTeam(team.teamId)) return;
    startEditingTeam(team);
  }, [canEditTeam, startEditingTeam, teams]);

  const confirmDelete = async () => {
    if (!canEditTeams) return;
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
    if (!canEditCurrentTeam) return;
    const wasEditing = editing;
    const savingKey = wasEditing?.teamId ?? CREATE_SAVING_KEY;
    // Ignore a repeat submit for the same editor while its save is pending —
    // this prevents a fast double-click on "Create" from making duplicates.
    if (savingIds.has(savingKey)) return;
    setSavingIds((prev) => new Set(prev).add(savingKey));
    const localTeamId = wasEditing?.teamId || `local-team-${generateRandomId()}`;
    const authoritativeTeam = wasEditing ? currentEditingTeam : null;
    const savedMemberIds = authoritativeTeam?.memberIds || [];
    const optimisticTeam: TeamRecord = {
      churchId,
      teamId: localTeamId,
      name: draft.name.trim(),
      description: draft.description || "",
      icon: draft.icon || "",
      memberIds: wasEditing && !canEditTeams ? savedMemberIds : draft.memberIds,
      usesMicrophoneAssignments: Boolean(draft.usesMicrophoneAssignments),
      usesIemAssignments: Boolean(draft.usesIemAssignments),
      archivedAt: wasEditing?.archivedAt || null,
    };
    const savedRecord = wasEditing
      ? { ...wasEditing, ...optimisticTeam }
      : optimisticTeam;
    onSaved(savedRecord);
    try {
      const response = wasEditing
        ? await updateTeam(churchId, wasEditing.teamId, {
          ...draft,
          memberIds: canEditTeams ? draft.memberIds : savedMemberIds,
        })
        : await createTeam(churchId, draft);
      if (!wasEditing) {
        onSaved(response.team, localTeamId);
      }
      // Saving commits data; Back or Cancel is responsible for leaving this editor.
      if (wasEditing) {
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
  const hasPendingChanges = editing
    ? JSON.stringify({ ...draft, memberIds: [...draft.memberIds].sort() }) !==
      JSON.stringify({
        name: editing.name,
        description: editing.description || "",
        icon: editing.icon || "",
        memberIds: [...(editing.memberIds || [])].sort(),
        usesMicrophoneAssignments: Boolean(editing.usesMicrophoneAssignments),
        usesIemAssignments: Boolean(editing.usesIemAssignments),
      })
    : JSON.stringify({ ...draft, memberIds: [...draft.memberIds].sort() }) !==
      JSON.stringify({
        name: "",
        description: "",
        icon: "",
        memberIds: [],
        usesMicrophoneAssignments: false,
        usesIemAssignments: false,
      });
  useTeamsUnsavedChanges(hasPendingChanges);

  const formatNameList = (names: string[]) =>
    names.length === 0 ? "None yet." : names.join(", ");
  const teamSubtitle = (team: TeamRecord) => {
    const names = team.memberIds
      .map((memberId) => members.find((member) => member.memberId === memberId))
      .filter((member): member is TeamRosterMember => Boolean(member))
      .slice(0, 3)
      .map(memberName);
    const remaining = Math.max(0, team.memberIds.length - names.length);
    const moreSummary = remaining > 0 ? ` +${remaining} more` : "";
    const rosterSummary = names.length === 0 ? "" : ` · ${names.join(", ")}${moreSummary}`;
    const memberLabel = team.memberIds.length === 1 ? "member" : "members";
    return `${team.memberIds.length} ${memberLabel} | ${positions.filter((position) => position.teamId === team.teamId).length} positions${rosterSummary}`;
  };

  const searchCandidates = async () => {
    if (!rosterPickerTeam || candidateQuery.trim().length < 2 || candidateBusy) return;
    const requestSequence = ++candidateRequestSequenceRef.current;
    const requestedTeamId = rosterPickerTeam.teamId;
    setCandidateBusy(true);
    setCandidateError("");
    try {
      const result = await searchTeamRosterCandidates(churchId, requestedTeamId, candidateQuery.trim());
      if (requestSequence === candidateRequestSequenceRef.current) {
        setCandidates(result.candidates || []);
      }
    } catch (error) {
      if (requestSequence === candidateRequestSequenceRef.current) {
        setCandidateError("Could not search people. Try again.");
        showApiErrorToast(showToast, error, "Could not search people.");
      }
    } finally {
      setCandidateBusy(false);
    }
  };

  const updateCandidateQuery = (query: string) => {
    candidateRequestSequenceRef.current += 1;
    setCandidates([]);
    setCandidateQuery(query);
  };

  const addCandidate = async (candidate: TeamRosterCandidate) => {
    if (!rosterPickerTeam || candidateBusy) return;
    setCandidateBusy(true);
    try {
      const result = await addTeamRosterMemberToTeam(churchId, rosterPickerTeam.teamId, candidate.memberId);
      onTeamRosterSaved(result.team);
      onRosterMemberSaved(normalizeSafeRosterMember(result.member));
      onRosterMutationReconcile(candidate.memberId);
      setCandidates((current) => current.filter((item) => item.memberId !== candidate.memberId));
      setRosterPickerTeam(null);
      setCandidateQuery("");
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not add this person to the team.");
    } finally {
      setCandidateBusy(false);
    }
  };

  const confirmRosterRemoval = async () => {
    if (!editing || !rosterMutationMember || rosterMutationBusy) return;
    setRosterMutationBusy(true);
    try {
      const result = await removeTeamRosterMemberFromTeam(churchId, editing.teamId, rosterMutationMember.memberId);
      onTeamRosterSaved(result.team);
      const remainsInVisibleTeam = teams.some((team) =>
        !team.archivedAt &&
        team.teamId !== editing.teamId &&
        team.memberIds?.includes(rosterMutationMember.memberId),
      );
      if (remainsInVisibleTeam) {
        onRosterMemberSaved(normalizeSafeRosterMember(result.member));
      } else {
        onRosterMemberRemoved(rosterMutationMember.memberId);
      }
      onRosterMutationReconcile(rosterMutationMember.memberId);
      setRosterMutationMember(null);
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not remove this person from the team.");
    } finally {
      setRosterMutationBusy(false);
    }
  };

  return (
    <>
      <CreatePanel
        open={showCreate}
        onOpenCreate={() => {
          requestDiscardAction(() => {
            setShowFilters(false);
            reset();
            setShowCreate(true);
          });
        }}
        canEdit={canEditTeams}
        keepCreateActionVisible
        title={editing ? "Edit team" : "Create team"}
        sectionTitle="Teams"
        description="Organize members into scheduling teams."
        createLabel="Create team"
        listHeaderActions={canEditTeams ? <PortableDataActions type="teams" onImported={onImported} /> : undefined}
        listToolbar={
          <div className="space-y-3">
            {returnTo && !showCreate ? (
              <TeamsReturnToolbar returnTo={returnTo} onBack={cancelEditing} />
            ) : null}
            <EntityListFilterToolbar
              entityLabel="Teams"
              query={listQuery}
              onQueryChange={setListQuery}
              filters={listFilters}
              onFiltersChange={setListFilters}
              filtersOpen={showFilters}
              onFiltersOpenChange={setShowFilters}
            />
          </div>
        }
        asideOpen={showFilters}
        asideTitle="Filter teams"
        asideHeaderActions={<Button variant="tertiary" onClick={() => setShowFilters(false)}>Close</Button>}
        aside={<EntityListFilterPanel entityLabel="teams" filters={listFilters} onFiltersChange={setListFilters} />}
        asideFooter={<EntityListFilterFooter filters={listFilters} onClear={() => setListFilters({ teamIds: [], includeArchived: false })} onClose={() => setShowFilters(false)} />}
        list={
          <>
            {filteredTeams.length === 0 ? <p className="text-sm text-gray-300">{teams.length === 0 ? "No teams yet." : "No matches."}</p> : null}
            {filteredTeams.map((team) => (
              <EntityRow
                key={team.teamId}
                title={team.name}
                subtitle={teamSubtitle(team)}
                icon={team.icon}
                archived={Boolean(team.archivedAt)}
                canEdit={canEditTeam(team.teamId)}
                onTitleClick={canEditTeam(team.teamId) ? () => selectTeam(team) : undefined}
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
                  canEdit={canEditTeams}
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
            entityLabel="team"
            isCreate={!editing}
            isSaving={isSavingCurrent}
            onSave={() => void submit()}
            onCancel={cancelEditing}
            hasPendingChanges={hasPendingChanges}
            disabled={!canEditCurrentTeam || !draft.name.trim() || isSavingCurrent}
          />
        }
      >
        <Input disabled={!canEditCurrentTeam} label="Name" value={draft.name} onChange={(name) => setDraft((d) => ({ ...d, name: String(name) }))} />
        {canEditCurrentTeam ? (
          <EntityIconPicker context="team" value={draft.icon || ""} onChange={(icon) => setDraft((d) => ({ ...d, icon }))} />
        ) : (
          <div className="space-y-1">
            <p className="text-sm font-medium text-gray-200">Icon</p>
            <EntityIconBadge icon={draft.icon} className="h-7 w-7" />
          </div>
        )}
        <TextArea disabled={!canEditCurrentTeam} label="Description" value={draft.description || ""} textareaClassName="min-h-20" onChange={(description) => setDraft((d) => ({ ...d, description }))} />
        {canEditTeams ? (
          <EntityMultiSelect
            label="Members"
            options={members.map((member) => ({ id: member.memberId, label: memberName(member), archived: Boolean(member.archivedAt) }))}
            value={draft.memberIds}
            onChange={(memberIds) => setDraft((d) => ({ ...d, memberIds }))}
          />
        ) : editing ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-gray-200">Members</p>
                <p className="text-sm text-gray-300">{(currentEditingTeam?.memberIds || []).length} {(currentEditingTeam?.memberIds || []).length === 1 ? "member" : "members"}</p>
              </div>
              {canEditCurrentTeam && !editing.archivedAt ? (
                <Button type="button" variant="secondary" svg={UserPlus} iconSize="sm" onClick={() => {
                  setRosterPickerTeam(editing);
                  setCandidateQuery("");
                  setCandidates([]);
                }}>Add member</Button>
              ) : null}
            </div>
            <ul className="divide-y divide-gray-700/60">
              {(currentEditingTeam?.memberIds || []).map((memberId) => {
                const rosterMember = members.find((item) => item.memberId === memberId);
                if (!rosterMember) return null;
                return (
                  <li key={memberId} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 truncate text-sm text-gray-200">{memberName(rosterMember)}</span>
                    {canEditCurrentTeam && !editing.archivedAt ? (
                      <Button type="button" variant="tertiary" className="text-xs" onClick={() => setRosterMutationMember(rosterMember)}>Remove from team</Button>
                    ) : null}
                  </li>
                );
              })}
              {(currentEditingTeam?.memberIds || []).length === 0 ? <li className="py-2 text-sm text-gray-400">No members yet.</li> : null}
            </ul>
          </div>
        ) : null}
        <Checkbox
          label={(
            <span className="flex flex-col gap-0.5">
              <span>Use microphone assignments</span>
              <span className="text-xs text-gray-400">
                Schedule microphones for this team&apos;s roles on each service day.
              </span>
            </span>
          )}
          checked={Boolean(draft.usesMicrophoneAssignments)}
          disabled={!canEditCurrentTeam}
          onCheckedChange={(usesMicrophoneAssignments) => setDraft((current) => ({
            ...current,
            usesMicrophoneAssignments,
          }))}
        />
        <Checkbox
          label={(
            <span className="flex flex-col gap-0.5">
              <span>Use IEM assignments</span>
              <span className="text-xs text-gray-400">Assign physical IEMs/beltpacks to this team&apos;s roles.</span>
            </span>
          )}
          checked={Boolean(draft.usesIemAssignments)}
          disabled={!canEditCurrentTeam}
          onCheckedChange={(usesIemAssignments) => setDraft((current) => ({ ...current, usesIemAssignments }))}
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
      <Modal
        isOpen={Boolean(rosterPickerTeam)}
        onClose={() => { if (!candidateBusy) { candidateRequestSequenceRef.current += 1; setRosterPickerTeam(null); } }}
        title={`Add member to ${rosterPickerTeam?.name || "team"}`}
        description="Search active church roster members by name."
        size="md"
        busy={candidateBusy}
      >
        <div className="space-y-4">
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Input label="Search existing person" value={candidateQuery} onChange={(value) => updateCandidateQuery(String(value))} />
            </div>
            <Button type="button" variant="secondary" svg={Search} isLoading={candidateBusy} disabled={candidateQuery.trim().length < 2 || candidateBusy} onClick={() => void searchCandidates()}>Search</Button>
          </div>
          {candidateQuery.trim().length > 0 && candidateQuery.trim().length < 2 ? <p className="text-sm text-gray-400">Enter at least 2 characters.</p> : null}
          {candidateError ? <p role="alert" className="text-sm text-red-300">{candidateError}</p> : null}
          <ul className="divide-y divide-gray-700/60">
            {candidates.map((candidate) => {
              const name = memberName(candidate as TeamRosterMember);
              return <li key={candidate.memberId} className="flex items-center justify-between gap-3 py-2">
                <span className="flex min-w-0 items-center gap-2">
                  <MemberAvatar profileImageUrl={candidate.profileImageUrl} memberName={name} />
                  <span className="truncate text-sm text-gray-200">{name}</span>
                </span>
                <Button type="button" variant="secondary" svg={Plus} iconSize="sm" disabled={candidateBusy} onClick={() => void addCandidate(candidate)}>Add</Button>
              </li>;
            })}
          </ul>
          {candidates.length === 0 && candidateQuery.trim().length >= 2 && !candidateBusy && !candidateError ? <p className="text-sm text-gray-400">No matching people found.</p> : null}
          {canEditCurrentTeam ? <Button type="button" variant="tertiary" svg={Plus} onClick={() => {
            const team = rosterPickerTeam;
            setRosterPickerTeam(null);
            if (team) navigate(TEAMS_SECTION_PATHS.members, { state: { teamsCreateMember: { teamId: team.teamId } } });
          }}>Create new member</Button> : null}
        </div>
      </Modal>
      <Modal
        isOpen={Boolean(rosterMutationMember)}
        onClose={() => { if (!rosterMutationBusy) setRosterMutationMember(null); }}
        title={`Remove ${rosterMutationMember ? memberName(rosterMutationMember) : "member"} from ${editing?.name || "team"}?`}
        size="sm"
        busy={rosterMutationBusy}
      >
        {rosterMutationMember ? <div className="space-y-4 text-sm text-gray-200">
          <p>This removes their {editing?.name || "team"} positions, team role, and qualifications.</p>
          <p>Existing schedule assignments will remain and can be reassigned separately.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={rosterMutationBusy} onClick={() => setRosterMutationMember(null)}>Cancel</Button>
            <Button type="button" isLoading={rosterMutationBusy} disabled={rosterMutationBusy} onClick={() => void confirmRosterRemoval()}>Remove from team</Button>
          </div>
        </div> : null}
      </Modal>
    </>
  );
};

export default TeamManager;
