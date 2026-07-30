export const SERVICE_PUBLIC_NOTES_TEAM_STORAGE_KEY =
  "worshipsyncServicePublicNotesTeam";

export const readServicePublicNotesTeam = (): string => {
  try {
    return localStorage.getItem(SERVICE_PUBLIC_NOTES_TEAM_STORAGE_KEY) || "";
  } catch {
    return "";
  }
};

export const writeServicePublicNotesTeam = (team: string) => {
  try {
    const trimmed = team.trim();
    if (trimmed) {
      localStorage.setItem(SERVICE_PUBLIC_NOTES_TEAM_STORAGE_KEY, trimmed);
      return;
    }
    localStorage.removeItem(SERVICE_PUBLIC_NOTES_TEAM_STORAGE_KEY);
  } catch {
    // Ignore storage failures (private mode, quota).
  }
};
