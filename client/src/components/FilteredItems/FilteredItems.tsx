import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch } from "../../hooks";
import { ReactComponent as CreateSVG } from "../../assets/icons/create.svg";
import { ReactComponent as MatchWordSVG } from "../../assets/icons/match-word.svg";

import Button from "../Button/Button";
import Input from "../Input/Input";
import "./FilteredItems.scss";
import {
  addItemToItemList,
  removeItemFromListById,
} from "../../store/itemListSlice";
import { Link } from "react-router-dom";
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
}: FilteredItemsProps) => {
  const dispatch = useDispatch();
  const loader = useRef(null);

  const listOfType = useMemo(() => {
    return list.filter((item) => item.type === type);
  }, [list, type]);

  const [filteredList, setFilteredList] =
    useState<filteredItemsListType[]>(listOfType);
  const [numShownItems, setNumShownItems] = useState(20);
  const [searchValue, setSearchValue] = useState("");
  const [debouncedSearchValue, setDebouncedSearchValue] = useState("");
  const [itemToBeDeleted, setItemToBeDeleted] = useState<ServiceItem | null>(
    null
  );

  const [showWords, setShowWords] = useState(false);
  const [isSearchLoading, setIsSearchLoading] = useState(false);

  const isFullListLoaded = filteredList.length <= numShownItems;

  const { db } = useContext(ControllerInfoContext) || {};

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearchValue(searchValue);
    }, 250);
    setIsSearchLoading(searchValue !== debouncedSearchValue);
    return () => {
      clearTimeout(timeout);
    };
  }, [searchValue, debouncedSearchValue]);

  useEffect(() => {
    const getFilteredItems = async () => {
      return new Promise<void>((resolve) => {
        const cleanSearchValue = debouncedSearchValue.replace(
          punctuationRegex,
          ""
        );
        if (cleanSearchValue.trim() === "") {
          setIsSearchLoading(false);
          setFilteredList(listOfType); // no search term
          resolve();
          return;
        }

        const searchTerms = cleanSearchValue
          .split(" ")
          .filter((term) => term.trim()); // ignore spaces
        const rankedList = [];
        for (let i = 0; i < listOfType.length; i++) {
          const name = listOfType[i].name.toLowerCase();

          let match = getMatchForString({ string: name, searchTerms });
          let matchedWords = "";
          let wordMatches = [];

          // add match points for lyrics

          if (type === "song") {
            // search lyrics in songs
            const arrangements =
              allDocs.find((song) => song.name.toLowerCase() === name)
                ?.arrangements || [];

            for (let j = 0; j < arrangements.length; j++) {
              const { formattedLyrics } = arrangements[j];

              for (let k = 0; k < formattedLyrics.length; k++) {
                const words = formattedLyrics[k].words;
                const wordMatch = getMatchForString({
                  string: words,
                  searchTerms,
                });
                if (wordMatch > 0) {
                  wordMatches.push({
                    match: wordMatch,
                    matchedWords: words,
                  });
                }
              }
            }

            const { updatedMatchedWords, updatedMatch } = updateWordMatches({
              matchedWords,
              match,
              wordMatches,
            });

            matchedWords = updatedMatchedWords;
            match += updatedMatch;
          } else if (type === "free") {
            // search slides in free form
            const slides =
              allDocs.find((free) => free.name.toLowerCase() === name)
                ?.slides || [];

            for (let j = 0; j < slides.length; j++) {
              const { boxes } = slides[j];

              for (let k = 0; k < boxes.length; k++) {
                const words = boxes[k].words || "";
                const wordMatch = getMatchForString({
                  string: words,
                  searchTerms,
                });
                wordMatches.push({
                  match: wordMatch,
                  matchedWords: words,
                });
              }
            }
            const { updatedMatchedWords, updatedMatch } = updateWordMatches({
              matchedWords,
              match,
              wordMatches,
            });

            matchedWords = updatedMatchedWords;
            match += updatedMatch;
          }

          rankedList.push({
            ...listOfType[i],
            matchPercent: match / searchTerms.length,
            matchedWords,
          });
        }

        const matchedList = rankedList
          .filter((item) => item.matchPercent >= 0.25) // filter out non-matched items
          .sort(
            // sort by match percent, then name
            (a, b) =>
              b.matchPercent - a.matchPercent || a.name.localeCompare(b.name)
          );

        setIsSearchLoading(false);
        setFilteredList(matchedList);
        setNumShownItems(30); // reset shown items
        resolve();
      });
    };
    getFilteredItems();
  }, [debouncedSearchValue, listOfType, allDocs, type]);

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
      {itemToBeDeleted && (
        <div className="fixed top-0 left-0 w-full h-full bg-black bg-opacity-50 flex items-center justify-center">
          <div className="bg-slate-700 rounded px-8 py-4">
            <p className="text-xl">
              Are you sure you want to delete{" "}
              <span className="font-semibold">{itemToBeDeleted.name}</span>?
            </p>
            <p className="text-lg text-amber-400">
              This action is permanent and will clear your undo history.
            </p>
            <div className="flex gap-6 w-full mt-4">
              <Button
                className="flex-1 justify-center"
                onClick={() => setItemToBeDeleted(null)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 justify-center"
                variant="cta"
                onClick={() => deleteItem(itemToBeDeleted)}
              >
                Delete Forever
              </Button>
            </div>
          </div>
        </div>
      )}
      <h2 className="text-2xl text-center mb-2 max-2xl:w-full 2xl:w-2/3">
        {heading}
      </h2>
      {isLoading && (
        <h3 className="text-lg text-center">{heading} is loading...</h3>
      )}
      <div className="flex gap-2 max-2xl:w-full 2xl:w-2/3 mb-4 px-6">
        <Input
          value={searchValue}
          disabled={isLoading}
          onChange={(val) => setSearchValue(val as string)}
          label="Search"
          className="text-base flex gap-2 items-center flex-1"
          data-ignore-undo="true"
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
        {isFullListLoaded && (
          <li className="text-sm flex gap-2 items-center mt-2 justify-center">
            <p>Can't find what you're looking for?</p>
            <Button
              variant="secondary"
              className="relative"
              svg={CreateSVG}
              color="#84cc16"
            >
              <Link
                className="h-full w-full"
                to={`/controller/create?type=${type}&name=${encodeURI(
                  searchValue
                )}`}
              >
                Create a new {label}
              </Link>
            </Button>
          </li>
        )}
        <li
          className={`w-full text-sm text-center py-1 rounded-md ${
            isFullListLoaded ? "bg-transparent" : "bg-black"
          }`}
          ref={loader}
        >
          {!isFullListLoaded && "Loading..."}
        </li>
      </ul>
    </div>
  );
};

export default FilteredItems;
