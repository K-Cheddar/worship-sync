const DEFAULT_CACHE_TTL_MS = 60 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_RESULTS = 10;
const DEFAULT_MAX_CACHE_ENTRIES = 500;
const MAX_QUERY_LENGTH = 200;

export class YouTubeSearchInputError extends Error {}
export class YouTubeSearchNotConfiguredError extends Error {}
export class YouTubeSearchUpstreamError extends Error {}

const cleanText = (value, maxLength = MAX_QUERY_LENGTH) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";

export const buildYouTubeSearchQuery = ({ title, artist, album } = {}) => {
  const cleanTitle = cleanText(title);
  const cleanArtist = cleanText(artist);
  const cleanAlbum = cleanText(album);
  if (!cleanTitle && !cleanArtist && !cleanAlbum) return "";
  if (cleanTitle) return [cleanTitle, cleanArtist || cleanAlbum].filter(Boolean).join(" ");
  return [cleanArtist, cleanAlbum].filter(Boolean).join(" ");
};

export const normalizeYouTubeSearchQuery = (value) =>
  cleanText(value).toLowerCase();

const parseIsoDuration = (value) => {
  if (typeof value !== "string") return undefined;
  const match = value.match(
    /^P(?:([0-9]+)D)?(?:T(?:([0-9]+)H)?(?:([0-9]+)M)?(?:([0-9]+)S)?)?$/,
  );
  if (!match) return undefined;
  const seconds =
    Number(match[1] || 0) * 86_400 +
    Number(match[2] || 0) * 3_600 +
    Number(match[3] || 0) * 60 +
    Number(match[4] || 0);
  return Number.isSafeInteger(seconds) ? seconds : undefined;
};

const thumbnailFor = (snippet) =>
  snippet?.thumbnails?.high?.url ||
  snippet?.thumbnails?.medium?.url ||
  snippet?.thumbnails?.default?.url ||
  "";

const normalizeResult = (item, details) => {
  const videoId = item?.id?.videoId;
  const snippet = item?.snippet;
  if (!videoId || !snippet) return null;
  const durationSeconds = parseIsoDuration(details?.contentDetails?.duration);
  return {
    videoId,
    title: cleanText(snippet.title, 300),
    channelName: cleanText(snippet.channelTitle, 200),
    thumbnail: thumbnailFor(snippet),
    description: cleanText(snippet.description, 500),
    publishedAt:
      typeof snippet.publishedAt === "string" ? snippet.publishedAt : undefined,
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
    ...(details?.status?.embeddable === undefined
      ? {}
      : { embeddable: details.status.embeddable }),
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
};

export const createYouTubeSearchService = ({
  httpClient,
  apiKey = process.env.YOUTUBE_API_KEY,
  now = () => Date.now(),
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  maxCacheEntries = DEFAULT_MAX_CACHE_ENTRIES,
  maxResults = DEFAULT_MAX_RESULTS,
} = {}) => {
  if (!httpClient?.get) {
    throw new Error("A YouTube search HTTP client is required.");
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

  const search = async ({ title, artist, album, query, forceRefresh = false } = {}) => {
    const explicitQuery = cleanText(query);
    const resolvedQuery = explicitQuery || buildYouTubeSearchQuery({ title, artist, album });
    const normalizedQuery = normalizeYouTubeSearchQuery(resolvedQuery);
    if (!normalizedQuery) {
      throw new YouTubeSearchInputError(
        "Add a song title or search query before searching YouTube.",
      );
    }
    if (!apiKey) throw new YouTubeSearchNotConfiguredError();

    const cached = cache.get(normalizedQuery);
    if (!forceRefresh && cached && cached.expiresAt > now()) {
      return { query: resolvedQuery, results: cached.value, cached: true };
    }
    if (cached) cache.delete(normalizedQuery);

    if (!forceRefresh) {
      const existingRequest = pending.get(normalizedQuery);
      if (existingRequest) return existingRequest;
    }

    const request = httpClient
      .get("https://www.googleapis.com/youtube/v3/search", {
        params: {
          key: apiKey,
          part: "snippet",
          q: resolvedQuery,
          type: "video",
          maxResults,
          videoEmbeddable: "true",
        },
        timeout: 10_000,
      })
      .then(async ({ data }) => {
        const items = Array.isArray(data?.items) ? data.items : [];
        const ids = items
          .map((item) => item?.id?.videoId)
          .filter((id) => typeof id === "string" && id.length > 0);
        let detailsById = new Map();
        if (ids.length) {
          try {
            const detailsResponse = await httpClient.get(
              "https://www.googleapis.com/youtube/v3/videos",
              {
                params: {
                  key: apiKey,
                  part: "contentDetails,status",
                  id: ids.join(","),
                },
                timeout: 10_000,
              },
            );
            detailsById = new Map(
              (Array.isArray(detailsResponse?.data?.items)
                ? detailsResponse.data.items
                : []
              ).map((item) => [item.id, item]),
            );
          } catch {
            // Search results remain useful when optional enrichment is unavailable.
          }
        }
        const results = items
          .map((item) => normalizeResult(item, detailsById.get(item?.id?.videoId)))
          .filter(Boolean);
        trimCache();
        cache.set(normalizedQuery, {
          value: results,
          expiresAt: now() + cacheTtlMs,
        });
        return { query: resolvedQuery, results, cached: false };
      })
      .catch((error) => {
        if (error instanceof YouTubeSearchInputError) throw error;
        throw new YouTubeSearchUpstreamError(
          "YouTube search is unavailable right now. Try again.",
          { cause: error },
        );
      })
      .finally(() => {
        if (pending.get(normalizedQuery) === request) {
          pending.delete(normalizedQuery);
        }
      });

    pending.set(normalizedQuery, request);
    return request;
  };

  return { search };
};
