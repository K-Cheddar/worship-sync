import type {
  Arrangment,
  DBItem,
  ItemSlideType,
  ItemState,
  ServiceItem,
} from "../types";
import { getFormattedSections } from "./overflow";

export const OUTLINE_PREFETCH_WINDOW = 2;
export const OUTLINE_SCROLL_SETTLE_MS = 120;
export const OUTLINE_PIN_THRESHOLD_PX = 8;

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
      isActive: boolean;
      slides: ItemSlideType[];
      startIndex: number;
    }
  | {
      type: "empty";
      listId: string;
      itemId: string;
    };

type ActiveItemSlideSource = {
  _id?: string;
  listId?: string;
  name?: string;
  type?: string;
  slides?: ItemSlideType[];
  arrangements?: Arrangment[];
  selectedArrangement?: number;
};

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
      source.arrangements?.[arrangementIndex]?.slides ?? source.slides ?? []
    );
  }
  return source.slides ?? [];
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
  },
): OutlineSlideSection[] =>
  items.map((item) => {
    const doc = options.docsById.get(item._id);
    const isActive =
      item.listId === options.activeItem.listId &&
      item._id === options.activeItem._id;
    return {
      listId: item.listId,
      itemId: item._id,
      name: isActive ? options.activeItem.name || item.name : item.name,
      type: item.type,
      rev: isActive ? undefined : doc?._rev,
      slides: resolveSlidesForOutlineItem(item, options),
      isActive,
    };
  });

export const buildOutlineVirtualRows = (
  sections: OutlineSlideSection[],
  cols: number,
): OutlineVirtualRow[] => {
  const safeCols = Math.max(1, cols);
  const rows: OutlineVirtualRow[] = [];
  for (const section of sections) {
    rows.push({
      type: "sectionLabel",
      listId: section.listId,
      itemId: section.itemId,
      name: section.name,
      itemType: section.type,
    });
    if (section.slides.length === 0) {
      rows.push({
        type: "empty",
        listId: section.listId,
        itemId: section.itemId,
      });
      continue;
    }
    for (let i = 0; i < section.slides.length; i += safeCols) {
      rows.push({
        type: "tiles",
        listId: section.listId,
        itemId: section.itemId,
        isActive: section.isActive,
        slides: section.slides.slice(i, i + safeCols),
        startIndex: i,
      });
    }
  }
  return rows;
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
