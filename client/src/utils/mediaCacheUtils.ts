import {
  Box,
  ItemSlideType,
  ItemProperties,
  DBItem,
  ItemLists,
  DBItemListDetails,
  ServiceItem,
} from "../types";

type PouchMissingDocError = {
  status?: number;
  name?: string;
  reason?: string;
};

// ---------------------------------------------------------------------------
// Box-level extractors
// ---------------------------------------------------------------------------

/**
 * Extract video background URLs from a box.
 * For Mux videos with playbackId, returns the MP4 static rendition URL.
 */
export const extractVideoUrlsFromBox = (box: Box): string[] => {
  const urls: string[] = [];

  if (box.mediaInfo?.type === "video" && box.mediaInfo?.background) {
    if (box.mediaInfo.source === "mux" && box.mediaInfo.muxPlaybackId) {
      urls.push(
        `https://stream.mux.com/${box.mediaInfo.muxPlaybackId}/highest.mp4`
      );
    } else {
      urls.push(box.mediaInfo.background);
    }
  }

  return urls;
};

/**
 * Extract image background URLs from a box.
 * Only includes full HTTP(S) URLs (skips Cloudinary public IDs that need conversion).
 * Also extracts video placeholder images so they are available offline.
 */
export const extractImageUrlsFromBox = (box: Box): string[] => {
  const urls: string[] = [];

  // Video boxes: cache the placeholder / poster image shown before the video loads
  if (box.mediaInfo?.type === "video" && box.mediaInfo.placeholderImage) {
    const ph = box.mediaInfo.placeholderImage;
    if (ph.startsWith("http://") || ph.startsWith("https://")) {
      urls.push(ph);
    }
  }

  // Non-video boxes: cache the background image
  if (box.mediaInfo?.type !== "video" && box.background) {
    if (
      box.background.startsWith("http://") ||
      box.background.startsWith("https://")
    ) {
      urls.push(box.background);
    }
  }

  return urls;
};

/** Extract both video and image URLs from a box. */
export const extractMediaUrlsFromBox = (box: Box): string[] => [
  ...extractVideoUrlsFromBox(box),
  ...extractImageUrlsFromBox(box),
];

// ---------------------------------------------------------------------------
// Slide-level extractors
// ---------------------------------------------------------------------------

export const extractVideoUrlsFromSlide = (slide: ItemSlideType): string[] =>
  slide.boxes.flatMap(extractVideoUrlsFromBox);

// ---------------------------------------------------------------------------
// Item-level extractors (DRY helper)
// ---------------------------------------------------------------------------

/** Internal helper — walks slides + arrangements and applies a box extractor. */
const extractUrlsFromItemBoxes = (
  item: ItemProperties | DBItem,
  boxExtractor: (box: Box) => string[]
): string[] => {
  const urls: string[] = [];
  if (item.slides) {
    for (const slide of item.slides) {
      for (const box of slide.boxes) {
        urls.push(...boxExtractor(box));
      }
    }
  }
  if (item.arrangements) {
    for (const arrangement of item.arrangements) {
      if (arrangement.slides) {
        for (const slide of arrangement.slides) {
          for (const box of slide.boxes) {
            urls.push(...boxExtractor(box));
          }
        }
      }
    }
  }
  return urls;
};

/** Extract all video URLs from an item (slides + arrangements). */
export const extractVideoUrlsFromItem = (
  item: ItemProperties | DBItem
): string[] => extractUrlsFromItemBoxes(item, extractVideoUrlsFromBox);

/** Extract all image URLs from an item (slides + arrangements). */
export const extractImageUrlsFromItem = (
  item: ItemProperties | DBItem
): string[] => extractUrlsFromItemBoxes(item, extractImageUrlsFromBox);

/** Extract all media (video + image) URLs from an item. */
export const extractMediaUrlsFromItem = (
  item: ItemProperties | DBItem
): string[] => extractUrlsFromItemBoxes(item, extractMediaUrlsFromBox);

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

const isMissingDocError = (error: unknown): boolean => {
  const maybeError = error as PouchMissingDocError;
  return (
    maybeError?.status === 404 ||
    maybeError?.name === "not_found" ||
    maybeError?.reason === "deleted"
  );
};

/**
 * Batch-load existing item docs by service items.
 * Missing/deleted docs are expected during normal edits and are skipped.
 */
export const getExistingItemsForServiceItems = async (
  db: PouchDB.Database,
  serviceItems: Pick<ServiceItem, "_id">[]
): Promise<DBItem[]> => {
  const itemIds = [
    ...new Set(serviceItems.map((item) => item._id).filter(Boolean)),
  ];
  if (itemIds.length === 0) return [];

  const result = (await db.allDocs({
    keys: itemIds,
    include_docs: true,
  })) as {
    rows: Array<{
      doc?: DBItem;
      error?: string;
      value?: { deleted?: boolean };
    }>;
  };

  return result.rows
    .filter(
      (row) =>
        row.doc && row.error !== "not_found" && !row.value?.deleted
    )
    .map((row) => row.doc as DBItem);
};

// ---------------------------------------------------------------------------
// Outline-level extractors
// ---------------------------------------------------------------------------

/**
 * Extract all unique video URLs from every item in every outline.
 * @deprecated Use {@link extractAllMediaUrlsFromOutlines} to cache both videos and images.
 */
export const extractAllVideoUrlsFromOutlines = async (
  db: PouchDB.Database
): Promise<Set<string>> =>
  extractAllUrlsFromOutlines(db, extractVideoUrlsFromItem);

/** Extract all unique media (video + image) URLs from every item in every outline. */
export const extractAllMediaUrlsFromOutlines = async (
  db: PouchDB.Database
): Promise<Set<string>> =>
  extractAllUrlsFromOutlines(db, extractMediaUrlsFromItem);

/** Shared implementation for outline scanning. */
const extractAllUrlsFromOutlines = async (
  db: PouchDB.Database,
  itemExtractor: (item: DBItem) => string[]
): Promise<Set<string>> => {
  const urls = new Set<string>();

  try {
    const itemListsResponse = (await db.get("ItemLists")) as ItemLists;
    const itemLists = itemListsResponse?.itemLists || [];

    for (const itemList of itemLists) {
      try {
        const itemListDetails = (await db.get(
          itemList._id
        )) as DBItemListDetails;
        const itemDocs = await getExistingItemsForServiceItems(
          db,
          itemListDetails?.items || []
        );

        for (const item of itemDocs) {
          itemExtractor(item).forEach((url) => urls.add(url));
        }
      } catch (error) {
        if (!isMissingDocError(error)) {
          console.warn(
            `Failed to load item list ${itemList._id}:`,
            error
          );
        }
      }
    }
  } catch (error) {
    console.error("Error extracting media URLs from outlines:", error);
  }

  return urls;
};
