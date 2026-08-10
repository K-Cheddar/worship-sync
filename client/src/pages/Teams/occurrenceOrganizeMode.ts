/**
 * Shared "By date" / "By service" preference for Plans and the admin schedule
 * grid. Plans default to date order for mixed-service weeks; schedule defaults
 * to service grouping for series-focused staffing. Each surface stores its own
 * preference.
 */

export type OccurrenceOrganizeMode = "byDate" | "byService";

export const OCCURRENCE_ORGANIZE_OPTIONS: {
  value: OccurrenceOrganizeMode;
  label: string;
}[] = [
  { value: "byDate", label: "By date" },
  { value: "byService", label: "By service" },
];

const DEFAULT_PLANS_MODE: OccurrenceOrganizeMode = "byDate";
const DEFAULT_SCHEDULE_MODE: OccurrenceOrganizeMode = "byService";

export const TEAMS_PLANS_ORGANIZE_STORAGE_KEY =
  "worshipsyncTeamsPlansOrganizeMode";
export const TEAM_SCHEDULE_ORGANIZE_STORAGE_KEY =
  "worshipsyncTeamScheduleOrganizeMode";

const isOrganizeMode = (
  value: string | null,
): value is OccurrenceOrganizeMode =>
  value === "byDate" || value === "byService";

const readOrganizeMode = (
  key: string,
  fallback: OccurrenceOrganizeMode,
): OccurrenceOrganizeMode => {
  try {
    const stored = localStorage.getItem(key);
    return isOrganizeMode(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
};

const writeOrganizeMode = (key: string, mode: OccurrenceOrganizeMode) => {
  try {
    localStorage.setItem(key, mode);
  } catch {
    // Ignore storage failures (private mode, quota).
  }
};

export const readPlansOrganizeMode = (): OccurrenceOrganizeMode =>
  readOrganizeMode(TEAMS_PLANS_ORGANIZE_STORAGE_KEY, DEFAULT_PLANS_MODE);

export const writePlansOrganizeMode = (mode: OccurrenceOrganizeMode) =>
  writeOrganizeMode(TEAMS_PLANS_ORGANIZE_STORAGE_KEY, mode);

export const readScheduleOrganizeMode = (): OccurrenceOrganizeMode =>
  readOrganizeMode(TEAM_SCHEDULE_ORGANIZE_STORAGE_KEY, DEFAULT_SCHEDULE_MODE);

export const writeScheduleOrganizeMode = (mode: OccurrenceOrganizeMode) =>
  writeOrganizeMode(TEAM_SCHEDULE_ORGANIZE_STORAGE_KEY, mode);
