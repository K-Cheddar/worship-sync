import type { SessionKind } from "../api/authTypes";

/**
 * Full name shown in the account toolbar and used for Pouch audit `updatedBy` / `createdBy`.
 * For human sessions, prefers the bootstrap toolbar label (`user`) first: it is resolved on the
 * server (Firebase Admin + profile) on every session refresh. The client Firebase Auth
 * `displayName` can lag behind Admin updates until `reload()` runs, which previously made the
 * toolbar disagree with `activeInstanceName` (which already prefers `user`).
 */
export function resolveAccountDisplayNameForAudit(opts: {
  sessionKind: SessionKind;
  user: string;
  firebaseHumanDisplayName: string;
}): string {
  const { sessionKind, user, firebaseHumanDisplayName } = opts;
  const trimmedUser = (user ?? "").trim();
  const fromAuth = firebaseHumanDisplayName.trim();
  if (sessionKind === "human") {
    if (trimmedUser) return trimmedUser;
    if (fromAuth) return fromAuth;
    return "";
  }
  return trimmedUser;
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
