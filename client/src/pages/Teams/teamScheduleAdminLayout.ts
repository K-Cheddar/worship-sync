import type { ScheduleExportLayout } from "./schedule/scheduleExportPdf";

export const TEAM_SCHEDULE_ADMIN_LAYOUT_STORAGE_KEY =
  "worshipsyncTeamScheduleAdminLayout";

/** The admin grid only offers the editable orientations (by-date lives in the
 * per-day detail view), and defaults to the by-position layout. */
export const ADMIN_SCHEDULE_LAYOUTS: ScheduleExportLayout[] = ["transpose", "grid"];

const ADMIN_DEFAULT_LAYOUT: ScheduleExportLayout = "transpose";

export const readTeamScheduleAdminLayout = (): ScheduleExportLayout => {
  try {
    const stored = localStorage.getItem(
      TEAM_SCHEDULE_ADMIN_LAYOUT_STORAGE_KEY,
    ) as ScheduleExportLayout | null;
    return stored && ADMIN_SCHEDULE_LAYOUTS.includes(stored)
      ? stored
      : ADMIN_DEFAULT_LAYOUT;
  } catch {
    return ADMIN_DEFAULT_LAYOUT;
  }
};

export const writeTeamScheduleAdminLayout = (layout: ScheduleExportLayout) => {
  try {
    localStorage.setItem(TEAM_SCHEDULE_ADMIN_LAYOUT_STORAGE_KEY, layout);
  } catch {
    // Ignore storage failures (private mode, quota).
  }
};
