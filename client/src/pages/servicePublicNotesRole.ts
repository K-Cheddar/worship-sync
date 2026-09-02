export const SERVICE_PUBLIC_NOTES_ROLE_STORAGE_KEY =
  "worshipsyncServicePublicNotesRole";

export const readServicePublicNotesRole = (): string => {
  try {
    return localStorage.getItem(SERVICE_PUBLIC_NOTES_ROLE_STORAGE_KEY) || "";
  } catch {
    return "";
  }
};

export const writeServicePublicNotesRole = (positionId: string) => {
  try {
    const trimmed = positionId.trim();
    if (trimmed) {
      localStorage.setItem(SERVICE_PUBLIC_NOTES_ROLE_STORAGE_KEY, trimmed);
      return;
    }
    localStorage.removeItem(SERVICE_PUBLIC_NOTES_ROLE_STORAGE_KEY);
  } catch {
    // Ignore storage failures (private mode, quota).
  }
};
