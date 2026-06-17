import { useMemo } from "react";
import { ListFilter } from "lucide-react";
import Button from "../../../components/Button/Button";
import { cn } from "@/utils/cnHelper";
import type { TeamPosition, TeamRecord, TeamRole } from "../../../api/authTypes";
import {
  countActiveMemberListFilters,
  emptyMemberListFilters,
  type MemberListFilterState,
} from "../teamsSelectors";
import { orderPositionsByTeamList } from "../teamsUtils";
import type { TeamsData } from "../types";
import EntityListSearch from "./EntityListSearch";
import MultiCheckboxGroup, {
  type MultiCheckboxOption,
  type MultiCheckboxOptionGroup,
} from "./MultiCheckboxGroup";
import QualificationFilterSection from "./QualificationFilterSection";
import { matchesScopedTeam, toCheckboxOption } from "./memberListFilterUtils";

export const MEMBER_FILTER_PANEL_ID = "member-filter-panel";

type MemberListFilterData = Pick<
  TeamsData,
  "teams" | "positions" | "teamRoles" | "qualificationAreas" | "qualificationLevels"
>;

type MemberListFilterToolbarProps = {
  listQuery: string;
  onListQueryChange: (value: string) => void;
  filters: MemberListFilterState;
  filtersOpen: boolean;
  onFiltersOpenChange: (open: boolean) => void;
  filtersDisabled?: boolean;
};

type MemberFilterPanelProps = {
  data: MemberListFilterData;
  value: MemberListFilterState;
  onChange: (value: MemberListFilterState) => void;
};

const isSchedulablePosition = (
  position: TeamPosition,
): position is TeamPosition & { positionId: string } => Boolean(position.positionId);

const isTeamRoleRecord = (role: TeamRole): role is TeamRole & { roleId: string } =>
  Boolean(role.roleId) && !("positionId" in role && role.positionId);

const buildTeamGroups = <T extends { teamId: string }>({
  teams,
  scopedTeamIds,
  items,
  toOption,
}: {
  teams: TeamRecord[];
  scopedTeamIds: string[];
  items: T[];
  toOption: (item: T) => MultiCheckboxOption;
}): MultiCheckboxOptionGroup[] =>
  teams
    .filter((team) => matchesScopedTeam(team.teamId, scopedTeamIds))
    .map((team) => ({
      heading: team.name,
      options: items
        .filter((item) => item.teamId === team.teamId)
        .map(toOption),
    }))
    .filter((group) => (group.options?.length || 0) > 0);

export const MemberListFilterToolbar = ({
  listQuery,
  onListQueryChange,
  filters,
  filtersOpen,
  onFiltersOpenChange,
  filtersDisabled = false,
}: MemberListFilterToolbarProps) => {
  const activeCount = countActiveMemberListFilters(filters);
  const hasFilter = activeCount > 0;

  return (
    <div className="flex gap-2">
      <EntityListSearch
        className="min-w-0 flex-1"
        label="Members"
        value={listQuery}
        onChange={onListQueryChange}
      />
      <Button
        type="button"
        variant="tertiary"
        svg={ListFilter}
        iconSize="sm"
        className={cn(
          "shrink-0",
          hasFilter && "border-cyan-400/40 bg-cyan-400/10 text-cyan-50",
        )}
        aria-expanded={filtersOpen}
        aria-controls={MEMBER_FILTER_PANEL_ID}
        disabled={filtersDisabled}
        aria-label={
          hasFilter
            ? `Filter members, ${activeCount} selected`
            : "Filter members"
        }
        onClick={() => onFiltersOpenChange(!filtersOpen)}
      >
        {hasFilter ? `Filter (${activeCount})` : "Filter"}
      </Button>
    </div>
  );
};

export const MemberFilterPanel = ({
  data,
  value,
  onChange,
}: MemberFilterPanelProps) => {
  const hasFilter = countActiveMemberListFilters(value) > 0;
  const scopedTeamIds = value.teamIds;

  const teamOptions = useMemo(
    () =>
      data.teams.map((team) => ({
        id: team.teamId,
        label: team.name,
        archived: Boolean(team.archivedAt),
      })),
    [data.teams],
  );

  const schedulablePositions = useMemo(
    () =>
      orderPositionsByTeamList(data.positions, data.teams).filter(isSchedulablePosition),
    [data.positions, data.teams],
  );

  const positionGroups = useMemo(
    () =>
      buildTeamGroups({
        teams: data.teams,
        scopedTeamIds,
        items: schedulablePositions.filter((position) =>
          matchesScopedTeam(position.teamId, scopedTeamIds),
        ),
        toOption: (position) =>
          toCheckboxOption({
            id: position.positionId,
            label: position.name,
            archived: Boolean(position.archivedAt),
          }),
      }),
    [data.teams, schedulablePositions, scopedTeamIds],
  );

  const teamRoleGroups = useMemo(() => {
    const roles = data.teamRoles
      .filter(isTeamRoleRecord)
      .filter((role) => matchesScopedTeam(role.teamId, scopedTeamIds))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return buildTeamGroups({
      teams: data.teams,
      scopedTeamIds,
      items: roles,
      toOption: (role) =>
        toCheckboxOption({
          id: role.roleId,
          label: role.name,
          archived: Boolean(role.archivedAt),
        }),
    });
  }, [data.teamRoles, data.teams, scopedTeamIds]);

  const updateFilters = (patch: Partial<MemberListFilterState>) => {
    onChange({ ...value, ...patch });
  };

  const handleTeamChange = (teamIds: string[]) => {
    const nextScopedTeamIds = teamIds;
    const nextPositionIds = value.positionIds.filter((positionId) => {
      const position = data.positions.find((item) => item.positionId === positionId);
      return position
        ? matchesScopedTeam(position.teamId, nextScopedTeamIds)
        : false;
    });
    const nextRoleIds = value.roleIds.filter((roleId) => {
      const role = data.teamRoles.find((item) => item.roleId === roleId);
      return role ? matchesScopedTeam(role.teamId, nextScopedTeamIds) : false;
    });
    const nextAreaIds = value.qualificationAreaIds.filter((areaId) => {
      const area = data.qualificationAreas.find((item) => item.areaId === areaId);
      return area ? matchesScopedTeam(area.teamId, nextScopedTeamIds) : false;
    });
    const nextLevelIds = value.qualificationLevelIds.filter((levelId) => {
      const level = data.qualificationLevels.find((item) => item.levelId === levelId);
      if (!level) return false;
      if (nextAreaIds.length > 0) return nextAreaIds.includes(level.areaId);
      const area = data.qualificationAreas.find((item) => item.areaId === level.areaId);
      return area ? matchesScopedTeam(area.teamId, nextScopedTeamIds) : false;
    });
    const nextStatuses =
      nextAreaIds.length > 0 ? value.qualificationStatuses : [];
    onChange({
      ...value,
      teamIds,
      positionIds: nextPositionIds,
      roleIds: nextRoleIds,
      qualificationAreaIds: nextAreaIds,
      qualificationLevelIds: nextLevelIds,
      qualificationStatuses: nextStatuses,
    });
  };

  return (
    <>
      {hasFilter ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="textLink"
            padding="p-0"
            className="text-xs text-cyan-300"
            onClick={() => onChange(emptyMemberListFilters())}
          >
            Clear all
          </Button>
        </div>
      ) : null}
      <MultiCheckboxGroup
        label="Teams"
        options={teamOptions}
        value={value.teamIds}
        onChange={handleTeamChange}
        defaultExpanded
      />
      <MultiCheckboxGroup
        label="Scheduling positions"
        description="Scheduling slots this member can be assigned to. These are not team roles."
        groups={positionGroups}
        value={value.positionIds}
        onChange={(positionIds) => updateFilters({ positionIds })}
        defaultExpanded
      />
      {teamRoleGroups.length > 0 ? (
        <MultiCheckboxGroup
          label="Team roles"
          description="Leadership or membership roles on a team. Separate from scheduling positions."
          groups={teamRoleGroups}
          value={value.roleIds}
          onChange={(roleIds) => updateFilters({ roleIds })}
          defaultExpanded={false}
        />
      ) : null}
      <QualificationFilterSection
        teams={data.teams}
        scopedTeamIds={scopedTeamIds}
        qualificationAreas={data.qualificationAreas}
        qualificationLevels={data.qualificationLevels}
        value={{
          qualificationAreaIds: value.qualificationAreaIds,
          qualificationLevelIds: value.qualificationLevelIds,
          qualificationStatuses: value.qualificationStatuses,
        }}
        onChange={updateFilters}
      />
    </>
  );
};
