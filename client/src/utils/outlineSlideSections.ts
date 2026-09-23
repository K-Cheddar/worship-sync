import type {
  DBItem,
  ItemSlideType,
  ItemState,
  ServiceItem,
  FormattedSection,
  ShouldSendTo,
} from "../types";
import { getFormattedSections } from "./overflow";

export const OUTLINE_PREFETCH_WINDOW = 2;
export const OUTLINE_SCROLL_SETTLE_MS = 120;
export const OUTLINE_PIN_THRESHOLD_PX = 8;
/** Keep re-applying the collapse/open scroll target while measurements settle. */
export const OUTLINE_INITIAL_ANCHOR_MS = 320;
/** Ignore scroll-pinning while a smooth programmatic scroll is in flight. */
export const OUTLINE_SMOOTH_SCROLL_MS = 450;

export type AllDocsLookup = {
  allSongDocs: DBItem[];
  allFreeFormDocs: DBItem[];
  allTimerDocs: DBItem[];
  allBibleDocs: DBItem[];
};

export type OutlineSlideSection = {
  listId: string;
  itemId: string;
  name: string;
  type: string;
  rev?: string;
  slides: ItemSlideType[];
  isActive: boolean;
  formattedSections?: FormattedSection[];
  shouldSendTo?: ShouldSendTo;
};

export type OutlineSlideSectionCacheEntry = {
  item: ServiceItem;
  listId: string;
  itemId: string;
  source: ActiveItemSlideSource | DBItem | undefined;
  sourceId?: string;
  sourceListId?: string;
  sourceRevision?: string;
  selectedArrangement?: number;
  resolvedSlides: ItemSlideType[];
  resolvedFormattedSections: FormattedSection[];
  resolvedShouldSendTo?: ShouldSendTo;
  section: OutlineSlideSection;
};

export type OutlineVirtualRowCacheEntry = {
  section: OutlineSlideSection;
  listId: string;
  itemId: string;
  name: string;
  itemType: string;
  slides: ItemSlideType[];
  slideCount: number;
  firstSlideId?: string;
  cols: number;
  rows: OutlineVirtualRow[];
};

export type OutlineVirtualRow =
  | {
      type: "sectionLabel";
      listId: string;
      itemId: string;
      name: string;
      itemType: string;
    }
  | {
      type: "tiles";
      listId: string;
      itemId: string;
      startIndex: number;
      count: number;
      firstSlideId?: string;
    }
  | {
      type: "empty";
      listId: string;
      itemId: string;
    };

type ActiveItemSlideSource = {
  _id?: string;
  listId?: string;
  _rev?: string;
  name?: string;
  type?: string;
  slides?: ItemSlideType[];
  arrangements?: { slides?: ItemSlideType[] }[];
  selectedArrangement?: number;
  formattedSections?: FormattedSection[];
  shouldSendTo?: ShouldSendTo;
};

const EMPTY_ITEM_SLIDES: ItemSlideType[] = [];
const EMPTY_FORMATTED_SECTIONS: FormattedSection[] = [];

/**
 * Route for an outline item on a given controller.
 *
 * `basePath` defaults to the main controller so existing callers are unchanged.
 * Auxiliary controllers live under their own path, and a hardcoded
 * "/controller" here would throw their operator out of the surface they are
 * driving mid-service. Get it from `useControllerBasePath`.
 */
export const getControllerItemPath = (
  item: Pick<ServiceItem, "_id" | "listId">,
  basePath = "/controller",
) =>
  `${basePath}/item/${window.btoa(encodeURI(item._id))}/${window.btoa(
    encodeURI(item.listId),
  )}`;

export const getNonHeadingOutlineItems = (
  list: ServiceItem[] | undefined,
): ServiceItem[] => (list ?? []).filter((item) => item.type !== "heading");

export const buildDocsById = (allDocs: AllDocsLookup | undefined) => {
  const map = new Map<string, DBItem>();
  if (!allDocs) return map;
  for (const doc of [
    ...allDocs.allSongDocs,
    ...allDocs.allFreeFormDocs,
    ...allDocs.allTimerDocs,
    ...allDocs.allBibleDocs,
  ]) {
    if (doc?._id) map.set(doc._id, doc);
  }
  return map;
};

export const mergeDocsById = (
  allDocs: AllDocsLookup | undefined,
  extraDocs?: Map<string, DBItem> | Record<string, DBItem>,
) => {
  const map = buildDocsById(allDocs);
  if (!extraDocs) return map;
  const extras =
    extraDocs instanceof Map ? extraDocs : Object.entries(extraDocs);
  for (const [id, doc] of extras) {
    if (!map.has(id) && doc?._id) map.set(id, doc);
  }
  return map;
};

const resolveSlidesFromDoc = (
  source: ActiveItemSlideSource | DBItem | undefined,
  fallbackType?: string,
): ItemSlideType[] => {
  if (!source) return [];
  const type = source.type || fallbackType;
  if (type === "song") {
    const arrangementIndex = source.selectedArrangement ?? 0;
    return (
      source.arrangements?.[arrangementIndex]?.slides ??
      source.slides ??
      EMPTY_ITEM_SLIDES
    );
  }
  return source.slides ?? EMPTY_ITEM_SLIDES;
};

export const resolveSlidesForOutlineItem = (
  serviceItem: Pick<ServiceItem, "_id" | "listId" | "type">,
  options: {
    activeItem: ActiveItemSlideSource;
    docsById: Map<string, DBItem>;
  },
): ItemSlideType[] => {
  const isActive =
    serviceItem.listId === options.activeItem.listId &&
    serviceItem._id === options.activeItem._id;
  if (isActive) {
    const fromActive = resolveSlidesFromDoc(
      options.activeItem,
      serviceItem.type,
    );
    if (fromActive.length > 0) return fromActive;
  }
  return resolveSlidesFromDoc(
    options.docsById.get(serviceItem._id),
    serviceItem.type,
  );
};

export const buildOutlineSlideSections = (
  items: ServiceItem[],
  options: {
    activeItem: ActiveItemSlideSource;
    docsById: Map<string, DBItem>;
    sectionCache?: Map<string, OutlineSlideSectionCacheEntry>;
  },
): OutlineSlideSection[] =>
  items.map((item) => {
    const doc = options.docsById.get(item._id);
    const isActive =
      item.listId === options.activeItem.listId &&
      item._id === options.activeItem._id;
    const source = isActive ? options.activeItem : doc;
    const resolvedSlides = resolveSlidesForOutlineItem(item, options);
    const resolvedFormattedSections =
      (isActive ? options.activeItem.formattedSections : doc?.formattedSections) ??
      EMPTY_FORMATTED_SECTIONS;
    const resolvedShouldSendTo = isActive
      ? options.activeItem.shouldSendTo
      : doc?.shouldSendTo;
    const sourceListId =
      source && "listId" in source ? source.listId : undefined;
    const cached = options.sectionCache?.get(item.listId);
    if (
      cached?.item === item &&
      cached.listId === item.listId &&
      cached.itemId === item._id &&
      cached.source === source &&
      cached.sourceId === source?._id &&
      cached.sourceListId === sourceListId &&
      cached.sourceRevision === source?._rev &&
      cached.selectedArrangement === source?.selectedArrangement &&
      cached.resolvedSlides === resolvedSlides &&
      cached.resolvedFormattedSections === resolvedFormattedSections &&
      cached.resolvedShouldSendTo === resolvedShouldSendTo
    ) {
      return cached.section;
    }
    const section = {
      listId: item.listId,
      itemId: item._id,
      name: isActive ? options.activeItem.name || item.name : item.name,
      type: item.type,
      rev: isActive ? undefined : doc?._rev,
      slides: resolvedSlides,
      isActive,
      formattedSections: resolvedFormattedSections,
      shouldSendTo: resolvedShouldSendTo,
    };
    options.sectionCache?.set(item.listId, {
      item,
      listId: item.listId,
      itemId: item._id,
      source,
      sourceId: source?._id,
      sourceListId,
      sourceRevision: source?._rev,
      selectedArrangement: source?.selectedArrangement,
      resolvedSlides,
      resolvedFormattedSections,
      resolvedShouldSendTo,
      section,
    });
    return section;
  });

export type OutlineVirtualRowIndex = {
  rowIndexByListId: Map<string, number>;
  rowIndexBySlideId: Map<string, number>;
  rowIndexBySlideIndex: Map<string, number>;
  tileRowsByListId: Map<
    string,
    { startIndex: number; count: number; rowIndex: number }[]
  >;
};

export const getOutlineVirtualRowKey = (row: OutlineVirtualRow): string => {
  if (row.type === "tiles") {
    return `${row.listId}:tiles:${row.startIndex}`;
  }
  return `${row.listId}:${row.type}`;
};

export const buildOutlineVirtualRows = (
  sections: OutlineSlideSection[],
  cols: number,
  rowCache?: Map<string, OutlineVirtualRowCacheEntry>,
): OutlineVirtualRow[] => {
  const safeCols = Math.max(1, cols);
  const rows: OutlineVirtualRow[] = [];
  for (const section of sections) {
    const firstSlideId = section.slides[0]?.id;
    const cached = rowCache?.get(section.listId);
    if (
      cached?.section === section &&
      cached.listId === section.listId &&
      cached.itemId === section.itemId &&
      cached.name === section.name &&
      cached.itemType === section.type &&
      cached.slides === section.slides &&
      cached.slideCount === section.slides.length &&
      cached.firstSlideId === firstSlideId &&
      cached.cols === safeCols
    ) {
      rows.push(...cached.rows);
      continue;
    }
    const sectionRows: OutlineVirtualRow[] = [
      {
        type: "sectionLabel",
        listId: section.listId,
        itemId: section.itemId,
        name: section.name,
        itemType: section.type,
      },
    ];
    if (section.slides.length === 0) {
      sectionRows.push({
        type: "empty",
        listId: section.listId,
        itemId: section.itemId,
      });
    } else {
      for (let i = 0; i < section.slides.length; i += safeCols) {
        sectionRows.push({
          type: "tiles",
          listId: section.listId,
          itemId: section.itemId,
          startIndex: i,
          count: Math.min(safeCols, section.slides.length - i),
          firstSlideId: section.slides[i]?.id,
        });
      }
    }
    rowCache?.set(section.listId, {
      section,
      listId: section.listId,
      itemId: section.itemId,
      name: section.name,
      itemType: section.type,
      slides: section.slides,
      slideCount: section.slides.length,
      firstSlideId,
      cols: safeCols,
      rows: sectionRows,
    });
    rows.push(...sectionRows);
  }
  return rows;
};

export const buildOutlineVirtualRowIndex = (
  rows: OutlineVirtualRow[],
  sectionsByListId?: Map<string, OutlineSlideSection>,
): OutlineVirtualRowIndex => {
  const rowIndexByListId = new Map<string, number>();
  const rowIndexBySlideId = new Map<string, number>();
  const rowIndexBySlideIndex = new Map<string, number>();
  const tileRowsByListId = new Map<
    string,
    { startIndex: number; count: number; rowIndex: number }[]
  >();
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!rowIndexByListId.has(row.listId)) rowIndexByListId.set(row.listId, rowIndex);
    if (row.type !== "tiles") continue;
    const tileRows = tileRowsByListId.get(row.listId) ?? [];
    tileRows.push({ startIndex: row.startIndex, count: row.count, rowIndex });
    tileRowsByListId.set(row.listId, tileRows);
    const slides = sectionsByListId?.get(row.listId)?.slides ?? [];
    for (let offset = 0; offset < row.count; offset += 1) {
      rowIndexBySlideIndex.set(
        `${row.listId}:${row.startIndex + offset}`,
        rowIndex,
      );
      const slideId = slides[row.startIndex + offset]?.id;
      if (slideId) rowIndexBySlideId.set(`${row.listId}:${slideId}`, rowIndex);
    }
  }
  return {
    rowIndexByListId,
    rowIndexBySlideId,
    rowIndexBySlideIndex,
    tileRowsByListId,
  };
};

export const getPrefetchItemIds = (
  items: Pick<ServiceItem, "_id" | "listId">[],
  pinnedListId: string | undefined,
  windowSize = OUTLINE_PREFETCH_WINDOW,
): string[] => {
  if (items.length === 0) return [];
  const foundIndex = items.findIndex((item) => item.listId === pinnedListId);
  const pinnedIndex = foundIndex >= 0 ? foundIndex : 0;
  const start = Math.max(0, pinnedIndex - windowSize);
  const end = Math.min(items.length, pinnedIndex + windowSize + 1);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (let i = start; i < end; i++) {
    const id = items[i]._id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
};

export const getPinnedListIdFromRowOffsets = (
  rows: Pick<OutlineVirtualRow, "listId">[],
  getRowStart: (index: number) => number,
  scrollTop: number,
  threshold = OUTLINE_PIN_THRESHOLD_PX,
): string | undefined => {
  let pinned: string | undefined;
  for (let i = 0; i < rows.length; i++) {
    if (getRowStart(i) <= scrollTop + threshold) {
      pinned = rows[i].listId;
    } else {
      break;
    }
  }
  return pinned;
};

export const getPinnedListIdFromVirtualItems = (
  rows: Pick<OutlineVirtualRow, "listId">[],
  virtualItems: Array<{ index: number; start: number; end?: number; size?: number }>,
  scrollTop: number,
  threshold = OUTLINE_PIN_THRESHOLD_PX,
): string | undefined => {
  let pinned: string | undefined;
  for (const virtualItem of virtualItems) {
    if (virtualItem.start <= scrollTop + threshold) {
      pinned = rows[virtualItem.index]?.listId ?? pinned;
    }
    if (virtualItem.start > scrollTop + threshold) break;
  }
  return pinned;
};

export const captureOutlineScrollAnchorFromVirtualItems = (
  rows: OutlineVirtualRow[],
  virtualItems: Array<{ index: number; start: number; end?: number; size?: number }>,
  scrollTop: number,
): OutlineScrollAnchor | null => {
  const item = virtualItems.find(
    (virtualItem) =>
      (virtualItem.end ?? virtualItem.start + (virtualItem.size ?? 0)) > scrollTop,
  );
  const row = item ? rows[item.index] : undefined;
  if (!item || !row) return null;
  const anchor: OutlineScrollAnchor = {
    listId: row.listId,
    rowType: row.type,
    localOffset: Math.max(0, scrollTop - item.start),
  };
  if (row.type === "tiles") {
    anchor.startIndex = row.startIndex;
    if (row.firstSlideId) anchor.slideId = row.firstSlideId;
  }
  return anchor;
};

/**
 * Viewport anchor for continuous-mode scroll restoration. When remote updates
 * rebuild virtual rows, keep the same on-screen row rather than a raw scrollTop
 * into a list whose offsets just shifted.
 */
export type OutlineScrollAnchor = {
  listId: string;
  rowType: OutlineVirtualRow["type"];
  /** For tiles rows: index of the first slide in that row. */
  startIndex?: number;
  /** Prefer matching by slide id when row startIndex shifts after an edit. */
  slideId?: string;
  localOffset: number;
};

export const captureOutlineScrollAnchor = (
  rows: OutlineVirtualRow[],
  getRowStart: (index: number) => number,
  scrollTop: number,
  sectionsByListId?: Map<string, OutlineSlideSection>,
): OutlineScrollAnchor | null => {
  if (rows.length === 0) return null;
  let rowIndex = 0;
  for (let i = 0; i < rows.length; i++) {
    if (getRowStart(i) <= scrollTop) {
      rowIndex = i;
    } else {
      break;
    }
  }
  const row = rows[rowIndex];
  if (!row) return null;
  const anchor: OutlineScrollAnchor = {
    listId: row.listId,
    rowType: row.type,
    localOffset: scrollTop - getRowStart(rowIndex),
  };
  if (row.type === "tiles") {
    anchor.startIndex = row.startIndex;
    const slideId =
      sectionsByListId?.get(row.listId)?.slides[row.startIndex]?.id ??
      row.firstSlideId;
    if (slideId) anchor.slideId = slideId;
  }
  return anchor;
};

export const resolveOutlineScrollTopFromAnchor = (
  rows: OutlineVirtualRow[],
  getRowStart: (index: number) => number,
  anchor: OutlineScrollAnchor,
  rowIndexIndex?: OutlineVirtualRowIndex,
): number | null => {
  let rowIndex = -1;
  if (anchor.rowType === "tiles" && anchor.slideId) {
    rowIndex =
      rowIndexIndex?.rowIndexBySlideId.get(
        `${anchor.listId}:${anchor.slideId}`,
      ) ?? -1;
  }
  if (rowIndex < 0 && anchor.rowType === "tiles" && anchor.startIndex != null) {
    rowIndex =
      rowIndexIndex?.rowIndexBySlideIndex.get(
        `${anchor.listId}:${anchor.startIndex}`,
      ) ?? -1;
  }
  if (rowIndex < 0) {
    rowIndex = rows.findIndex(
      (row) => row.type === anchor.rowType && row.listId === anchor.listId,
    );
  }
  if (rowIndex < 0) {
    rowIndex = rows.findIndex((row) => row.listId === anchor.listId);
  }
  if (rowIndex < 0) return null;
  return getRowStart(rowIndex) + anchor.localOffset;
};

/**
 * Row rebuilds can change packing and tile height, so restore from a frozen
 * identity rather than a live scrollTop that the browser may have clamped.
 *
 * Prefer the selected slide whenever it can be resolved. When it was visible,
 * retain its approximate row-center position; when it was not visible, the
 * restore phase centers it so row rebuilds cannot lose the selected slide.
 */
export type OutlineSlideFocalPoint =
  | {
      kind: "selected";
      listId: string;
      slideIndex: number;
      /** Row center relative to the viewport before the column reflow. */
      viewportCenter?: number;
    }
  | {
      kind: "viewport";
      anchor: OutlineScrollAnchor;
    };

export const captureOutlineSlideFocalPoint = (
  rows: OutlineVirtualRow[],
  getRowStart: (index: number) => number,
  getRowHeight: (index: number) => number,
  scrollTop: number,
  viewportHeight: number,
  selectedListId: string | undefined,
  selectedSlide: number,
  sectionsByListId?: Map<string, OutlineSlideSection>,
): OutlineSlideFocalPoint | null => {
  if (rows.length === 0) return null;

  if (selectedListId && selectedSlide >= 0 && viewportHeight > 0) {
    const rowIndex = findOutlineRowIndexForItem(
      rows,
      selectedListId,
      selectedSlide,
    );
    if (rowIndex >= 0) {
      const start = getRowStart(rowIndex);
      const rowHeight = getRowHeight(rowIndex);
      const end = start + rowHeight;
      const rowCenter = start + rowHeight / 2 - scrollTop;
      const isVisible =
        start < scrollTop + viewportHeight &&
        end > scrollTop &&
        rowCenter >= 0 &&
        rowCenter <= viewportHeight;
      return {
        kind: "selected",
        listId: selectedListId,
        slideIndex: selectedSlide,
        ...(isVisible
          ? { viewportCenter: rowCenter }
          : {}),
      };
    }
  }

  const anchor = captureOutlineScrollAnchor(
    rows,
    getRowStart,
    scrollTop,
    sectionsByListId,
  );
  if (!anchor) return null;
  return { kind: "viewport", anchor: { ...anchor, localOffset: 0 } };
};

/**
 * Prefer the tile row that contains `slideIndex` so collapsing the editor keeps
 * the operator on the slide they were viewing, not only the section header.
 */
export const findOutlineRowIndexForItem = (
  rows: OutlineVirtualRow[],
  listId: string,
  slideIndex?: number,
  index?: OutlineVirtualRowIndex,
): number => {
  if (slideIndex != null && slideIndex >= 0) {
    const indexedTileIndex = index?.rowIndexBySlideIndex.get(
      `${listId}:${slideIndex}`,
    );
    if (indexedTileIndex != null) return indexedTileIndex;
    const tileRows = index?.tileRowsByListId.get(listId);
    const tileIndex = tileRows?.find(
      (row) => slideIndex >= row.startIndex && slideIndex < row.startIndex + row.count,
    )?.rowIndex ?? -1;
    if (tileIndex >= 0) return tileIndex;
    const fallbackTileIndex = rows.findIndex(
      (row) =>
        row.type === "tiles" &&
        row.listId === listId &&
        slideIndex >= row.startIndex &&
        slideIndex < row.startIndex + row.count,
    );
    if (fallbackTileIndex >= 0) return fallbackTileIndex;
  }
  return index?.rowIndexByListId.get(listId) ?? rows.findIndex(
    (row) => row.type === "sectionLabel" && row.listId === listId,
  );
};

export const prepareItemForEditor = (
  doc: DBItem,
  listId: string,
): Partial<ItemState> => {
  const withSections: DBItem =
    doc.type === "free" &&
    (!doc.formattedSections || doc.formattedSections.length === 0)
      ? {
          ...doc,
          formattedSections: getFormattedSections(doc.slides ?? [], 1),
        }
      : doc;
  return { ...withSections, listId };
};
