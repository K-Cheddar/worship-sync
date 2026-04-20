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
  "/overlay-controller",
  "/boards/controller",
  "/boards/display",
]);

const AUTH_REDIRECT_PREFIXES = ["/controller", "/boards/"];

/** Limit redirect query strings (deep links, filters) without allowing unbounded payloads. */
const AUTH_REDIRECT_MAX_SEARCH_LENGTH = 8192;

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

/** Same allowlist as pathname; drops unsafe or oversized query strings (invalid → treated as no query). */
export function sanitizeAuthRedirectSearch(search: unknown): string {
  if (typeof search !== "string") return "";
  const trimmed = search.trim();
  if (!trimmed) return "";
  if (!trimmed.startsWith("?")) return "";
  if (trimmed.length > AUTH_REDIRECT_MAX_SEARCH_LENGTH) return "";
  return trimmed;
}

/**
 * Pathname + optional search from AuthGate `Navigate state={{ from: location }}`.
 * Preserves deep-link query strings (e.g. `/controller/bible?search=John%203:16`).
 */
export function getAuthRedirectToFromState(state: unknown): string | null {
  if (
    typeof state !== "object" ||
    state === null ||
    !("from" in state) ||
    typeof (state as { from?: unknown }).from !== "object" ||
    (state as { from: unknown }).from === null
  ) {
    return null;
  }
  const from = (state as { from: { pathname?: unknown; search?: unknown } })
    .from;
  const pathname = sanitizeAuthRedirectPathname(from.pathname);
  if (!pathname) return null;
  const search = sanitizeAuthRedirectSearch(from.search);
  return `${pathname}${search}`;
}

/** Pathname only (no query). Prefer `getAuthRedirectToFromState` when the search string matters. */
export function getAuthRedirectPathnameFromState(
  state: unknown,
): string | null {
  const to = getAuthRedirectToFromState(state);
  if (!to) return null;
  const q = to.indexOf("?");
  return q === -1 ? to : to.slice(0, q);
}

/** After human sign-in, matches AppEntry: deep link when present, otherwise `/home`. */
export function getHumanPostAuthPath(location: Location): string {
  const p = getAuthRedirectToFromState(location.state);
  return p && p !== "/" ? p : "/home";
}
