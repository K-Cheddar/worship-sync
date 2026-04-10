import { useEffect, useState } from "react";
import { LayoutList, Plus, Check, Trash2, WholeWord } from "lucide-react";
import Button from "../Button/Button";
import { ServiceItem } from "../../types";
import { alternatingAdminListRowBg } from "../../utils/listRowStripes";
import { cn } from "../../utils/cnHelper";
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
  /** Shown under the title for songs when stored metadata includes an artist (e.g. lyrics import). */
  artistName?: string;
  /** When false, hide add-to-outline and delete (view-only library access). */
  canMutateLibrary?: boolean;
  /** Songs library: open read-only sections preview for this item. */
  onViewSongSections?: () => void;
};

const FilteredItem = ({
  index,
  item,
  addItemToList,
  setItemToBeDeleted,
  showWords: _showWords,
  searchValue,
  updateShowWords,
  artistName,
  canMutateLibrary = true,
  onViewSongSections,
}: FilteredItemProps) => {
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
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border border-white/5 transition-colors",
        alternatingAdminListRowBg(index),
        "hover:border-white/20",
      )}
    >
      <div className="flex flex-col gap-2 py-1.5 pl-4 pr-2 md:flex-row md:items-center md:gap-2 md:pr-0">
        <div className="flex w-full min-w-0 items-start justify-between gap-2 md:flex-1 md:justify-start md:pr-0">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <HighlightWords
              searchValue={searchValue}
              string={item.name}
              className="text-base"
              highlightWordColor={showWords ? "text-white" : "text-orange-400"}
              nonHighlightWordColor={searchValue ? "text-gray-300" : "text-white"}
              allowPartial
            />
            {artistName ? (
              <p className="truncate text-sm text-gray-400" title={artistName}>
                {artistName}
              </p>
            ) : null}
          </div>
          {canMutateLibrary && (
            <Button
              svg={Trash2}
              variant="tertiary"
              color="red"
              className="shrink-0 md:hidden"
              onClick={() => setItemToBeDeleted(item)}
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 md:ml-auto md:flex-nowrap">
          {matchedWords && (
            <Button
              onClick={() => _updateShowWords()}
              svg={WholeWord}
              color="#fb923c"
              variant="tertiary"
            />
          )}
          {onViewSongSections && (
            <Button
              type="button"
              onClick={onViewSongSections}
              svg={LayoutList}
              variant="tertiary"
              color="#22d3ee"
              aria-label="View lyrics"
            >
              View lyrics
            </Button>
          )}
          {canMutateLibrary && (
            <>
              <Button
                variant="primary"
                color={justAdded ? "#84cc16" : "#22d3ee"}
                className="min-h-6 text-sm leading-3"
                padding="py-1 px-2"
                disabled={justAdded}
                svg={justAdded ? Check : Plus}
                onClick={() => addItem(item)}
              >
                {justAdded ? "Added." : "Add to outline"}
              </Button>
              <Button
                svg={Trash2}
                variant="tertiary"
                color="red"
                className="hidden md:inline-flex"
                onClick={() => setItemToBeDeleted(item)}
              />
            </>
          )}
        </div>
      </div>
      <div>
        <HighlightWords
          searchValue={searchValue}
          string={matchedWords || ""}
          className={cn(
            "px-4 text-sm text-gray-300 transition-all",
            showWordsSection
              ? "max-h-32 overflow-y-auto border-t-2 border-white/10 py-2"
              : "max-h-0",
          )}
        />
      </div>
    </li>
  );
};

export default FilteredItem;
