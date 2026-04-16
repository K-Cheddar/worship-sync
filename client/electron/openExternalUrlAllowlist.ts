/**
 * Restricts shell.openExternal targets from the renderer (SSO browser step, etc.).
 * Override with comma-separated hostnames, e.g. WORSHIPSYNC_OPEN_EXTERNAL_HOSTS=app.example.com,staging.example.com
 */
const DEFAULT_ALLOWED_HOSTS = [
  "www.worshipsync.net",
  "worshipsync.net",
  "local.worshipsync.net",
];

const parseAllowedHosts = (): Set<string> => {
  const raw = String(process.env.WORSHIPSYNC_OPEN_EXTERNAL_HOSTS || "").trim();
  const list = raw
    ? raw.split(",").map((h) => h.trim().toLowerCase())
    : DEFAULT_ALLOWED_HOSTS;
  return new Set(list.filter(Boolean));
};

const isLocalDevHost = (hostname: string): boolean => {
  const h = hostname.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
};

/**
 * @throws Error with a stable message when the URL must not be opened.
 */
export const assertAllowedOpenExternalUrl = (
  raw: string,
  options: { isDev: boolean },
): void => {
  const trimmed = String(raw || "").trim();
  if (!trimmed) {
    throw new Error("No URL was provided to open.");
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("That link is not a valid URL.");
  }

  const protocol = url.protocol.toLowerCase();
  const host = url.hostname.toLowerCase();

  if (protocol !== "https:" && protocol !== "http:") {
    throw new Error(
      "Only http and https links can be opened from WorshipSync.",
    );
  }

  if (protocol === "http:") {
    if (!options.isDev || !isLocalDevHost(host)) {
      throw new Error(
        "Insecure links can only be opened for local development.",
      );
    }
    return;
  }

  if (!parseAllowedHosts().has(host)) {
    throw new Error(
      "That URL is not on the allowed list for opening from WorshipSync.",
    );
  }
};
