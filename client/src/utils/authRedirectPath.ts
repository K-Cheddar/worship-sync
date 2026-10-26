import type { Location } from "react-router-dom";

const AUTH_REDIRECT_EXACT_PATHS = new Set([
  "/",
  "/home",
  "/account",
  "/teams",
  "/teams-and-services",
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
  "/current-service",
  "/current-service/view",
  "/my-schedule",
  "/resources",
]);

// `/aux-controller/<id>` is a dynamic operator surface (same tier as `/controller`).
// Omitting it sent booth restarts to the presentation controller after operator entry.
const AUTH_REDIRECT_PREFIXES = [
  "/controller",
  "/aux-controller",
  "/boards/",
  "/device-pairing/approve/",
  "/account/",
  "/teams/",
  "/teams-and-services/",
];

/** Limit redirect query strings (deep links, filters) without allowing unbounded payloads. */
const AUTH_REDIRECT_MAX_SEARCH_LENGTH = 8192;
const AUTH_REDIRECT_MAX_HASH_LENGTH = 8192;

const containsUnsafeUrlCharacter = (value: string) =>
  value.includes("\\") ||
  Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });

export function sanitizeAuthRedirectPathname(pathname: unknown): string | null {
  if (typeof pathname !== "string") return null;
  const trimmedPath = pathname.trim();
  if (
    !trimmedPath.startsWith("/") ||
    trimmedPath.startsWith("//") ||
    trimmedPath.includes("?") ||
    trimmedPath.includes("#") ||
    containsUnsafeUrlCharacter(trimmedPath)
  ) {
    return null;
  }
  if (AUTH_REDIRECT_EXACT_PATHS.has(trimmedPath)) {
    return trimmedPath;
  }
  return AUTH_REDIRECT_PREFIXES.some((prefix) =>
    prefix.endsWith("/")
      ? trimmedPath.startsWith(prefix)
      : trimmedPath === prefix || trimmedPath.startsWith(`${prefix}/`),
  )
    ? trimmedPath
    : null;
}

/** Same allowlist as pathname; drops unsafe or oversized query strings (invalid → treated as no query). */
export function sanitizeAuthRedirectSearch(search: unknown): string {
  if (typeof search !== "string") return "";
  const trimmed = search.trim();
  if (!trimmed) return "";
  if (
    !trimmed.startsWith("?") ||
    trimmed.includes("#") ||
    containsUnsafeUrlCharacter(trimmed)
  ) return "";
  if (trimmed.length > AUTH_REDIRECT_MAX_SEARCH_LENGTH) return "";
  return trimmed;
}

export function sanitizeAuthRedirectHash(hash: unknown): string {
  if (typeof hash !== "string") return "";
  const trimmed = hash.trim();
  if (!trimmed) return "";
  if (
    !trimmed.startsWith("#") ||
    containsUnsafeUrlCharacter(trimmed) ||
    trimmed.length > AUTH_REDIRECT_MAX_HASH_LENGTH
  ) return "";
  return trimmed;
}

/** Sanitize a complete in-app return destination read from storage or state. */
export function sanitizeAuthRedirectTo(to: unknown): string | null {
  if (typeof to !== "string") return null;
  const trimmed = to.trim();
  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    containsUnsafeUrlCharacter(trimmed)
  ) return null;

  const hashIndex = trimmed.indexOf("#");
  const beforeHash = hashIndex === -1 ? trimmed : trimmed.slice(0, hashIndex);
  const hash = sanitizeAuthRedirectHash(
    hashIndex === -1 ? "" : trimmed.slice(hashIndex),
  );
  const searchIndex = beforeHash.indexOf("?");
  const pathname = searchIndex === -1 ? beforeHash : beforeHash.slice(0, searchIndex);
  const search = sanitizeAuthRedirectSearch(
    searchIndex === -1 ? "" : beforeHash.slice(searchIndex),
  );
  const safePathname = sanitizeAuthRedirectPathname(pathname);
  if (!safePathname) return null;
  return `${safePathname}${search}${hash}`;
}

/**
 * Full safe destination from AuthGate `Navigate state={{ from: location }}`.
 * Preserves query strings and fragments on in-app deep links.
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
  const from = (state as {
    from: { pathname?: unknown; search?: unknown; hash?: unknown };
  }).from;
  const pathname = sanitizeAuthRedirectPathname(from.pathname);
  if (!pathname) return null;
  const search = sanitizeAuthRedirectSearch(from.search);
  const hash = sanitizeAuthRedirectHash(from.hash);
  return sanitizeAuthRedirectTo(`${pathname}${search}${hash}`);
}

/** Pathname only (no query or fragment). Prefer `getAuthRedirectToFromState` for redirects. */
export function getAuthRedirectPathnameFromState(
  state: unknown,
): string | null {
  const to = getAuthRedirectToFromState(state);
  if (!to) return null;
  return to.split(/[?#]/, 1)[0];
}

/**
 * Reload-safe return path when leaving the public BrowserRouter shell for the
 * HashRouter operator app (full-page assign drops React Router `state.from`).
 */
export const PUBLIC_SHELL_AUTH_RETURN_KEY =
  "worshipsync_public_shell_auth_return";

const sanitizeStoredAuthReturnPath = (raw: string): string | null => {
  return sanitizeAuthRedirectTo(raw);
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
  if (
    fromState &&
    isPostAuthDestination(fromState)
  ) {
    return fromState;
  }
  const fromShell = takePublicShellAuthReturnPath();
  return fromShell && isPostAuthDestination(fromShell)
    ? fromShell
    : "/home";
}

export function isPostAuthDestination(to: string): boolean {
  const pathname = to.split(/[?#]/, 1)[0];
  return pathname !== "/" && pathname !== "/login";
}
