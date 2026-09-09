export const SERVICE_PUBLIC_NOTES_ROLE_STORAGE_KEY =
  "worshipsyncServicePublicNotesRole";

const normalizePositionIds = (positionIds: string[]): string[] => {
  const seen = new Set<string>();
  const next: string[] = [];
  positionIds.forEach((positionId) => {
    const trimmed = positionId.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    next.push(trimmed);
  });
  return next;
};

/** Reads selected role ids. Legacy single-id strings still restore correctly. */
export const readServicePublicNotesRole = (): string[] => {
  try {
    const raw = localStorage.getItem(SERVICE_PUBLIC_NOTES_ROLE_STORAGE_KEY);
    if (!raw) return [];
    if (raw.startsWith("[")) {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return normalizePositionIds(
        parsed.filter((entry): entry is string => typeof entry === "string"),
      );
    }
    return normalizePositionIds([raw]);
  } catch {
    return [];
  }
};

export const writeServicePublicNotesRole = (positionIds: string[]) => {
  try {
    const next = normalizePositionIds(positionIds);
    if (next.length) {
      localStorage.setItem(
        SERVICE_PUBLIC_NOTES_ROLE_STORAGE_KEY,
        JSON.stringify(next),
      );
      return;
    }
    localStorage.removeItem(SERVICE_PUBLIC_NOTES_ROLE_STORAGE_KEY);
  } catch {
    // Ignore storage failures (private mode, quota).
  }
};
