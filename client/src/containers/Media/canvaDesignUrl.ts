/**
 * Parse a Canva design id from a pasted design URL or raw id.
 * Public view links still require the church-connected account to have access.
 */
export const parseCanvaDesignId = (raw: string): string | null => {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;

  if (/^[A-Za-z0-9_-]{3,200}$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    if (host !== "www.canva.com" && host !== "canva.com") {
      return null;
    }
    const match = parsed.pathname.match(
      /^\/design\/([A-Za-z0-9_-]{3,200})(?:\/|$)/i,
    );
    return match?.[1] ?? null;
  } catch {
    return null;
  }
};
