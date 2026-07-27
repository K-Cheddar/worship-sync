import type { ScheduleExportLayout } from "./schedule/scheduleExportPdf";

export const TEAM_SCHEDULE_ADMIN_LAYOUT_STORAGE_KEY =
  "worshipsyncTeamScheduleAdminLayout";

/**
 * Admin schedule layouts. "grid" and "transpose" are the two table orientations
 * (and map onto the shared {@link ScheduleExportLayout} values for PDF export);
 * "board" is the admin-only per-service card view, which has no export equivalent.
 * The by-date export layout lives in the per-day detail view, not the admin grid.
 */
export type TeamScheduleAdminLayout = "transpose" | "grid" | "board";

export const ADMIN_SCHEDULE_LAYOUTS: TeamScheduleAdminLayout[] = [
  "transpose",
  "grid",
  "board",
];

const DESKTOP_DEFAULT_LAYOUT: TeamScheduleAdminLayout = "transpose";
const NARROW_DEFAULT_LAYOUT: TeamScheduleAdminLayout = "board";
const NARROW_SCREEN_QUERY = "(max-width: 1023px)";

const isAdminLayout = (value: string | null): value is TeamScheduleAdminLayout =>
  value === "transpose" || value === "grid" || value === "board";

/**
 * The user's explicitly-chosen layout, or `null` when they have never picked one.
 * A null result lets the caller fall back to a responsive default without that
 * default being mistaken for (and later persisted as) a deliberate choice.
 */
export const readTeamScheduleAdminLayout = (): TeamScheduleAdminLayout | null => {
  try {
    const stored = localStorage.getItem(TEAM_SCHEDULE_ADMIN_LAYOUT_STORAGE_KEY);
    return isAdminLayout(stored) ? stored : null;
  } catch {
    return null;
  }
};

/** Whether the user has deliberately picked a layout (vs. running on the default). */
export const hasStoredTeamScheduleAdminLayout = (): boolean =>
  readTeamScheduleAdminLayout() !== null;

/** The responsive default for a given viewport: card view when narrow (the wide
 * table scrolls awkwardly there), the by-position table otherwise. */
export const responsiveDefaultTeamScheduleAdminLayout = (
  prefersNarrow: boolean,
): TeamScheduleAdminLayout =>
  prefersNarrow ? NARROW_DEFAULT_LAYOUT : DESKTOP_DEFAULT_LAYOUT;

const prefersNarrowLayout = (): boolean => {
  try {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia(NARROW_SCREEN_QUERY).matches
    );
  } catch {
    return false;
  }
};

/**
 * Initial layout on mount: honour an explicit stored preference, otherwise fall
 * back to the responsive default for the current viewport.
 */
export const resolveInitialTeamScheduleAdminLayout = (): TeamScheduleAdminLayout =>
  readTeamScheduleAdminLayout() ??
  responsiveDefaultTeamScheduleAdminLayout(prefersNarrowLayout());

/** Persist a deliberate layout switch so it wins over the responsive default. */
export const writeTeamScheduleAdminLayout = (layout: TeamScheduleAdminLayout) => {
  try {
    localStorage.setItem(TEAM_SCHEDULE_ADMIN_LAYOUT_STORAGE_KEY, layout);
  } catch {
    // Ignore storage failures (private mode, quota).
  }
};

/** Map an admin layout onto the export layout used for the PDF preview. The card
 * view has no table export, so it falls back to the phone-friendly by-date list. */
export const toScheduleExportLayout = (
  layout: TeamScheduleAdminLayout,
): ScheduleExportLayout => (layout === "board" ? "byDate" : layout);
