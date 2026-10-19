import { useCallback, useEffect, useMemo, useRef } from "react";
import type { TeamPosition, TeamScheduleSummary, TeamService } from "../../../api/authTypes";
import { serverDate } from "@/utils/serverTime";
import { buildTeamSchedulePeriod, findInitialTeamSchedulePeriod } from "./teamSchedulePeriod";
import { filterOccurrencesToRange, type SchedulePeriodPreset } from "./schedulePeriodUtils";
import { resolveRangePreset, useRangeSelection } from "../rangeSelection";

/** Team/range navigation and generation only; saved-document selection stays with the editor. */
export const useScheduleWorkspacePeriod = ({
  services: activeServices, positions, schedules, teamId: workspaceTeamId, timeZone: serviceTimeZone,
}: {
  services: TeamService[];
  positions: TeamPosition[];
  schedules: TeamScheduleSummary[];
  teamId: string;
  timeZone: string;
}) => {
  const { initialTeamPeriodResult, periodReferenceTime } = useMemo(() => {
    const referenceTime = serverDate();
    return {
      initialTeamPeriodResult: findInitialTeamSchedulePeriod({
        services: activeServices,
        positions,
        teamId: workspaceTeamId,
        schedules,
        now: referenceTime,
        timeZone: serviceTimeZone,
      }),
      periodReferenceTime: referenceTime,
    };
  },
    [activeServices, positions, schedules, serviceTimeZone, workspaceTeamId],
  );
  const initialPeriodRange = useMemo(() => ({
    start: initialTeamPeriodResult.start,
    end: initialTeamPeriodResult.end,
  }), [initialTeamPeriodResult.end, initialTeamPeriodResult.start]);
  const resolveSchedulePresetRange = useCallback(
    (
      preset: Exclude<SchedulePeriodPreset, "upcoming" | "custom">,
      referenceTime: Date,
    ) => resolveRangePreset(preset, referenceTime),
    [],
  );
  const {
    preset: periodPreset,
    range: periodRange,
    selectPreset: selectRangePreset,
    selectCustomRange,
    setSelection: setPeriodSelection,
  } = useRangeSelection({
    now: periodReferenceTime,
    initialPreset: initialTeamPeriodResult.preset,
    initialRange: initialPeriodRange,
    resolvePresetRange: resolveSchedulePresetRange,
    resolveUpcomingRange: () => initialPeriodRange,
  });
  const hasExplicitPeriodSelectionRef = useRef(false);
  const periodTeamIdRef = useRef(workspaceTeamId);
  useEffect(() => {
    if (periodTeamIdRef.current !== workspaceTeamId) {
      periodTeamIdRef.current = workspaceTeamId;
      hasExplicitPeriodSelectionRef.current = false;
    }
    if (hasExplicitPeriodSelectionRef.current) return;
    setPeriodSelection(initialTeamPeriodResult.preset, initialPeriodRange);
  }, [initialPeriodRange, initialTeamPeriodResult.preset, setPeriodSelection, workspaceTeamId]);
  const teamPeriod = useMemo(
    () => buildTeamSchedulePeriod({
      services: activeServices,
      positions,
      teamId: workspaceTeamId,
      startDate: periodRange.start,
      endDate: periodRange.end,
      timeZone: serviceTimeZone,
    }),
    [activeServices, positions, periodRange.end, periodRange.start, serviceTimeZone, workspaceTeamId],
  );
  const periodServiceIds = teamPeriod.serviceIds;
  const generatedPeriodOccurrences = useMemo(
    () => filterOccurrencesToRange(teamPeriod.occurrences, periodRange, serviceTimeZone),
    [periodRange, serviceTimeZone, teamPeriod.occurrences],
  );
  const markExplicitPeriodSelection = useCallback(() => {
    hasExplicitPeriodSelectionRef.current = true;
  }, []);
  return {
    periodPreset, periodRange, selectRangePreset, selectCustomRange, setPeriodSelection,
    markExplicitPeriodSelection, teamPeriod, periodServiceIds, generatedPeriodOccurrences,
  };
};
