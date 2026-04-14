import type { SessionKind } from "../api/authTypes";

/**
 * Full name shown in the account toolbar and used for Pouch audit `updatedBy` / `createdBy`.
 * For human sessions, prefers Firebase Auth profile display name when set (same as UserSection).
 */
export function resolveAccountDisplayNameForAudit(opts: {
  sessionKind: SessionKind;
  user: string;
  firebaseHumanDisplayName: string;
}): string {
  const { sessionKind, user, firebaseHumanDisplayName } = opts;
  if (sessionKind === "human") {
    const fromAuth = firebaseHumanDisplayName.trim();
    if (fromAuth) return fromAuth;
  }
  return (user ?? "").trim();
}

/** First token before the first space; if no space, returns the trimmed string. */
export const firstNameFromDisplayName = (displayName: string): string => {
  const t = displayName.trim();
  if (!t) {
    return "";
  }
  const space = t.indexOf(" ");
  return space === -1 ? t : t.slice(0, space);
};
