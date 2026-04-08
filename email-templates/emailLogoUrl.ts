/**
 * Absolute URL for the WorshipSync mark in HTML emails. Image must be reachable by mail clients.
 * Override with EMAIL_LOGO_URL, or derived from AUTH_APP_BASE_URL origin + /logo512.png.
 */
export function getDefaultEmailLogoUrl(): string {
  const explicit = process.env.EMAIL_LOGO_URL?.trim();
  if (explicit) {
    return explicit;
  }
  const base = process.env.AUTH_APP_BASE_URL?.trim();
  if (base) {
    try {
      const parsed = new URL(base);
      return `${parsed.origin}/logo512.png`;
    } catch {
      /* ignore invalid URL */
    }
  }
  return "https://www.worshipsync.net/logo512.png";
}
