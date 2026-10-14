/** Trusted auth API origins for the app's configured browser/Electron dev setup. */
export const allowedE2EAuthOrigins = (baseURL: string): Set<string> => {
  const appURL = new URL(baseURL);
  const origins = new Set([appURL.origin]);

  // The local dev renderer runs on 3000 while its authenticated API runs on
  // 5000. Trust only that repository-owned sibling origin; never wildcard ports
  // or sibling hosts where an ID token or session cookie could be sent.
  if (
    appURL.protocol === "https:" &&
    appURL.hostname === "local.worshipsync.net" &&
    appURL.port === "3000"
  ) {
    appURL.port = "5000";
    origins.add(appURL.origin);
  }

  return origins;
};
