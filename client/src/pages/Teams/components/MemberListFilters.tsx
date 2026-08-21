import { useMemo } from "react";
import { ListFilter, X } from "lucide-react";
import Button from "../../../components/Button/Button";
import Checkbox from "../../../components/Checkbox/Checkbox";
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
  data: MemberListFilterData;
  listQuery: string;
  onListQueryChange: (value: string) => void;
  filters: MemberListFilterState;
  onFiltersChange: (value: MemberListFilterState) => void;
  filtersOpen: boolean;
  onFiltersOpenChange: (open: boolean) => void;
  onClearFilters: () => void;
  filtersDisabled?: boolean;
};

type ActiveMemberFilter = {
  key: keyof MemberListFilterState;
  id: string;
  label: string;
};

const qualificationStatusLabels: Record<
  MemberListFilterState["qualificationStatuses"][number],
  string
> = {
  in_training: "In training",
  completed: "Completed",
  expired: "Expired",
};

const buildActiveMemberFilters = (
  filters: MemberListFilterState,
  data: MemberListFilterData,
): ActiveMemberFilter[] => {
  const labelsById = <T extends string>(items: { id: T; label: string }[]) =>
    new Map(items.map((item) => [item.id, item.label]));
  const teamLabels = labelsById(
    data.teams.map((team) => ({ id: team.teamId, label: team.name })),
  );
  const positionLabels = labelsById(
    data.positions.map((position) => ({
      id: position.positionId,
      label: position.name,
    })),
  );
  const roleLabels = labelsById(
    data.teamRoles.map((role) => ({ id: role.roleId, label: role.name })),
  );
  const areaLabels = labelsById(
    data.qualificationAreas.map((area) => ({ id: area.areaId, label: area.name })),
  );
  const levelLabels = labelsById(
    data.qualificationLevels.map((level) => ({
      id: level.levelId,
      label: level.name,
    })),
  );

  return [
    ...filters.teamIds.map((id) => ({
      key: "teamIds" as const,
      id,
      label: `Team: ${teamLabels.get(id) || "Unavailable"}`,
    })),
    ...filters.positionIds.map((id) => ({
      key: "positionIds" as const,
      id,
      label: `Position: ${positionLabels.get(id) || "Unavailable"}`,
    })),
    ...filters.roleIds.map((id) => ({
      key: "roleIds" as const,
      id,
      label: `Role: ${roleLabels.get(id) || "Unavailable"}`,
    })),
    ...filters.qualificationAreaIds.map((id) => ({
      key: "qualificationAreaIds" as const,
      id,
      label: `Qualification: ${areaLabels.get(id) || "Unavailable"}`,
    })),
    ...filters.qualificationLevelIds.map((id) => ({
      key: "qualificationLevelIds" as const,
      id,
      label: `Level: ${levelLabels.get(id) || "Unavailable"}`,
    })),
    ...filters.qualificationStatuses.map((id) => ({
      key: "qualificationStatuses" as const,
      id,
      label: `Status: ${qualificationStatusLabels[id]}`,
    })),
    ...(filters.includeArchived
      ? [{ key: "includeArchived" as const, id: "true", label: "Show archived" }]
      : []),
  ];
};

const removeActiveMemberFilter = (
  filters: MemberListFilterState,
  filter: ActiveMemberFilter,
  data: MemberListFilterData,
): MemberListFilterState => {
  if (filter.key === "includeArchived") {
    return { ...filters, includeArchived: false };
  }

  if (filter.key === "teamIds") {
    const teamIds = filters.teamIds.filter((id) => id !== filter.id);
    const isInTeamScope = (teamId: string) =>
      teamIds.length === 0 || teamIds.includes(teamId);
    const positionIds = filters.positionIds.filter((id) => {
      const position = data.positions.find((item) => item.positionId === id);
      return position ? isInTeamScope(position.teamId) : false;
    });
    const roleIds = filters.roleIds.filter((id) => {
      const role = data.teamRoles.find((item) => item.roleId === id);
      return role ? isInTeamScope(role.teamId) : false;
    });
    const qualificationAreaIds = filters.qualificationAreaIds.filter((id) => {
      const area = data.qualificationAreas.find((item) => item.areaId === id);
      return area ? isInTeamScope(area.teamId) : false;
    });
    const qualificationLevelIds = filters.qualificationLevelIds.filter((id) => {
      const level = data.qualificationLevels.find((item) => item.levelId === id);
      return level ? qualificationAreaIds.includes(level.areaId) : false;
    });

    return {
      ...filters,
      teamIds,
      positionIds,
      roleIds,
      qualificationAreaIds,
      qualificationLevelIds,
      qualificationStatuses:
        qualificationAreaIds.length > 0 ? filters.qualificationStatuses : [],
    };
  }

  if (filter.key === "qualificationAreaIds") {
    const qualificationAreaIds = filters.qualificationAreaIds.filter(
      (id) => id !== filter.id,
    );
    const qualificationLevelIds = filters.qualificationLevelIds.filter((id) => {
      const level = data.qualificationLevels.find((item) => item.levelId === id);
      return level ? qualificationAreaIds.includes(level.areaId) : false;
    });
    return {
      ...filters,
      qualificationAreaIds,
      qualificationLevelIds,
      qualificationStatuses:
        qualificationAreaIds.length > 0 ? filters.qualificationStatuses : [],
    };
  }

  return {
    ...filters,
    [filter.key]: filters[filter.key].filter((id) => id !== filter.id),
  };
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
  data,
  listQuery,
  onListQueryChange,
  filters,
  onFiltersChange,
  filtersOpen,
  onFiltersOpenChange,
  onClearFilters,
  filtersDisabled = false,
}: MemberListFilterToolbarProps) => {
  const activeCount = countActiveMemberListFilters(filters);
  const hasFilter = activeCount > 0;
  const activeFilters = buildActiveMemberFilters(filters, data);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <EntityListSearch
          className="min-w-0 flex-1"
          label="Members"
          value={listQuery}
          onChange={onListQueryChange}
        />
        <div className="flex shrink-0">
          <Button
            type="button"
            variant="tertiary"
            svg={ListFilter}
            iconSize="sm"
            className={cn(
              hasFilter &&
              "rounded-r-none border-cyan-400/40 border-r-0 bg-cyan-400/10 text-cyan-50",
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
          {hasFilter ? (
            <Button
              type="button"
              variant="tertiary"
              svg={X}
              iconSize="sm"
              padding="px-1.5 py-1"
              className="rounded-l-none border-cyan-400/40 bg-cyan-400/10 text-cyan-50"
              disabled={filtersDisabled}
              aria-label="Clear all filters"
              onClick={onClearFilters}
            />
          ) : null}
        </div>
      </div>
      {hasFilter ? (
        <div
          className="flex flex-wrap gap-1.5"
          aria-label="Active member filters"
          role="group"
        >
          {activeFilters.map((filter) => (
            <div
              key={`${filter.key}-${filter.id}`}
              className="flex min-w-0 items-center gap-1 rounded-full border border-cyan-400/40 bg-cyan-400/10 py-0.5 pl-2.5 pr-1 text-xs text-cyan-50"
            >
              <span className="truncate">{filter.label}</span>
              <Button
                type="button"
                variant="textLink"
                svg={X}
                iconSize="xs"
                padding="p-0.5"
                className="shrink-0 rounded-full text-cyan-200 hover:bg-cyan-300/15 hover:text-white"
                disabled={filtersDisabled}
                aria-label={`Remove ${filter.label} filter`}
                onClick={() =>
                  onFiltersChange(removeActiveMemberFilter(filters, filter, data))
                }
              />
            </div>
          ))}
        </div>
      ) : null}
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
      <Checkbox
        label="Show archived members"
        checked={value.includeArchived}
        onCheckedChange={(checked) =>
          updateFilters({ includeArchived: Boolean(checked) })
        }
      />
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
