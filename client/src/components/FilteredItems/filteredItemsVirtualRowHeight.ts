import type { filteredItemsListType } from "./FilteredItems";

export const COLLAPSED_FILTERED_ITEM_ROW_HEIGHT = 44;
export const FILTERED_ITEM_ROW_GAP = 8;
export const EXTERNAL_STATUS_ROW_HEIGHT = 72;
export const EXTERNAL_RESULT_ROW_HEIGHT = 148;

// These estimates only need to be close: each row remeasures itself via the
// virtualizer's ResizeObserver once mounted. Keeping them near the real DOM
// height avoids a visible jump between the estimated and measured layout.
const TITLE_LINE_HEIGHT = 24; // text-base line box
const ARTIST_LINE_HEIGHT = 22; // text-sm line + gap-0.5
const ROW_VERTICAL_PADDING = 12; // py-1.5 (top + bottom)
const ROW_BORDER = 2; // 1px border top + bottom
const ACTION_ROW_HEIGHT = 28; // "Add to outline" button line

const estimateCollapsedHeaderHeight = (
  item: filteredItemsListType,
  hasArtist: boolean,
): number => {
  const titleLines = Math.min(Math.max(1, Math.ceil(item.name.length / 36)), 3);
  const titleBlock =
    titleLines * TITLE_LINE_HEIGHT + (hasArtist ? ARTIST_LINE_HEIGHT : 0);
  return (
    Math.max(titleBlock, ACTION_ROW_HEIGHT) + ROW_VERTICAL_PADDING + ROW_BORDER
  );
};

export const isFilteredItemLyricsExpanded = (
  item: filteredItemsListType,
  globalShowWords: boolean,
): boolean => {
  const matchedWords = item.matchedWords?.trim();
  if (!matchedWords) return false;
  return item.showWords ?? globalShowWords;
};

export const getLibraryItemVirtualKey = (
  item: filteredItemsListType,
  globalShowWords: boolean,
): string => {
  const expanded = isFilteredItemLyricsExpanded(item, globalShowWords);
  return `${item._id}:${expanded ? "open" : "closed"}`;
};

/** Content-aware guess for virtual row height — remeasured after layout. */
export const estimateFilteredItemRowHeight = (
  item: filteredItemsListType | undefined,
  globalShowWords: boolean,
  hasArtist: boolean,
): number => {
  if (!item) return COLLAPSED_FILTERED_ITEM_ROW_HEIGHT;

  const headerHeight = estimateCollapsedHeaderHeight(item, hasArtist);
  const collapsedHeight = Math.max(headerHeight, COLLAPSED_FILTERED_ITEM_ROW_HEIGHT);

  if (!isFilteredItemLyricsExpanded(item, globalShowWords)) {
    return collapsedHeight;
  }

  const matchedWords = item.matchedWords?.trim() ?? "";
  const wordCount = matchedWords
    .replace(/\n/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  const approxLines = Math.min(Math.max(1, Math.ceil(wordCount / 10)), 5);
  const lyricPanelHeight = Math.min(approxLines * 22 + 16, 128);

  return collapsedHeight + lyricPanelHeight + 8;
};
