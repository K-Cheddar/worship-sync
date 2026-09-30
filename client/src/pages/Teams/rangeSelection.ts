import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatPlainDate } from "../../utils/plainDate";

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

export type RangeSelectionPersistence = {
  key: string | null;
  /** Existing page-specific storage can be read once while it is migrated. */
  legacyKeys?: string[];
};

export const RANGE_PRESET_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: "upcoming", label: "Upcoming" },
  { value: "thisMonth", label: "This month" },
  { value: "nextMonth", label: "Next month" },
  { value: "thisQuarter", label: "This quarter" },
  { value: "nextQuarter", label: "Next quarter" },
  { value: "custom", label: "Custom" },
];

export const resolveRangePreset = (
  preset: Exclude<RangePreset, "custom">,
  now = new Date(),
): PlainDateRange => {
  const year = now.getFullYear();
  const month = now.getMonth();
  const quarterStartMonth = Math.floor(month / 3) * 3;
  let start: Date;
  let end: Date;

  switch (preset) {
    case "upcoming":
      start = new Date(year, month, now.getDate());
      end = new Date(year, month + 2, 0);
      break;
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

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
};

const isRangePreset = (value: unknown): value is RangePreset =>
  RANGE_PRESET_OPTIONS.some((option) => option.value === value);

const parseStoredPreference = (parsed: unknown): RangeSelectionPreference | null => {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const value = parsed as Record<string, unknown>;
  const presetValue = value.preset ?? value.rangePreset;
  const preset = isRangePreset(presetValue) ? presetValue : null;
  if (!preset) return null;

  const storedRange = value.range && typeof value.range === "object"
    ? value.range as Record<string, unknown>
    : value;
  const start = storedRange.start ?? storedRange.customStartDate;
  const end = storedRange.end ?? storedRange.customEndDate;
  const range = isDate(start) && isDate(end) && start <= end
    ? { start, end }
    : undefined;

  return preset === "custom" && !range ? null : { preset, ...(range ? { range } : {}) };
};

export const readRangeSelectionPreference = (
  key: string | null | undefined,
): RangeSelectionPreference | null => {
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? parseStoredPreference(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
};

export const writeRangeSelectionPreference = (
  key: string | null | undefined,
  preference: RangeSelectionPreference,
) => {
  if (!key) return;
  try {
    window.localStorage.setItem(key, JSON.stringify({
      version: 1,
      preset: preference.preset,
      ...(preference.preset === "custom" && preference.range
        ? { range: preference.range }
        : {}),
    }));
  } catch {
    // Range preferences are best-effort local UI state.
  }
};

export const rangeSelectionStorageKey = (page: string, churchId: string) =>
  `worshipSync:teamsRange:${page}:${churchId}`;

export const resolveRangeSelection = ({
  querySelection,
  savedSelection,
  defaultPreset = "upcoming",
  defaultRange,
  resolvePresetRange = resolveRangePreset,
}: {
  querySelection?: RangeSelectionPreference | null;
  savedSelection?: RangeSelectionPreference | null;
  defaultPreset?: RangePreset;
  defaultRange?: PlainDateRange;
  resolvePresetRange?: (
    preset: Exclude<RangePreset, "custom">,
  ) => PlainDateRange;
}): { preset: RangePreset; range: PlainDateRange; source: "query" | "saved" | "default" } => {
  const selected = querySelection
    ? { selection: querySelection, source: "query" as const }
    : savedSelection
      ? { selection: savedSelection, source: "saved" as const }
      : {
        selection: { preset: defaultPreset, range: defaultRange },
        source: "default" as const,
      };
  const { selection } = selected;
  const range = selection.preset === "custom"
    ? selection.range || defaultRange || resolvePresetRange("upcoming")
    : resolvePresetRange(selection.preset);
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

  if (preset === "custom") {
    const days = Math.max(
      1,
      Math.round((end.getTime() - start.getTime()) / 86400000) + 1,
    );
    start.setDate(start.getDate() + days * direction);
    end.setDate(end.getDate() + days * direction);
  } else {
    const months = preset.includes("Quarter") ? 3 : 1;
    start.setDate(1);
    start.setMonth(start.getMonth() + months * direction);
    end.setTime(new Date(start.getFullYear(), start.getMonth() + months, 0).getTime());
  }

  return { start: formatPlainDate(start), end: formatPlainDate(end) };
};

type RangeSelectionOptions = {
  initialPreset?: RangePreset;
  initialRange?: PlainDateRange;
  persistence?: RangeSelectionPersistence;
  querySelection?: RangeSelectionPreference | null;
  resolvePresetRange?: (
    preset: Exclude<RangePreset, "custom">,
  ) => PlainDateRange;
};

/** Owns the shared preset/range transition rules while leaving page state around it composable. */
export const useRangeSelection = ({
  initialPreset = "upcoming",
  initialRange = resolveRangePreset(initialPreset === "custom" ? "upcoming" : initialPreset),
  persistence,
  querySelection = null,
  resolvePresetRange = resolveRangePreset,
}: RangeSelectionOptions = {}) => {
  const initialRangeStart = initialRange.start;
  const initialRangeEnd = initialRange.end;
  const initialSelection = useMemo(
    () => resolveRangeSelection({
      querySelection,
      savedSelection: persistence?.key
        ? readRangeSelectionPreference(persistence.key) ||
          persistence.legacyKeys?.map(readRangeSelectionPreference).find(Boolean) || null
        : null,
      defaultPreset: initialPreset,
      defaultRange: { start: initialRangeStart, end: initialRangeEnd },
      resolvePresetRange,
    }),
    [
      initialPreset,
      initialRangeEnd,
      initialRangeStart,
      persistence?.key,
      persistence?.legacyKeys,
      querySelection,
      resolvePresetRange,
    ],
  );
  const [preset, setPreset] = useState<RangePreset>(initialSelection.preset);
  const [range, setRange] = useState<PlainDateRange>(initialSelection.range);
  const persistenceKeyRef = useRef(persistence?.key ?? null);
  const [restoredFromPersistence, setRestoredFromPersistence] = useState(
    initialSelection.source !== "default",
  );

  const persistSelection = useCallback((nextPreset: RangePreset, nextRange: PlainDateRange) => {
    writeRangeSelectionPreference(persistence?.key, {
      preset: nextPreset,
      range: nextRange,
    });
  }, [persistence?.key]);

  // Church changes are an identity boundary. Re-read the new page preference,
  // but do not write a default back until the operator makes a selection.
  useEffect(() => {
    const nextKey = persistence?.key ?? null;
    if (persistenceKeyRef.current === nextKey) return;
    persistenceKeyRef.current = nextKey;
    const restored = resolveRangeSelection({
      querySelection,
      savedSelection: nextKey
        ? readRangeSelectionPreference(nextKey) ||
          persistence?.legacyKeys?.map(readRangeSelectionPreference).find(Boolean) || null
        : null,
      defaultPreset: initialPreset,
      defaultRange: { start: initialRangeStart, end: initialRangeEnd },
      resolvePresetRange,
    });
    setPreset(restored.preset);
    setRange(restored.range);
    setRestoredFromPersistence(restored.source !== "default");
  }, [
    initialPreset,
    initialRangeEnd,
    initialRangeStart,
    persistence?.key,
    persistence?.legacyKeys,
    querySelection,
    resolvePresetRange,
  ]);

  useEffect(() => {
    if (initialSelection.source !== "saved" || !persistence?.key) return;
    if (!readRangeSelectionPreference(persistence.key)) {
      writeRangeSelectionPreference(persistence.key, {
        preset: initialSelection.preset,
        range: initialSelection.range,
      });
    }
  }, [initialSelection, persistence?.key]);

  const selectPreset = useCallback((nextPreset: RangePreset) => {
    setPreset(nextPreset);
    const nextRange = nextPreset === "custom" ? range : resolvePresetRange(nextPreset);
    if (nextPreset !== "custom") setRange(nextRange);
    persistSelection(nextPreset, nextRange);
  }, [persistSelection, range, resolvePresetRange]);

  const selectCustomRange = useCallback(({ startDate, endDate }: {
    startDate: string;
    endDate: string;
  }) => {
    if (!startDate || !endDate) return;
    setPreset("custom");
    const nextRange = { start: startDate, end: endDate };
    setRange(nextRange);
    persistSelection("custom", nextRange);
  }, [persistSelection]);

  const setSelection = useCallback((
    nextPreset: RangePreset,
    nextRange: PlainDateRange,
    options: { persist?: boolean } = {},
  ) => {
    setPreset(nextPreset);
    setRange(nextRange);
    if (options.persist !== false) persistSelection(nextPreset, nextRange);
  }, [persistSelection]);

  return {
    preset,
    range,
    setRange,
    selectPreset,
    selectCustomRange,
    setSelection,
    restoredFromPersistence,
  };
};

