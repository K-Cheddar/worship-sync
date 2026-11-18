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
import Checkbox from "../Checkbox/Checkbox";
import type { ItemLibraryAuditDisplay } from "../../utils/itemLibraryPresentation";

export const FILTERED_ITEM_GRID_COLUMNS =
  "grid gap-1 grid-cols-[20px_minmax(0,1fr)_9rem] md:gap-2 md:grid-cols-[20px_minmax(0,1fr)_15rem]";
export const FILTERED_DETAILS_GRID_COLUMNS =
  "grid gap-1 grid-cols-[20px_minmax(0,1fr)_9rem] md:gap-2 md:grid-cols-[20px_minmax(0,1fr)_21rem]";
export const FILTERED_LIBRARY_GRID_COLUMNS =
  "grid gap-1 grid-cols-[20px_minmax(0,1fr)_5rem_6rem] md:gap-2 md:grid-cols-[20px_minmax(0,2fr)_minmax(0,1.1fr)_minmax(0,1fr)_20rem]";
export const FILTERED_LIBRARY_SELECTION_GRID_COLUMNS =
  "grid gap-1 grid-cols-[24px_20px_minmax(0,1fr)_5rem_6rem] md:gap-2 md:grid-cols-[24px_20px_minmax(0,2fr)_minmax(0,1.1fr)_minmax(0,1fr)_20rem]";

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
  /** Open the existing details viewer for this item. */
  onViewDetails?: () => void;
  viewDetailsAriaLabel?: string;
  /** Use the wider action track needed by song and custom-item details. */
  useDetailsGrid?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  onSelectionChange?: (selected: boolean) => void;
  /** Enables the Type, Name, Updated, and Updated by library columns. */
  libraryColumns?: boolean;
  auditDisplay?: ItemLibraryAuditDisplay;
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
  onViewDetails,
  viewDetailsAriaLabel = "View song details",
  useDetailsGrid = false,
  selectionMode = false,
  selected = false,
  onSelectionChange,
  libraryColumns = false,
  auditDisplay,
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
  let rowColumns = FILTERED_ITEM_GRID_COLUMNS;
  if (useDetailsGrid) rowColumns = FILTERED_DETAILS_GRID_COLUMNS;
  if (libraryColumns) {
    rowColumns = selectionMode
      ? FILTERED_LIBRARY_SELECTION_GRID_COLUMNS
      : FILTERED_LIBRARY_GRID_COLUMNS;
  } else if (selectionMode && useDetailsGrid) {
    rowColumns = "grid gap-1 grid-cols-[24px_20px_minmax(0,1fr)_9rem] md:gap-2 md:grid-cols-[24px_20px_minmax(0,1fr)_21rem]";
  } else if (selectionMode) {
    rowColumns = "grid gap-1 grid-cols-[24px_20px_minmax(0,1fr)_9rem] md:gap-2 md:grid-cols-[24px_20px_minmax(0,1fr)_15rem]";
  }

  return (
    <div
      role="listitem"
      data-item-id={item._id}
      className={cn(
        "flex min-h-0 flex-col overflow-hidden border-b border-gray-700 transition-colors hover:bg-cyan-500/10",
        alternatingAdminListRowBg(index),
      )}
    >
      <div
        className={cn(
          "grid items-center gap-1 py-1 pl-4 pr-4 md:gap-2",
          rowColumns,
        )}
      >
        {selectionMode ? (
          <Checkbox
            checked={selected}
            onCheckedChange={(checked) => onSelectionChange?.(checked)}
            aria-label={`Select ${item.name}`}
            className="col-start-1 row-start-1 flex items-center justify-center"
          />
        ) : null}
        <span
          className={cn(
            libraryColumns
              ? selectionMode
                ? "col-start-2 row-start-1 flex min-w-0 items-center justify-center"
                : "col-start-1 row-start-1 flex min-w-0 items-center justify-center"
              : selectionMode
              ? "col-start-2 row-start-1 flex min-w-0 items-center justify-center"
              : "col-start-1 row-start-1 flex min-w-0 items-center justify-center",
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
            "row-start-1 flex w-full min-w-0 items-start justify-between gap-2 md:justify-start md:pr-0",
            selectionMode ? "col-start-3" : "col-start-2",
          )}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-0" title={item.name}>
            <HighlightWords
              searchValue={searchValue}
              string={item.name.trimStart()}
              className={cn("text-base md:flex-nowrap md:truncate", libraryColumns && "truncate text-sm md:text-base")}
              highlightWordColor={showWords ? "text-white" : "text-orange-400"}
              nonHighlightWordColor={searchValue ? "text-gray-300" : "text-white"}
              allowPartial
            />
            {item.type === "song" && artistName ? (
              <p className="truncate text-sm text-gray-400" title={artistName}>
                {artistName}
              </p>
            ) : null}
          </div>
          {canDelete && !libraryColumns ? (
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
        {libraryColumns && auditDisplay ? (
          <>
            <div
              className={cn(
                "row-start-1 min-w-0 text-[11px] leading-4 text-gray-400",
                selectionMode ? "col-start-4 md:col-start-4" : "col-start-3 md:col-start-3",
              )}
              title={`Updated: ${auditDisplay.updatedAt}`}
            >
              <span className="block truncate">{auditDisplay.updatedAt}</span>
            </div>
            <div
              className={cn(
                "row-start-1 min-w-0 text-[11px] leading-4 text-gray-400",
                selectionMode ? "col-start-5 md:col-start-5" : "col-start-4 md:col-start-4",
              )}
              title={`Updated by: ${auditDisplay.updatedBy}`}
            >
              <span className="block truncate">{auditDisplay.updatedBy}</span>
            </div>
          </>
        ) : null}
        <div
          className={cn(
            "flex flex-wrap items-center justify-end gap-2",
            libraryColumns
              ? "row-start-2 col-span-3 md:col-span-1 md:row-start-1"
              : "row-start-1 col-span-1",
            libraryColumns
              ? selectionMode
                ? "col-start-3 md:col-start-6"
                : "col-start-2 md:col-start-5"
              : selectionMode
                ? "col-start-4 md:col-start-4"
                : "col-start-3 md:col-start-3",
            "md:flex-nowrap md:justify-self-end",
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
          {onViewDetails && (
            <Button
              type="button"
              onClick={onViewDetails}
              svg={LayoutList}
              variant="tertiary"
              color="#22d3ee"
              className="min-h-7"
              aria-label={viewDetailsAriaLabel}
            >
              <span className="sr-only sm:not-sr-only">View details</span>
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
              className={libraryColumns ? "inline-flex" : "hidden md:inline-flex"}
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
