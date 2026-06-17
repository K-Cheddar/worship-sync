import { useMemo, useState } from "react";
import CollapsibleSectionTrigger from "../../../components/CollapsibleSectionTrigger/CollapsibleSectionTrigger";
import type {
  TeamMemberQualificationStatus,
  TeamQualificationArea,
  TeamQualificationLevel,
  TeamRecord,
} from "../../../api/authTypes";
import type { MemberListFilterState } from "../teamsSelectors";
import {
  CheckboxOptionGrid,
  TeamGroupedCheckboxLists,
  type MultiCheckboxOptionGroup,
} from "./MultiCheckboxGroup";
import { matchesScopedTeam, toCheckboxOption } from "./memberListFilterUtils";

const qualificationStatusOptions: {
  id: TeamMemberQualificationStatus;
  label: string;
}[] = [
    { id: "in_training", label: "In training" },
    { id: "completed", label: "Completed" },
    { id: "expired", label: "Expired" },
  ];

type QualificationFilterSectionProps = {
  teams: TeamRecord[];
  scopedTeamIds: string[];
  qualificationAreas: TeamQualificationArea[];
  qualificationLevels: TeamQualificationLevel[];
  value: Pick<
    MemberListFilterState,
    "qualificationAreaIds" | "qualificationLevelIds" | "qualificationStatuses"
  >;
  onChange: (patch: Partial<MemberListFilterState>) => void;
};

const buildTeamAreaGroups = ({
  teams,
  scopedTeamIds,
  areas,
}: {
  teams: TeamRecord[];
  scopedTeamIds: string[];
  areas: TeamQualificationArea[];
}): MultiCheckboxOptionGroup[] =>
  teams
    .filter((team) => matchesScopedTeam(team.teamId, scopedTeamIds))
    .map((team) => ({
      heading: team.name,
      options: areas
        .filter((area) => area.teamId === team.teamId)
        .map((area) =>
          toCheckboxOption({
            id: area.areaId,
            label: area.name,
            archived: area.archivedAt,
          }),
        ),
    }))
    .filter((group) => (group.options?.length || 0) > 0);

const QualificationFilterSection = ({
  teams,
  scopedTeamIds,
  qualificationAreas,
  qualificationLevels,
  value,
  onChange,
}: QualificationFilterSectionProps) => {
  const [expanded, setExpanded] = useState(false);
  const visibleTeams = useMemo(
    () => teams.filter((team) => matchesScopedTeam(team.teamId, scopedTeamIds)),
    [teams, scopedTeamIds],
  );
  const scopedAreas = useMemo(
    () =>
      qualificationAreas
        .filter((area) => matchesScopedTeam(area.teamId, scopedTeamIds))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
    [qualificationAreas, scopedTeamIds],
  );
  const areaGroups = useMemo(
    () =>
      buildTeamAreaGroups({
        teams,
        scopedTeamIds,
        areas: scopedAreas,
      }),
    [scopedAreas, scopedTeamIds, teams],
  );
  const hasAreas = areaGroups.length > 0;
  const selectedAreaIds = value.qualificationAreaIds;
  const hasSelectedAreas = selectedAreaIds.length > 0;

  const levelGroups = useMemo(() => {
    if (!hasSelectedAreas) return [];
    const levels = qualificationLevels
      .filter((level) => selectedAreaIds.includes(level.areaId))
      .sort((a, b) => a.rank - b.rank);

    return visibleTeams
      .map((team) => {
        const teamAreas = scopedAreas.filter(
          (area) =>
            area.teamId === team.teamId && selectedAreaIds.includes(area.areaId),
        );
        const sections = teamAreas
          .map((area) => ({
            heading: area.name,
            options: levels
              .filter((level) => level.areaId === area.areaId)
              .map((level) =>
                toCheckboxOption({
                  id: level.levelId,
                  label: level.name,
                  archived: level.archivedAt,
                }),
              ),
          }))
          .filter((section) => section.options.length > 0);

        return {
          heading: team.name,
          sections,
        };
      })
      .filter((group) => (group.sections?.length || 0) > 0);
  }, [
    hasSelectedAreas,
    qualificationLevels,
    scopedAreas,
    selectedAreaIds,
    visibleTeams,
  ]);

  const handleAreaChange = (qualificationAreaIds: string[]) => {
    const nextLevelIds = value.qualificationLevelIds.filter((levelId) => {
      const level = qualificationLevels.find((item) => item.levelId === levelId);
      return level ? qualificationAreaIds.includes(level.areaId) : false;
    });
    onChange({
      qualificationAreaIds,
      qualificationLevelIds: nextLevelIds,
      qualificationStatuses:
        qualificationAreaIds.length > 0 ? value.qualificationStatuses : [],
    });
  };

  if (!hasAreas) return null;

  return (
    <div className="min-w-0 space-y-2">
      <CollapsibleSectionTrigger
        label="Qualifications"
        expanded={expanded}
        onExpandedChange={setExpanded}
      />
      {expanded ? (
        <>
          <p className="px-1 text-xs text-gray-400">
            Choose an area first, then narrow by level or status.
          </p>
          <fieldset className="min-w-0 space-y-4 rounded-md border border-gray-700 bg-gray-950/60 p-2">
            <legend className="sr-only">Qualifications</legend>
            <div className="max-h-56 space-y-4 overflow-y-auto">
              <div className="space-y-2">
                <p className="px-1 text-xs font-semibold text-gray-200">Areas</p>
                <TeamGroupedCheckboxLists
                  groups={areaGroups}
                  value={selectedAreaIds}
                  onChange={handleAreaChange}
                />
              </div>
              {hasSelectedAreas && levelGroups.length > 0 ? (
                <div className="space-y-2 border-t border-gray-800 pt-3">
                  <p className="px-1 text-xs font-semibold text-gray-200">Levels</p>
                  <TeamGroupedCheckboxLists
                    groups={levelGroups}
                    value={value.qualificationLevelIds}
                    onChange={(qualificationLevelIds) =>
                      onChange({ qualificationLevelIds })
                    }
                  />
                </div>
              ) : null}
              {hasSelectedAreas ? (
                <div className="space-y-2 border-t border-gray-800 pt-3">
                  <p className="px-1 text-xs font-semibold text-gray-200">Status</p>
                  <CheckboxOptionGrid
                    options={qualificationStatusOptions}
                    value={value.qualificationStatuses}
                    onChange={(qualificationStatuses) =>
                      onChange({
                        qualificationStatuses:
                          qualificationStatuses as TeamMemberQualificationStatus[],
                      })
                    }
                  />
                </div>
              ) : null}
            </div>
          </fieldset>
        </>
      ) : null}
    </div>
  );
};

export default QualificationFilterSection;
