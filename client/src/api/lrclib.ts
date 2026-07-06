import { getApiBasePath } from "../utils/environment";
import {
  NormalizedLrclibTrack,
  getLyricsImportStructureScore,
  normalizeLrclibTrack,
  sortLrclibTracksByLyricsStructure,
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

const WELL_STRUCTURED_LYRICS_SCORE = 200;

const normalizeComparable = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const tracksLikelySameSong = (
  left: NormalizedLrclibTrack,
  right: NormalizedLrclibTrack,
) => {
  const leftTitle = normalizeComparable(left.trackName);
  const rightTitle = normalizeComparable(right.trackName);
  const leftArtist = normalizeComparable(left.artistName);
  const rightArtist = normalizeComparable(right.artistName);

  const titlesMatch =
    leftTitle === rightTitle ||
    leftTitle.startsWith(rightTitle) ||
    rightTitle.startsWith(leftTitle);
  const artistsMatch =
    leftArtist === rightArtist ||
    leftArtist.includes(rightArtist) ||
    rightArtist.includes(leftArtist);

  return titlesMatch && artistsMatch;
};

const trackMatchesImportQuery = (
  candidate: NormalizedLrclibTrack,
  query: LrclibImportQuery,
): boolean => {
  const expectedTitle = normalizeComparable(query.trackName);
  const expectedArtist = query.artistName?.trim()
    ? normalizeComparable(query.artistName)
    : null;
  const title = normalizeComparable(candidate.trackName);
  const artist = normalizeComparable(candidate.artistName);

  const titlesMatch =
    title === expectedTitle ||
    title.startsWith(expectedTitle) ||
    expectedTitle.startsWith(title);

  if (!expectedArtist) {
    return titlesMatch;
  }

  const artistsMatch =
    artist === expectedArtist ||
    artist.includes(expectedArtist) ||
    expectedArtist.includes(artist);

  return titlesMatch && artistsMatch;
};

const isClearlyBestStructuredCandidate = (
  candidates: NormalizedLrclibTrack[],
): NormalizedLrclibTrack | null => {
  const top = candidates[0];
  const second = candidates[1];
  if (!top) return null;

  const topScore = getLyricsImportStructureScore(top);
  const clearlyBest =
    topScore >= WELL_STRUCTURED_LYRICS_SCORE &&
    (!second || topScore - getLyricsImportStructureScore(second) >= 50);

  return clearlyBest ? top : null;
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
  return sortLrclibTracksByLyricsStructure(normalizeTrackList(data));
};

export const resolveLrclibImport = async (
  query: LrclibImportQuery,
): Promise<LrclibImportResolution> => {
  let match: NormalizedLrclibTrack | null = null;

  try {
    match = await getLrclibTrack(query);
  } catch (error) {
    console.warn("Exact lyrics lookup failed; falling back to search.", error);
  }

  if (
    match &&
    getLyricsImportStructureScore(match) < WELL_STRUCTURED_LYRICS_SCORE
  ) {
    try {
      const candidates = await searchLrclibTracks(query);
      const betterMatch = candidates.find(
        (candidate) =>
          tracksLikelySameSong(match, candidate) &&
          getLyricsImportStructureScore(candidate) >
            getLyricsImportStructureScore(match),
      );

      if (betterMatch) {
        match = betterMatch;
      }
    } catch (error) {
      console.warn(
        "Lyrics search for a better-structured match failed.",
        error,
      );
    }
  }

  if (match) {
    return {
      match,
      candidates: [],
    };
  }

  const candidates = await searchLrclibTracks(query);
  const autoSelected = isClearlyBestStructuredCandidate(candidates);

  if (autoSelected && trackMatchesImportQuery(autoSelected, query)) {
    return {
      match: autoSelected,
      candidates: [],
    };
  }

  return {
    match: null,
    candidates,
  };
};
