import type { OccurrenceOrganizeMode } from "./occurrenceOrganizeMode";

export type PlansRangePreset =
  | "upcoming"
  | "thisMonth"
  | "nextMonth"
  | "thisQuarter"
  | "nextQuarter"
  | "custom";

export type PlansFilterPreferences = {
  serviceIds: string[];
  organizeMode: OccurrenceOrganizeMode;
  rangePreset: PlansRangePreset;
  customStartDate?: string;
  customEndDate?: string;
};

const CURRENT_PREFERENCES_VERSION = 1;

const STORAGE_KEY_PREFIX = "worshipSync:teamsPlansFilters:";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isRangePreset = (value: unknown): value is PlansRangePreset =>
  value === "upcoming"
  || value === "thisMonth"
  || value === "nextMonth"
  || value === "thisQuarter"
  || value === "nextQuarter"
  || value === "custom";

const isOrganizeMode = (value: unknown): value is OccurrenceOrganizeMode =>
  value === "byDate" || value === "byService";

const isDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
  );
};

const storageKey = (churchId: string) => `${STORAGE_KEY_PREFIX}${churchId}`;

export const readPlansFilterPreferences = (
  churchId: string,
): PlansFilterPreferences | null => {
  try {
    const raw = window.localStorage.getItem(storageKey(churchId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const value = parsed as Record<string, unknown>;
    const serviceIds = Array.isArray(value.serviceIds)
      ? value.serviceIds.filter((id): id is string => typeof id === "string")
      : [];
    const storedPreset = isRangePreset(value.rangePreset)
      ? value.rangePreset
      : "upcoming";
    // The old default was persisted as "thisMonth" with no marker, so it
    // cannot be distinguished from an explicit choice. Treat that legacy value
    // as the old default once; all writes below carry the new version marker.
    const rangePreset = value.version === CURRENT_PREFERENCES_VERSION
      ? storedPreset
      : storedPreset === "thisMonth"
        ? "upcoming"
        : storedPreset;
    const customStartDate = isDate(value.customStartDate)
      ? value.customStartDate
      : undefined;
    const customEndDate = isDate(value.customEndDate)
      ? value.customEndDate
      : undefined;

    if (
      rangePreset === "custom"
      && (!customStartDate || !customEndDate || customStartDate > customEndDate)
    ) {
      return {
        serviceIds,
        organizeMode: isOrganizeMode(value.organizeMode)
          ? value.organizeMode
          : "byDate",
        rangePreset: "upcoming",
      };
    }

    return {
      serviceIds,
      organizeMode: isOrganizeMode(value.organizeMode)
        ? value.organizeMode
        : "byDate",
      rangePreset,
      ...(customStartDate ? { customStartDate } : {}),
      ...(customEndDate ? { customEndDate } : {}),
    };
  } catch {
    return null;
  }
};

export const writePlansFilterPreferences = (
  churchId: string,
  preferences: PlansFilterPreferences,
) => {
  try {
    window.localStorage.setItem(storageKey(churchId), JSON.stringify({
      ...preferences,
      version: CURRENT_PREFERENCES_VERSION,
    }));
  } catch {
    // Ignore storage failures (private mode, quota).
  }
};
