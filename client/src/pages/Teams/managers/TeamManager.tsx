import { useContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  type TeamUpdatePayload,
} from "../../../api/auth";
import type { TeamRecord, TeamPosition, TeamQualificationArea, TeamRole, TeamRosterMember } from "../../../api/authTypes";
import generateRandomId from "../../../utils/generateRandomId";
import CreatePanel from "../CreatePanel";
import PortableDataActions from "../../../components/PortableDataTransfer/PortableDataActions";
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
import TeamMemberProfileEditor from "./TeamMemberProfileEditor";
import TeamMembersEditor from "../components/TeamMembersEditor";
import TeamsReturnToolbar from "../components/TeamsReturnToolbar";
import EntityIconPicker from "../EntityIconPicker";
import { showApiErrorToast } from "../../../utils/apiErrorToast";
import EntityIconBadge from "../../../components/icons/EntityIconBadge";
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

const sameIdSet = (left: string[], right: string[]) => {
  const leftIds = new Set(left);
  const rightIds = new Set(right);
  return leftIds.size === rightIds.size && [...leftIds].every((id) => rightIds.has(id));
};

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
  onImported?: () => void | Promise<void>;
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
  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidates, setCandidates] = useState<TeamRosterCandidate[]>([]);
  const [candidateHasMore, setCandidateHasMore] = useState(false);
  const [candidateBusy, setCandidateBusy] = useState(false);
  const [candidateError, setCandidateError] = useState("");
  const [candidateSearchRevision, setCandidateSearchRevision] = useState(0);
  const candidateRequestSequenceRef = useRef(0);
  const [candidateAdding, setCandidateAdding] = useState<{ teamId: string; memberId: string } | null>(null);
  const candidateAddInFlightRef = useRef(false);
  const [rosterMutationMemberId, setRosterMutationMemberId] = useState<string | null>(null);
  const [teamProfileMember, setTeamProfileMember] = useState<TeamRosterMember | null>(null);
  const [rosterMutationBusy, setRosterMutationBusy] = useState(false);
  const [draft, setDraft] = useState<TeamPayload>({
    name: "",
    description: "",
    icon: "",
    memberIds: [],
    usesMicrophoneAssignments: false,
    usesIemAssignments: false,
  });
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const editorSessionRef = useRef(0);
  const saveDraftSnapshotsRef = useRef(new Map<string, TeamPayload>());
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
    editorSessionRef.current += 1;
    candidateRequestSequenceRef.current += 1;
    setCandidateQuery("");
    setCandidates([]);
    setCandidateBusy(false);
    setCandidateError("");
    setRosterMutationMemberId(null);
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
    editorSessionRef.current += 1;
    candidateRequestSequenceRef.current += 1;
    setCandidateQuery("");
    setCandidates([]);
    setCandidateBusy(false);
    setCandidateError("");
    setRosterMutationMemberId(null);
    setTeamProfileMember(null);
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
    const editorSession = editorSessionRef.current;
    const submittedDraft = draft;
    saveDraftSnapshotsRef.current.set(savingKey, submittedDraft);
    setSavingIds((prev) => new Set(prev).add(savingKey));
    const localTeamId = wasEditing?.teamId || `local-team-${generateRandomId()}`;
    const authoritativeTeam = wasEditing ? currentEditingTeam : null;
    const savedMemberIds = authoritativeTeam?.memberIds || [];
    const membershipChanged = Boolean(
      wasEditing && canEditTeams &&
      !sameIdSet(draft.memberIds, wasEditing.memberIds || []),
    );
    const payload: TeamPayload = { ...draft, name: draft.name.trim() };
    const { memberIds: submittedMemberIds, ...settingsPayload } = payload;
    const updatePayload: TeamUpdatePayload = membershipChanged
      ? {
          ...settingsPayload,
          memberIds: submittedMemberIds,
          baseMemberIds: wasEditing?.memberIds || [],
        }
      : settingsPayload;
    const optimisticTeam: TeamRecord = {
      churchId,
      teamId: localTeamId,
      name: payload.name,
      description: payload.description || "",
      icon: payload.icon || "",
      memberIds: wasEditing && !membershipChanged ? savedMemberIds : payload.memberIds,
      usesMicrophoneAssignments: Boolean(payload.usesMicrophoneAssignments),
      usesIemAssignments: Boolean(payload.usesIemAssignments),
      archivedAt: wasEditing?.archivedAt || null,
    };
    const savedRecord = wasEditing
      ? { ...wasEditing, ...optimisticTeam }
      : optimisticTeam;
    onSaved(savedRecord);
    try {
      const response = wasEditing
        ? await updateTeam(churchId, wasEditing.teamId, {
          ...updatePayload,
        })
        : await createTeam(churchId, payload);
      onSaved(response.team, wasEditing ? undefined : localTeamId);
      if (editorSessionRef.current === editorSession) {
        if (wasEditing) {
          setEditing((current) =>
            current?.teamId === wasEditing.teamId ? response.team : current,
          );
        } else {
          setEditing((current) => (current === null ? response.team : current));
        }
        if (JSON.stringify(draftRef.current) === JSON.stringify(submittedDraft)) {
          const savedDraft: TeamPayload = {
            name: response.team.name,
            description: response.team.description || "",
            icon: response.team.icon || "",
            memberIds: response.team.memberIds || [],
            usesMicrophoneAssignments: Boolean(response.team.usesMicrophoneAssignments),
            usesIemAssignments: Boolean(response.team.usesIemAssignments),
          };
          draftRef.current = savedDraft;
          setDraft(savedDraft);
        }
      }
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not save this team.");
      onArchived();
    } finally {
      saveDraftSnapshotsRef.current.delete(savingKey);
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
  const draftDiffersFromSaved = editing
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
  const pendingSaveDraft = saveDraftSnapshotsRef.current.get(currentEditorKey);
  const hasPendingChanges = draftDiffersFromSaved && !(
    isSavingCurrent &&
    pendingSaveDraft &&
    JSON.stringify(draft) === JSON.stringify(pendingSaveDraft)
  );
  useTeamsUnsavedChanges(hasPendingChanges);

  const formatNameList = (names: string[]) =>
    names.length === 0 ? "None yet." : names.join(", ");
  const teamSummary = (team: TeamRecord) => {
    const memberIds = team.memberIds || [];
    const positionCount = positions.filter((position) => position.teamId === team.teamId).length;
    const memberLabel = memberIds.length === 1 ? "member" : "members";
    return {
      details: (
        <div className="min-w-0">
          <span className="font-medium text-gray-300">{memberIds.length}</span>{" "}
          <span>{memberLabel}</span>
          <span className="text-gray-600"> | </span>
          <span className="font-medium text-gray-300">{positionCount}</span>{" "}
          <span>positions</span>
        </div>
      ),
    };
  };

  const updateCandidateQuery = (query: string) => {
    candidateRequestSequenceRef.current += 1;
    setCandidates([]);
    setCandidateHasMore(false);
    setCandidateBusy(false);
    setCandidateError("");
    setCandidateQuery(query);
  };

  const addDraftMember = (memberId: string) => {
    if (!canEditCurrentTeam || draft.memberIds.includes(memberId)) return;
    setDraft((current) => current.memberIds.includes(memberId)
      ? current
      : { ...current, memberIds: [...current.memberIds, memberId] });
    updateCandidateQuery("");
  };

  useEffect(() => {
    const requestedTeam = editing;
    const query = candidateQuery.trim();
    if (
      canEditTeams ||
      !requestedTeam ||
      !canEditCurrentTeam ||
      requestedTeam.archivedAt ||
      query.length < 2
    ) {
      setCandidates([]);
      setCandidateHasMore(false);
      setCandidateBusy(false);
      setCandidateError("");
      return undefined;
    }

    const requestSequence = ++candidateRequestSequenceRef.current;
    const requestedTeamId = requestedTeam.teamId;
    setCandidateBusy(true);
    setCandidateHasMore(false);
    setCandidateError("");
    const timeout = window.setTimeout(() => {
      void searchTeamRosterCandidates(churchId, requestedTeamId, query)
        .then((result) => {
          if (requestSequence === candidateRequestSequenceRef.current) {
            setCandidates(result.candidates || []);
            setCandidateHasMore(Boolean(result.hasMore));
          }
        })
        .catch((error) => {
          if (requestSequence === candidateRequestSequenceRef.current) {
            setCandidates([]);
            setCandidateHasMore(false);
            setCandidateError("Could not search people. Try again.");
            showApiErrorToast(showToast, error, "Could not search people.");
          }
        })
        .finally(() => {
          if (requestSequence === candidateRequestSequenceRef.current) {
            setCandidateBusy(false);
          }
        });
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      if (candidateRequestSequenceRef.current === requestSequence) {
        candidateRequestSequenceRef.current += 1;
      }
    };
  }, [
    candidateQuery,
    candidateSearchRevision,
    canEditCurrentTeam,
    canEditTeams,
    churchId,
    editing,
    showToast,
  ]);

  const addCandidate = async (memberId: string) => {
    const requestedTeam = editing;
    const editorSession = editorSessionRef.current;
    const queryAtStart = candidateQuery;
    if (
      !requestedTeam ||
      canEditTeams ||
      !canEditCurrentTeam ||
      requestedTeam.archivedAt ||
      candidateAddInFlightRef.current ||
      (currentEditingTeam?.memberIds || []).includes(memberId)
    ) return;

    candidateAddInFlightRef.current = true;
    setCandidateAdding({ teamId: requestedTeam.teamId, memberId });
    try {
      const result = await addTeamRosterMemberToTeam(churchId, requestedTeam.teamId, memberId);
      onTeamRosterSaved(result.team);
      onRosterMemberSaved(normalizeSafeRosterMember(result.member));
      onRosterMutationReconcile(memberId);
      if (editorSessionRef.current === editorSession && candidateQuery === queryAtStart) {
        updateCandidateQuery("");
      }
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not add this person to the team.");
    } finally {
      candidateAddInFlightRef.current = false;
      setCandidateAdding(null);
    }
  };

  const confirmRosterRemoval = async () => {
    if (!rosterMutationMemberId || rosterMutationBusy) return;
    const memberId = rosterMutationMemberId;
    if (canEditTeams) {
      setDraft((current) => ({
        ...current,
        memberIds: current.memberIds.filter((id) => id !== memberId),
      }));
      setRosterMutationMemberId(null);
      return;
    }

    const requestedTeam = editing;
    if (!requestedTeam || !canEditCurrentTeam || requestedTeam.archivedAt) return;
    if (!(currentEditingTeam?.memberIds || []).includes(memberId)) {
      setRosterMutationMemberId(null);
      return;
    }
    setRosterMutationBusy(true);
    try {
      const result = await removeTeamRosterMemberFromTeam(churchId, requestedTeam.teamId, memberId);
      onTeamRosterSaved(result.team);
      const remainsInVisibleTeam = teams.some((team) =>
        !team.archivedAt &&
        team.teamId !== requestedTeam.teamId &&
        team.memberIds?.includes(memberId),
      );
      if (remainsInVisibleTeam) {
        onRosterMemberSaved(normalizeSafeRosterMember(result.member));
      } else {
        onRosterMemberRemoved(memberId);
      }
      onRosterMutationReconcile(memberId);
      setRosterMutationMemberId((current) => current === memberId ? null : current);
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not remove this person from the team.");
    } finally {
      setRosterMutationBusy(false);
    }
  };

  const rosterMutationMember = rosterMutationMemberId
    ? members.find((member) => member.memberId === rosterMutationMemberId) || null
    : null;
  const rosterMutationTeamName = editing?.name || draft.name.trim() || "this team";

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
                {...teamSummary(team)}
                icon={team.icon}
                archived={Boolean(team.archivedAt)}
                compact
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
        {(canEditTeams || editing) ? (
          <TeamMembersEditor
            key={editing?.teamId || "__create__"}
            memberIds={canEditTeams ? draft.memberIds : currentEditingTeam?.memberIds || []}
            members={members}
            suggestions={canEditTeams ? [] : candidates}
            searchMode={canEditTeams ? "local" : "scoped"}
            searchQuery={candidateQuery}
            onSearchQueryChange={updateCandidateQuery}
            canEditMembership={canEditCurrentTeam && (canEditTeams || !editing?.archivedAt)}
            isSearching={!canEditTeams && candidateBusy}
            isAdding={Boolean(editing && candidateAdding?.teamId === editing.teamId)}
            hasMoreSuggestions={!canEditTeams && candidateHasMore}
            addingMemberId={editing && candidateAdding?.teamId === editing.teamId ? candidateAdding.memberId : null}
            searchError={canEditTeams ? "" : candidateError}
            onRetrySearch={() => setCandidateSearchRevision((revision) => revision + 1)}
            onAddMember={(memberId) => {
              if (canEditTeams) addDraftMember(memberId);
              else void addCandidate(memberId);
            }}
            onRemoveMember={setRosterMutationMemberId}
            onManageMember={!canEditTeams && editing
              ? (member) => setTeamProfileMember(member)
              : undefined}
            onCreateMember={!canEditTeams && editing
              ? () => navigate(TEAMS_SECTION_PATHS.members, {
                state: { teamsCreateMember: { teamId: editing.teamId } },
              })
              : undefined}
          />
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
        isOpen={Boolean(rosterMutationMemberId)}
        onClose={() => { if (!rosterMutationBusy) setRosterMutationMemberId(null); }}
        title={`Remove ${rosterMutationMember ? memberName(rosterMutationMember) : "this member"} from ${rosterMutationTeamName}?`}
        size="sm"
        busy={rosterMutationBusy}
      >
        {rosterMutationMemberId ? <div className="space-y-4 text-sm text-gray-200">
          {canEditTeams ? (
            <p>This removes them from the team when you save your changes. It does not delete their member record.</p>
          ) : (
            <p>This removes their team-specific positions, role, and qualifications. It does not delete their member record.</p>
          )}
          <p>Existing schedule assignments will remain and can be reassigned separately.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={rosterMutationBusy} onClick={() => setRosterMutationMemberId(null)}>Cancel</Button>
            <Button type="button" isLoading={rosterMutationBusy} disabled={rosterMutationBusy} onClick={() => void confirmRosterRemoval()}>Remove from team</Button>
          </div>
        </div> : null}
      </Modal>
      {editing ? (
        <TeamMemberProfileEditor
          churchId={churchId}
          team={editing}
          member={teamProfileMember}
          positions={positions}
          roles={roles}
          qualificationAreas={qualificationAreas}
          qualificationLevels={data.qualificationLevels}
          onClose={() => setTeamProfileMember(null)}
          onSaved={(memberId) => onRosterMutationReconcile(memberId)}
        />
      ) : null}
    </>
  );
};

export default TeamManager;
