import type {
  TeamPosition,
  TeamSchedule,
  TeamScheduleSummary,
  TeamService,
} from "../../../api/authTypes";
import { parsePlainDate } from "@/utils/plainDate";
import { findInitialTeamSchedulePeriod } from "./teamSchedulePeriod";
import {
  findReusablePeriodSchedule,
  formatSchedulePeriodName,
} from "./schedulePeriodUtils";
import { filterServicesWithOccurrencesInRange } from "@/utils/teamScheduleOccurrences";
import { isActive } from "../teamsUtils";
import { serverDate } from "@/utils/serverTime";

export type ScheduleDateRange = { startDate: string; endDate: string };

/** Upcoming team's next relevant period, skipping periods fully covered by a schedule. */
export const getCreateScheduleDefaultRange = ({
  churchId,
  teamId,
  services,
  positions,
  schedules,
  now = serverDate(),
}: {
  churchId: string;
  teamId: string;
  services: TeamService[];
  positions: TeamPosition[];
  schedules: (TeamSchedule | TeamScheduleSummary)[];
  now?: Date;
}): ScheduleDateRange => {
  let searchDate = now;
  while (teamId) {
    const upcoming = findInitialTeamSchedulePeriod({
      services,
      positions,
      teamId,
      schedules,
      now: searchDate,
    });
    const range = { startDate: upcoming.start, endDate: upcoming.end };
    const coveredSchedule = upcoming.nextOccurrence && churchId
      ? findReusablePeriodSchedule({
        schedules,
        churchId,
        teamId,
        occurrences: upcoming.period.occurrences,
        visibleStartDate: range.startDate,
        visibleEndDate: range.endDate,
      }).schedule
      : null;
    if (!coveredSchedule) return range;

    const periodEnd = parsePlainDate(range.endDate);
    if (!periodEnd) return range;
    periodEnd.setDate(periodEnd.getDate() + 1);
    searchDate = periodEnd;
  }
  const fallback = findInitialTeamSchedulePeriod({
    services,
    positions,
    teamId,
    schedules,
    now,
  });
  return { startDate: fallback.start, endDate: fallback.end };
};

/** Most recent active schedule for a team (by startDate, then endDate). */
export const getMostRecentTeamSchedule = ({
  schedules,
  teamId,
}: {
  schedules: (TeamSchedule | TeamScheduleSummary)[];
  teamId: string;
}): TeamSchedule | TeamScheduleSummary | null => {
  if (!teamId) return null;
  const sorted = [...schedules.filter((schedule) =>
    schedule.teamId === teamId && isActive(schedule),
  )].sort(
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
  schedules: (TeamSchedule | TeamScheduleSummary)[];
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
export const formatSuggestedScheduleName = formatSchedulePeriodName;

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
