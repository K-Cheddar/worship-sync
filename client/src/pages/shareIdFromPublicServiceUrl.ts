/**
 * Public service plan URLs look like `https://host/#/services/<token>`.
 * Returns the share token, or "" when the URL is not a public service link.
 */
export const shareIdFromPublicServiceUrl = (url: string): string => {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const hash = parsed.hash || "";
    const fromHash = hash.match(/^#\/services\/([^/?#]+)/);
    if (fromHash?.[1]) return decodeURIComponent(fromHash[1]);
    const fromPath = parsed.pathname.match(/\/services\/([^/]+)\/?$/);
    if (fromPath?.[1]) return decodeURIComponent(fromPath[1]);
    return "";
  } catch {
    const fallback = raw.match(/(?:#|^)\/services\/([^/?#]+)/);
    return fallback?.[1] ? decodeURIComponent(fallback[1]) : "";
  }
};
