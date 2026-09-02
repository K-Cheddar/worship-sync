import axios from "axios";
import * as cheerio from "cheerio";
import lyricsImportFilter from "./lyricsImportFilter.cjs";
import {
  pickBestImportablePlainLyrics,
  sortLyricsImportTracksByStructure,
} from "./lyricsImportFormat.cjs";

const { shouldExcludeLyricsImport } = lyricsImportFilter;

const LRCLIB_BASE_URL = "https://lrclib.net/api";
const GENIUS_API_BASE_URL = "https://api.genius.com";
const GENIUS_UNOFFICIAL_API_BASE_URL = "https://genius.com/api";
const LYRICS_OVH_API_BASE_URL = "https://api.lyrics.ovh";
const GENIUS_RESULT_LIMIT = 3;
const LYRICS_OVH_RESULT_LIMIT = 3;
const PROVIDER_SEARCH_TIMEOUT_MS = 5000;
const GENIUS_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.150 Safari/537.36";

const getStringValue = (value) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const getBooleanValue = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return undefined;
};

const normalizeDurationMs = (value) => {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return undefined;
  return Math.round(numericValue < 10000 ? numericValue * 1000 : numericValue);
};

const extractPlainLyricsFromSyncedLyrics = (syncedLyrics) => {
  if (typeof syncedLyrics !== "string" || !syncedLyrics.trim()) return null;

  const lines = syncedLyrics
    .split(/\r?\n/)
    .map((line) => line.replace(/^\[[^\]]+\]/g, "").trim());

  // LRC files timestamp section pauses as blank lines. Collapse runs of them
  // into a single blank line instead of dropping them entirely, so imported
  // lyrics keep the same verse/chorus breaks Genius imports have.
  const collapsedLines = [];
  for (const line of lines) {
    const isBlank = line.length === 0;
    const previousIsBlank =
      collapsedLines.length > 0 &&
      collapsedLines[collapsedLines.length - 1].length === 0;
    if (isBlank && (previousIsBlank || collapsedLines.length === 0)) continue;
    collapsedLines.push(line);
  }
  while (
    collapsedLines.length > 0 &&
    collapsedLines[collapsedLines.length - 1].length === 0
  ) {
    collapsedLines.pop();
  }

  const plainText = collapsedLines.join("\n").trim();
  return plainText || null;
};

const normalizeComparableText = (value) => {
  const normalizedValue = getStringValue(value);
  if (!normalizedValue) return "";

  return normalizedValue
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
};

const normalizeLyricsImportTrack = (track) => {
  const requestedSource = getStringValue(track.source);
  const source =
    requestedSource === "genius" || requestedSource === "lyricsovh"
      ? requestedSource
      : "lrclib";
  const lrclibId = Number(
    track.lrclibId ?? track.id ?? track.trackId ?? track.track_id ?? 0,
  );
  const geniusId = Number(track.geniusId ?? 0);
  const lyricsOvhKey = getStringValue(track.lyricsOvhKey);
  const trackName =
    getStringValue(track.trackName) ??
    getStringValue(track.track_name) ??
    getStringValue(track.name) ??
    "";
  const artistName =
    getStringValue(track.artistName) ??
    getStringValue(track.artist_name) ??
    getStringValue(track.artist) ??
    "";
  const hasValidLrclibId = Number.isFinite(lrclibId) && lrclibId > 0;
  const hasValidGeniusId = Number.isFinite(geniusId) && geniusId > 0;

  if (
    !trackName ||
    !artistName ||
    (source === "lrclib" && !hasValidLrclibId) ||
    (source === "genius" && !hasValidGeniusId) ||
    (source === "lyricsovh" && !lyricsOvhKey)
  ) {
    throw new Error("Invalid lyrics import track payload");
  }

  const syncedLyrics =
    getStringValue(track.syncedLyrics) ??
    getStringValue(track.synced_lyrics) ??
    null;
  const plainLyrics = pickBestImportablePlainLyrics(
    getStringValue(track.plainLyrics) ?? getStringValue(track.plain_lyrics),
    extractPlainLyricsFromSyncedLyrics(syncedLyrics),
  );

  return {
    source,
    ...(hasValidLrclibId ? { lrclibId } : {}),
    ...(hasValidGeniusId ? { geniusId } : {}),
    ...(lyricsOvhKey ? { lyricsOvhKey } : {}),
    geniusUrl: getStringValue(track.geniusUrl) ?? getStringValue(track.url),
    trackName,
    artistName,
    albumName:
      getStringValue(track.albumName) ??
      getStringValue(track.album_name) ??
      getStringValue(track.album),
    durationMs: normalizeDurationMs(
      track.durationMs ?? track.duration_ms ?? track.duration,
    ),
    instrumental: getBooleanValue(track.instrumental),
    plainLyrics: plainLyrics ?? null,
    syncedLyrics,
  };
};

const normalizeLrclibTracksList = (tracks) => {
  if (!Array.isArray(tracks)) return [];

  return tracks.flatMap((track) => {
    try {
      if (shouldExcludeLyricsImport(track)) {
        return [];
      }

      return [normalizeLyricsImportTrack(track)];
    } catch (error) {
      console.warn("Skipping invalid lyrics import track payload:", track);
      return [];
    }
  });
};

const escapeRegex = (value) => {
  if (typeof value !== "string") return "";
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const sanitizeGeniusQuery = (query) => {
  return query
    .toLowerCase()
    .replace(/ *\([^)]*\) */g, "")
    .replace(/ *\[[^\]]*]/g, "")
    .replace(/feat\.|ft\./g, "")
    .replace(/\s+/g, " ")
    .trim();
};

export const createLyricsImportService = ({ geniusAccessToken } = {}) => {
  const hasAccessToken = Boolean(geniusAccessToken);

  const getLrclibRequestParams = (req) => {
    const params = {};
    const trackName = getStringValue(req.query.trackName);
    const artistName = getStringValue(req.query.artistName);
    const albumName = getStringValue(req.query.albumName);
    const durationMs = getStringValue(req.query.durationMs);

    if (trackName) params.track_name = trackName;
    if (artistName) params.artist_name = artistName;
    if (albumName) params.album_name = albumName;
    if (durationMs) params.duration = durationMs;

    return params;
  };

  const buildGeniusQuery = (params) => {
    return [params.track_name, params.artist_name, params.album_name]
      .filter((value) => typeof value === "string" && value.trim().length > 0)
      .join(" ")
      .trim();
  };

  const getGeniusSearchHeaders = () => {
    const headers = {
      "User-Agent": GENIUS_USER_AGENT,
    };

    if (geniusAccessToken) {
      headers.Authorization = `Bearer ${geniusAccessToken}`;
    }

    return headers;
  };

  const normalizeGeniusSearchHits = (data) => {
    if (hasAccessToken) {
      return Array.isArray(data?.response?.hits) ? data.response.hits : [];
    }

    const sections = Array.isArray(data?.response?.sections)
      ? data.response.sections
      : [];
    return sections.flatMap((section) =>
      Array.isArray(section?.hits) ? section.hits : [],
    );
  };

  const searchGeniusSongs = async (query, { signal } = {}) => {
    const sanitizedQuery = sanitizeGeniusQuery(query);
    const encodedQuery = encodeURIComponent(sanitizedQuery);
    const url = hasAccessToken
      ? `${GENIUS_API_BASE_URL}/search?q=${encodedQuery}`
      : `${GENIUS_UNOFFICIAL_API_BASE_URL}/search/song?per_page=${GENIUS_RESULT_LIMIT}&q=${encodedQuery}`;

    try {
      const response = await axios.get(
        url,
        withAbortSignal(
          {
            headers: getGeniusSearchHeaders(),
            timeout: PROVIDER_SEARCH_TIMEOUT_MS,
          },
          signal,
        ),
      );

      return normalizeGeniusSearchHits(response.data)
        .filter((hit) => hit?.type === "song" && hit?.result)
        .map((hit) => hit.result);
    } catch (error) {
      if (!isCanceledRequest(error)) {
        console.error("Genius search request failed:", {
          url,
          hasAccessToken,
          message: error.message,
          status: error.response?.status,
          code: error.code,
        });
      }
      throw error;
    }
  };

  const stripGeniusLyricsPreamble = (lyrics, title) => {
    const normalizedLyrics = getStringValue(lyrics);
    if (!normalizedLyrics) {
      return null;
    }

    const titlePattern = escapeRegex(title);
    const patterns = [
      titlePattern
        ? new RegExp(
            `^\\d+\\s+Contributors?\\s*${titlePattern}\\s+Lyrics\\s*`,
            "i",
          )
        : null,
      /^\d+\s+Contributors?.{0,120}?Lyrics\s*/i,
    ].filter(Boolean);

    let cleanedLyrics = normalizedLyrics;
    for (const pattern of patterns) {
      cleanedLyrics = cleanedLyrics.replace(pattern, "").trim();
    }

    return getStringValue(cleanedLyrics) ?? null;
  };

  const extractLyricsFromGeniusHtml = (html, title) => {
    if (typeof html !== "string" || !html.trim()) {
      return null;
    }

    const $ = cheerio.load(html);
    const containers = $("#lyrics-root [data-lyrics-container='true']");
    if (containers.length === 0) {
      return null;
    }

    const lyrics = containers
      .map((_, element) => {
        const clone = $(element).clone();
        // Genius keeps song descriptions and annotation UI inside the lyrics
        // container. Those nodes are explicitly marked as non-lyric text.
        clone.find("[data-exclude-from-selection='true']").remove();
        clone.find("br").replaceWith("\n");
        return clone.text();
      })
      .get()
      .join("\n")
      .trim();

    if (!lyrics) {
      return null;
    }

    // Preserve chart labels such as [Verse 1] and [Chorus]. The client
    // recognizes these labels and can build an already-arranged song from
    // them; only the Genius contributor/title preamble is import noise.
    return stripGeniusLyricsPreamble(lyrics, title);
  };

  const fetchGeniusLyrics = async (song, { signal } = {}) => {
    let response;
    try {
      response = await axios.get(
        song.url,
        withAbortSignal(
          {
            headers: {
              "User-Agent": GENIUS_USER_AGENT,
            },
            timeout: PROVIDER_SEARCH_TIMEOUT_MS,
          },
          signal,
        ),
      );
    } catch (error) {
      if (!isCanceledRequest(error)) {
        console.error("Genius lyrics page request failed:", {
          url: song?.url,
          message: error.message,
          status: error.response?.status,
          code: error.code,
        });
      }
      return null;
    }

    const lyrics = extractLyricsFromGeniusHtml(response.data, song?.title);

    if (!lyrics) {
      // A 200 response with no lyrics container usually means Genius served a
      // bot-challenge/interstitial page instead of the real song page (common
      // when scraping from datacenter/cloud IPs), not that lyrics don't exist.
      console.error("Genius lyrics page returned no lyrics container:", {
        url: song?.url,
        status: response.status,
        htmlLength:
          typeof response.data === "string" ? response.data.length : 0,
      });
    }

    return lyrics;
  };

  const normalizeGeniusTrack = ({ song, plainLyrics }) => {
    const track = normalizeLyricsImportTrack({
      source: "genius",
      geniusId: song.id,
      geniusUrl: song.url,
      trackName: song.title,
      artistName: song.primary_artist?.name ?? song.artist?.name,
      albumName: song.album?.name,
      instrumental: song.instrumental,
      plainLyrics,
      syncedLyrics: null,
    });

    return shouldExcludeLyricsImport(track) ? null : track;
  };

  const dedupeTracksBySourceId = (tracks) => {
    const seenTrackIds = new Set();

    return tracks.filter((track) => {
      const sourceIds = {
        genius: track.geniusId,
        lyricsovh: track.lyricsOvhKey,
        lrclib: track.lrclibId,
      };
      const sourceId = sourceIds[track.source];
      const trackKey = `${track.source}:${sourceId ?? ""}`;

      if (seenTrackIds.has(trackKey)) {
        return false;
      }

      seenTrackIds.add(trackKey);
      return true;
    });
  };

  const searchGeniusTracks = async (
    params,
    { signal, fetchLyrics = true } = {},
  ) => {
    const query = buildGeniusQuery(params);

    if (!query) return [];

    const songs = await searchGeniusSongs(query, { signal });

    const lyricsResults = await Promise.all(
      songs.slice(0, GENIUS_RESULT_LIMIT).map(async (song) => {
        const plainLyrics = fetchLyrics
          ? await fetchGeniusLyrics(song, { signal })
          : null;

        if (!plainLyrics && fetchLyrics) {
          return null;
        }

        try {
          return normalizeGeniusTrack({ song, plainLyrics });
        } catch (error) {
          return null;
        }
      }),
    );

    return dedupeTracksBySourceId(lyricsResults.filter(Boolean));
  };

  const searchLyricsOvhTracks = async (params, { signal } = {}) => {
    const query = buildGeniusQuery(params);
    if (!query) return [];

    const suggestionResponse = await axios.get(
      `${LYRICS_OVH_API_BASE_URL}/suggest/${encodeURIComponent(query)}`,
      withAbortSignal({ timeout: PROVIDER_SEARCH_TIMEOUT_MS }, signal),
    );
    const suggestions = Array.isArray(suggestionResponse.data?.data)
      ? suggestionResponse.data.data
      : [];

    const tracks = await Promise.all(
      suggestions.slice(0, LYRICS_OVH_RESULT_LIMIT).map(async (suggestion) => {
        const trackName = getStringValue(suggestion?.title);
        const artistName = getStringValue(suggestion?.artist?.name);
        if (!trackName || !artistName) return null;

        try {
          const lyricsResponse = await axios.get(
            `${LYRICS_OVH_API_BASE_URL}/v1/${encodeURIComponent(artistName)}/${encodeURIComponent(trackName)}`,
            withAbortSignal({ timeout: PROVIDER_SEARCH_TIMEOUT_MS }, signal),
          );
          const plainLyrics = getStringValue(lyricsResponse.data?.lyrics);
          if (!plainLyrics) return null;

          const track = normalizeLyricsImportTrack({
            source: "lyricsovh",
            lyricsOvhKey: `${artistName}::${trackName}`,
            trackName,
            artistName,
            albumName: getStringValue(suggestion?.album?.title),
            durationMs: suggestion?.duration,
            plainLyrics,
            syncedLyrics: null,
          });
          return shouldExcludeLyricsImport(track) ? null : track;
        } catch (error) {
          if (!isCanceledRequest(error) && !isLyricsOvhMiss(error)) {
            console.error("lyrics.ovh lyrics lookup failed:", {
              trackName,
              artistName,
              message: error.message,
              status: error.response?.status,
              code: error.code,
            });
          }
          return null;
        }
      }),
    );

    return dedupeTracksBySourceId(tracks.filter(Boolean));
  };

  const isExactLyricsMatch = (track, params) => {
    const expectedTrackName = normalizeComparableText(params.track_name);
    const expectedArtistName = normalizeComparableText(params.artist_name);
    const trackName = normalizeComparableText(track.trackName);
    const artistName = normalizeComparableText(track.artistName);

    const titlesMatch =
      trackName === expectedTrackName ||
      trackName.startsWith(expectedTrackName) ||
      expectedTrackName.startsWith(trackName);
    const artistsMatch =
      artistName === expectedArtistName ||
      artistName.includes(expectedArtistName) ||
      expectedArtistName.includes(artistName);

    return Boolean(
      expectedTrackName && expectedArtistName && titlesMatch && artistsMatch,
    );
  };

  const getGeniusTrack = async (params) => {
    if (!params.artist_name) {
      return null;
    }

    const tracks = await searchGeniusTracks(params);
    return tracks.find((track) => isExactLyricsMatch(track, params)) ?? null;
  };

  const getLyricsOvhTrack = async (params) => {
    if (!params.artist_name) {
      return null;
    }

    const tracks = await searchLyricsOvhTracks(params);
    return tracks.find((track) => isExactLyricsMatch(track, params)) ?? null;
  };

  const getLrclibTrack = async (params) => {
    const response = await axios.get(`${LRCLIB_BASE_URL}/get`, {
      params,
      timeout: 10000,
    });

    if (shouldExcludeLyricsImport(response.data)) {
      return null;
    }

    return normalizeLyricsImportTrack(response.data);
  };

  const searchLrclibTracks = async (params, { signal } = {}) => {
    const response = await axios.get(`${LRCLIB_BASE_URL}/search`, {
      params: {
        query: params.track_name,
        track_name: params.track_name,
        artist_name: params.artist_name,
        album_name: params.album_name,
        duration: params.duration,
      },
      timeout: PROVIDER_SEARCH_TIMEOUT_MS,
      ...(signal ? { signal } : {}),
    });

    return sortLyricsImportTracksByStructure(
      normalizeLrclibTracksList(response.data),
    );
  };

  const searchAllLyricsTracks = async (
    params,
    { includeGenius = true, includeGeniusLyrics = true } = {},
  ) => {
    const providers = [
      ...(includeGenius
        ? [
            {
              name: "Genius",
              search: (providerParams, options) =>
                searchGeniusTracks(providerParams, {
                  ...options,
                  fetchLyrics: includeGeniusLyrics,
                }),
            },
          ]
        : []),
      { name: "lyrics.ovh", search: searchLyricsOvhTracks },
      { name: "LRCLIB", search: searchLrclibTracks },
    ];
    const providerResults = await Promise.all(
      providers.map(async (provider) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          PROVIDER_SEARCH_TIMEOUT_MS,
        );

        try {
          return await provider.search(params, { signal: controller.signal });
        } catch (error) {
          console.error(`${provider.name} lyrics search failed:`, {
            message: error.message,
            status: error.response?.status,
            code: error.code,
          });
          return [];
        } finally {
          clearTimeout(timeoutId);
        }
      }),
    );

    return providerResults.flat();
  };

  return {
    getGeniusTrack,
    getLrclibRequestParams,
    getLrclibTrack,
    getLyricsOvhTrack,
    searchAllLyricsTracks,
    searchGeniusTracks,
    searchLrclibTracks,
    searchLyricsOvhTracks,
  };
};

const withAbortSignal = (config, signal) => {
  if (!signal) return config;
  return { ...config, signal };
};

const isCanceledRequest = (error) => error?.code === "ERR_CANCELED";

const isLyricsOvhMiss = (error) => error?.response?.status === 404;
