import axios from "axios";
import * as cheerio from "cheerio";
import lyricsImportFilter from "./lyricsImportFilter.cjs";

const { shouldExcludeLyricsImport } = lyricsImportFilter;

const LRCLIB_BASE_URL = "https://lrclib.net/api";
const GENIUS_API_BASE_URL = "https://api.genius.com";
const GENIUS_UNOFFICIAL_API_BASE_URL = "https://genius.com/api";
const GENIUS_RESULT_LIMIT = 5;
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

  const plainText = syncedLyrics
    .split(/\r?\n/)
    .map((line) => line.replace(/^\[[^\]]+\]/g, "").trim())
    .filter(Boolean)
    .join("\n");

  return plainText.trim() || null;
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
  const source = getStringValue(track.source) === "genius" ? "genius" : "lrclib";
  const lrclibId = Number(
    track.lrclibId ?? track.id ?? track.trackId ?? track.track_id ?? 0,
  );
  const geniusId = Number(track.geniusId ?? 0);
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
    (source === "genius" && !hasValidGeniusId)
  ) {
    throw new Error("Invalid lyrics import track payload");
  }

  const syncedLyrics =
    getStringValue(track.syncedLyrics) ??
    getStringValue(track.synced_lyrics) ??
    null;
  const plainLyrics =
    getStringValue(track.plainLyrics) ??
    getStringValue(track.plain_lyrics) ??
    extractPlainLyricsFromSyncedLyrics(syncedLyrics);

  return {
    source,
    ...(hasValidLrclibId ? { lrclibId } : {}),
    ...(hasValidGeniusId ? { geniusId } : {}),
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

  const searchGeniusSongs = async (query) => {
    const sanitizedQuery = sanitizeGeniusQuery(query);
    const encodedQuery = encodeURIComponent(sanitizedQuery);
    const url = hasAccessToken
      ? `${GENIUS_API_BASE_URL}/search?q=${encodedQuery}`
      : `${GENIUS_UNOFFICIAL_API_BASE_URL}/search/song?per_page=5&q=${encodedQuery}`;

    const response = await axios.get(url, {
      headers: getGeniusSearchHeaders(),
      timeout: 10000,
    });

    return normalizeGeniusSearchHits(response.data)
      .filter((hit) => hit?.type === "song" && hit?.result)
      .map((hit) => hit.result);
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

  const extractLyricsFromGeniusHtml = (html, title, removeChorus = true) => {
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
        clone.find("br").replaceWith("\n");
        return clone.text();
      })
      .get()
      .join("\n")
      .trim();

    if (!lyrics) {
      return null;
    }

    const normalizedLyrics = removeChorus
      ? lyrics.replace(/\[[^\]]+\]\n?/g, "")
      : lyrics;

    return stripGeniusLyricsPreamble(normalizedLyrics, title);
  };

  const fetchGeniusLyrics = async (song) => {
    try {
      const response = await axios.get(song.url, {
        headers: {
          "User-Agent": GENIUS_USER_AGENT,
        },
        timeout: 10000,
      });

      return extractLyricsFromGeniusHtml(response.data, song?.title, true);
    } catch (error) {
      return null;
    }
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
      const trackKey =
        track.source === "genius"
          ? `genius:${track.geniusId ?? ""}`
          : `lrclib:${track.lrclibId ?? ""}`;

      if (seenTrackIds.has(trackKey)) {
        return false;
      }

      seenTrackIds.add(trackKey);
      return true;
    });
  };

  const searchGeniusTracks = async (params) => {
    const query = buildGeniusQuery(params);

    if (!query) return [];

    const songs = await searchGeniusSongs(query);

    const lyricsResults = await Promise.all(
      songs.slice(0, GENIUS_RESULT_LIMIT).map(async (song) => {
        const plainLyrics = await fetchGeniusLyrics(song);

        if (!plainLyrics) {
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

  const isExactGeniusMatch = (track, params) => {
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
    return tracks.find((track) => isExactGeniusMatch(track, params)) ?? null;
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

  const searchLrclibTracks = async (params) => {
    const response = await axios.get(`${LRCLIB_BASE_URL}/search`, {
      params: {
        query: params.track_name,
        track_name: params.track_name,
        artist_name: params.artist_name,
        album_name: params.album_name,
        duration: params.duration,
      },
      timeout: 10000,
    });

    return normalizeLrclibTracksList(response.data);
  };

  return {
    getGeniusTrack,
    getLrclibRequestParams,
    getLrclibTrack,
    searchGeniusTracks,
    searchLrclibTracks,
  };
};
