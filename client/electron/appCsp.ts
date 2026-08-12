type CspRequestDetails = {
  url: string;
  resourceType: string;
};

const DEV_RENDERER_ORIGIN = "https://local.worshipsync.net:3000";

/**
 * CSP applied only to WorshipSync's top-level Electron renderer document.
 * Keep third-party sources scoped to the resource type that needs them.
 */
export const buildAppCspHeader = (isPackaged: boolean): string => {
  const devConnectSrc = isPackaged
    ? ""
    : "https://local.worshipsync.net:5000 https://localhost:5000 ";

  return (
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.firebaseio.com https://*.firebasedatabase.app https://apis.google.com https://www.gstatic.com https://*.msftauth.net https://*.msauth.net; " +
    "style-src 'self' 'unsafe-inline' data: https://*.msftauth.net https://*.msauth.net; " +
    "font-src 'self' data:; " +
    "img-src 'self' data: blob: media-cache: https://*.googleapis.com https://*.gstatic.com https://res.cloudinary.com https://image.mux.com https://*.r2.cloudflarestorage.com https://*.canva.com https://*.google.com https://accounts.youtube.com https://i.ytimg.com https://img.youtube.com https://i.scdn.co https://*.msftauth.net https://*.msauth.net; " +
    "media-src 'self' blob: media-cache: https://*.mux.com https://*.edgemv.mux.com https://*.r2.cloudflarestorage.com; " +
    "connect-src 'self' blob: media-cache: https://*.mux.com https://*.edgemv.mux.com https://direct-uploads.oci-us-ashburn-1-vop1.production.mux.com https://*.cloudinary.com https://*.r2.cloudflarestorage.com " +
    devConnectSrc +
    "https://*.worshipsync.net " +
    "https://*.firebaseio.com wss://*.firebaseio.com " +
    "https://*.firebasedatabase.app wss://*.firebasedatabase.app " +
    "https://*.firebaseapp.com https://*.googleapis.com " +
    "https://securetoken.googleapis.com https://www.googleapis.com " +
    "https://apis.google.com https://www.google.com https://accounts.youtube.com https://login.microsoftonline.com https://*.live.com " +
    "https://*.microsoft.com https://*.cfp.microsoft.com https://*.copilot.com https://*.msauth.net https://*.msftauth.net https://*.azureedge.net " +
    "https://*.ingest.us.sentry.io https://*.ingest.euro.sentry.io; " +
    "form-action 'self' https://*.live.com https://login.microsoftonline.com https://*.microsoftonline.com https://*.microsoft.com https://*.cfp.microsoft.com https://*.copilot.com https://*.firebaseapp.com https://accounts.google.com; " +
    "frame-src 'self' blob: https://*.worshipsync.net https://*.firebaseio.com https://*.firebasedatabase.app https://*.firebaseapp.com https://securetoken.googleapis.com https://accounts.google.com https://accounts.youtube.com https://www.youtube.com https://www.youtube-nocookie.com https://open.spotify.com https://apis.google.com https://login.microsoftonline.com https://*.live.com https://*.microsoft.com https://*.cfp.microsoft.com https://*.copilot.com; " +
    "worker-src 'self' blob:; " +
    "child-src 'self' blob:; " +
    "object-src 'none'; " +
    "base-uri 'self';"
  );
};

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
