const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const SPOTIFY_RESOURCE_ID_PATTERN = /^[A-Za-z0-9]{1,64}$/;
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_CACHE_ENTRIES = 500;
const MAX_OEMBED_RESPONSE_BYTES = 256 * 1024;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);
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

export class RichLinkPreviewInputError extends Error {}
export class RichLinkPreviewUnavailableError extends Error {}

const cleanText = (value, maxLength) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

const asPositiveInteger = (value, maximum = 2_000) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= maximum
    ? number
    : undefined;
};

const parseHttpUrl = (value) => {
  try {
    const url = new URL(typeof value === "string" ? value.trim() : "");
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
};

const parseYouTubeReference = (url) => {
  const hostname = url.hostname.toLowerCase();
  const pathParts = url.pathname.split("/").filter(Boolean);
  let videoId = null;

  if (hostname === "youtu.be" || hostname === "www.youtu.be") {
    videoId = pathParts[0];
  } else if (YOUTUBE_HOSTS.has(hostname)) {
    if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v");
    } else if (["embed", "shorts", "live"].includes(pathParts[0])) {
      videoId = pathParts[1];
    }
  }

  if (!YOUTUBE_VIDEO_ID_PATTERN.test(videoId || "")) return null;
  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
  return {
    provider: "youtube",
    kind: "video",
    resourceId: videoId,
    cacheKey: `youtube:${videoId}`,
    canonicalUrl,
    oEmbedUrl: "https://www.youtube.com/oembed",
    oEmbedTargetUrl: canonicalUrl,
  };
};

const parseSpotifyReference = (url) => {
  const hostname = url.hostname.toLowerCase();
  if (!SPOTIFY_HOSTS.has(hostname)) return null;
  const pathParts = url.pathname.split("/").filter(Boolean);

  if (hostname === "spotify.link" || hostname === "www.spotify.link") {
    const shortCode = pathParts[0];
    if (!shortCode || !/^[A-Za-z0-9_-]{1,128}$/.test(shortCode)) return null;
    const shortUrl = `https://spotify.link/${shortCode}`;
    return {
      provider: "spotify",
      kind: "unknown",
      resourceId: shortCode,
      cacheKey: `spotify:short:${shortCode}`,
      canonicalUrl: shortUrl,
      oEmbedUrl: "https://open.spotify.com/oembed",
      oEmbedTargetUrl: shortUrl,
    };
  }

  if (pathParts[0]?.toLowerCase().startsWith("intl-")) pathParts.shift();
  const kind = pathParts[0]?.toLowerCase();
  const resourceId = pathParts[1];
  if (
    !kind ||
    !SPOTIFY_RESOURCE_TYPES.has(kind) ||
    !SPOTIFY_RESOURCE_ID_PATTERN.test(resourceId || "")
  ) {
    return null;
  }

  const canonicalUrl = `https://open.spotify.com/${kind}/${resourceId}`;
  return {
    provider: "spotify",
    kind,
    resourceId,
    cacheKey: `spotify:${kind}:${resourceId}`,
    canonicalUrl,
    oEmbedUrl: "https://open.spotify.com/oembed",
    oEmbedTargetUrl: canonicalUrl,
  };
};

const parseReference = (value) => {
  const url = parseHttpUrl(value);
  if (!url) return null;
  return parseYouTubeReference(url) || parseSpotifyReference(url);
};

const youtubeThumbnailUrl = (value, videoId) => {
  const url = parseHttpUrl(value);
  if (
    url?.protocol === "https:" &&
    (url.hostname.toLowerCase() === "i.ytimg.com" ||
      url.hostname.toLowerCase() === "img.youtube.com")
  ) {
    return url.toString();
  }
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
};

const spotifyThumbnailUrl = (value) => {
  const url = parseHttpUrl(value);
  return url?.protocol === "https:" && url.hostname.toLowerCase() === "i.scdn.co"
    ? url.toString()
    : undefined;
};

const decodeHtmlAttribute = (value) =>
  value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");

const getSpotifyEmbedReference = (html) => {
  const source = typeof html === "string" ? html.slice(0, 20_000) : "";
  const match = source.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
  const url = parseHttpUrl(match ? decodeHtmlAttribute(match[1]) : "");
  if (
    url?.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "open.spotify.com"
  ) {
    return null;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "embed") return null;
  if (parts[1]?.toLowerCase().startsWith("intl-")) parts.splice(1, 1);
  const kind = parts[1]?.toLowerCase();
  const resourceId = parts[2];
  if (
    !kind ||
    !SPOTIFY_RESOURCE_TYPES.has(kind) ||
    !SPOTIFY_RESOURCE_ID_PATTERN.test(resourceId || "")
  ) {
    return null;
  }

  return {
    kind,
    resourceId,
    embedUrl: url.toString(),
    canonicalUrl: `https://open.spotify.com/${kind}/${resourceId}`,
  };
};

const buildPreview = (reference, data) => {
  const title = cleanText(data?.title, 300);
  if (!title) {
    throw new RichLinkPreviewUnavailableError(
      `${reference.provider === "youtube" ? "YouTube" : "Spotify"} did not return details for this link.`,
    );
  }

  if (reference.provider === "youtube") {
    return {
      provider: "youtube",
      kind: "video",
      resourceId: reference.resourceId,
      title,
      creator: cleanText(data?.author_name, 200) || undefined,
      thumbnailUrl: youtubeThumbnailUrl(
        data?.thumbnail_url,
        reference.resourceId,
      ),
      thumbnailWidth: asPositiveInteger(data?.thumbnail_width),
      thumbnailHeight: asPositiveInteger(data?.thumbnail_height),
      canonicalUrl: reference.canonicalUrl,
      embedUrl: `https://www.youtube-nocookie.com/embed/${reference.resourceId}`,
      embedWidth: asPositiveInteger(data?.width),
      embedHeight: asPositiveInteger(data?.height),
      supportsSegments: true,
    };
  }

  const embed = getSpotifyEmbedReference(data?.html);
  if (!embed) {
    throw new RichLinkPreviewUnavailableError(
      "Spotify did not return a supported player for this link.",
    );
  }
  return {
    provider: "spotify",
    kind: embed.kind,
    resourceId: embed.resourceId,
    title,
    thumbnailUrl: spotifyThumbnailUrl(data?.thumbnail_url),
    thumbnailWidth: asPositiveInteger(data?.thumbnail_width),
    thumbnailHeight: asPositiveInteger(data?.thumbnail_height),
    canonicalUrl: embed.canonicalUrl,
    embedUrl: embed.embedUrl,
    embedWidth: asPositiveInteger(data?.width),
    embedHeight: asPositiveInteger(data?.height, 600),
    supportsSegments: false,
  };
};

export const createRichLinkPreviewService = ({
  httpClient,
  now = () => Date.now(),
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  maxCacheEntries = DEFAULT_MAX_CACHE_ENTRIES,
} = {}) => {
  if (!httpClient?.get) {
    throw new Error("A rich link preview HTTP client is required.");
  }

  const cache = new Map();
  const pending = new Map();

  const trimCache = () => {
    while (cache.size >= maxCacheEntries) {
      const oldestKey = cache.keys().next().value;
      if (!oldestKey) break;
      cache.delete(oldestKey);
    }
  };

  const getPreview = async (value) => {
    const reference = parseReference(value);
    if (!reference) {
      throw new RichLinkPreviewInputError(
        "That YouTube or Spotify link is not supported.",
      );
    }

    const cached = cache.get(reference.cacheKey);
    if (cached && cached.expiresAt > now()) return cached.value;
    if (cached) cache.delete(reference.cacheKey);

    const existingRequest = pending.get(reference.cacheKey);
    if (existingRequest) return existingRequest;

    const request = httpClient
      .get(reference.oEmbedUrl, {
        params: { url: reference.oEmbedTargetUrl, format: "json" },
        timeout: 5_000,
        maxContentLength: MAX_OEMBED_RESPONSE_BYTES,
      })
      .then(({ data }) => {
        const preview = buildPreview(reference, data);
        trimCache();
        cache.set(reference.cacheKey, {
          value: preview,
          expiresAt: now() + cacheTtlMs,
        });
        return preview;
      })
      .catch((error) => {
        if (error instanceof RichLinkPreviewUnavailableError) throw error;
        if (error?.response?.status === 400 || error?.response?.status === 404) {
          throw new RichLinkPreviewUnavailableError(
            "Preview details are not available for this link.",
          );
        }
        throw error;
      })
      .finally(() => pending.delete(reference.cacheKey));

    pending.set(reference.cacheKey, request);
    return request;
  };

  return { getPreview };
};
