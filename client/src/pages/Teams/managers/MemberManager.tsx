import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import Button from "../../../components/Button/Button";
import Input from "../../../components/Input/Input";
import Select from "../../../components/Select/Select";
import TextArea from "../../../components/TextArea/TextArea";
import DeleteModal from "../../../components/Modal/DeleteModal";
import DatePicker from "@/components/ui/DatePicker";
import FormActionButtons from "../components/FormActionButtons";
import EntityFormDangerActions from "../components/EntityFormDangerActions";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { useToast } from "../../../context/toastContext";
import {
  archiveTeamRosterMember,
  createTeamRosterMember,
  deleteTeamRosterMember,
  updateTeamRosterMember,
  type TeamRosterMemberPayload,
} from "../../../api/auth";
import type {
  TeamMemberQualification,
  TeamMemberQualificationStatus,
  TeamPosition,
  TeamRecord,
  TeamRosterMember,
} from "../../../api/authTypes";
import generateRandomId from "../../../utils/generateRandomId";
import CreatePanel from "../CreatePanel";
import {
  MemberFilterPanel,
  MemberListFilterToolbar,
  MEMBER_FILTER_PANEL_ID,
} from "../components/MemberListFilters";
import TeamsReturnToolbar from "../components/TeamsReturnToolbar";
import EntityMultiSelect from "../EntityMultiSelect";
import EntityRow from "../components/EntityRow";
import { showApiErrorToast } from "../../../utils/apiErrorToast";
import {
  describeDeletionImpacts,
  emptyRange,
  memberMatchesListQuery,
  memberName,
  orderPositionsByTeamList,
  sortTeamRosterMembersAlphabetically,
} from "../teamsUtils";
import { TEAMS_MEMBER_EDIT_SEARCH_PARAM } from "../teamsReturnNavigation";
import { useTeamsReturnNavigation } from "../hooks/useTeamsReturnNavigation";
import {
  countActiveMemberListFilters,
  emptyMemberListFilters,
  memberMatchesListFilters,
} from "../teamsSelectors";
import type { TeamsData } from "../types";

const NO_SELECTION_VALUE = "__none";

const qualificationStatusOptions: {
  value: TeamMemberQualificationStatus;
  label: string;
}[] = [
    { value: "in_training", label: "In training" },
    { value: "completed", label: "Completed" },
    { value: "expired", label: "Expired" },
  ];

type MemberManagerProps = {
  members: TeamRosterMember[];
  positions: TeamPosition[];
  data: TeamsData;
  canEdit: boolean;
  onSaved: (member: TeamRosterMember, replaceId?: string) => void;
  onArchived: () => void;
  onRemoved: (memberId: string) => void;
};

const MemberManager = ({
  members,
  positions,
  data,
  canEdit,
  onSaved,
  onArchived,
  onRemoved,
}: MemberManagerProps) => {
  const context = useContext(GlobalInfoContext);
  const { showToast } = useToast();
  const churchId = context?.churchId || "";
  const [editing, setEditing] = useState<TeamRosterMember | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deleting, setDeleting] = useState<TeamRosterMember | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [draft, setDraft] = useState<TeamRosterMemberPayload>({
    firstName: "",
    lastName: "",
    dateOfBirth: "",
    positionIds: [],
    desiredPositionIds: [],
    teamMemberships: {},
    qualifications: [],
    blockoutDates: [],
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [listQuery, setListQuery] = useState("");
  const [listFilters, setListFilters] = useState(emptyMemberListFilters);
  const [draftListFilters, setDraftListFilters] = useState(emptyMemberListFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const { returnTo, finishEditing } = useTeamsReturnNavigation();
  const pendingEditMemberIdRef = useRef<string | null>(null);

  const openMemberEditor = useCallback((member: TeamRosterMember) => {
    setShowFilters(false);
    setEditing(member);
    setShowCreate(true);
    setDraft({
      firstName: member.firstName,
      lastName: member.lastName,
      dateOfBirth: member.dateOfBirth || "",
      positionIds: member.positionIds || [],
      desiredPositionIds: member.desiredPositionIds || [],
      teamMemberships: member.teamMemberships || {},
      qualifications: member.qualifications || [],
      blockoutDates: member.blockoutDates || [],
      notes: member.notes || "",
    });
  }, []);

  useEffect(() => {
    const editMemberId = searchParams.get(TEAMS_MEMBER_EDIT_SEARCH_PARAM)?.trim();
    if (!editMemberId || !canEdit) return;
    pendingEditMemberIdRef.current = editMemberId;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete(TEAMS_MEMBER_EDIT_SEARCH_PARAM);
    setSearchParams(nextParams, { replace: true });
  }, [canEdit, searchParams, setSearchParams]);

  useEffect(() => {
    const editMemberId = pendingEditMemberIdRef.current;
    if (!editMemberId) return;
    const member = members.find((item) => item.memberId === editMemberId);
    if (!member) return;
    pendingEditMemberIdRef.current = null;
    openMemberEditor(member);
  }, [members, openMemberEditor]);

  useEffect(() => {
    if (!showCreate) return;
    setShowFilters(false);
  }, [showCreate]);

  const cancelFilters = useCallback(() => {
    setDraftListFilters(listFilters);
    setShowFilters(false);
  }, [listFilters]);

  const applyFilters = useCallback(() => {
    setListFilters(draftListFilters);
    setShowFilters(false);
  }, [draftListFilters]);

  const handleFiltersOpenChange = useCallback(
    (next: boolean) => {
      if (showCreate && next) return;
      if (next) {
        setDraftListFilters(listFilters);
        setShowFilters(true);
        return;
      }
      cancelFilters();
    },
    [cancelFilters, listFilters, showCreate],
  );

  useEffect(() => {
    if (!showFilters) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelFilters();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [cancelFilters, showFilters]);

  const positionNameById = useMemo(
    () => new Map(positions.map((position) => [position.positionId, position.name])),
    [positions],
  );
  const teamNameById = useMemo(
    () => new Map(data.teams.map((team) => [team.teamId, team.name])),
    [data.teams],
  );
  const teamsById = useMemo(
    () => new Map(data.teams.map((team) => [team.teamId, team])),
    [data.teams],
  );
  const activeFilterCount = countActiveMemberListFilters(listFilters);
  const roleById = useMemo(
    () => new Map(data.teamRoles.map((role) => [role.roleId, role])),
    [data.teamRoles],
  );
  const areaById = useMemo(
    () => new Map(data.qualificationAreas.map((area) => [area.areaId, area])),
    [data.qualificationAreas],
  );

  const filteredMembers = useMemo(
    () =>
      sortTeamRosterMembersAlphabetically(
        members.filter((member) => {
          const positionNames = (member.positionIds || [])
            .map((positionId) => positionNameById.get(positionId))
            .filter(Boolean) as string[];
          if (!memberMatchesListQuery(member, listQuery, positionNames)) {
            return false;
          }
          return memberMatchesListFilters(member, listFilters, teamsById);
        }),
      ),
    [members, listQuery, listFilters, positionNameById, teamsById],
  );

  const reset = () => {
    setEditing(null);
    setShowCreate(false);
    setDraft({
      firstName: "",
      lastName: "",
      dateOfBirth: "",
      positionIds: [],
      desiredPositionIds: [],
      teamMemberships: {},
      qualifications: [],
      blockoutDates: [],
      notes: "",
    });
  };

  const cancelEditing = () => {
    finishEditing(reset);
  };

  const confirmDelete = async () => {
    if (!canEdit) return;
    if (!deleting) return;
    const member = deleting;
    if (member.memberId.startsWith("local-")) {
      onRemoved(member.memberId);
      setDeleting(null);
      return;
    }
    setDeleteBusy(true);
    onRemoved(member.memberId);
    try {
      await deleteTeamRosterMember(churchId, member.memberId);
      setDeleting(null);
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not delete this member.");
      onSaved(member);
    } finally {
      setDeleteBusy(false);
    }
  };

  const submit = async () => {
    if (!canEdit) return;
    setSaving(true);
    const body = {
      ...draft,
      blockoutDates: draft.blockoutDates.filter(
        (range) => range.startDate || range.endDate,
      ),
    };
    const localMemberId = editing?.memberId || `local-member-${generateRandomId()}`;
    const optimisticMember: TeamRosterMember = {
      churchId,
      memberId: localMemberId,
      firstName: body.firstName.trim(),
      lastName: body.lastName.trim(),
      dateOfBirth: body.dateOfBirth || "",
      positionIds: body.positionIds,
      desiredPositionIds: body.desiredPositionIds || [],
      teamMemberships: body.teamMemberships || {},
      qualifications: body.qualifications || [],
      blockoutDates: body.blockoutDates,
      notes: body.notes || "",
      archivedAt: editing?.archivedAt || null,
    };
    onSaved(editing ? { ...editing, ...optimisticMember } : optimisticMember);
    try {
      const response = editing
        ? await updateTeamRosterMember(churchId, editing.memberId, body)
        : await createTeamRosterMember(churchId, body);
      if (!editing) {
        onSaved(response.member, localMemberId);
      }
      finishEditing(reset);
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not save this member.");
      onArchived();
    } finally {
      setSaving(false);
    }
  };

  // Positions follow each team's Positions tab order; teams follow the roster list.
  const positionOptions = useMemo(
    () =>
      orderPositionsByTeamList(positions, data.teams).map((position) => ({
        id: position.positionId,
        label: position.name,
        sublabel: teamNameById.get(position.teamId) || "No team",
        archived: Boolean(position.archivedAt),
      })),
    [positions, data.teams, teamNameById],
  );

  // Positions the member asked for (intake) but is not yet eligible to be
  // scheduled for. Promoting one adds it to positionIds (the assignment gate).
  const desiredNotEligible = useMemo(
    () =>
      (draft.desiredPositionIds || []).filter(
        (positionId) => !draft.positionIds.includes(positionId),
      ),
    [draft.desiredPositionIds, draft.positionIds],
  );

  const roleTeamIds = Array.from(
    new Set([
      ...(editing
        ? data.teams
          .filter((team) => (team.memberIds || []).includes(editing.memberId))
          .map((team) => team.teamId)
        : []),
      ...Object.keys(draft.teamMemberships || {}),
    ]),
  );
  const roleTeams = roleTeamIds
    .map((teamId) => data.teams.find((team) => team.teamId === teamId))
    .filter(Boolean) as TeamRecord[];
  const qualificationAreaOptions = data.qualificationAreas.map((area) => ({
    value: area.areaId,
    label: `${area.name}${teamNameById.get(area.teamId) ? ` (${teamNameById.get(area.teamId)})` : ""}`,
  }));

  const createEmptyQualification = (): TeamMemberQualification => ({
    qualificationId: `local-qualification-${generateRandomId()}`,
    areaId: data.qualificationAreas[0]?.areaId || "",
    levelId: data.qualificationAreas[0]
      ? data.qualificationLevels.find(
        (level) => level.areaId === data.qualificationAreas[0].areaId,
      )?.levelId || ""
      : "",
    teamId: data.qualificationAreas[0]?.teamId || "",
    status: "in_training",
  });

  return (
    <>
      <CreatePanel
        open={showCreate}
        onOpenCreate={() => {
          setShowFilters(false);
          reset();
          setShowCreate(true);
        }}
        canEdit={canEdit}
        title={editing ? "Edit member" : "Create member"}
        sectionTitle={
          <>
            Members{" "}
            <span className="text-sm font-normal text-gray-400">
              ({filteredMembers.length}
              {listQuery || activeFilterCount > 0 ? ` of ${members.length}` : ""})
            </span>
          </>
        }
        description="Keep roster details and availability current."
        createLabel="Create member"
        scrollableList
        listToolbar={
          members.length > 0 ? (
            <MemberListFilterToolbar
              listQuery={listQuery}
              onListQueryChange={setListQuery}
              filters={listFilters}
              filtersOpen={showFilters}
              filtersDisabled={showCreate}
              onFiltersOpenChange={handleFiltersOpenChange}
            />
          ) : null
        }
        asideOpen={showFilters && !showCreate}
        asideId={MEMBER_FILTER_PANEL_ID}
        asideTitle="Filter members"
        asideHeaderActions={
          <Button
            type="button"
            variant="tertiary"
            svg={X}
            iconSize="sm"
            padding="p-0.5"
            className="shrink-0 text-gray-400 hover:text-white"
            aria-label="Close filters"
            onClick={cancelFilters}
          />
        }
        aside={
          <MemberFilterPanel
            data={data}
            value={draftListFilters}
            onChange={setDraftListFilters}
          />
        }
        asideFooter={
          <FormActionButtons
            pinFooter
            saveLabel="Apply"
            onSave={applyFilters}
            onCancel={cancelFilters}
          />
        }
        list={
          <>
            {members.length === 0 ? <p className="text-sm text-gray-300">No members yet.</p> : null}
            {members.length > 0 && filteredMembers.length === 0 ? (
              <p className="text-sm text-gray-300">No matches.</p>
            ) : null}
            {filteredMembers.map((member) => (
              <EntityRow
                key={member.memberId}
                compact
                title={memberName(member)}
                archived={Boolean(member.archivedAt)}
                canEdit={canEdit}
                onTitleClick={() => openMemberEditor(member)}
              />
            ))}
          </>
        }
        formHeaderActions={
          editing || returnTo ? (
            <TeamsReturnToolbar returnTo={returnTo} onBack={cancelEditing}>
              {editing ? (
                <EntityFormDangerActions
                  archived={Boolean(editing.archivedAt)}
                  canEdit={canEdit}
                  archiveLabel="Archive member"
                  deleteLabel="Delete member"
                  menuLabel="Member actions"
                  onArchive={
                    editing.archivedAt
                      ? undefined
                      : async () => {
                        const archivedMember = {
                          ...editing,
                          archivedAt: new Date().toISOString(),
                        };
                        onSaved(archivedMember);
                        try {
                          await archiveTeamRosterMember(churchId, editing.memberId);
                          finishEditing(reset);
                        } catch (error) {
                          showApiErrorToast(showToast, error, "Could not archive this member.");
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
            saveLabel="Save member"
            onSave={() => void submit()}
            onCancel={cancelEditing}
            disabled={!canEdit || !draft.firstName.trim() || !draft.lastName.trim()}
            isLoading={saving}
          />
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="First name" value={draft.firstName} onChange={(firstName) => setDraft((d) => ({ ...d, firstName: String(firstName) }))} />
          <Input label="Last name" value={draft.lastName} onChange={(lastName) => setDraft((d) => ({ ...d, lastName: String(lastName) }))} />
        </div>
        <DatePicker label="Date of birth" value={draft.dateOfBirth || ""} onChange={(dateOfBirth) => setDraft((d) => ({ ...d, dateOfBirth }))} />
        <EntityMultiSelect
          label="Positions"
          description="Positions this member can be scheduled for."
          options={positionOptions}
          value={draft.positionIds}
          onChange={(positionIds) => setDraft((d) => ({ ...d, positionIds }))}
        />
        {desiredNotEligible.length > 0 ? (
          <div className="rounded-md border border-amber-400/40 bg-amber-500/10 p-3">
            <p className="text-sm font-semibold text-amber-100">
              Requested from intake, not yet schedulable
            </p>
            <p className="mt-0.5 text-xs text-amber-100/80">
              These positions are what the member wants to do. Add one to make
              them assignable to it.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {desiredNotEligible.map((positionId) => (
                <Button
                  key={positionId}
                  variant="secondary"
                  svg={Plus}
                  iconSize="sm"
                  padding="px-2 py-1"
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      positionIds: [...d.positionIds, positionId],
                    }))
                  }
                >
                  {positionNameById.get(positionId) || "Position"}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        <EntityMultiSelect
          label="Desired positions"
          description="What the member wants to do, from intake forms. Does not affect scheduling on its own."
          options={positionOptions}
          value={draft.desiredPositionIds || []}
          onChange={(desiredPositionIds) =>
            setDraft((d) => ({ ...d, desiredPositionIds }))
          }
        />
        <fieldset className="space-y-2">
          <legend className="p-1 text-sm font-semibold">Team roles</legend>
          {roleTeams.length === 0 ? (
            <p className="text-sm text-gray-400">
              Add this member to a team before assigning a team role.
            </p>
          ) : null}
          {roleTeams.map((team) => {
            const membership = draft.teamMemberships?.[team.teamId] || {
              teamId: team.teamId,
            };
            const roleOptions = [
              { value: NO_SELECTION_VALUE, label: "No role" },
              ...data.teamRoles
                .filter((role) => role.teamId === team.teamId)
                .map((role) => ({
                  value: role.roleId,
                  label: `${role.name}${role.archivedAt ? " (archived)" : ""}`,
                })),
            ];
            return (
              <div
                key={team.teamId}
                className="rounded-md border border-gray-700 bg-gray-950/60 p-2"
              >
                <Select
                  label={`${team.name} role`}
                  value={membership.roleId || NO_SELECTION_VALUE}
                  options={roleOptions}
                  onChange={(roleId) =>
                    setDraft((current) => {
                      const teamMemberships = { ...(current.teamMemberships || {}) };
                      const existing = teamMemberships[team.teamId] || {
                        teamId: team.teamId,
                      };
                      teamMemberships[team.teamId] = {
                        ...existing,
                        roleId:
                          roleId === NO_SELECTION_VALUE ? undefined : roleId,
                        roleLabel:
                          roleId === NO_SELECTION_VALUE
                            ? undefined
                            : roleById.get(roleId)?.name || existing.roleLabel,
                      };
                      return { ...current, teamMemberships };
                    })
                  }
                  selectClassName="w-full"
                />
              </div>
            );
          })}
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="p-1 text-sm font-semibold">Qualifications</legend>
          {data.qualificationAreas.length === 0 ? (
            <p className="text-sm text-gray-400">
              Add qualification areas before assigning training levels.
            </p>
          ) : null}
          {(draft.qualifications || []).map((qualification, index) => {
            const selectedArea = areaById.get(qualification.areaId);
            const levelOptions = [
              { value: NO_SELECTION_VALUE, label: "No level" },
              ...data.qualificationLevels
                .filter((level) => level.areaId === qualification.areaId)
                .sort((a, b) => a.rank - b.rank)
                .map((level) => ({
                  value: level.levelId,
                  label: `${level.name}${level.archivedAt ? " (archived)" : ""}`,
                })),
            ];
            return (
              <div
                key={qualification.qualificationId || index}
                className="space-y-2 rounded-md border border-gray-700 bg-gray-950/60 p-2"
              >
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <Select
                    label="Area"
                    value={qualification.areaId || NO_SELECTION_VALUE}
                    options={[
                      { value: NO_SELECTION_VALUE, label: "Choose area" },
                      ...qualificationAreaOptions,
                    ]}
                    onChange={(areaId) =>
                      setDraft((current) => ({
                        ...current,
                        qualifications: (current.qualifications || []).map(
                          (item, itemIndex) =>
                            itemIndex === index
                              ? {
                                ...item,
                                areaId:
                                  areaId === NO_SELECTION_VALUE ? "" : areaId,
                                teamId:
                                  areaId === NO_SELECTION_VALUE
                                    ? ""
                                    : areaById.get(areaId)?.teamId || "",
                                levelId: "",
                              }
                              : item,
                        ),
                      }))
                    }
                    selectClassName="w-full"
                  />
                  <Select
                    label="Level"
                    value={qualification.levelId || NO_SELECTION_VALUE}
                    options={levelOptions}
                    onChange={(levelId) =>
                      setDraft((current) => ({
                        ...current,
                        qualifications: (current.qualifications || []).map(
                          (item, itemIndex) =>
                            itemIndex === index
                              ? {
                                ...item,
                                levelId:
                                  levelId === NO_SELECTION_VALUE
                                    ? undefined
                                    : levelId,
                              }
                              : item,
                        ),
                      }))
                    }
                    selectClassName="w-full"
                  />
                  <Select
                    label="Status"
                    value={qualification.status || "in_training"}
                    options={qualificationStatusOptions}
                    onChange={(status) =>
                      setDraft((current) => ({
                        ...current,
                        qualifications: (current.qualifications || []).map(
                          (item, itemIndex) =>
                            itemIndex === index
                              ? {
                                ...item,
                                status: status as TeamMemberQualificationStatus,
                              }
                              : item,
                        ),
                      }))
                    }
                    selectClassName="w-full"
                  />
                  <Button
                    type="button"
                    variant="tertiary"
                    svg={X}
                    iconSize="sm"
                    padding="p-0"
                    className="shrink-0 self-center text-gray-400 hover:text-white"
                    aria-label="Remove qualification"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        qualifications: (current.qualifications || []).filter(
                          (_, itemIndex) => itemIndex !== index,
                        ),
                      }))
                    }
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <DatePicker
                    label="Completed"
                    value={qualification.completedAt || ""}
                    onChange={(completedAt) =>
                      setDraft((current) => ({
                        ...current,
                        qualifications: (current.qualifications || []).map(
                          (item, itemIndex) =>
                            itemIndex === index ? { ...item, completedAt } : item,
                        ),
                      }))
                    }
                  />
                  <DatePicker
                    label="Expires"
                    value={qualification.expiresAt || ""}
                    onChange={(expiresAt) =>
                      setDraft((current) => ({
                        ...current,
                        qualifications: (current.qualifications || []).map(
                          (item, itemIndex) =>
                            itemIndex === index ? { ...item, expiresAt } : item,
                        ),
                      }))
                    }
                  />
                </div>
                <Input
                  label="Notes"
                  hideLabel
                  placeholder={
                    selectedArea
                      ? `Notes for ${selectedArea.name}`
                      : "Qualification notes"
                  }
                  value={qualification.notes || ""}
                  onChange={(notes) =>
                    setDraft((current) => ({
                      ...current,
                      qualifications: (current.qualifications || []).map(
                        (item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, notes: String(notes) }
                            : item,
                      ),
                    }))
                  }
                />
              </div>
            );
          })}
          <Button
            variant="secondary"
            svg={Plus}
            iconSize="sm"
            disabled={data.qualificationAreas.length === 0}
            onClick={() =>
              setDraft((current) => ({
                ...current,
                qualifications: [
                  ...(current.qualifications || []),
                  createEmptyQualification(),
                ],
              }))
            }
          >
            Add qualification
          </Button>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="p-1 text-sm font-semibold">Blockout dates:</legend>
          {draft.blockoutDates.length === 0 ? (
            <p className="text-sm text-gray-400">No blockout dates added.</p>
          ) : null}
          {draft.blockoutDates.map((range, index) => (
            <div key={index} className="space-y-2 rounded-md border border-gray-700 bg-gray-950/60 p-2">
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <DatePicker label="Start date" hideLabel value={range.startDate} onChange={(startDate) => setDraft((d) => ({ ...d, blockoutDates: d.blockoutDates.map((item, i) => i === index ? { ...item, startDate } : item) }))} />
                <DatePicker label="End date" hideLabel value={range.endDate} onChange={(endDate) => setDraft((d) => ({ ...d, blockoutDates: d.blockoutDates.map((item, i) => i === index ? { ...item, endDate } : item) }))} />
                <Button
                  type="button"
                  variant="tertiary"
                  svg={X}
                  iconSize="sm"
                  padding="p-0"
                  className="shrink-0 self-center text-gray-400 hover:text-white"
                  aria-label="Remove blockout date"
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      blockoutDates: d.blockoutDates.filter((_, i) => i !== index),
                    }))
                  }
                />
              </div>
              <Input hideLabel label="Notes" placeholder="Notes (optional)" value={range.notes || ""} onChange={(notes) => setDraft((d) => ({ ...d, blockoutDates: d.blockoutDates.map((item, i) => i === index ? { ...item, notes: String(notes) } : item) }))} />
            </div>
          ))}
          <Button variant="secondary" svg={Plus} iconSize="sm" onClick={() => setDraft((d) => ({ ...d, blockoutDates: [...d.blockoutDates, emptyRange()] }))}>
            Add date
          </Button>
        </fieldset>
        <TextArea label="Notes" value={draft.notes || ""} textareaClassName="min-h-24" onChange={(notes) => setDraft((d) => ({ ...d, notes }))} />
      </CreatePanel>
      <DeleteModal
        isOpen={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
        itemName={deleting ? memberName(deleting) : undefined}
        isConfirming={deleteBusy}
        message="Permanently delete the member"
        impacts={deleting ? describeDeletionImpacts("member", deleting.memberId, data) : undefined}
        warningMessage="This cannot be undone. Archive instead if you only want to hide them."
      />
    </>
  );
};

export default MemberManager;
