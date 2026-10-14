import { parsePlainDate } from "@/utils/plainDate";
import type { TeamScheduleOccurrence, TeamScheduleSummary } from "../../../api/authTypes";
import { calendarDateInTimeZone, getOccurrenceDate, hasOccurrenceIdentityAmbiguity, matchOccurrencesByIdentity } from "@/utils/teamScheduleOccurrences";
import { RANGE_PRESET_OPTIONS, resolveRangePreset, type RangePreset } from "../rangeSelection";

export type SchedulePeriodPreset = RangePreset;
export const SCHEDULE_PERIOD_OPTIONS = RANGE_PRESET_OPTIONS;
export const rangeFromPreset = resolveRangePreset;

export const resolveDisplayedPeriodRange = ({
  preset: _preset,
  selectedRange,
  scheduleRange,
  viewingSavedSchedule = false,
}: {
  preset: SchedulePeriodPreset;
  selectedRange: { start: string; end: string };
  scheduleRange?: { start: string; end: string } | null;
  viewingSavedSchedule?: boolean;
}) => {
  if (viewingSavedSchedule) return scheduleRange || selectedRange;
  return selectedRange;
};

export const filterOccurrencesToRange = (
  occurrences: TeamScheduleOccurrence[],
  range: { start: string; end: string },
  timeZone = "UTC",
) => occurrences.filter((occurrence) => {
  const date = getOccurrenceDate(occurrence, timeZone);
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
  return overlapping.sort((left, right) =>
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
  startDate,
  endDate,
  occurrences,
  visibleStartDate,
  visibleEndDate,
  operatorSelectedScheduleId,
  timeZone = "UTC",
}: {
  schedules: TeamScheduleSummary[];
  churchId: string;
  teamId: string;
  startDate?: string;
  endDate?: string;
  occurrences: TeamScheduleOccurrence[];
  visibleStartDate?: string;
  visibleEndDate?: string;
  /** A schedule deliberately chosen in the current period picker. */
  operatorSelectedScheduleId?: string;
  timeZone?: string;
}): {
  schedule: TeamScheduleSummary | null;
  ambiguous: boolean;
  ownershipConflict?: boolean;
} => {
  const visibleDates = occurrences
    .map((occurrence) => calendarDateInTimeZone(new Date(occurrence.startsAt), timeZone))
    .sort();
  const firstVisibleDate = visibleStartDate || visibleDates[0];
  const lastVisibleDate = visibleEndDate || visibleDates[visibleDates.length - 1];
  if (!firstVisibleDate || !lastVisibleDate) return { schedule: null, ambiguous: false };
  const periodStartDate = visibleStartDate || startDate || firstVisibleDate;
  const periodEndDate = visibleEndDate || endDate || lastVisibleDate;
  const teamSchedules = schedules.filter((schedule) =>
    !schedule.archivedAt && schedule.churchId === churchId && schedule.teamId === teamId,
  );
  const inScope = teamSchedules.filter((schedule) =>
    Boolean(schedule.startDate && schedule.endDate) &&
    schedule.startDate! <= periodEndDate && schedule.endDate! >= periodStartDate,
  );
  const ambiguous = inScope.some((schedule) =>
    hasOccurrenceIdentityAmbiguity(schedule.occurrences || [], occurrences, timeZone),
  );
  const ownershipConflict = occurrences.some((occurrence) => {
    const owners = inScope.filter((schedule) => {
      const match = matchOccurrencesByIdentity(
        schedule.occurrences || [],
        [occurrence],
        timeZone,
      );
      return match.matches.has(occurrence.occurrenceId);
    });
    return owners.length > 1;
  });
  const eligible = schedules.filter((schedule) => {
    if (
      schedule.archivedAt || schedule.churchId !== churchId ||
      schedule.teamId !== teamId || !schedule.startDate || !schedule.endDate
    ) return false;
    // Every candidate is later restricted to an exact range or one covering
    // this period, so older/non-covering ranges cannot be reusable. Skip their
    // occurrence identity scans up front.
    if (schedule.startDate > periodStartDate || schedule.endDate < periodEndDate) return false;
    const storedOccurrences = schedule.occurrences || [];
    const { matches, ambiguousCurrentIds } = matchOccurrencesByIdentity(
      storedOccurrences,
      occurrences,
      timeZone,
    );
    if (ambiguousCurrentIds.size > 0) return false;
    if (matches.size > 0 || occurrences.length === 0) return true;
    return isCanonicalGeneratedSchedule(schedule) &&
      schedule.startDate === periodStartDate &&
      schedule.endDate === periodEndDate &&
      storedOccurrences.length === 0 &&
      !hasScheduleData(schedule);
  });
  const exact = eligible.filter((schedule) =>
    schedule.startDate === periodStartDate && schedule.endDate === periodEndDate);
  const covering = eligible.filter((schedule) =>
    schedule.startDate! <= periodStartDate && schedule.endDate! >= periodEndDate);
  const tier = exact.length ? exact : covering;
  const explicitlySelected = tier
    .find((schedule) => schedule.scheduleId === operatorSelectedScheduleId);
  const ordered = [...tier].sort((left, right) =>
    Number(hasScheduleData(right)) - Number(hasScheduleData(left)) ||
    Number(isCanonicalGeneratedSchedule(right)) - Number(isCanonicalGeneratedSchedule(left)) ||
    String(left.startDate).localeCompare(String(right.startDate)) ||
    String(left.endDate).localeCompare(String(right.endDate)) ||
    left.scheduleId.localeCompare(right.scheduleId),
  );
  return {
    schedule: explicitlySelected || ordered[0] || null,
    ambiguous,
    ...(ownershipConflict ? { ownershipConflict: true } : {}),
  };
};

/** Preserve saved occurrence keys and append only safely identifiable current rows. */
export const mergeCurrentScheduleOccurrences = (
  stored: TeamScheduleOccurrence[],
  current: TeamScheduleOccurrence[],
  timeZone = "UTC",
  otherSchedules: TeamScheduleSummary[] = [],
) => {
  const saved = Array.isArray(stored) ? stored : [];
  const generated = Array.isArray(current) ? current : [];
  const { matches, ambiguousCurrentIds } = matchOccurrencesByIdentity(saved, generated, timeZone);
  if (
    ambiguousCurrentIds.size > 0 ||
    hasOccurrenceIdentityAmbiguity(saved, generated, timeZone)
  ) return { occurrences: saved, ambiguous: true };

  const missing = generated.filter((occurrence) => {
    if (matches.has(occurrence.occurrenceId)) return false;
    return !otherSchedules.some((schedule) => {
      if (schedule.archivedAt) return false;
      const match = matchOccurrencesByIdentity(
        schedule.occurrences || [],
        [occurrence],
        timeZone,
      );
      return match.matches.has(occurrence.occurrenceId) || match.ambiguousCurrentIds.size > 0;
    });
  });
  const occurrences = [...saved, ...missing].sort((left, right) =>
    String(left.startsAt).localeCompare(String(right.startsAt)) ||
    String(left.occurrenceId).localeCompare(String(right.occurrenceId)),
  );
  return { occurrences, ambiguous: false };
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
