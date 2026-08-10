type CspRequestDetails = {
  url: string;
  resourceType: string;
};

const DEV_RENDERER_ORIGIN = "https://local.worshipsync.net:3000";

/**
 * The session also carries trusted third-party iframes. Only WorshipSync's
 * top-level renderer document may receive the app CSP; applying it to an
 * embedded provider replaces that provider's policy and can block playback.
 */
export const shouldAttachAppCsp = (
  details: CspRequestDetails,
  isPackaged: boolean,
) => {
  if (details.resourceType !== "mainFrame") return false;

  try {
    const url = new URL(details.url);
    return isPackaged
      ? url.protocol === "file:"
      : url.origin === DEV_RENDERER_ORIGIN;
  } catch {
    return false;
  }
};
