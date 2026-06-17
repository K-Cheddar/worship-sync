import type { TeamsScheduleDrafts } from "./types";

// Local-only persistence for Teams UI state that should survive a page reload
// but is NOT server data: the last-selected schedule and any in-progress
// schedule-form drafts. These used to ride the Pouch cache (which replicated to
// CouchDB and caused inbound-sync races); localStorage is the equivalent local
// store with no network replication. Server data is never cached here — it is
// always loaded fresh from the REST bootstrap and kept live via SSE + polling.

const selectedScheduleKey = (churchId: string) =>
  `teams:selected-schedule:${churchId}`;
const draftsKey = (churchId: string) => `teams:drafts:${churchId}`;

const safeGet = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeSet = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Best-effort: ignore quota / disabled-storage (private mode) errors.
  }
};

const safeRemove = (key: string) => {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Best-effort: ignore.
  }
};

export const readSelectedScheduleId = (churchId: string): string =>
  churchId ? safeGet(selectedScheduleKey(churchId)) || "" : "";

export const writeSelectedScheduleId = (
  churchId: string,
  scheduleId: string,
) => {
  if (!churchId) return;
  if (scheduleId) {
    safeSet(selectedScheduleKey(churchId), scheduleId);
  } else {
    safeRemove(selectedScheduleKey(churchId));
  }
};

export const readScheduleDrafts = (churchId: string): TeamsScheduleDrafts => {
  if (!churchId) return {};
  const raw = safeGet(draftsKey(churchId));
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as TeamsScheduleDrafts;
    }
  } catch {
    // Corrupt entry: fall through to empty.
  }
  return {};
};

export const writeScheduleDrafts = (
  churchId: string,
  drafts: TeamsScheduleDrafts,
) => {
  if (!churchId) return;
  if (Object.keys(drafts).length === 0) {
    safeRemove(draftsKey(churchId));
    return;
  }
  safeSet(draftsKey(churchId), JSON.stringify(drafts));
};
