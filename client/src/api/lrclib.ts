import { getApiBasePath } from "../utils/environment";
import { NormalizedLrclibTrack, normalizeLrclibTrack } from "../utils/lrclib";

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
    `${getApiBasePath()}api/lrclib/${endpoint}?${buildSearchParams(query).toString()}`,
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
    throw new Error("Could not fetch lyrics from LRCLIB.");
  }

  return normalizeLrclibTrack(await response.json());
};

export const searchLrclibTracks = async (
  query: LrclibImportQuery,
): Promise<NormalizedLrclibTrack[]> => {
  const response = await fetchLrclibEndpoint("search", query);

  if (!response.ok) {
    throw new Error("Could not search LRCLIB.");
  }

  const data = await response.json();
  return normalizeTrackList(data);
};

export const resolveLrclibImport = async (
  query: LrclibImportQuery,
): Promise<LrclibImportResolution> => {
  const match = await getLrclibTrack(query);
  if (match) {
    return {
      match,
      candidates: [],
    };
  }

  const candidates = await searchLrclibTracks(query);
  return {
    match: null,
    candidates,
  };
};
