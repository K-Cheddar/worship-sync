export const TEAM_SCHEDULE_PUBLIC_HIGHLIGHT_STORAGE_KEY =
  "worshipsyncTeamSchedulePublicHighlight";

export const readTeamSchedulePublicHighlight = (): string => {
  try {
    return (
      localStorage.getItem(TEAM_SCHEDULE_PUBLIC_HIGHLIGHT_STORAGE_KEY) || ""
    );
  } catch {
    return "";
  }
};

export const writeTeamSchedulePublicHighlight = (memberId: string) => {
  try {
    if (memberId) {
      localStorage.setItem(
        TEAM_SCHEDULE_PUBLIC_HIGHLIGHT_STORAGE_KEY,
        memberId,
      );
      return;
    }
    localStorage.removeItem(TEAM_SCHEDULE_PUBLIC_HIGHLIGHT_STORAGE_KEY);
  } catch {
    // Ignore storage failures (private mode, quota).
  }
};
