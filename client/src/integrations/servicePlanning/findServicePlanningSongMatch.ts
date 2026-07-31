/**
 * Matches a song title printed on a service plan against the local library.
 *
 * Two stages, because ranking and deciding are different jobs:
 *
 *  1. Rank with the same search the Songs library uses, so the importer and the
 *     song picker agree on which songs a title is even about.
 *  2. Accept the top candidate only if `songTitleSimilarity` says the two
 *     titles are the same name — the search score can't do this, since it
 *     reports which branch matched rather than how alike two full titles are.
 *
 * The bias is toward leaving a song unlinked. An unmatched import shows as a
 * clearly marked chip the operator can link in one click, while a wrong link is
 * a wrong song on screen that nobody notices until it's live.
 */
import type { ServiceItem } from "../../types";
import { getMatchForString } from "../../utils/generalUtils";
import { cleanPlanningTitle } from "./cleanPlanningTitle";
import { compareSongTitles } from "./songTitleSimilarity";

/** How many search hits get the closer look. Beyond this the search ranking has
 * long stopped being about the same song. */
const RANKED_CANDIDATE_LIMIT = 10;

/** Two library songs this close to each other means the title doesn't choose
 * between them, so neither is linked. */
const AMBIGUOUS_MARGIN = 0.05;

const uniqueNonEmptyValues = (values: string[]): string[] =>
  Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value)),
  );

export const getServicePlanningSongMatchScore = (
  planningTitle: string,
  songName: string,
): number => {
  const searchValues = uniqueNonEmptyValues([
    cleanPlanningTitle(planningTitle).toLowerCase(),
  ]);
  const songNameVariants = uniqueNonEmptyValues([
    songName,
    cleanPlanningTitle(songName),
  ]);

  let bestScore = 0;

  for (const searchValue of searchValues) {
    for (const songNameVariant of songNameVariants) {
      bestScore = Math.max(
        bestScore,
        getMatchForString({
          string: songNameVariant,
          searchValue,
        }),
      );
    }
  }

  return bestScore;
};

/** Near-misses worth offering to a person, well below the bar for linking one
 * automatically. Under this, a title has nothing useful to say about a song. */
export const SONG_SUGGESTION_THRESHOLD = 0.5;

export type SongMatchCandidate<T> = {
  song: T;
  similarity: number;
  /** True when the titles match beyond doubt — see `compareSongTitles`. */
  isConfident: boolean;
};

/**
 * Library songs a planning title might name, most alike first: the search
 * ranking narrows the field, then `compareSongTitles` orders what's left by how
 * alike the two titles actually are.
 */
export const rankSongMatchCandidates = <T extends { _id: string; name: string }>(
  planningTitle: string,
  songs: T[],
): SongMatchCandidate<T>[] => {
  if (!cleanPlanningTitle(planningTitle).trim()) return [];

  return songs
    .map((song) => ({ song, score: getServicePlanningSongMatchScore(planningTitle, song.name) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, RANKED_CANDIDATE_LIMIT)
    .map(({ song }) => ({ song, ...compareSongTitles(planningTitle, song.name) }))
    .sort((left, right) => right.similarity - left.similarity);
};

/**
 * The library song a planning title names, or null when nothing is close
 * enough to be sure. Works against any {_id, name} shape so both import paths
 * can use it — the presentation library's song docs aren't ServiceItems.
 */
export const findBestSongMatchByName = <T extends { _id: string; name: string }>(
  planningTitle: string,
  songs: T[],
): T | null => {
  const [best, runnerUp] = rankSongMatchCandidates(planningTitle, songs);
  if (!best?.isConfident) return null;
  // An exact title wins outright even when the library holds a near-duplicate.
  if (best.similarity < 1 && runnerUp &&
    best.similarity - runnerUp.similarity < AMBIGUOUS_MARGIN) {
    return null;
  }

  return best.song;
};

/**
 * Songs to offer for a title that wasn't linked — either nothing was close
 * enough, or two songs were equally close and neither could be chosen. Both
 * cases are answered the same way: show the near-misses and let a person pick.
 */
export const findSongMatchSuggestions = <T extends { _id: string; name: string }>(
  planningTitle: string,
  songs: T[],
  limit = 3,
): SongMatchCandidate<T>[] =>
  rankSongMatchCandidates(planningTitle, songs)
    .filter(({ similarity }) => similarity >= SONG_SUGGESTION_THRESHOLD)
    .slice(0, limit);

export const findBestServicePlanningSongMatch = (
  planningTitle: string,
  songs: ServiceItem[],
): ServiceItem | null => findBestSongMatchByName(planningTitle, songs);
