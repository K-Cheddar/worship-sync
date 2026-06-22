import React, {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useDispatch } from "../../hooks";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FilePlus, Search, WholeWord } from "lucide-react";
import { useNavigate } from "react-router-dom";

import Button from "../Button/Button";
import Spinner from "../Spinner/Spinner";
import SongSearchInput from "../SongList/SongSearchInput";
import DeleteModal from "../Modal/DeleteModal";
import {
  addItemToItemList,
  removeItemFromListById,
} from "../../store/itemListSlice";
import { removeItemFromAllItemsList } from "../../store/allItemsSlice";
import { DBItem, ServiceItem } from "../../types";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { ActionCreators } from "redux-undo";
import FilteredItem from "./FilteredItem";
import ViewSongSectionsDrawer from "../SongSections/ViewSongSectionsDrawer";
import {
  getMatchForString,
  punctuationRegex,
  updateWordMatches,
} from "../../utils/generalUtils";
import { computeSongSearchEnrichment } from "../../utils/songSearchUtils";
import {
  createSongMetadataFromLrclib,
  getImportableLyricsFromTrack,
  type NormalizedLrclibTrack,
} from "../../utils/lrclib";
import { initialCreateItemState, setCreateItem } from "../../store/createItemSlice";
import { ref, get, set } from "firebase/database";
import { globalFireDbInfo } from "../../context/globalInfo";
import { deleteTimer } from "../../store/timersSlice";
import { getChurchDataPath } from "../../utils/firebasePaths";
import { alternatingAdminListRowBg } from "../../utils/listRowStripes";
import { cn } from "../../utils/cnHelper";
import { searchLrclibTracks } from "../../api/lrclib";
import ExternalLyricsResultItem from "./ExternalLyricsResultItem";
import ViewExternalLyricsDrawer from "./ViewExternalLyricsDrawer";
import {
  EXTERNAL_SECTION_FOOTER_HEIGHT,
  EXTERNAL_SECTION_HEADER_HEIGHT,
  getExternalSectionClassName,
  getExternalSectionPosition,
} from "./externalResultsSection";
import {
  COLLAPSED_FILTERED_ITEM_ROW_HEIGHT,
  estimateFilteredItemRowHeight,
  EXTERNAL_RESULT_ROW_HEIGHT,
  EXTERNAL_STATUS_ROW_HEIGHT,
  FILTERED_ITEM_ROW_GAP,
  getLibraryItemVirtualKey,
} from "./filteredItemsVirtualRowHeight";

type FilteredItemsProps = {
  list: ServiceItem[];
  type: string;
  heading: string;
  label: string;
  isLoading: boolean;
  allDocs: DBItem[];
  searchValue: string;
  setSearchValue: (value: string) => void;
  /** Rendered above the scrollable list — use for pinned virtual items (e.g. Upcoming Service). */
  pinnedTopContent?: React.ReactNode;
};

export type filteredItemsListType = ServiceItem & {
  matchPercentage?: number;
  matchedWords?: string;
  showWords?: boolean;
};

type FilteredItemsVirtualRow =
  | { kind: "external-section-header" }
  | { kind: "external-section-footer" }
  | { kind: "external-loading" }
  | { kind: "external-error"; message: string }
  | { kind: "external-empty" }
  | { kind: "external"; candidate: NormalizedLrclibTrack }
  | { kind: "library"; item: filteredItemsListType; libraryIndex: number };

const getExternalCandidateKey = (candidate: NormalizedLrclibTrack) =>
  `${candidate.source}:${candidate.geniusId ?? candidate.lrclibId ?? candidate.trackName}:${candidate.artistName}`;

const FilteredItems = ({
  list,
  type,
  heading,
  label,
  isLoading,
  allDocs,
  searchValue,
  setSearchValue,
  pinnedTopContent,
}: FilteredItemsProps) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const listScrollRef = useRef<HTMLDivElement | null>(null);

  const listOfType = useMemo(() => {
    return list.filter((item) => item.type === type);
  }, [list, type]);

  const docsById = useMemo(() => {
    const byId = new Map<string, DBItem>();
    for (const doc of allDocs) {
      byId.set(doc._id, doc);
    }
    return byId;
  }, [allDocs]);

  const freeDocsByName = useMemo(() => {
    const byName = new Map<string, DBItem>();
    if (type !== "free") {
      return byName;
    }
    for (const doc of allDocs) {
      const key = doc.name.toLowerCase();
      // Preserve the previous `find` semantics: first match by name wins.
      if (!byName.has(key)) {
        byName.set(key, doc);
      }
    }
    return byName;
  }, [allDocs, type]);

  const songArtistById = useMemo(() => {
    const byId = new Map<string, string>();
    if (type !== "song") {
      return byId;
    }
    for (const doc of allDocs) {
      const artist = doc.songMetadata?.artistName?.trim();
      if (artist) {
        byId.set(doc._id, artist);
      }
    }
    return byId;
  }, [allDocs, type]);

  const [filteredList, setFilteredList] =
    useState<filteredItemsListType[]>(listOfType);
  const [debouncedSearchValue, setDebouncedSearchValue] = useState("");
  const [itemToBeDeleted, setItemToBeDeleted] = useState<ServiceItem | null>(
    null
  );

  const [showWords, setShowWords] = useState(false);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [isExternalSearchLoading, setIsExternalSearchLoading] = useState(false);
  const [externalSearchQuery, setExternalSearchQuery] = useState("");
  const [externalSearchResults, setExternalSearchResults] = useState<
    NormalizedLrclibTrack[]
  >([]);
  const [externalSearchError, setExternalSearchError] = useState("");
  const [viewSectionsSongId, setViewSectionsSongId] = useState<string | null>(
    null,
  );
  const [viewExternalLyricsCandidate, setViewExternalLyricsCandidate] =
    useState<NormalizedLrclibTrack | null>(null);
  const externalSearchCacheRef = useRef(new Map<string, NormalizedLrclibTrack[]>());

  const displayRows = useMemo<FilteredItemsVirtualRow[]>(() => {
    const rows: FilteredItemsVirtualRow[] = [];

    if (type === "song" && externalSearchQuery) {
      if (isExternalSearchLoading) {
        rows.push({ kind: "external-loading" });
      } else {
        rows.push({ kind: "external-section-header" });
        if (externalSearchError) {
          rows.push({ kind: "external-error", message: externalSearchError });
        } else if (externalSearchResults.length === 0) {
          rows.push({ kind: "external-empty" });
        } else {
          for (const candidate of externalSearchResults) {
            rows.push({ kind: "external", candidate });
          }
        }

        if (filteredList.length > 0) {
          rows.push({ kind: "external-section-footer" });
        }
      }
    }

    filteredList.forEach((item, libraryIndex) => {
      rows.push({ kind: "library", item, libraryIndex });
    });

    return rows;
  }, [
    type,
    externalSearchQuery,
    isExternalSearchLoading,
    externalSearchError,
    externalSearchResults,
    filteredList,
  ]);

  const displayRowKinds = useMemo(
    () => displayRows.map((row) => row.kind),
    [displayRows],
  );

  const displayRowsRef = useRef(displayRows);
  displayRowsRef.current = displayRows;

  const showWordsRef = useRef(showWords);
  showWordsRef.current = showWords;
  const songArtistByIdRef = useRef(songArtistById);
  songArtistByIdRef.current = songArtistById;

  const virtualizer = useVirtualizer({
    count: displayRows.length,
    getScrollElement: () => listScrollRef.current,
    getItemKey: (index) => {
      const row = displayRowsRef.current[index];
      if (!row) return index;
      if (row.kind === "external-section-header") {
        return `external-section-header:${externalSearchQuery}`;
      }
      if (row.kind === "external-section-footer") {
        return `external-section-footer:${externalSearchQuery}`;
      }
      if (row.kind === "external-loading") return "external-loading";
      if (row.kind === "external-error") return "external-error";
      if (row.kind === "external-empty") return "external-empty";
      if (row.kind === "external") return getExternalCandidateKey(row.candidate);
      return getLibraryItemVirtualKey(row.item, showWordsRef.current);
    },
    estimateSize: (index) => {
      const row = displayRowsRef.current[index];
      if (!row) return COLLAPSED_FILTERED_ITEM_ROW_HEIGHT;
      if (row.kind === "external-section-header") {
        return EXTERNAL_SECTION_HEADER_HEIGHT;
      }
      if (row.kind === "external-section-footer") {
        return EXTERNAL_SECTION_FOOTER_HEIGHT;
      }
      if (
        row.kind === "external-loading" ||
        row.kind === "external-error" ||
        row.kind === "external-empty"
      ) {
        return EXTERNAL_STATUS_ROW_HEIGHT;
      }
      if (row.kind === "external") {
        return EXTERNAL_RESULT_ROW_HEIGHT;
      }
      return estimateFilteredItemRowHeight(
        row.item,
        showWordsRef.current,
        Boolean(songArtistByIdRef.current.get(row.item._id)),
      );
    },
    gap: FILTERED_ITEM_ROW_GAP,
    overscan: 5,
    initialRect: { width: 0, height: 600 },
  });

  const viewSongDoc = useMemo(() => {
    if (!viewSectionsSongId || type !== "song") return null;
    const doc = allDocs.find(
      (d) => d._id === viewSectionsSongId && d.type === "song",
    );
    return doc ?? null;
  }, [viewSectionsSongId, allDocs, type]);

  const { db, isMobile = false } = useContext(ControllerInfoContext) || {};
  const { access } = useContext(GlobalInfoContext) || {};
  const canMutateLibrary = access !== "view";

  // Memoize the search function. Runs synchronously on every debounced
  // keystroke, so it stays O(n): doc lookups go through `docsById` /
  // `freeDocsByName` instead of an `allDocs.find` per item.
  const searchItems = useMemo(() => {
    return (rawSearchValue: string): filteredItemsListType[] => {
      const cleanSearchValue = rawSearchValue
        .replace(punctuationRegex, "")
        .toLowerCase()
        .trim();

      if (cleanSearchValue === "") {
        return listOfType;
      }

      const results = listOfType.map((item) => {
        if (type === "song") {
          const doc = docsById.get(item._id);
          if (doc?.type === "song") {
            const enriched = computeSongSearchEnrichment(doc, cleanSearchValue);
            return {
              ...item,
              matchRank: enriched.matchRank,
              matchedWords: enriched.matchedWords,
              showWords: enriched.showWords,
            };
          }
          return { ...item, matchRank: 0, matchedWords: "", showWords: false };
        }

        const name = item.name.toLowerCase();
        const match = getMatchForString({
          string: name,
          searchValue: cleanSearchValue,
          allowPartial: true,
        });
        const wordMatches = [];
        let hasLyricMatch = false;

        if (type === "free") {
          const slides = freeDocsByName.get(name)?.slides || [];

          for (const slide of slides) {
            for (const box of slide.boxes) {
              const wordMatch = getMatchForString({
                string: box.words || "",
                searchValue: cleanSearchValue,
              });
              if (wordMatch > 0) {
                hasLyricMatch = true;
                wordMatches.push({
                  match: wordMatch,
                  matchedWords: box.words || "",
                });
              }
            }
          }
        }

        const { updatedMatchedWords, updatedMatch } = updateWordMatches({
          matchedWords: "",
          match,
          wordMatches,
        });

        return {
          ...item,
          matchRank: match + updatedMatch,
          matchedWords: updatedMatchedWords,
          showWords: hasLyricMatch && match === 0, // Auto-expand if there's a lyric match but no title match
        };
      });

      return results
        .filter((item) => item.matchRank > 0)
        .sort(
          (a, b) => b.matchRank - a.matchRank || a.name.localeCompare(b.name)
        );
    };
  }, [listOfType, docsById, freeDocsByName, type]);

  // Debounced search effect
  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearchValue(searchValue);
    }, 250);
    setIsSearchLoading(searchValue !== debouncedSearchValue);
    return () => clearTimeout(timeout);
  }, [searchValue, debouncedSearchValue]);

  // Search effect
  useEffect(() => {
    const results = searchItems(debouncedSearchValue);
    setFilteredList(results);
    setIsSearchLoading(false);
    listScrollRef.current?.scrollTo?.({ top: 0 });
  }, [debouncedSearchValue, searchItems]);

  const deleteItem = async (item: ServiceItem) => {
    setItemToBeDeleted(null);
    dispatch(removeItemFromAllItemsList(item._id));
    dispatch(removeItemFromListById(item._id));
    dispatch(ActionCreators.clearHistory());

    // If deleting a timer, also delete from Firebase and localStorage
    if (item.type === "timer") {
      const timerId = item._id;

      // Delete from Redux store
      dispatch(deleteTimer(timerId));

      // Delete from localStorage
      try {
        const storedTimers = JSON.parse(
          localStorage.getItem("timerInfo") || "[]"
        );
        const filteredTimers = storedTimers.filter(
          (timer: any) => timer.id !== timerId
        );
        localStorage.setItem("timerInfo", JSON.stringify(filteredTimers));
      } catch (error) {
        console.error("Error updating localStorage:", error);
      }

      // Delete from Firebase
      if (globalFireDbInfo.db && globalFireDbInfo.churchId) {
        try {
          const timersRef = ref(
            globalFireDbInfo.db,
            getChurchDataPath(globalFireDbInfo.churchId, "timers")
          );

          const snapshot = await get(timersRef);
          const currentTimers = snapshot.val() || [];

          // Filter out the deleted timer
          const updatedTimers = currentTimers.filter(
            (timer: any) => timer.id !== timerId
          );

          await set(timersRef, updatedTimers);
        } catch (error) {
          console.error("Error deleting timer from Firebase:", error);
        }
      }
    }

    if (db) {
      try {
        const doc = await db.get(item._id);
        db.remove(doc);
      } catch (error) {
        console.error(error);
      }
    }
  };

  const updateShowWords = (show: boolean, index?: number) => {
    if (index === undefined) {
      const updatedList = filteredList.map((item) => ({
        ...item,
        showWords: show,
      }));
      setFilteredList(updatedList);
      setShowWords(show);
    } else {
      const updatedList = filteredList.map((item, i) => ({
        ...item,
        showWords: i === index ? show : item.showWords,
      }));
      const allShown = updatedList.every((item) => item.showWords);
      const allHidden = updatedList.every((item) => !item.showWords);
      if (allShown) setShowWords(true);
      if (allHidden) setShowWords(false);
      setFilteredList(updatedList);
    }
  };

  const normalizedExternalSearchValue = searchValue.trim();

  useEffect(() => {
    setExternalSearchQuery("");
    setExternalSearchResults([]);
    setExternalSearchError("");
  }, [searchValue]);

  const createSongFromExternalResult = (candidate: NormalizedLrclibTrack) => {
    dispatch(
      setCreateItem({
        ...initialCreateItemState,
        name: candidate.trackName,
        type: "song",
        text: getImportableLyricsFromTrack(candidate),
        songArtist: candidate.artistName,
        songAlbum: candidate.albumName || "",
        songMetadata: createSongMetadataFromLrclib(candidate),
        lyricsImportCandidates: [],
        lyricsImportError: "",
      }),
    );
    navigate("/controller/create");
  };

  const renderDisplayRow = (row: FilteredItemsVirtualRow, rowIndex: number) => {
    const sectionPosition = getExternalSectionPosition(rowIndex, displayRowKinds);

    if (row.kind === "external-section-header") {
      return (
        <div
          role="listitem"
          className={cn(
            "px-4 py-2 text-center",
            alternatingAdminListRowBg(rowIndex),
            getExternalSectionClassName(sectionPosition),
          )}
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200/80">
            External lyrics
          </p>
          <p className="text-sm text-gray-400">
            Matching &ldquo;{externalSearchQuery}&rdquo;
          </p>
        </div>
      );
    }

    if (row.kind === "external-section-footer") {
      return (
        <div
          role="separator"
          aria-label="End of search results"
          className="mb-3 flex items-center gap-3 px-3 py-2"
        >
          <div className="h-px flex-1 bg-cyan-500/25" />
          <span className="shrink-0 text-xs text-gray-400">End of search results</span>
          <div className="h-px flex-1 bg-cyan-500/25" />
        </div>
      );
    }

    if (row.kind === "external-loading") {
      return (
        <div
          role="listitem"
          className={cn(
            "flex items-center justify-center gap-2 px-4 py-6 text-sm text-gray-300",
            alternatingAdminListRowBg(rowIndex),
            getExternalSectionClassName(sectionPosition),
          )}
        >
          <Spinner />
          <span>Searching external lyrics...</span>
        </div>
      );
    }

    if (row.kind === "external-error") {
      return (
        <p
          role="listitem"
          className={cn(
            "px-4 py-3 text-sm text-red-300",
            alternatingAdminListRowBg(rowIndex),
            getExternalSectionClassName(sectionPosition),
          )}
        >
          {row.message}
        </p>
      );
    }

    if (row.kind === "external-empty") {
      return (
        <p
          role="listitem"
          className={cn(
            "px-4 py-3 text-sm text-gray-400",
            alternatingAdminListRowBg(rowIndex),
            getExternalSectionClassName(sectionPosition),
          )}
        >
          No external matches found.
        </p>
      );
    }

    if (row.kind === "external") {
      return (
        <ExternalLyricsResultItem
          index={rowIndex}
          candidate={row.candidate}
          searchValue={normalizedExternalSearchValue}
          sectionPosition={sectionPosition}
          onCreateSong={createSongFromExternalResult}
          onViewLyrics={setViewExternalLyricsCandidate}
        />
      );
    }

    return renderFilteredItem(row.item, rowIndex, row.libraryIndex);
  };

  const renderFilteredItem = (
    item: filteredItemsListType,
    rowIndex: number,
    libraryIndex: number,
  ) => (
    <FilteredItem
      key={item._id}
      item={item}
      index={rowIndex}
      showWords={item.showWords ?? showWords}
      updateShowWords={updateShowWords}
      addItemToList={(_item) => dispatch(addItemToItemList(_item))}
      setItemToBeDeleted={setItemToBeDeleted}
      searchValue={searchValue}
      artistName={songArtistById.get(item._id)}
      canMutateLibrary={canMutateLibrary}
      onViewSongSections={
        type === "song" ? () => setViewSectionsSongId(item._id) : undefined
      }
      libraryIndex={libraryIndex}
    />
  );

  const searchExternalLyrics = async () => {
    if (!normalizedExternalSearchValue) {
      setExternalSearchError("Enter lyrics to search first.");
      return;
    }

    const cacheKey = normalizedExternalSearchValue.toLowerCase();
    const cachedResults = externalSearchCacheRef.current.get(cacheKey);

    setExternalSearchError("");
    setExternalSearchQuery(normalizedExternalSearchValue);

    if (cachedResults) {
      setExternalSearchResults(cachedResults);
      setIsExternalSearchLoading(false);
      return;
    }

    setIsExternalSearchLoading(true);
    setExternalSearchResults([]);

    try {
      const results = await searchLrclibTracks({
        trackName: normalizedExternalSearchValue,
      });
      externalSearchCacheRef.current.set(cacheKey, results);
      setExternalSearchResults(results);
    } catch (error) {
      console.error("External lyrics search failed:", error);
      setExternalSearchResults([]);
      setExternalSearchError("Could not search external lyrics right now.");
    } finally {
      setIsExternalSearchLoading(false);
    }
  };

  return (
    <div className="flex h-full w-full max-w-none flex-col items-stretch px-2 py-4">
      <DeleteModal
        isOpen={!!itemToBeDeleted}
        onClose={() => setItemToBeDeleted(null)}
        onConfirm={() => itemToBeDeleted && deleteItem(itemToBeDeleted)}
        itemName={itemToBeDeleted?.name}
      />
      <ViewSongSectionsDrawer
        song={viewSongDoc}
        isOpen={Boolean(viewSectionsSongId && viewSongDoc)}
        isMobile={isMobile}
        searchHighlight={searchValue}
        onClose={() => setViewSectionsSongId(null)}
      />
      <ViewExternalLyricsDrawer
        candidate={viewExternalLyricsCandidate}
        isOpen={Boolean(viewExternalLyricsCandidate)}
        isMobile={isMobile}
        searchHighlight={normalizedExternalSearchValue}
        onClose={() => setViewExternalLyricsCandidate(null)}
      />
      <h2 className="mb-2 w-full text-center text-2xl">{heading}</h2>
      {isLoading && (
        <h3 className="text-lg text-center">{heading} are loading...</h3>
      )}
      <div className="mb-4 flex w-full gap-2 justify-center">
        <SongSearchInput
          value={searchValue}
          disabled={isLoading}
          onChange={setSearchValue}
          label="Search"
          className="text-base flex flex-1 gap-2 items-center max-w-2xl"
          placeholder=""
          showSearchIconWhenEmpty={false}
        />
        <Button
          disabled={!searchValue}
          onClick={() => updateShowWords(!showWords)}
          svg={WholeWord}
        >
          {showWords ? "Hide" : "Show"} All{" "}
        </Button>
      </div>
      {canMutateLibrary && (
        <div className="mb-2 flex flex-col gap-3">
          <section className="text-sm flex flex-wrap gap-2 items-center justify-center">
            <p>Can't find what you're looking for?</p>
            <Button
              variant="secondary"
              className="relative"
              svg={FilePlus}
              color="#84cc16"
              component="link"
              to={`/controller/create?type=${type}&name=${encodeURI(searchValue)}`}
            >
              Create a new {label}
            </Button>
            {type === "song" && (
              <Button
                variant="tertiary"
                className="relative"
                svg={Search}
                color="#22d3ee"
                onClick={searchExternalLyrics}
                disabled={!normalizedExternalSearchValue || isExternalSearchLoading}
              >
                {isExternalSearchLoading ? "Searching..." : "Search external lyrics"}
              </Button>
            )}
          </section>
        </div>
      )}
      {pinnedTopContent && (
        <div className="mb-2 px-1 sm:px-2">{pinnedTopContent}</div>
      )}
      <div className="relative min-h-0 flex-1">
        {isSearchLoading && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-gray-800/35">
            <Spinner />
          </div>
        )}
        <div
          ref={listScrollRef}
          className="scrollbar-variable h-full w-full overflow-y-auto px-1 sm:px-2"
          role="list"
        >
          <div
            className="relative"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const row = displayRows[virtualItem.index];
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  className="absolute left-0 top-0 w-full"
                  style={{
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  {row ? renderDisplayRow(row, virtualItem.index) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FilteredItems;
