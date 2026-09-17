import { getApiBasePath } from "../utils/environment";
import {
  getImportableLyricsFromTrack,
  NormalizedLrclibTrack,
  normalizeLrclibTrack,
  sortLyricsImportTracksBySource,
} from "../utils/lrclib";

export type LrclibImportQuery = {
  trackName: string;
  artistName?: string;
  albumName?: string;
  durationMs?: number;
};

export type LrclibImportResolution = {
  match: NormalizedLrclibTrack | null;
  candidates: NormalizedLrclibTrack[];
};

const buildSearchParams = ({
  trackName,
  artistName,
  albumName,
  durationMs,
}: LrclibImportQuery) => {
  const params = new URLSearchParams();
  params.set("trackName", trackName);
  if (artistName?.trim()) params.set("artistName", artistName.trim());
  if (albumName?.trim()) params.set("albumName", albumName.trim());
  if (durationMs) params.set("durationMs", String(durationMs));
  return params;
};

const hasLocalGeniusSearch = (): boolean =>
  typeof window.electronAPI?.searchGeniusLyrics === "function";

const debugLyricsImportTiming = (
  phase: string,
  startedAt: number,
  details?: Record<string, unknown>,
): void => {
  if (!import.meta.env.DEV) return;

  console.debug(`[lyrics-import] ${phase}: ${(performance.now() - startedAt).toFixed(0)}ms`, details);
};

const fetchLrclibEndpoint = async (
  endpoint: "get" | "search",
  query: LrclibImportQuery,
): Promise<Response> => {
  return fetch(
    `${getApiBasePath()}api/lrclib/${endpoint}?${buildSearchParams(query).toString()}${
      endpoint === "search" && hasLocalGeniusSearch() ? "&localGenius=true" : ""
    }`,
  );
};

const normalizeTrackList = (data: unknown): NormalizedLrclibTrack[] => {
  if (!Array.isArray(data)) return [];

  return data.flatMap((track) => {
    try {
      return [normalizeLrclibTrack(track as Record<string, unknown>)];
    } catch (error) {
      console.warn("Skipping invalid LRCLIB candidate:", track);
      return [];
    }
  });
};

export const getLrclibTrack = async (
  query: LrclibImportQuery,
): Promise<NormalizedLrclibTrack | null> => {
  if (!query.artistName?.trim()) {
    return null;
  }

  const response = await fetchLrclibEndpoint("get", query);

  if (response.status === 400 || response.status === 404) return null;
  if (!response.ok) {
    throw new Error("Could not fetch lyrics.");
  }

  const track = await response.json();
  return normalizeLrclibTrack(track);
};

const searchServerLyricsProviders = async (
  query: LrclibImportQuery,
): Promise<NormalizedLrclibTrack[]> => {
  const response = await fetchLrclibEndpoint("search", query);

  if (!response.ok) {
    throw new Error("Could not search for lyrics.");
  }

  const data = await response.json();
  return normalizeTrackList(data);
};

const searchGeniusLyricsLocally = async (
  query: LrclibImportQuery,
): Promise<NormalizedLrclibTrack[]> => {
  if (!hasLocalGeniusSearch()) return [];

  const data = await window.electronAPI!.searchGeniusLyrics(query);
  return normalizeTrackList(data);
};

export const searchLrclibTracks = async (
  query: LrclibImportQuery,
): Promise<NormalizedLrclibTrack[]> => {
  const startedAt = performance.now();
  const useLocalGenius = hasLocalGeniusSearch();

  const serverResultsPromise = searchServerLyricsProviders(query).then(
    (results) => {
      debugLyricsImportTiming("server lyrics providers", startedAt, {
        resultCount: results.length,
      });
      return results;
    },
  );

  if (!useLocalGenius) {
    return serverResultsPromise.then((results) => {
      debugLyricsImportTiming("total lyrics search", startedAt, {
        resultCount: results.length,
        useLocalGenius,
      });
      return results;
    });
  }

  const geniusResultsPromise = searchGeniusLyricsLocally(query).then(
    (results) => {
      debugLyricsImportTiming("local Genius search", startedAt, {
        resultCount: results.length,
      });
      return results;
    },
  );

  const [serverResults, geniusResults] = await Promise.allSettled([
    serverResultsPromise,
    geniusResultsPromise,
  ]);

  const serverTracks =
    serverResults.status === "fulfilled" ? serverResults.value : [];
  const geniusTracks =
    geniusResults.status === "fulfilled" ? geniusResults.value : [];

  if (serverResults.status === "rejected" && geniusResults.status === "rejected") {
    throw serverResults.reason;
  }

  const results = useLocalGenius
    ? sortLyricsImportTracksBySource([...geniusTracks, ...serverTracks])
    : serverTracks;

  const hydrationStartedAt = performance.now();
  const hydrationResults = await Promise.allSettled(
    results.map(async (candidate) => {
      if (
        candidate.source !== "genius" ||
        getImportableLyricsFromTrack(candidate)
      ) {
        return candidate;
      }

      return fetchGeniusLyricsLocally(candidate);
    }),
  );
  const hydratedResults = hydrationResults.map((hydration, index) =>
    hydration.status === "fulfilled" ? hydration.value : results[index],
  );

  debugLyricsImportTiming("local Genius page hydration", hydrationStartedAt, {
    candidateCount: geniusTracks.length,
  });

  debugLyricsImportTiming("total lyrics search", startedAt, {
    resultCount: hydratedResults.length,
    useLocalGenius,
  });
  return hydratedResults;
};

const stripGeniusLyricsPreamble = (lyrics: string, title: string): string => {
  const titlePattern = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return lyrics
    .trim()
    .replace(
      new RegExp(`^\\d+\\s+Contributors?\\s*${titlePattern}\\s+Lyrics\\s*`, "i"),
      "",
    )
    .replace(/^\d+\s+Contributors?.{0,120}?Lyrics\s*/i, "")
    .trim();
};

const extractGeniusLyricsFromHtml = (html: string, title: string): string => {
  const document = new DOMParser().parseFromString(html, "text/html");
  const containers = Array.from(
    document.querySelectorAll<HTMLElement>(
      "#lyrics-root [data-lyrics-container='true']",
    ),
  );
  const lyrics = containers
    .map((container) => {
      const clone = container.cloneNode(true) as HTMLElement;
      clone
        .querySelectorAll("[data-exclude-from-selection='true']")
        .forEach((excluded) => excluded.remove());
      clone.querySelectorAll("br").forEach((lineBreak) => {
        lineBreak.replaceWith(document.createTextNode("\n"));
      });
      return (clone.textContent ?? "").trim();
    })
    .filter(Boolean)
    .join("\n")
    .trim();

  return stripGeniusLyricsPreamble(lyrics, title);
};

export const fetchGeniusLyricsLocally = async (
  track: NormalizedLrclibTrack,
): Promise<NormalizedLrclibTrack> => {
  const startedAt = performance.now();
  if (
    track.source !== "genius" ||
    !track.geniusUrl ||
    typeof window.electronAPI?.fetchGeniusLyrics !== "function"
  ) {
    return track;
  }

  const response = await window.electronAPI.fetchGeniusLyrics(track.geniusUrl);
  const plainLyrics = response.ok
    ? stripGeniusLyricsPreamble(
      response.lyrics ??
        extractGeniusLyricsFromHtml(response.html ?? "", track.trackName),
      track.trackName,
    )
    : "";

  if (!plainLyrics) {
    throw new Error(`Genius returned no lyrics (HTTP ${response.status}).`);
  }

  debugLyricsImportTiming("local Genius page hydration", startedAt, {
    geniusId: track.geniusId,
  });
  return { ...track, plainLyrics };
};

export const resolveLrclibImport = async (
  query: LrclibImportQuery,
): Promise<LrclibImportResolution> => {
  const candidates = await searchLrclibTracks(query);
  return {
    match: null,
    candidates,
  };
};
