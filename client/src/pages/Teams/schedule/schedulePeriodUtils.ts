import { formatPlainDate, parsePlainDate } from "@/utils/plainDate";
import type { TeamScheduleOccurrence, TeamScheduleSummary } from "../../../api/authTypes";
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
  startDate,
  endDate,
  serviceIds,
  occurrences,
  visibleStartDate = startDate,
  visibleEndDate = endDate,
}: {
  schedules: TeamScheduleSummary[];
  churchId: string;
  teamId: string;
  startDate: string;
  endDate: string;
  serviceIds: string[];
  occurrences: TeamScheduleOccurrence[];
  visibleStartDate?: string;
  visibleEndDate?: string;
}) => {
  const visibleOccurrenceIds = occurrences.map((occurrence) => occurrence.occurrenceId);
  if (visibleOccurrenceIds.length === 0) return { schedule: null, ambiguous: false };
  const sameSet = (left: string[] | undefined, right: string[]) => {
    if (!left || left.length !== right.length) return false;
    const sortedLeft = [...left].sort();
    const sortedRight = [...right].sort();
    return sortedLeft.every((value, index) => value === sortedRight[index]);
  };
  const sameVisiblePeriod = schedules.filter((schedule) => {
    if (
      schedule.archivedAt || schedule.churchId !== churchId ||
      schedule.teamId !== teamId || !schedule.startDate || !schedule.endDate ||
      schedule.startDate > visibleStartDate || schedule.endDate < visibleEndDate
    ) return false;
    const storedOccurrenceIds = schedule.occurrences?.map((occurrence) => occurrence.occurrenceId) || [];
    return visibleOccurrenceIds.every((id) => storedOccurrenceIds.includes(id));
  });
  // Generated records outrank legacy records. The client cannot synchronously
  // hash the current identity, so validate the stored key/ID pair and the
  // church/team/date identity; this also admits records written with the old
  // key that omitted churchId. Multiple generated matches are corrupt/ambiguous.
  const generated = sameVisiblePeriod.filter((schedule) =>
    schedule.source === "generated-period" &&
    Boolean(schedule.generatedPeriodKey) &&
    schedule.scheduleId === `generated_${schedule.generatedPeriodKey}`,
  );
  if (generated.length > 0) {
    const populated = generated.filter(hasScheduleData);
    if (populated.length === 1) return { schedule: populated[0], ambiguous: false };
    if (populated.length > 1) return { schedule: null, ambiguous: true };
    const exact = generated.filter((schedule) => schedule.startDate === startDate && schedule.endDate === endDate);
    const preferred = exact.length ? exact : generated;
    return preferred.length === 1
      ? { schedule: preferred[0], ambiguous: false }
      : { schedule: null, ambiguous: true };
  }
  const legacy = schedules.filter((schedule) =>
    !schedule.archivedAt && schedule.churchId === churchId && schedule.teamId === teamId &&
    schedule.source == null &&
    schedule.startDate === startDate && schedule.endDate === endDate &&
    sameSet(schedule.serviceIds, serviceIds) &&
    sameSet(
      schedule.occurrences?.map((occurrence) => occurrence.occurrenceId),
      occurrences.map((occurrence) => occurrence.occurrenceId),
    ),
  );
  if (legacy.length === 1) return { schedule: legacy[0], ambiguous: false };
  const populated = legacy.filter(hasScheduleData);
  return populated.length === 1
    ? { schedule: populated[0], ambiguous: false }
    : { schedule: null, ambiguous: legacy.length > 0 };
};

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
    ("responses" in schedule && Object.keys(schedule.responses || {}).length > 0);
};
