import { useEffect, useMemo, useRef, useState } from "react";
import { useLoadMoreOnScroll } from "./useLoadMoreOnScroll";
import { filterAndSortSongsForSearchWithEnrichment } from "../utils/songSearchUtils";
import { DBItem } from "../types";

const DEBOUNCE_MS = 250;
const INITIAL_SHOWN = 20;
const AFTER_DEBOUNCE_SHOWN = 30;

type UseSongSearchPagedListOptions = {
  /** Full `DBItem` list from the library (song rows are filtered by `type === "song"`). */
  songs: DBItem[];
  /**
   * When false, incremental loading is off (e.g. drawer closed or not on Songs tab).
   * Still require `filteredSongs.length > numShown` inside the hook.
   */
  loadMoreEnabledBase: boolean;
  /** Bumps load-more attachment when this changes (drawer open, tab, search). */
  rescheduleKey?: string;
  /**
   * When this flips to false, search and paging reset (e.g. drawer closed).
   * Omit if the parent manages reset manually.
   */
  isActive?: boolean;
};

/**
 * Debounced title/lyrics search, ranked song list, and incremental rendering
 * (shared with the import-sections drawer).
 */
export function useSongSearchPagedList({
  songs,
  loadMoreEnabledBase,
  rescheduleKey = "",
  isActive = true,
}: UseSongSearchPagedListOptions) {
  const [searchValue, setSearchValue] = useState("");
  const [debouncedSearchValue, setDebouncedSearchValue] = useState("");
  const [numShown, setNumShown] = useState(INITIAL_SHOWN);
  const listScrollRef = useRef<HTMLUListElement | null>(null);

  const songDocs = useMemo(
    () => songs.filter((song) => song.type === "song"),
    [songs],
  );

  const filteredSongRows = useMemo(
    () =>
      filterAndSortSongsForSearchWithEnrichment(
        songDocs,
        debouncedSearchValue,
      ),
    [songDocs, debouncedSearchValue],
  );

  const filteredSongs = useMemo(
    () => filteredSongRows.map((row) => row.song),
    [filteredSongRows],
  );

  const visibleSongRows = useMemo(
    () => filteredSongRows.slice(0, numShown),
    [filteredSongRows, numShown],
  );

  const isListFullyLoaded = filteredSongRows.length <= numShown;
  const isSearchLoading = searchValue !== debouncedSearchValue;

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearchValue(searchValue);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [searchValue]);

  useEffect(() => {
    setNumShown(AFTER_DEBOUNCE_SHOWN);
  }, [debouncedSearchValue]);

  const loadMoreEnabled =
    loadMoreEnabledBase &&
    filteredSongRows.length > 0 &&
    filteredSongRows.length > numShown;

  useLoadMoreOnScroll({
    scrollRef: listScrollRef,
    enabled: loadMoreEnabled,
    totalAvailable: filteredSongRows.length,
    batchSize: 20,
    setShownCount: setNumShown,
    shownCount: numShown,
    rescheduleKey,
  });

  useEffect(() => {
    if (isActive) return;
    setSearchValue("");
    setDebouncedSearchValue("");
    setNumShown(INITIAL_SHOWN);
  }, [isActive]);

  return {
    searchValue,
    setSearchValue,
    debouncedSearchValue,
    songDocs,
    filteredSongs,
    visibleSongRows,
    listScrollRef,
    isSearchLoading,
    isListFullyLoaded,
  };
}
