import { useEffect, useState } from "react";
import { ReactComponent as AddSVG } from "../../assets/icons/add.svg";
import { ReactComponent as CheckSVG } from "../../assets/icons/check.svg";
import { ReactComponent as DeleteSVG } from "../../assets/icons/delete.svg";
import { ReactComponent as MatchWordSVG } from "../../assets/icons/match-word.svg";
import Button from "../Button/Button";
import { ServiceItem } from "../../types";
import { filteredItemsListType } from "./FilteredItems";
import HighlightWords from "./HighlightWords";

type FilteredItemProps = {
  index: number;
  item: filteredItemsListType;
  addItemToList: (item: ServiceItem) => void;
  setItemToBeDeleted: (item: ServiceItem) => void;
  showWords: boolean;
  searchValue: string;
  updateShowWords: (showWords: boolean, index: number) => void;
};

const FilteredItem = ({
  index,
  item,
  addItemToList,
  setItemToBeDeleted,
  showWords: _showWords,
  searchValue,
  updateShowWords,
}: FilteredItemProps) => {
  const isEven = index % 2 === 0;
  const bg = isEven ? "bg-gray-800" : "bg-gray-600";

  const [justAdded, setJustAdded] = useState(false);
  const [showWords, setShowWords] = useState(_showWords);

  useEffect(() => {
    setShowWords(_showWords);
  }, [_showWords]);

  const _updateShowWords = () => {
    setShowWords(!showWords);
    updateShowWords(!showWords, index);
  };

  const addItem = (item: ServiceItem) => {
    const itemToAdd = {
      name: item.name,
      type: item.type,
      _id: item._id,
      listId: item.listId,
      background: item.background,
    };
    addItemToList(itemToAdd);
    setJustAdded(true);

    setTimeout(() => setJustAdded(false), 2000);
  };

  const matchedWords = item.matchedWords;
  const showWordsSection = showWords && matchedWords;

  return (
    <li
      key={item._id}
      className={`flex flex-col ${bg} hover:border-gray-300 border border-transparent rounded-md overflow-clip`}
    >
      <div className="flex gap-2 pl-4 items-center py-1.5">
        <HighlightWords
          searchValue={searchValue}
          string={item.name}
          className="text-base"
          highlightWordColor={showWords ? "text-white" : "text-orange-400"}
          nonHighlightWordColor={searchValue ? "text-gray-300" : "text-white"}
          allowPartial
        />
        {matchedWords && (
          <Button
            onClick={() => _updateShowWords()}
            svg={MatchWordSVG}
            color="#fb923c"
            variant="tertiary"
          />
        )}
        <Button
          color={justAdded ? "#84cc16" : "#22d3ee"}
          variant="tertiary"
          className="text-sm h-full leading-3 ml-auto min-h-6"
          padding="py-1 px-2"
          disabled={justAdded}
          svg={justAdded ? CheckSVG : AddSVG}
          onClick={() => addItem(item)}
        >
          {justAdded ? "Added!" : "Add to outline"}
        </Button>
        <Button
          svg={DeleteSVG}
          variant="tertiary"
          color="red"
          onClick={() => setItemToBeDeleted(item)}
        />
      </div>
      <div>
        <HighlightWords
          searchValue={searchValue}
          string={matchedWords || ""}
          className={`text-sm px-4 text-gray-300 transition-all ${
            showWordsSection
              ? "max-h-32 overflow-y-auto border-gray-400 border-t-2 py-2"
              : "max-h-0"
          }`}
        />
      </div>
    </li>
  );
};

export default FilteredItem;
