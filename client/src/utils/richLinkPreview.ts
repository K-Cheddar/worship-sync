import { getYouTubeVideoReference } from "./youtube";

export type RichLinkProvider = "youtube" | "spotify";

export type RichLinkReference = {
  provider: RichLinkProvider;
  cacheKey: string;
};

const SPOTIFY_HOSTS = new Set([
  "open.spotify.com",
  "www.open.spotify.com",
  "spotify.link",
  "www.spotify.link",
]);

const SPOTIFY_RESOURCE_TYPES = new Set([
  "album",
  "artist",
  "audiobook",
  "episode",
  "playlist",
  "show",
  "track",
]);

const getSpotifyCacheKey = (url: URL) => {
  const host = url.hostname.toLowerCase();
  const pathParts = url.pathname.split("/").filter(Boolean);
  if (pathParts[0]?.toLowerCase().startsWith("intl-")) pathParts.shift();

  const resourceType = pathParts[0]?.toLowerCase();
  const resourceId = pathParts[1];
  if (
    (host === "open.spotify.com" || host === "www.open.spotify.com") &&
    resourceType &&
    SPOTIFY_RESOURCE_TYPES.has(resourceType) &&
    resourceId &&
    /^[A-Za-z0-9]{1,64}$/.test(resourceId)
  ) {
    return `spotify:${resourceType}:${resourceId}`;
  }

  if (host === "spotify.link" || host === "www.spotify.link") {
    const shortCode = pathParts[0];
    return shortCode && /^[A-Za-z0-9_-]{1,128}$/.test(shortCode)
      ? `spotify:short:${shortCode}`
      : null;
  }

  return null;
};

export const getRichLinkReference = (
  value: string,
): RichLinkReference | null => {
  const youtube = getYouTubeVideoReference(value);
  if (youtube) {
    return { provider: "youtube", cacheKey: `youtube:${youtube.videoId}` };
  }

  try {
    const url = new URL(value.trim());
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      !SPOTIFY_HOSTS.has(url.hostname.toLowerCase())
    ) {
      return null;
    }
    const cacheKey = getSpotifyCacheKey(url);
    return cacheKey ? { provider: "spotify", cacheKey } : null;
  } catch {
    return null;
  }
};
