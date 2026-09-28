import { useState } from "react";
import { LayoutList, Plus, Check, Trash2, WholeWord } from "lucide-react";
import Button from "../Button/Button";
import { ServiceItem } from "../../types";
import { alternatingAdminListRowBg } from "../../utils/listRowStripes";
import { cn } from "../../utils/cnHelper";
import {
  getItemTypeLabel,
  iconColorMap,
  svgMap,
} from "../../utils/itemTypeMaps";
import { filteredItemsListType } from "./FilteredItems";
import HighlightWords from "./HighlightWords";

export const FILTERED_ITEM_GRID_COLUMNS =
  "grid gap-1 grid-cols-[44px_minmax(0,1fr)_9rem] md:gap-2 md:grid-cols-[44px_minmax(0,1fr)_15rem]";
export const FILTERED_SONG_GRID_COLUMNS =
  "grid gap-1 grid-cols-[44px_minmax(0,1fr)_9rem] md:gap-2 md:grid-cols-[44px_minmax(0,1fr)_13rem_21rem]";

type FilteredItemProps = {
  index: number;
  /** Index in the filtered library list — used for per-item show/hide lyrics. */
  libraryIndex?: number;
  item: filteredItemsListType;
  addItemToList: (item: ServiceItem) => void;
  setItemToBeDeleted: (item: ServiceItem) => void;
  showWords: boolean;
  searchValue: string;
  updateShowWords: (showWords: boolean, index: number) => void;
  /** Shown under the title for songs when stored metadata includes an artist (e.g. lyrics import). */
  artistName?: string;
  /**
   * When false, hide library delete. Primary add/attach still shows when
   * `showAddButton` is true (attach mode uses add without delete).
   */
  canMutateLibrary?: boolean;
  /** When false, hide the primary add/attach control (view-only library). Default true. */
  showAddButton?: boolean;
  /** Label for the primary action before the brief "Added." confirmation. */
  addButtonLabel?: string;
  /** When false, hide delete controls even if `canMutateLibrary` is true. Default follows canMutateLibrary. */
  showDelete?: boolean;
  /** Songs library: open read-only details, resources, and lyrics for this item. */
  onViewSongSections?: () => void;
  /** Show a separate artist column in the Songs library table. */
  showArtistColumn?: boolean;
};

const FilteredItem = ({
  index,
  libraryIndex,
  item,
  addItemToList,
  setItemToBeDeleted,
  showWords,
  searchValue,
  updateShowWords,
  artistName,
  canMutateLibrary = true,
  showAddButton,
  addButtonLabel = "Add to outline",
  showDelete,
  onViewSongSections,
  showArtistColumn = false,
}: FilteredItemProps) => {
  const [justAdded, setJustAdded] = useState(false);
  const canAdd = showAddButton ?? canMutateLibrary;
  const canDelete = showDelete ?? canMutateLibrary;

  const _updateShowWords = () => {
    updateShowWords(!showWords, libraryIndex ?? index);
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
  const ItemTypeIcon = svgMap.get(item.type);
  const itemTypeLabel = getItemTypeLabel(item.type);

  return (
    <div
      role="listitem"
      className={cn(
        "flex min-h-0 flex-col overflow-hidden border-b border-gray-700 transition-colors hover:bg-cyan-500/10",
        alternatingAdminListRowBg(index),
      )}
    >
      <div
        className={cn(
          "flex flex-col gap-1 py-1 pl-4 pr-4 md:items-center md:gap-2",
          showArtistColumn
            ? FILTERED_SONG_GRID_COLUMNS
            : FILTERED_ITEM_GRID_COLUMNS,
        )}
      >
        <span
          className={cn(
            "col-start-1 row-start-1 flex min-w-0 items-center justify-center",
            showArtistColumn && "row-span-2 md:row-span-1",
          )}
          role="img"
          aria-label={itemTypeLabel}
          title={itemTypeLabel}
        >
          {ItemTypeIcon ? (
            <ItemTypeIcon
              size={18}
              color={iconColorMap.get(item.type)}
              aria-hidden="true"
            />
          ) : null}
        </span>
        <div
          className={cn(
            "col-start-2 row-start-1 flex w-full min-w-0 items-start justify-between gap-2 md:justify-start md:pr-0",
          )}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-0.5" title={item.name}>
            <HighlightWords
              searchValue={searchValue}
              string={item.name.trimStart()}
              className="text-base md:flex-nowrap md:truncate"
              highlightWordColor={showWords ? "text-white" : "text-orange-400"}
              nonHighlightWordColor={searchValue ? "text-gray-300" : "text-white"}
              allowPartial
            />
          </div>
          {canDelete ? (
            <Button
              svg={Trash2}
              variant="tertiary"
              color="red"
              className="shrink-0 md:hidden"
              aria-label={`Delete ${item.name}`}
              onClick={() => setItemToBeDeleted(item)}
            />
          ) : null}
        </div>
        {showArtistColumn ? (
          <p
            className="col-start-2 row-start-2 min-w-0 justify-self-start truncate text-left text-sm text-gray-400 md:col-start-3 md:row-start-1"
            title={artistName || "No artist listed"}
          >
            {artistName || "—"}
          </p>
        ) : null}
        <div
          className={cn(
            "col-start-3 row-start-1 flex flex-wrap items-center justify-end gap-2",
            showArtistColumn
              ? "md:col-start-4 md:row-start-1 md:flex-nowrap md:justify-self-end"
              : "md:col-start-3 md:row-start-1 md:flex-nowrap md:justify-self-end",
          )}
        >
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
              aria-label="View song details"
            >
              View details
            </Button>
          )}
          {canAdd ? (
            <Button
              variant="primary"
              color={justAdded ? "#84cc16" : "#22d3ee"}
              className="min-h-6 text-sm leading-3"
              padding="py-1 px-2"
              disabled={justAdded}
              svg={justAdded ? Check : Plus}
              onClick={() => addItem(item)}
            >
              {justAdded ? "Added." : addButtonLabel}
            </Button>
          ) : null}
          {canDelete ? (
            <Button
              svg={Trash2}
              variant="tertiary"
              color="red"
              className="hidden md:inline-flex"
              aria-label={`Delete ${item.name}`}
              onClick={() => setItemToBeDeleted(item)}
            />
          ) : null}
        </div>
      </div>
      {showWordsSection ? (
        <HighlightWords
          searchValue={searchValue}
          string={matchedWords}
          className="max-h-32 overflow-y-auto border-t-2 border-white/10 px-4 py-2 text-sm text-gray-300"
        />
      ) : null}
    </div>
  );
};

export default FilteredItem;
