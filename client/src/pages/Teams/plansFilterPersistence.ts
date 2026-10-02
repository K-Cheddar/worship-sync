import type { OccurrenceOrganizeMode } from "./occurrenceOrganizeMode";

export type PlansFilterPreferences = {
  serviceIds: string[];
  organizeMode: OccurrenceOrganizeMode;
};

const CURRENT_PREFERENCES_VERSION = 1;

const STORAGE_KEY_PREFIX = "worshipSync:teamsPlansFilters:";
const isOrganizeMode = (value: unknown): value is OccurrenceOrganizeMode =>
  value === "byDate" || value === "byService";

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
    return {
      serviceIds,
      organizeMode: isOrganizeMode(value.organizeMode)
        ? value.organizeMode
        : "byDate",
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
