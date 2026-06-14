export const TEAM_SCHEDULE_PUBLIC_THEME_STORAGE_KEY =
  "worshipsyncTeamSchedulePublicTheme";

export type TeamSchedulePublicTheme = "light" | "dark";

export const readTeamSchedulePublicTheme = (): TeamSchedulePublicTheme => {
  try {
    const stored = localStorage.getItem(TEAM_SCHEDULE_PUBLIC_THEME_STORAGE_KEY);
    return stored === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
};

export const writeTeamSchedulePublicTheme = (
  theme: TeamSchedulePublicTheme,
) => {
  try {
    localStorage.setItem(TEAM_SCHEDULE_PUBLIC_THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore storage failures (private mode, quota).
  }
};
