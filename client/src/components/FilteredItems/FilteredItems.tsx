import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch } from "../../hooks";
import { useLoadMoreOnScroll } from "../../hooks/useLoadMoreOnScroll";
import { FilePlus, WholeWord } from "lucide-react";

import Button from "../Button/Button";
import SongListScrollArea from "../SongList/SongListScrollArea";
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
import { ref, get, set } from "firebase/database";
import { globalFireDbInfo } from "../../context/globalInfo";
import { deleteTimer } from "../../store/timersSlice";
import { getChurchDataPath } from "../../utils/firebasePaths";

type FilteredItemsProps = {
  list: ServiceItem[];
  type: string;
  heading: string;
  label: string;
  isLoading: boolean;
  allDocs: DBItem[];
  searchValue: string;
  setSearchValue: (value: string) => void;
};

export type filteredItemsListType = ServiceItem & {
  matchPercentage?: number;
  matchedWords?: string;
  showWords?: boolean;
};

const FilteredItems = ({
  list,
  type,
  heading,
  label,
  isLoading,
  allDocs,
  searchValue,
  setSearchValue,
}: FilteredItemsProps) => {
  const dispatch = useDispatch();
  const listScrollRef = useRef<HTMLUListElement | null>(null);

  const listOfType = useMemo(() => {
    return list.filter((item) => item.type === type);
  }, [list, type]);

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
  const [numShownItems, setNumShownItems] = useState(20);
  const [debouncedSearchValue, setDebouncedSearchValue] = useState("");
  const [itemToBeDeleted, setItemToBeDeleted] = useState<ServiceItem | null>(
    null
  );

  const [showWords, setShowWords] = useState(false);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [viewSectionsSongId, setViewSectionsSongId] = useState<string | null>(
    null,
  );

  const viewSongDoc = useMemo(() => {
    if (!viewSectionsSongId || type !== "song") return null;
    const doc = allDocs.find(
      (d) => d._id === viewSectionsSongId && d.type === "song",
    );
    return doc ?? null;
  }, [viewSectionsSongId, allDocs, type]);

  const isFullListLoaded = filteredList.length <= numShownItems;

  const { db, isMobile = false } = useContext(ControllerInfoContext) || {};
  const { access } = useContext(GlobalInfoContext) || {};
  const canMutateLibrary = access !== "view";

  // Memoize the search function
  const searchItems = useMemo(() => {
    return async (searchValue: string) => {
      const cleanSearchValue = searchValue
        .replace(punctuationRegex, "")
        .toLowerCase()
        .trim();

      if (cleanSearchValue.trim() === "") {
        return listOfType;
      }

      const searchPromises = listOfType.map(async (item) => {
        if (type === "song") {
          const doc = allDocs.find((song) => song._id === item._id);
          if (doc?.type === "song") {
            const enriched = computeSongSearchEnrichment(
              doc,
              cleanSearchValue,
            );
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
        const matchedWords = "";
        const wordMatches = [];
        let hasLyricMatch = false;

        if (type === "free") {
          const slides =
            allDocs.find((free) => free.name.toLowerCase() === name)?.slides ||
            [];

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
          matchedWords,
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

      const results = await Promise.all(searchPromises);
      return results
        .filter((item) => item.matchRank > 0)
        .sort(
          (a, b) => b.matchRank - a.matchRank || a.name.localeCompare(b.name)
        );
    };
  }, [listOfType, allDocs, type]);

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
    const performSearch = async () => {
      const results = await searchItems(debouncedSearchValue);
      setFilteredList(results);
      setNumShownItems(30);
      setIsSearchLoading(false);
    };

    performSearch();
  }, [debouncedSearchValue, searchItems]);

  useLoadMoreOnScroll({
    scrollRef: listScrollRef,
    enabled: !isFullListLoaded && filteredList.length > 0,
    totalAvailable: filteredList.length,
    batchSize: 20,
    setShownCount: setNumShownItems,
    shownCount: numShownItems,
    rescheduleKey: debouncedSearchValue,
    /** Load the next batch before the footer enters view (reduces visible “load” strip when scrolling fast). */
    thresholdPx: 200,
  });

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
        <section className="text-sm flex gap-2 items-center mt-1 mb-2 justify-center">
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
        </section>
      )}
      <SongListScrollArea
        scrollRef={listScrollRef}
        isSearchLoading={isSearchLoading}
        isFullyLoaded={isFullListLoaded}
        layout="embedded"
        ulClassName="w-full px-1 sm:px-2"
      >
        {filteredList.slice(0, numShownItems).map((item, index) => {
          return (
            <FilteredItem
              key={item._id}
              item={item}
              index={index}
              showWords={item.showWords ?? showWords}
              updateShowWords={updateShowWords}
              addItemToList={(_item) => dispatch(addItemToItemList(_item))}
              setItemToBeDeleted={setItemToBeDeleted}
              searchValue={searchValue}
              artistName={songArtistById.get(item._id)}
              canMutateLibrary={canMutateLibrary}
              onViewSongSections={
                type === "song"
                  ? () => setViewSectionsSongId(item._id)
                  : undefined
              }
            />
          );
        })}
      </SongListScrollArea>
    </div>
  );
};

export default FilteredItems;
