import { getApiBasePath } from "../utils/environment";
import {
  NormalizedLrclibTrack,
  normalizeLrclibTrack,
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

const fetchLrclibEndpoint = async (
  endpoint: "get" | "search",
  query: LrclibImportQuery,
): Promise<Response> => {
  return fetch(
    `${getApiBasePath()}api/lrclib/${endpoint}?${buildSearchParams(query).toString()}${
      endpoint === "search" && window.electronAPI ? "&localGenius=true" : ""
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

export const searchLrclibTracks = async (
  query: LrclibImportQuery,
): Promise<NormalizedLrclibTrack[]> => {
  const response = await fetchLrclibEndpoint("search", query);

  if (!response.ok) {
    throw new Error("Could not search for lyrics.");
  }

  const data = await response.json();
  return normalizeTrackList(data);
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
  if (track.source !== "genius" || !track.geniusUrl || !window.electronAPI) {
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
