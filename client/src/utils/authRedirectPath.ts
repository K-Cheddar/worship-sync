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

// `/aux-controller/<id>` is a dynamic operator surface (same tier as `/controller`).
// Omitting it sent booth restarts to the presentation controller after operator entry.
const AUTH_REDIRECT_PREFIXES = ["/controller", "/aux-controller", "/boards/"];

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

/**
 * Reload-safe return path when leaving the public BrowserRouter shell for the
 * HashRouter operator app (full-page assign drops React Router `state.from`).
 */
export const PUBLIC_SHELL_AUTH_RETURN_KEY =
  "worshipsync_public_shell_auth_return";

const sanitizeStoredAuthReturnPath = (raw: string): string | null => {
  const q = raw.indexOf("?");
  const pathname = q === -1 ? raw : raw.slice(0, q);
  const search = q === -1 ? "" : raw.slice(q);
  const safePath = sanitizeAuthRedirectPathname(pathname);
  if (!safePath) return null;
  return `${safePath}${sanitizeAuthRedirectSearch(search)}`;
};

export function setPublicShellAuthReturnPath(redirectTo: string): void {
  if (typeof window === "undefined") return;
  const sanitized = sanitizeStoredAuthReturnPath(redirectTo);
  if (!sanitized) return;
  try {
    window.sessionStorage.setItem(PUBLIC_SHELL_AUTH_RETURN_KEY, sanitized);
  } catch {
    // Privacy modes may block sessionStorage; post-auth falls back to /home.
  }
}

export function peekPublicShellAuthReturnPath(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PUBLIC_SHELL_AUTH_RETURN_KEY);
    if (!raw) return null;
    return sanitizeStoredAuthReturnPath(raw);
  } catch {
    return null;
  }
}

export function clearPublicShellAuthReturnPath(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PUBLIC_SHELL_AUTH_RETURN_KEY);
  } catch {
    // Ignore storage failures.
  }
}

/** Read and clear the public-shell return path (one-shot handoff). */
export function takePublicShellAuthReturnPath(): string | null {
  const path = peekPublicShellAuthReturnPath();
  clearPublicShellAuthReturnPath();
  return path;
}

/** After human sign-in, matches AppEntry: deep link when present, otherwise `/home`. */
export function getHumanPostAuthPath(location: Location): string {
  const fromState = getAuthRedirectToFromState(location.state);
  if (fromState && fromState !== "/") return fromState;
  const fromShell = takePublicShellAuthReturnPath();
  return fromShell && fromShell !== "/" ? fromShell : "/home";
}
