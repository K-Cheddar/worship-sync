import type { ScheduleExportLayout } from "./schedule/scheduleExportPdf";

export const TEAM_SCHEDULE_PUBLIC_LAYOUT_STORAGE_KEY =
  "worshipsyncTeamSchedulePublicLayout";

const VALID_LAYOUTS: ScheduleExportLayout[] = ["grid", "transpose", "byDate"];

export const readTeamSchedulePublicLayout = (): ScheduleExportLayout => {
  try {
    const stored = localStorage.getItem(
      TEAM_SCHEDULE_PUBLIC_LAYOUT_STORAGE_KEY,
    ) as ScheduleExportLayout | null;
    return stored && VALID_LAYOUTS.includes(stored) ? stored : "byDate";
  } catch {
    return "byDate";
  }
};

export const writeTeamSchedulePublicLayout = (layout: ScheduleExportLayout) => {
  try {
    localStorage.setItem(TEAM_SCHEDULE_PUBLIC_LAYOUT_STORAGE_KEY, layout);
  } catch {
    // Ignore storage failures (private mode, quota).
  }
};
