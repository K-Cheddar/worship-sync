import type { Location } from "react-router-dom";

const AUTH_REDIRECT_EXACT_PATHS = new Set([
  "/",
  "/home",
  "/account",
  "/login",
  "/invite",
  "/auth/reset",
  "/recovery/confirm",
  "/workstation/pair",
  "/workstation/operator",
  "/display/pair",
  "/projector",
  "/projector-full",
  "/monitor",
  "/stream",
  "/stream-info",
  "/credits",
  "/credits-editor",
  "/info-controller",
  "/overlay-controller",
  "/boards/controller",
  "/boards/display",
]);

const AUTH_REDIRECT_PREFIXES = [
  "/controller",
  "/boards/",
];

export function sanitizeAuthRedirectPathname(pathname: unknown): string | null {
  if (typeof pathname !== "string") return null;
  const trimmedPath = pathname.trim();
  if (!trimmedPath.startsWith("/") || trimmedPath.startsWith("//")) {
    return null;
  }
  if (AUTH_REDIRECT_EXACT_PATHS.has(trimmedPath)) {
    return trimmedPath;
  }
  return AUTH_REDIRECT_PREFIXES.some((prefix) => trimmedPath.startsWith(prefix))
    ? trimmedPath
    : null;
}

/** Pathname from AuthGate/AppEntry `Navigate state={{ from: location }}` (React Router Location). */
export function getAuthRedirectPathnameFromState(state: unknown): string | null {
  if (
    typeof state === "object" &&
    state &&
    "from" in state &&
    typeof (state as { from?: { pathname?: string } }).from?.pathname ===
      "string"
  ) {
    return sanitizeAuthRedirectPathname(
      (state as { from: { pathname: string } }).from.pathname
    );
  }
  return null;
}

/** After human sign-in, matches AppEntry: deep link when present, otherwise `/home`. */
export function getHumanPostAuthPath(location: Location): string {
  const p = getAuthRedirectPathnameFromState(location.state);
  return p && p !== "/" ? p : "/home";
}
