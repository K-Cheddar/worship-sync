import { formatPlainDate, parsePlainDate } from "@/utils/plainDate";
import type { TeamScheduleOccurrence, TeamScheduleSummary } from "../../../api/authTypes";

export type SchedulePeriodPreset =
  | "thisMonth"
  | "nextMonth"
  | "thisQuarter"
  | "nextQuarter"
  | "custom";

export const SCHEDULE_PERIOD_OPTIONS: { value: SchedulePeriodPreset; label: string }[] = [
  { value: "thisMonth", label: "This month" },
  { value: "nextMonth", label: "Next month" },
  { value: "thisQuarter", label: "This quarter" },
  { value: "nextQuarter", label: "Next quarter" },
  { value: "custom", label: "Custom" },
];

export const rangeFromPreset = (
  preset: Exclude<SchedulePeriodPreset, "custom">,
  now = new Date(),
) => {
  const year = now.getFullYear();
  const month = now.getMonth();
  const quarterStartMonth = Math.floor(month / 3) * 3;
  let start: Date;
  let end: Date;
  switch (preset) {
    case "thisMonth":
      start = new Date(year, month, 1);
      end = new Date(year, month + 1, 0);
      break;
    case "nextMonth":
      start = new Date(year, month + 1, 1);
      end = new Date(year, month + 2, 0);
      break;
    case "thisQuarter":
      start = new Date(year, quarterStartMonth, 1);
      end = new Date(year, quarterStartMonth + 3, 0);
      break;
    case "nextQuarter":
      start = new Date(year, quarterStartMonth + 3, 1);
      end = new Date(year, quarterStartMonth + 6, 0);
      break;
  }
  return { start: formatPlainDate(start), end: formatPlainDate(end) };
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
  serviceIds,
  occurrences,
}: {
  schedules: TeamScheduleSummary[];
  churchId: string;
  teamId: string;
  startDate: string;
  endDate: string;
  serviceIds: string[];
  occurrences: TeamScheduleOccurrence[];
}) => {
  const sameSet = (left: string[] | undefined, right: string[]) => {
    if (!left || left.length !== right.length) return false;
    const sortedLeft = [...left].sort();
    const sortedRight = [...right].sort();
    return sortedLeft.every((value, index) => value === sortedRight[index]);
  };
  const samePeriod = schedules.filter((schedule) => {
    if (
      schedule.archivedAt || schedule.churchId !== churchId ||
      schedule.teamId !== teamId || schedule.startDate !== startDate ||
      schedule.endDate !== endDate
    ) return false;
    return true;
  });
  // Generated records outrank legacy records. The client cannot synchronously
  // hash the current identity, so validate the stored key/ID pair and the
  // church/team/date identity; this also admits records written with the old
  // key that omitted churchId. Multiple generated matches are corrupt/ambiguous.
  const generated = samePeriod.filter((schedule) =>
    schedule.source === "generated-period" &&
    Boolean(schedule.generatedPeriodKey) &&
    schedule.scheduleId === `generated_${schedule.generatedPeriodKey}`,
  );
  if (generated.length > 0) {
    return {
      schedule: generated.length === 1 ? generated[0] : null,
      ambiguous: generated.length > 1,
    };
  }
  const legacy = samePeriod.filter((schedule) =>
    schedule.source == null &&
    sameSet(schedule.serviceIds, serviceIds) &&
    sameSet(
      schedule.occurrences?.map((occurrence) => occurrence.occurrenceId),
      occurrences.map((occurrence) => occurrence.occurrenceId),
    ),
  );
  return {
    schedule: legacy.length === 1 ? legacy[0] : null,
    ambiguous: legacy.length > 1,
  };
};
