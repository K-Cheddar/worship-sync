import type { ControllerAccess } from "../api/authTypes";

/**
 * Controller permissions only. The legacy `appAccess: "member"` value is
 * normalized at the auth boundary to Controller access `none`.
 */

export type { ControllerAccess };

export const normalizeControllerAccess = (value: unknown): ControllerAccess => {
  if (value === "member") return "none";
  if (value === "none" || value === "view" || value === "music" || value === "full") {
    return value;
  }
  return "none";
};

/** True for controller sessions that may look but not modify. */
export const isControllerViewOnly = (access?: ControllerAccess | "member" | null): boolean =>
  access === "view" || access === "none" || access === "member";

/** True when the user has any Controller/operator access. */
export const hasControllerAccess = (access?: ControllerAccess | "member" | null): boolean =>
  access === "view" || access === "music" || access === "full";

export const hasFullControllerAccess = (access?: ControllerAccess | null): boolean =>
  access === "full";

// Temporary alias for workstation and older call sites. New auth code uses the
// explicitly named Controller helpers above.
export const isViewOnlyAccess = isControllerViewOnly;
