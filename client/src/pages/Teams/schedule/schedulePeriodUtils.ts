import { formatPlainDate, parsePlainDate } from "@/utils/plainDate";
import type { TeamScheduleOccurrence, TeamScheduleSummary } from "../../../api/authTypes";
import { calendarDateInTimeZone } from "@/utils/teamScheduleOccurrences";
import {
  RANGE_PRESET_OPTIONS,
  resolveRangePreset,
  type RangePreset,
} from "../rangeSelection";

export type SchedulePeriodPreset = RangePreset;
export const SCHEDULE_PERIOD_OPTIONS = RANGE_PRESET_OPTIONS;
export const rangeFromPreset = resolveRangePreset;

/**
 * Upcoming is a moving display window; generated schedules use calendar-aligned
 * bounds so changing the day does not change the period being persisted.
 */
export const persistedScheduleRange = (
  preset: SchedulePeriodPreset,
  visibleRange: { start: string; end: string },
) => {
  if (preset !== "upcoming") return visibleRange;
  const start = parsePlainDate(visibleRange.start);
  const end = parsePlainDate(visibleRange.end);
  if (!start || !end) return visibleRange;
  return {
    start: formatPlainDate(new Date(start.getFullYear(), start.getMonth(), 1)),
    end: formatPlainDate(new Date(end.getFullYear(), end.getMonth() + 1, 0)),
  };
};

export const filterOccurrencesToRange = (
  occurrences: TeamScheduleOccurrence[],
  range: { start: string; end: string },
) => occurrences.filter((occurrence) => {
  const date = occurrence.startsAt.slice(0, 10);
  return date >= range.start && date <= range.end;
});

export const formatSchedulePeriodName = (startDate: string, endDate: string) => {
  const start = parsePlainDate(startDate);
  const end = parsePlainDate(endDate);
  if (!start || !end) return "";
  const sameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();
  const monthLastDate = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
  if (sameMonth && start.getDate() === 1 && end.getDate() === monthLastDate) {
    return start.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }
  const format = (date: Date) => date.toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
  return `${format(start)} – ${format(end)}`;
};

export const findReusablePeriodSchedule = ({
  schedules,
  churchId,
  teamId,
  occurrences,
}: {
  schedules: TeamScheduleSummary[];
  churchId: string;
  teamId: string;
  // Retained as accepted context for existing callers; occurrence identity and
  // occurrence-date coverage determine compatibility.
  startDate?: string;
  endDate?: string;
  serviceIds?: string[];
  occurrences: TeamScheduleOccurrence[];
  visibleStartDate?: string;
  visibleEndDate?: string;
}) => {
  const visibleOccurrenceIds = occurrences.map((occurrence) => occurrence.occurrenceId);
  if (visibleOccurrenceIds.length === 0) return { schedule: null, ambiguous: false };
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const visibleDates = occurrences
    .map((occurrence) => calendarDateInTimeZone(new Date(occurrence.startsAt), timeZone))
    .sort();
  const firstVisibleDate = visibleDates[0];
  const lastVisibleDate = visibleDates[visibleDates.length - 1];
  const compatible = schedules.filter((schedule) => {
    if (
      schedule.archivedAt || schedule.churchId !== churchId ||
      schedule.teamId !== teamId || !schedule.startDate || !schedule.endDate ||
      schedule.startDate > firstVisibleDate || schedule.endDate < lastVisibleDate
    ) return false;
    const storedOccurrenceIds = schedule.occurrences?.map((occurrence) => occurrence.occurrenceId) || [];
    // Generated periods are reused by church/team/date identity so service
    // setup changes do not hide staffing saved on a rolling period.
    return isCanonicalGeneratedSchedule(schedule) ||
      visibleOccurrenceIds.every((id) => storedOccurrenceIds.includes(id));
  });
  const canonicalGenerated = compatible.filter(isCanonicalGeneratedSchedule);
  // A valid generated identity has always outranked its source-less legacy
  // copy. Custom schedules remain peers so real conflicting staffing is not
  // hidden by generated identity alone.
  const resolutionCandidates = canonicalGenerated.length > 0
    ? compatible.filter((schedule) => schedule.source != null || isCanonicalGeneratedSchedule(schedule))
    : compatible;
  const populated = resolutionCandidates.filter(hasScheduleData);
  if (populated.length === 1) return { schedule: populated[0], ambiguous: false };
  if (populated.length > 1) return { schedule: null, ambiguous: true };

  if (canonicalGenerated.length === 1) return { schedule: canonicalGenerated[0], ambiguous: false };
  if (canonicalGenerated.length > 1 || resolutionCandidates.length > 1) return { schedule: null, ambiguous: true };
  return resolutionCandidates.length === 1
    ? { schedule: resolutionCandidates[0], ambiguous: false }
    : { schedule: null, ambiguous: false };
};

const isCanonicalGeneratedSchedule = (schedule: TeamScheduleSummary) =>
  schedule.source === "generated-period" &&
  Boolean(schedule.generatedPeriodKey) &&
  schedule.scheduleId === `generated_${schedule.generatedPeriodKey}`;

const hasScheduleData = (schedule: TeamScheduleSummary) => {
  if (schedule.hasScheduleData !== undefined) return schedule.hasScheduleData;
  // Older summaries omit some maps, so their emptiness cannot be established.
  if (schedule.assignmentsOmitted) return true;
  const assignmentCounts = schedule.assignmentCounts?.byMemberId || {};
  return Object.values(assignmentCounts).some((count) => count > 0) ||
    Boolean(schedule.guests?.length) ||
    ("assignments" in schedule && Object.keys(schedule.assignments || {}).length > 0) ||
    ("microphoneAssignments" in schedule && Object.keys(schedule.microphoneAssignments || {}).length > 0) ||
    ("iemAssignments" in schedule && Object.keys(schedule.iemAssignments || {}).length > 0) ||
    ("additionalPositionSlots" in schedule && Object.keys(schedule.additionalPositionSlots || {}).length > 0) ||
    ("optionalPositionSlots" in schedule && Object.keys(schedule.optionalPositionSlots || {}).length > 0) ||
    ("responses" in schedule && Object.keys(schedule.responses || {}).length > 0);
};
