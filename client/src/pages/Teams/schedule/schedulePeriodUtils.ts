import { parsePlainDate } from "@/utils/plainDate";
import type { TeamScheduleOccurrence, TeamScheduleSummary } from "../../../api/authTypes";
import { calendarDateInTimeZone } from "@/utils/teamScheduleOccurrences";
import { RANGE_PRESET_OPTIONS, resolveRangePreset, type RangePreset } from "../rangeSelection";

export type SchedulePeriodPreset = RangePreset;
export const SCHEDULE_PERIOD_OPTIONS = RANGE_PRESET_OPTIONS;
export const rangeFromPreset = resolveRangePreset;

export const resolveDisplayedPeriodRange = ({
  preset,
  selectedRange,
  scheduleRange,
  viewingSavedSchedule = false,
  preserveSelectedRange = false,
}: {
  preset: SchedulePeriodPreset;
  selectedRange: { start: string; end: string };
  scheduleRange?: { start: string; end: string } | null;
  viewingSavedSchedule?: boolean;
  preserveSelectedRange?: boolean;
}) => {
  if (viewingSavedSchedule) return scheduleRange || selectedRange;
  if (preset === "upcoming" && !preserveSelectedRange) return scheduleRange || selectedRange;
  return selectedRange;
};

export const filterOccurrencesToRange = (
  occurrences: TeamScheduleOccurrence[],
  range: { start: string; end: string },
) => occurrences.filter((occurrence) => {
  const date = occurrence.startsAt.slice(0, 10);
  return date >= range.start && date <= range.end;
});

/** Active schedules for the selected team whose saved bounds touch the visible range. */
export const findOverlappingPeriodSchedules = ({
  schedules,
  churchId,
  teamId,
  range,
}: {
  schedules: TeamScheduleSummary[];
  churchId: string;
  teamId: string;
  range: { start: string; end: string };
}) => {
  const overlapping = schedules.filter((schedule) =>
    !schedule.archivedAt &&
    schedule.churchId === churchId &&
    schedule.teamId === teamId &&
    Boolean(schedule.startDate && schedule.endDate) &&
    schedule.startDate! <= range.end &&
    schedule.endDate! >= range.start,
  );
  const canonicalGenerated = overlapping.filter(isCanonicalGeneratedSchedule);
  return overlapping.filter((schedule) =>
    schedule.source != null ||
    !canonicalGenerated.some((generated) =>
      generated.startDate === schedule.startDate && generated.endDate === schedule.endDate),
  ).sort((left, right) =>
    String(left.startDate).localeCompare(String(right.startDate)) ||
    String(left.endDate).localeCompare(String(right.endDate)) ||
    left.name.localeCompare(right.name),
  );
};

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
  visibleStartDate,
  visibleEndDate,
}: {
  schedules: TeamScheduleSummary[];
  churchId: string;
  teamId: string;
  startDate?: string;
  endDate?: string;
  occurrences: TeamScheduleOccurrence[];
  visibleStartDate?: string;
  visibleEndDate?: string;
}) => {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const visibleDates = occurrences
    .map((occurrence) => calendarDateInTimeZone(new Date(occurrence.startsAt), timeZone))
    .sort();
  const firstVisibleDate = visibleStartDate || visibleDates[0];
  const lastVisibleDate = visibleEndDate || visibleDates[visibleDates.length - 1];
  if (!firstVisibleDate || !lastVisibleDate) return { schedule: null, ambiguous: false };
  const compatible = schedules.filter((schedule) => {
    if (
      schedule.archivedAt || schedule.churchId !== churchId ||
      schedule.teamId !== teamId || !schedule.startDate || !schedule.endDate ||
      schedule.startDate > firstVisibleDate || schedule.endDate < lastVisibleDate
    ) return false;
    // Service Setup identities can change after a saved schedule is created.
    // Schedule identity comes from its owner and covered dates, not that mutable setup.
    return true;
  });
  const canonicalGenerated = compatible.filter(isCanonicalGeneratedSchedule);
  // A valid generated identity outranks only its source-less copy for the
  // same stored period. Other populated schedules remain peers so real
  // staffing is not hidden by an overlapping generated identity.
  const resolutionCandidates = canonicalGenerated.length > 0
    ? compatible.filter((schedule) => schedule.source != null ||
      isCanonicalGeneratedSchedule(schedule) ||
      !canonicalGenerated.some((generated) =>
        generated.startDate === schedule.startDate && generated.endDate === schedule.endDate))
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
