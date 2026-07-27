import type {
  TeamRecord,
  TeamSchedule,
  TeamScheduleOccurrence,
} from "../../../api/authTypes";
import { getCellMemberIds } from "../teamsUtils";

export type ScheduleAssignmentConflict = {
  memberId: string;
  scheduleId: string;
  scheduleName: string;
  teamId: string;
  teamName: string;
  occurrenceId: string;
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
 * Whether two occurrences describe the same service moment. Prefer shared
 * identity / start time; when either side lacks `startsAt` (legacy schedules),
 * fall back to shared service ids only if the parent schedules' date ranges
 * overlap — so unrelated months do not false-positive.
 */
export const scheduleOccurrencesConflict = (
  current?: TeamScheduleOccurrence | null,
  other?: TeamScheduleOccurrence | null,
  options?: { schedulesOverlap?: boolean },
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
  if (current.startsAt && other.startsAt) {
    if (current.startsAt !== other.startsAt) return false;
    const currentServiceIds = occurrenceServiceIds(current);
    const otherServiceIds = occurrenceServiceIds(other);
    return [...currentServiceIds].some((serviceId) =>
      otherServiceIds.has(serviceId),
    );
  }
  if (!options?.schedulesOverlap) return false;
  const currentServiceIds = occurrenceServiceIds(current);
  const otherServiceIds = occurrenceServiceIds(other);
  return [...currentServiceIds].some((serviceId) =>
    otherServiceIds.has(serviceId),
  );
};

export const findCrossTeamScheduleOccurrenceConflicts = ({
  schedule,
  occurrenceId,
  memberId,
  schedules,
  teams,
}: {
  schedule: TeamSchedule | null | undefined;
  occurrenceId: string;
  memberId: string;
  schedules: TeamSchedule[];
  teams: TeamRecord[];
}): ScheduleAssignmentConflict[] => {
  if (!schedule || !memberId) return [];
  const currentOccurrence = scheduleOccurrencesForConflict(schedule).find(
    (occurrence) => occurrence.occurrenceId === occurrenceId,
  );
  if (!currentOccurrence) return [];
  const teamNameById = new Map(teams.map((team) => [team.teamId, team.name]));

  return schedules.flatMap((otherSchedule) => {
    if (!otherSchedule || otherSchedule.archivedAt) return [];
    if (otherSchedule.scheduleId === schedule.scheduleId) return [];
    if (otherSchedule.teamId === schedule.teamId) return [];
    const otherOccurrence = scheduleOccurrencesForConflict(otherSchedule).find(
      (candidate) =>
        scheduleOccurrencesConflict(currentOccurrence, candidate, {
          schedulesOverlap: scheduleDateRangesOverlap(schedule, otherSchedule),
        }),
    );
    if (!otherOccurrence) return [];
    const row = otherSchedule.assignments?.[otherOccurrence.occurrenceId] || {};
    const isAssigned = Object.values(row).some((cell) =>
      getCellMemberIds(cell).includes(memberId),
    );
    if (!isAssigned) return [];
    return [
      {
        memberId,
        scheduleId: otherSchedule.scheduleId,
        scheduleName: otherSchedule.name || "Schedule",
        teamId: otherSchedule.teamId,
        teamName: teamNameById.get(otherSchedule.teamId) || "another team",
        occurrenceId: otherOccurrence.occurrenceId,
      },
    ];
  });
};

export const formatCrossTeamScheduleConflictWarning = (
  conflicts: ScheduleAssignmentConflict[],
) => {
  const teamNames = [...new Set(conflicts.map((conflict) => conflict.teamName))]
    .filter(Boolean)
    .slice(0, 2);
  if (teamNames.length === 0) return "";
  const extra = conflicts.length - teamNames.length;
  return `Also scheduled on ${teamNames.join(", ")}${extra > 0 ? ` +${extra} more` : ""}`;
};
