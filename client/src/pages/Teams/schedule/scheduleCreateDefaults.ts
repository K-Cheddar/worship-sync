import type { TeamSchedule, TeamService } from "../../../api/authTypes";
import { formatPlainDate, parsePlainDate } from "@/utils/plainDate";
import { filterServicesWithOccurrencesInRange } from "@/utils/teamScheduleOccurrences";
import { scheduleDateRangesOverlap } from "./scheduleConflicts";
import { isActive } from "../teamsUtils";

export type ScheduleDateRange = { startDate: string; endDate: string };

/** Calendar month range, optionally offset from `now` (0 = this month, 1 = next). */
export const getCalendarMonthRange = (
  monthOffset = 0,
  now: Date = new Date(),
): ScheduleDateRange => {
  const start = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0);
  return {
    startDate: formatPlainDate(start),
    endDate: formatPlainDate(end),
  };
};

const activeTeamSchedules = (schedules: TeamSchedule[], teamId: string) =>
  schedules.filter(
    (schedule) => schedule.teamId === teamId && isActive(schedule),
  );

/** True when an active schedule for this team overlaps the given range. */
export const teamHasScheduleOverlappingRange = ({
  schedules,
  teamId,
  range,
}: {
  schedules: TeamSchedule[];
  teamId: string;
  range: ScheduleDateRange;
}) => {
  if (!teamId) return false;
  return activeTeamSchedules(schedules, teamId).some((schedule) =>
    scheduleDateRangesOverlap(schedule, range),
  );
};

/**
 * Default create window: current month, or next month when that team already
 * has an active schedule overlapping the current month.
 */
export const getCreateScheduleDefaultRange = ({
  teamId,
  schedules,
  now = new Date(),
}: {
  teamId: string;
  schedules: TeamSchedule[];
  now?: Date;
}): ScheduleDateRange => {
  const currentMonth = getCalendarMonthRange(0, now);
  if (
    teamId &&
    teamHasScheduleOverlappingRange({
      schedules,
      teamId,
      range: currentMonth,
    })
  ) {
    return getCalendarMonthRange(1, now);
  }
  return currentMonth;
};

/** Most recent active schedule for a team (by startDate, then endDate). */
export const getMostRecentTeamSchedule = ({
  schedules,
  teamId,
}: {
  schedules: TeamSchedule[];
  teamId: string;
}): TeamSchedule | null => {
  if (!teamId) return null;
  const sorted = [...activeTeamSchedules(schedules, teamId)].sort(
    (left, right) => {
      const byStart = String(right.startDate || "").localeCompare(
        String(left.startDate || ""),
      );
      if (byStart !== 0) return byStart;
      return String(right.endDate || "").localeCompare(
        String(left.endDate || ""),
      );
    },
  );
  return sorted[0] || null;
};

/**
 * Prefill services from the team's most recent schedule, limited to services
 * that still have occurrences in the create range. Falls back to every active
 * service with occurrences in range when there is no prior schedule (or none of
 * its services apply).
 */
export const getCreateScheduleDefaultServiceIds = ({
  teamId,
  schedules,
  services,
  range,
}: {
  teamId: string;
  schedules: TeamSchedule[];
  services: TeamService[];
  range: ScheduleDateRange;
}): string[] => {
  const inRangeIds = new Set(
    filterServicesWithOccurrencesInRange({
      services: services.filter(isActive),
      startDate: range.startDate,
      endDate: range.endDate,
    }).map((service) => service.serviceId),
  );

  const recent = getMostRecentTeamSchedule({ schedules, teamId });
  const fromRecent = (recent?.serviceIds || []).filter((serviceId) =>
    inRangeIds.has(serviceId),
  );
  if (fromRecent.length > 0) return fromRecent;
  return [...inRangeIds];
};

/**
 * Suggested schedule name from a date window. Full month → "October 2026";
 * otherwise a short inclusive range label.
 */
export const formatSuggestedScheduleName = (
  startDate: string,
  endDate: string,
): string => {
  const start = parsePlainDate(startDate);
  const end = parsePlainDate(endDate);
  if (!start || !end) return "";

  const sameMonth =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth();
  const isMonthStart = start.getDate() === 1;
  const lastDayOfEndMonth = new Date(
    end.getFullYear(),
    end.getMonth() + 1,
    0,
  ).getDate();
  const isMonthEnd = end.getDate() === lastDayOfEndMonth;

  if (sameMonth && isMonthStart && isMonthEnd) {
    return start.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
  }

  const startLabel = start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const endLabel = end.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${startLabel} – ${endLabel}`;
};

export const resolveScheduleNameForSave = ({
  name,
  startDate,
  endDate,
}: {
  name: string;
  startDate: string;
  endDate: string;
}): string => {
  const trimmed = name.trim();
  if (trimmed) return trimmed;
  return formatSuggestedScheduleName(startDate, endDate).trim();
};
