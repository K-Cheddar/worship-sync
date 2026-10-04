import { useCallback, useState } from "react";
import { formatPlainDate } from "../../utils/plainDate";
import { serverDate } from "../../utils/serverTime";

export type RangePreset =
  | "upcoming"
  | "thisMonth"
  | "nextMonth"
  | "thisQuarter"
  | "nextQuarter"
  | "custom";

export type PlainDateRange = { start: string; end: string };

export type RangeSelectionPreference = {
  preset: RangePreset;
  range?: PlainDateRange;
};

export const RANGE_PRESET_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: "upcoming", label: "Upcoming" },
  { value: "thisMonth", label: "This month" },
  { value: "nextMonth", label: "Next month" },
  { value: "thisQuarter", label: "This quarter" },
  { value: "nextQuarter", label: "Next quarter" },
  { value: "custom", label: "Custom" },
];

export const calendarMonthRange = (date: Date): PlainDateRange => ({
  start: formatPlainDate(new Date(date.getFullYear(), date.getMonth(), 1)),
  end: formatPlainDate(new Date(date.getFullYear(), date.getMonth() + 1, 0)),
});

export const resolveRangePreset = (
  preset: Exclude<RangePreset, "upcoming" | "custom">,
  now = serverDate(),
): PlainDateRange => {
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

export const formatResolvedDateRange = (range: PlainDateRange): string => {
  const format = (value: string) =>
    new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  return `${format(range.start)} – ${format(range.end)}`;
};

export const resolveRangeSelection = ({
  querySelection,
  defaultPreset = "upcoming",
  defaultRange,
  now = serverDate(),
  resolvePresetRange = (preset, referenceTime) => resolveRangePreset(preset, referenceTime),
}: {
  querySelection?: RangeSelectionPreference | null;
  defaultPreset?: RangePreset;
  defaultRange?: PlainDateRange;
  now?: Date;
  resolvePresetRange?: (
    preset: Exclude<RangePreset, "upcoming" | "custom">,
    now: Date,
  ) => PlainDateRange;
}): { preset: RangePreset; range: PlainDateRange; source: "query" | "default" } => {
  const selected = querySelection
    ? { selection: querySelection, source: "query" as const }
    : { selection: { preset: defaultPreset, range: defaultRange }, source: "default" as const };
  const { selection } = selected;
  const range = selection.preset === "custom"
    ? selection.range || defaultRange || calendarMonthRange(now)
    : selection.preset === "upcoming"
      ? defaultRange || calendarMonthRange(now)
      : resolvePresetRange(selection.preset, now);
  return { preset: selection.preset, range, source: selected.source };
};

export const shiftRange = (
  preset: RangePreset,
  range: PlainDateRange,
  direction: -1 | 1,
): PlainDateRange => {
  const start = new Date(`${range.start}T12:00:00`);
  const end = new Date(`${range.end}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return range;

  const rangeMonthCount = (end.getFullYear() - start.getFullYear()) * 12 +
    end.getMonth() - start.getMonth() + 1;
  const isCalendarQuarter = rangeMonthCount === 3 &&
    start.getDate() === 1 &&
    end.getDate() === new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
  const months = preset.includes("Quarter") || (preset === "custom" && isCalendarQuarter) ? 3 : 1;
  start.setDate(1);
  start.setMonth(start.getMonth() + months * direction);
  end.setTime(new Date(start.getFullYear(), start.getMonth() + months, 0).getTime());

  return { start: formatPlainDate(start), end: formatPlainDate(end) };
};

type RangeSelectionOptions = {
  initialPreset?: RangePreset;
  initialRange?: PlainDateRange;
  querySelection?: RangeSelectionPreference | null;
  now?: Date;
  resolvePresetRange?: (
    preset: Exclude<RangePreset, "upcoming" | "custom">,
    now: Date,
  ) => PlainDateRange;
  resolveUpcomingRange?: (now: Date) => PlainDateRange;
};

/** Owns transient range selection; page data supplies the current Upcoming target. */
export const useRangeSelection = ({
  initialPreset = "upcoming",
  now = serverDate(),
  initialRange = calendarMonthRange(now),
  querySelection = null,
  resolvePresetRange = (preset, referenceTime) => resolveRangePreset(preset, referenceTime),
  resolveUpcomingRange = (referenceTime) => calendarMonthRange(referenceTime),
}: RangeSelectionOptions = {}) => {
  const initialSelection = resolveRangeSelection({
    querySelection,
    defaultPreset: initialPreset,
    defaultRange: initialRange,
    now,
    resolvePresetRange,
  });
  const [preset, setPreset] = useState<RangePreset>(initialSelection.preset);
  const [manualRange, setManualRange] = useState<PlainDateRange>(initialSelection.range);
  const range = preset === "upcoming" ? resolveUpcomingRange(now) : manualRange;

  const selectPreset = useCallback((nextPreset: RangePreset) => {
    const nextRange = nextPreset === "custom"
      ? range
      : nextPreset === "upcoming"
        ? resolveUpcomingRange(now)
        : resolvePresetRange(nextPreset, now);
    setManualRange(nextRange);
    setPreset(nextPreset);
  }, [now, range, resolvePresetRange, resolveUpcomingRange]);

  const selectCustomRange = useCallback(({ startDate, endDate }: {
    startDate: string;
    endDate: string;
  }) => {
    if (!startDate || !endDate) return;
    setPreset("custom");
    const nextRange = { start: startDate, end: endDate };
    setManualRange(nextRange);
  }, []);

  const setSelection = useCallback((
    nextPreset: RangePreset,
    nextRange: PlainDateRange,
  ) => {
    setPreset(nextPreset);
    setManualRange(nextRange);
  }, []);

  return {
    preset,
    range,
    setRange: setManualRange,
    selectPreset,
    selectCustomRange,
    setSelection,
  };
};
