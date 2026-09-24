/**
 * Path-based public share URLs (`/services/...`) boot {@link PublicApp}
 * (BrowserRouter). Kept in sync with `server/publicShareMeta.js`.
 */

const RESERVED_BOARD_SEGMENTS = new Set(["controller", "display"]);

const normalizePathname = (pathname: string): string => {
  const raw = String(pathname || "").trim() || "/";
  if (raw.length > 1 && raw.endsWith("/")) return raw.slice(0, -1);
  return raw;
};

/** Whether this pathname should mount the public BrowserRouter shell. */
export const isPublicSharePathname = (pathname: string): boolean => {
  const path = normalizePathname(pathname);

  if (path === "/invite") return true;
  if (
    path === "/sms-opt-in" ||
    /^\/sms-opt-in\/[^/]+$/.test(path) ||
    path === "/privacy" ||
    path === "/terms"
  ) {
    return true;
  }
  if (/^\/services\/[^/]+$/.test(path)) return true;
  if (/^\/schedule-response\/[^/]+$/.test(path)) return true;
  if (/^\/teams\/schedule\/[^/]+$/.test(path)) return true;
  if (path === "/teams/intake" || /^\/teams\/intake\/[^/]+$/.test(path)) {
    return true;
  }

  let match = path.match(/^\/boards\/present\/([^/]+)$/);
  if (match && !RESERVED_BOARD_SEGMENTS.has(match[1])) return true;

  match = path.match(/^\/boards\/([^/]+)$/);
  if (match && !RESERVED_BOARD_SEGMENTS.has(match[1])) return true;

  return false;
};
