import { DBItem } from "../types";
import {
  getMatchForString,
  punctuationRegex,
  updateWordMatches,
} from "./generalUtils";

const sortSongsAlphabetically = (songs: DBItem[]): DBItem[] =>
  [...songs].sort((a, b) => {
    const nameDiff = a.name.localeCompare(b.name, "en", { numeric: true });
    if (nameDiff !== 0) return nameDiff;
    const artistA = a.songMetadata?.artistName?.trim() || "";
    const artistB = b.songMetadata?.artistName?.trim() || "";
    return artistA.localeCompare(artistB, "en", { numeric: true });
  });

/** Same ranking as the Songs library (FilteredItems): title + lyrics across arrangements. */
export const computeSongSearchEnrichment = (
  song: DBItem,
  cleanSearchValue: string,
) => {
  const name = song.name.toLowerCase();
  const match = getMatchForString({
    string: name,
    searchValue: cleanSearchValue,
    allowPartial: true,
  });

  const wordMatches: { match: number; matchedWords: string }[] = [];

  for (const arrangement of song.arrangements || []) {
    for (const lyric of arrangement.formattedLyrics || []) {
      const wordMatch = getMatchForString({
        string: lyric.words,
        searchValue: cleanSearchValue,
      });
      if (wordMatch > 0) {
        wordMatches.push({
          match: wordMatch,
          matchedWords: lyric.words,
        });
      }
    }
  }

  const { updatedMatchedWords, updatedMatch } = updateWordMatches({
    matchedWords: "",
    match,
    wordMatches,
  });

  const matchRank = match + updatedMatch;
  const hasLyricMatch = wordMatches.length > 0;

  return {
    matchRank,
    matchedWords: updatedMatchedWords,
    showWords: hasLyricMatch && match === 0,
  };
};

export type SongSearchRow = {
  song: DBItem;
  matchRank: number;
  matchedWords: string;
  /** When true, lyric snippet is a stronger match than title (library / FilteredItems behavior). */
  showWords: boolean;
};

/** Title + lyrics ranking with `matchedWords` for HighlightWords (Songs library + import drawer). */
export const filterAndSortSongsForSearchWithEnrichment = (
  songs: DBItem[],
  searchValue: string,
): SongSearchRow[] => {
  const cleanSearchValue = searchValue
    .replace(punctuationRegex, "")
    .toLowerCase()
    .trim();

  if (cleanSearchValue === "") {
    return sortSongsAlphabetically(songs).map((song) => ({
      song,
      matchRank: 0,
      matchedWords: "",
      showWords: false,
    }));
  }

  return songs
    .map((song) => ({
      song,
      ...computeSongSearchEnrichment(song, cleanSearchValue),
    }))
    .filter((row) => row.matchRank > 0)
    .sort(
      (a, b) =>
        b.matchRank - a.matchRank ||
        a.song.name.localeCompare(b.song.name, "en", { numeric: true }),
    );
};

export const filterAndSortSongsForSearch = (
  songs: DBItem[],
  searchValue: string,
): DBItem[] =>
  filterAndSortSongsForSearchWithEnrichment(songs, searchValue).map(
    (row) => row.song,
  );
