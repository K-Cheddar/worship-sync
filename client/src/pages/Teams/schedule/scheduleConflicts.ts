import type {
  TeamRecord,
  TeamSchedule,
  TeamScheduleOccurrence,
} from "../../../api/authTypes";
import { getOccurrenceDate } from "../../../utils/teamScheduleOccurrences";
import { getCellMemberIds } from "../teamsUtils";

export type ScheduleAssignmentConflict = {
  memberId: string;
  scheduleId: string;
  scheduleName: string;
  teamId: string;
  teamName: string;
  occurrenceId: string;
  positionId?: string;
  kind?: "other-team" | "other-schedule" | "other-position";
};

const occurrenceServiceIds = (occurrence?: TeamScheduleOccurrence | null) =>
  new Set(
    [occurrence?.serviceId, ...(occurrence?.serviceIds || [])]
      .map((id) => String(id || "").trim())
      .filter(Boolean),
  );

const scheduleOccurrencesForConflict = (schedule?: TeamSchedule | null) =>
  schedule?.occurrences?.length
    ? schedule.occurrences
    : (schedule?.serviceIds || []).map(
        (serviceId): TeamScheduleOccurrence => ({
          occurrenceId: serviceId,
          serviceId,
          name: "",
          startsAt: "",
        }),
      );

/** True when two schedule date windows overlap (inclusive plain YYYY-MM-DD). */
export const scheduleDateRangesOverlap = (
  a: { startDate?: string; endDate?: string } | null | undefined,
  b: { startDate?: string; endDate?: string } | null | undefined,
) => {
  const aStart = a?.startDate || a?.endDate || "";
  const aEnd = a?.endDate || a?.startDate || "";
  const bStart = b?.startDate || b?.endDate || "";
  const bEnd = b?.endDate || b?.startDate || "";
  if (!aStart || !aEnd || !bStart || !bEnd) return true;
  return aStart <= bEnd && aEnd >= bStart;
};

/**
 * Whether two occurrences describe the same service moment. Joined occurrences
 * use their earliest member service as `startsAt`, so a joined occurrence can
 * match a standalone member at a different time on the same stored date.
 * Legacy schedules without `startsAt` still require overlapping date ranges.
 */
export const scheduleOccurrencesConflict = (
  current?: TeamScheduleOccurrence | null,
  other?: TeamScheduleOccurrence | null,
  options?: { schedulesOverlap?: boolean; timeZone?: string },
) => {
  if (!current || !other) return false;
  if (
    current.occurrenceId &&
    other.occurrenceId &&
    current.occurrenceId === other.occurrenceId &&
    current.startsAt &&
    other.startsAt
  ) {
    return true;
  }
  const currentServiceIds = occurrenceServiceIds(current);
  const otherServiceIds = occurrenceServiceIds(other);
  const sharesServiceId = [...currentServiceIds].some((serviceId) =>
    otherServiceIds.has(serviceId),
  );
  if (!sharesServiceId) return false;
  if (current.startsAt && other.startsAt) {
    if (current.startsAt === other.startsAt) return true;
    const includesJoinedServices =
      currentServiceIds.size > 1 || otherServiceIds.size > 1;
    return (
      includesJoinedServices &&
      getOccurrenceDate(current, options?.timeZone || "UTC") ===
        getOccurrenceDate(other, options?.timeZone || "UTC")
    );
  }
  return Boolean(options?.schedulesOverlap);
};

export const findCrossTeamScheduleOccurrenceConflicts = ({
  schedule,
  occurrenceId,
  memberId,
  schedules,
  teams,
  cellKey,
  timeZone = "UTC",
}: {
  schedule: TeamSchedule | null | undefined;
  occurrenceId: string;
  memberId: string;
  schedules: TeamSchedule[];
  teams: TeamRecord[];
  positionId?: string;
  cellKey?: string;
  timeZone?: string;
}): ScheduleAssignmentConflict[] => {
  if (!schedule || !memberId) return [];
  const currentOccurrence = scheduleOccurrencesForConflict(schedule).find(
    (occurrence) => occurrence.occurrenceId === occurrenceId,
  );
  if (!currentOccurrence) return [];
  const teamNameById = new Map(teams.map((team) => [team.teamId, team.name]));

  return schedules.flatMap((otherSchedule) => {
    if (!otherSchedule || otherSchedule.archivedAt) return [];
    if (otherSchedule.scheduleId === schedule.scheduleId && !cellKey) return [];
    const otherOccurrence = scheduleOccurrencesForConflict(otherSchedule).find(
      (candidate) =>
        scheduleOccurrencesConflict(currentOccurrence, candidate, {
          schedulesOverlap: scheduleDateRangesOverlap(schedule, otherSchedule),
          timeZone,
        }),
    );
    if (!otherOccurrence) return [];
    const row = otherSchedule.assignments?.[otherOccurrence.occurrenceId] || {};
    const matchingCells = Object.entries(row).filter(([candidateCellKey, cell]) =>
      getCellMemberIds(cell).includes(memberId) &&
      !(otherSchedule.scheduleId === schedule.scheduleId && candidateCellKey === cellKey),
    );
    if (matchingCells.length === 0) return [];
    return matchingCells.map(([candidateCellKey]) => ({
        memberId,
        scheduleId: otherSchedule.scheduleId,
        scheduleName: otherSchedule.name || "Schedule",
        teamId: otherSchedule.teamId,
        teamName: teamNameById.get(otherSchedule.teamId) || "another team",
        occurrenceId: otherOccurrence.occurrenceId,
        positionId: candidateCellKey.split("::")[0],
        kind: otherSchedule.scheduleId === schedule.scheduleId
          ? "other-position"
          : otherSchedule.teamId === schedule.teamId
            ? "other-schedule"
            : "other-team",
      }));
  });
};

export const formatCrossTeamScheduleConflictWarning = (
  conflicts: ScheduleAssignmentConflict[],
) => {
  const descriptions = [...new Set(conflicts.map((conflict) => {
    if (conflict.kind === "other-position") return "another position";
    if (conflict.kind === "other-schedule") return conflict.scheduleName || "another schedule";
    return conflict.teamName;
  }))]
    .filter(Boolean)
    .slice(0, 2);
  if (descriptions.length === 0) return "";
  const extra = conflicts.length - descriptions.length;
  return `Also scheduled on ${descriptions.join(", ")}${extra > 0 ? ` +${extra} more` : ""}`;
};
