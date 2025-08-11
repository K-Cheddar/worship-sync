import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch } from "../../hooks";
import { ReactComponent as CreateSVG } from "../../assets/icons/create.svg";
import { ReactComponent as MatchWordSVG } from "../../assets/icons/match-word.svg";
import { ReactComponent as CloseSVG } from "../../assets/icons/close.svg";

import Button from "../Button/Button";
import Input from "../Input/Input";
import DeleteModal from "../Modal/DeleteModal";
import "./FilteredItems.scss";
import {
  addItemToItemList,
  removeItemFromListById,
} from "../../store/itemListSlice";
import { removeItemFromAllItemsList } from "../../store/allItemsSlice";
import { DBItem, ServiceItem } from "../../types";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { ActionCreators } from "redux-undo";
import FilteredItem from "./FilteredItem";
import {
  getMatchForString,
  punctuationRegex,
  updateWordMatches,
} from "../../utils/generalUtils";
import Spinner from "../Spinner/Spinner";

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
  const loader = useRef(null);

  const listOfType = useMemo(() => {
    return list.filter((item) => item.type === type);
  }, [list, type]);

  const [filteredList, setFilteredList] =
    useState<filteredItemsListType[]>(listOfType);
  const [numShownItems, setNumShownItems] = useState(20);
  const [debouncedSearchValue, setDebouncedSearchValue] = useState("");
  const [itemToBeDeleted, setItemToBeDeleted] = useState<ServiceItem | null>(
    null
  );

  const [showWords, setShowWords] = useState(false);
  const [isSearchLoading, setIsSearchLoading] = useState(false);

  const isFullListLoaded = filteredList.length <= numShownItems;

  const { db } = useContext(ControllerInfoContext) || {};

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
        const name = item.name.toLowerCase();
        const match = getMatchForString({
          string: name,
          searchValue: cleanSearchValue,
          allowPartial: true,
        });
        const matchedWords = "";
        const wordMatches = [];
        let hasLyricMatch = false;

        if (type === "song") {
          const arrangements =
            allDocs.find((song) => song.name.toLowerCase() === name)
              ?.arrangements || [];

          for (const arrangement of arrangements) {
            for (const lyric of arrangement.formattedLyrics) {
              const wordMatch = getMatchForString({
                string: lyric.words,
                searchValue: cleanSearchValue,
              });
              if (wordMatch > 0) {
                hasLyricMatch = true;
                wordMatches.push({
                  match: wordMatch,
                  matchedWords: lyric.words,
                });
              }
            }
          }
        } else if (type === "free") {
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

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setNumShownItems((prev) => prev + 20);
      }
    });

    if (loader.current) {
      observer.observe(loader.current);
    }

    return () => {
      observer.disconnect();
    };
  }, []);

  const deleteItem = async (item: ServiceItem) => {
    setItemToBeDeleted(null);
    dispatch(removeItemFromAllItemsList(item._id));
    dispatch(removeItemFromListById(item._id));
    dispatch(ActionCreators.clearHistory());
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
    <div className="px-2 py-4 h-full flex flex-col items-center">
      <DeleteModal
        isOpen={!!itemToBeDeleted}
        onClose={() => setItemToBeDeleted(null)}
        onConfirm={() => itemToBeDeleted && deleteItem(itemToBeDeleted)}
        itemName={itemToBeDeleted?.name}
      />
      <h2 className="text-2xl text-center mb-2 max-2xl:w-full 2xl:w-2/3">
        {heading}
      </h2>
      {isLoading && (
        <h3 className="text-lg text-center">{heading} are loading...</h3>
      )}
      <div className="flex gap-2 max-2xl:w-full 2xl:w-2/3 mb-4 px-6">
        <Input
          value={searchValue}
          disabled={isLoading}
          onChange={(val) => setSearchValue(val as string)}
          label="Search"
          className="text-base flex gap-2 items-center flex-1"
          data-ignore-undo="true"
          svg={searchValue ? CloseSVG : undefined}
          svgAction={() => setSearchValue("")}
        />
        <Button
          disabled={!searchValue}
          onClick={() => updateShowWords(!showWords)}
          svg={MatchWordSVG}
        >
          {showWords ? "Hide" : "Show"} All{" "}
        </Button>
      </div>
      <ul className="filtered-items-list">
        {isSearchLoading && (
          <li className="absolute top-0 left-0 w-full h-full flex items-center justify-center bg-gray-800/35">
            <Spinner />
          </li>
        )}
        {searchValue && (
          <li className="text-sm flex gap-2 items-center mt-1 mb-2 justify-center">
            <p>Can't find what you're looking for?</p>
            <Button
              variant="secondary"
              className="relative"
              svg={CreateSVG}
              color="#84cc16"
              component="link"
              to={`/controller/create?type=${type}&name=${encodeURI(
                searchValue
              )}`}
            >
              Create a new {label}
            </Button>
          </li>
        )}
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
            />
          );
        })}

        <li
          className={`w-full text-sm text-center py-1 rounded-md ${
            isFullListLoaded ? "bg-transparent" : "bg-black"
          }`}
          ref={loader}
        >
          {!isFullListLoaded && <Spinner />}
        </li>
      </ul>
    </div>
  );
};

export default FilteredItems;
