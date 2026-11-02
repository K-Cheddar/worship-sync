import { useMemo, useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import Button from "../../../components/Button/Button";
import Input from "../../../components/Input/Input";
import Select from "../../../components/Select/Select";
import DatePicker from "../../../components/ui/DatePicker";
import EntityIconBadge from "../../../components/icons/EntityIconBadge";
import CollapsibleSectionTrigger from "../../../components/CollapsibleSectionTrigger/CollapsibleSectionTrigger";
import SelectAllButton from "../../../components/SelectAllButton";
import type {
  TeamMemberMembership,
  TeamMemberQualification,
  TeamMemberQualificationStatus,
  TeamPosition,
  TeamQualificationArea,
  TeamQualificationLevel,
  TeamRecord,
  TeamRole,
} from "../../../api/authTypes";
import generateRandomId from "../../../utils/generateRandomId";
import EntityMultiSelect, { type EntityMultiSelectOption } from "../EntityMultiSelect";
import { orderPositionsByTeamList } from "../teamsUtils";

const NO_SELECTION_VALUE = "__none";

const qualificationStatusOptions: {
  value: TeamMemberQualificationStatus;
  label: string;
}[] = [
  { value: "in_training", label: "In training" },
  { value: "completed", label: "Completed" },
  { value: "expired", label: "Expired" },
];

type Props = {
  teams: TeamRecord[];
  positions: TeamPosition[];
  roles: TeamRole[];
  qualificationAreas: TeamQualificationArea[];
  qualificationLevels: TeamQualificationLevel[];
  selectedTeamIds: string[];
  positionIds: string[];
  desiredPositionIds: string[];
  teamMemberships: Record<string, TeamMemberMembership>;
  qualifications: TeamMemberQualification[];
  disabled?: boolean;
  defaultFirstLevelOnAdd?: boolean;
  renderPositionAction?: (option: EntityMultiSelectOption) => ReactNode;
  beforeDesiredPositions?: ReactNode;
  onPositionIdsChange: (positionIds: string[]) => void;
  onDesiredPositionIdsChange: (positionIds: string[]) => void;
  onRoleChange: (teamId: string, roleId?: string, roleLabel?: string) => void;
  onQualificationsChange: (qualifications: TeamMemberQualification[]) => void;
};

/** Shared team-scoped profile controls used by the full and scoped member editors. */
const MemberTeamProfileFields = ({
  teams,
  positions,
  roles,
  qualificationAreas,
  qualificationLevels,
  selectedTeamIds,
  positionIds,
  desiredPositionIds,
  teamMemberships,
  qualifications,
  disabled = false,
  defaultFirstLevelOnAdd = false,
  renderPositionAction,
  beforeDesiredPositions,
  onPositionIdsChange,
  onDesiredPositionIdsChange,
  onRoleChange,
  onQualificationsChange,
}: Props) => {
  const [showDesiredPositions, setShowDesiredPositions] = useState(false);
  const teamNameById = useMemo(
    () => new Map(teams.map((team) => [team.teamId, team.name])),
    [teams],
  );
  const positionOptions = useMemo(() => orderPositionsByTeamList(positions, teams).map((position) => ({
    id: position.positionId,
    label: position.name,
    sublabel: teamNameById.get(position.teamId) || "No team",
    icon: position.icon,
    archived: Boolean(position.archivedAt),
    groupId: teamNameById.has(position.teamId) ? position.teamId : "__no_team",
  })), [positions, teamNameById, teams]);
  const positionTeamFilters = useMemo(() => {
    const labelById = new Map<string, string>();
    positionOptions.forEach((option) => {
      if (!labelById.has(option.groupId || "__no_team")) {
        labelById.set(option.groupId || "__no_team", option.sublabel || "No team");
      }
    });
    return Array.from(labelById, ([id, label]) => ({ id, label }));
  }, [positionOptions]);
  const desiredPositionSelectableIds = positionOptions
    .filter((option) => !option.archived || desiredPositionIds.includes(option.id))
    .map((option) => option.id);
  const desiredPositionsAllSelected = desiredPositionSelectableIds.length > 0 &&
    desiredPositionSelectableIds.every((id) => desiredPositionIds.includes(id));
  const desiredNotEligible = desiredPositionIds.filter((id) => !positionIds.includes(id));
  const positionNameById = new Map(positionOptions.map((option) => [option.id, option.label]));
  const selectedTeams = selectedTeamIds
    .map((teamId) => teams.find((team) => team.teamId === teamId))
    .filter((team): team is TeamRecord => Boolean(team));
  const qualificationAreaById = new Map(
    qualificationAreas.map((area) => [area.areaId, area]),
  );
  const activeQualificationAreas = qualificationAreas.filter((area) => !area.archivedAt);
  const selectableQualificationAreas = qualificationAreas.filter((area) =>
    !area.archivedAt || qualifications.some((qualification) => qualification.areaId === area.areaId),
  );
  const sortedLevelsByArea = useMemo(() => {
    const levelsByArea = new Map<string, TeamQualificationLevel[]>();
    qualificationLevels.forEach((level) => {
      const levels = levelsByArea.get(level.areaId) || [];
      levels.push(level);
      levelsByArea.set(level.areaId, levels);
    });
    levelsByArea.forEach((levels) => levels.sort((a, b) => a.rank - b.rank));
    return levelsByArea;
  }, [qualificationLevels]);

  const toggleAllDesiredPositions = () => {
    const selected = new Set(desiredPositionIds);
    if (desiredPositionsAllSelected) {
      desiredPositionSelectableIds.forEach((id) => selected.delete(id));
    } else {
      desiredPositionSelectableIds.forEach((id) => selected.add(id));
    }
    onDesiredPositionIdsChange(Array.from(selected));
  };

  const addQualification = () => {
    const area = activeQualificationAreas[0];
    const levelId = area && defaultFirstLevelOnAdd
      ? sortedLevelsByArea.get(area.areaId)?.find((level) => !level.archivedAt)?.levelId
      : undefined;
    onQualificationsChange([
      ...qualifications,
      {
        qualificationId: `local-qualification-${generateRandomId()}`,
        areaId: area?.areaId || "",
        ...(levelId ? { levelId } : {}),
        teamId: area?.teamId || selectedTeamIds[0] || "",
        status: "in_training",
      },
    ]);
  };

  const updateQualification = (
    index: number,
    update: (qualification: TeamMemberQualification) => TeamMemberQualification,
  ) => onQualificationsChange(qualifications.map((qualification, rowIndex) =>
    rowIndex === index ? update(qualification) : qualification,
  ));

  return (
    <div className="min-w-0 space-y-4">
      <EntityMultiSelect
        label="Positions"
        description="Positions this member can be scheduled for."
        inlineSublabel
        options={positionOptions}
        groups={positionTeamFilters}
        hideGroupFilters
        defaultGroupIds={selectedTeamIds}
        value={positionIds}
        onChange={onPositionIdsChange}
        disabled={disabled}
        renderOptionAction={renderPositionAction}
      />

      {beforeDesiredPositions}

      {desiredNotEligible.length > 0 ? (
        <div className="rounded-md border border-amber-400/40 bg-amber-500/10 p-3">
          <p className="text-sm font-semibold text-amber-100">
            Requested from intake, not yet schedulable
          </p>
          <p className="mt-0.5 text-xs text-amber-100/80">
            These positions are what the member wants to do. Add one to make them assignable to it.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {desiredNotEligible.map((positionId) => (
              <Button
                key={positionId}
                type="button"
                variant="secondary"
                svg={Plus}
                iconSize="sm"
                padding="px-2 py-1"
                disabled={disabled}
                onClick={() => onPositionIdsChange([...positionIds, positionId])}
              >
                {positionNameById.get(positionId) || "Position"}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="min-w-0 space-y-1">
        <CollapsibleSectionTrigger
          label="Desired positions"
          expanded={showDesiredPositions}
          onExpandedChange={setShowDesiredPositions}
          endContent={(
            <span
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <SelectAllButton
                allSelected={desiredPositionsAllSelected}
                tone="admin"
                onClick={toggleAllDesiredPositions}
                disabled={disabled}
              />
            </span>
          )}
        />
        {showDesiredPositions ? (
          <EntityMultiSelect
            label="Desired positions"
            hideLabel
            hideSelectAll
            description="What the member wants to do, from intake forms. Does not affect scheduling on its own."
            inlineSublabel
            options={positionOptions}
            groups={positionTeamFilters}
            hideGroupFilters
            value={desiredPositionIds}
            onChange={onDesiredPositionIdsChange}
            disabled={disabled}
          />
        ) : null}
      </div>

      <fieldset disabled={disabled} className="space-y-2">
        <legend className="p-1 text-sm font-semibold">Team roles</legend>
        {selectedTeams.length === 0 ? (
          <p className="text-sm text-gray-400">Choose a team above to assign a team role.</p>
        ) : null}
        {selectedTeams.map((team) => {
          const membership = teamMemberships[team.teamId] || { teamId: team.teamId };
          const teamRoles = roles.filter((role) => role.teamId === team.teamId);
          const hasCurrentRole = teamRoles.some((role) => role.roleId === membership.roleId);
          const roleOptions = [
            { value: NO_SELECTION_VALUE, label: "No role" },
            ...teamRoles
              .filter((role) => !role.archivedAt || role.roleId === membership.roleId)
              .map((role) => ({
              value: role.roleId,
              label: (
                <span className="inline-flex items-center gap-2">
                  <EntityIconBadge icon={role.icon || "ShieldCheck"} className="size-5 shrink-0" iconClassName="size-3" />
                  <span>{role.name}{role.archivedAt ? " (archived)" : ""}</span>
                </span>
              ),
              })),
            ...(membership.roleId && !hasCurrentRole ? [{
              value: membership.roleId,
              label: (
                <span className="inline-flex items-center gap-2">
                  <EntityIconBadge icon="ShieldCheck" className="size-5 shrink-0" iconClassName="size-3" />
                  <span>Archived role ({membership.roleId})</span>
                </span>
              ),
            }] : []),
          ];
          return (
            <div key={team.teamId} className="rounded-md border border-gray-700 bg-gray-950/60 p-2">
              <Select
                label={`${team.name} role`}
                value={membership.roleId || NO_SELECTION_VALUE}
                options={roleOptions}
                onChange={(roleId) => {
                  const selectedRole = teamRoles.find((role) => role.roleId === roleId);
                  onRoleChange(
                    team.teamId,
                    roleId === NO_SELECTION_VALUE ? undefined : roleId,
                    roleId === NO_SELECTION_VALUE ? undefined : selectedRole?.name || membership.roleLabel,
                  );
                }}
                selectClassName="w-full"
              />
            </div>
          );
        })}
      </fieldset>

      <fieldset disabled={disabled} className="space-y-2">
        <legend className="p-1 text-sm font-semibold">Qualifications</legend>
        {activeQualificationAreas.length === 0 ? (
          <p className="text-sm text-gray-400">No active qualification areas are available to add.</p>
        ) : null}
        {qualifications.map((qualification, index) => {
          const selectedArea = qualificationAreaById.get(qualification.areaId);
          const areaOptions = [
            { value: NO_SELECTION_VALUE, label: "Choose area" },
            ...selectableQualificationAreas.map((area) => ({
              value: area.areaId,
              label: (
                <span className="inline-flex items-center gap-2">
                  <EntityIconBadge icon={area.icon || "Award"} className="size-5 shrink-0" iconClassName="size-3" />
                  <span>{area.name}{teamNameById.get(area.teamId) ? ` (${teamNameById.get(area.teamId)})` : ""}{area.archivedAt ? " (archived)" : ""}</span>
                </span>
              ),
            })),
            ...(qualification.areaId && !selectedArea ? [{
              value: qualification.areaId,
              label: `Archived qualification area (${qualification.areaId})`,
            }] : []),
          ];
          const levels = (sortedLevelsByArea.get(qualification.areaId) || []).filter((level) =>
            !level.archivedAt || level.levelId === qualification.levelId,
          );
          const hasCurrentLevel = levels.some((level) => level.levelId === qualification.levelId);
          const levelOptions = [
            { value: NO_SELECTION_VALUE, label: "No level" },
            ...levels.map((level) => ({
              value: level.levelId,
              label: `${level.name}${level.archivedAt ? " (archived)" : ""}`,
            })),
            ...(qualification.levelId && !hasCurrentLevel ? [{
              value: qualification.levelId,
              label: `Archived level (${qualification.levelId})`,
            }] : []),
          ];
          return (
            <div key={qualification.qualificationId || index} className="space-y-2 rounded-md border border-gray-700 bg-gray-950/60 p-2">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                <Select
                  label="Area"
                  value={qualification.areaId || NO_SELECTION_VALUE}
                  options={areaOptions}
                  onChange={(areaId) => updateQualification(index, (item) => ({
                    ...item,
                    areaId: areaId === NO_SELECTION_VALUE ? "" : areaId,
                    teamId: areaId === NO_SELECTION_VALUE ? "" : qualificationAreaById.get(areaId)?.teamId || "",
                    levelId: undefined,
                  }))}
                  selectClassName="w-full"
                />
                <Select
                  label="Level"
                  value={qualification.levelId || NO_SELECTION_VALUE}
                  options={levelOptions}
                  onChange={(levelId) => updateQualification(index, (item) => ({
                    ...item,
                    levelId: levelId === NO_SELECTION_VALUE ? undefined : levelId,
                  }))}
                  selectClassName="w-full"
                />
                <Select
                  label="Status"
                  value={qualification.status || "in_training"}
                  options={qualificationStatusOptions}
                  onChange={(status) => updateQualification(index, (item) => ({
                    ...item,
                    status: status as TeamMemberQualificationStatus,
                  }))}
                  selectClassName="w-full"
                />
                <Button
                  type="button"
                  variant="tertiary"
                  svg={X}
                  iconSize="sm"
                  padding="p-0"
                  className="shrink-0 self-center text-gray-400 hover:text-white"
                  aria-label={`Remove ${selectedArea?.name || "this"} qualification`}
                  onClick={() => onQualificationsChange(qualifications.filter((_, rowIndex) => rowIndex !== index))}
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <DatePicker
                  label="Completed"
                  value={qualification.completedAt || ""}
                  onChange={(completedAt) => updateQualification(index, (item) => ({ ...item, completedAt }))}
                />
                <DatePicker
                  label="Expires"
                  value={qualification.expiresAt || ""}
                  onChange={(expiresAt) => updateQualification(index, (item) => ({ ...item, expiresAt }))}
                />
              </div>
              <Input
                label="Notes"
                placeholder={selectedArea ? `Notes for ${selectedArea.name}` : "Qualification notes"}
                value={qualification.notes || ""}
                onChange={(notes) => updateQualification(index, (item) => ({ ...item, notes: String(notes) }))}
              />
            </div>
          );
        })}
        <Button
          type="button"
          variant="secondary"
          svg={Plus}
          iconSize="sm"
          disabled={disabled || activeQualificationAreas.length === 0}
          onClick={addQualification}
        >
          Add qualification
        </Button>
      </fieldset>
    </div>
  );
};

export default MemberTeamProfileFields;
