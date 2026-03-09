import { Cloudinary } from "@cloudinary/url-gen";
import { globalDb } from "../context/controllerInfo";
import {
  updateAllBibleDocs,
  updateAllFreeFormDocs,
  updateAllSongDocs,
  updateAllTimerDocs,
} from "../store/allDocsSlice";
import {
  allDocsType,
  Box,
  CreditsInfo,
  CREDIT_HISTORY_ID_PREFIX,
  DBAllItems,
  DBCredit,
  DBCreditHistory,
  DBItem,
  DBItemListDetails,
  DBItemLists,
  DocType,
  DBOverlay,
  DBOverlayHistory,
  ItemSlideType,
  OverlayHistoryKey,
  ServiceItem,
  getCreditHistoryDocId,
  getOverlayHistoryDocId,
  OVERLAY_HISTORY_ID_PREFIX,
  DBDoc,
  DBMedia,
} from "../types";
import { formatItemInfo } from "./formatItemInfo";
import { formatSong, getFormattedSections } from "./overflow";

type propsType = {
  db: PouchDB.Database;
  allItems: DBAllItems;
};

export const deleteUnusedBibleItems = async ({ db, allItems }: propsType) => {
  const items = allItems.items;

  const bibleItems = items.filter((item) => item.type === "bible");

  const allItemLists: DBItemLists | undefined = await db.get("ItemLists");
  const itemLists = allItemLists?.itemLists || [];
  const bibleItemsInLists: ServiceItem[] = [];

  for (const itemList of itemLists) {
    const listDetails: DBItemListDetails = await db.get(itemList._id);
    const listItems = listDetails?.items || [];
    bibleItemsInLists.push(
      ...listItems.filter((item) => item.type === "bible"),
    );
  }

  const bibleItemsToBeDeleted = bibleItems.filter(
    (bibleItem) =>
      !bibleItemsInLists.some(
        (bibleItemInList) => bibleItemInList._id === bibleItem._id,
      ),
  );

  if (bibleItemsToBeDeleted.length === 0) return; // nothing to delete

  const updatedItems = items.filter(
    (item) => !bibleItemsToBeDeleted.includes(item),
  );

  // Remove bible items from all items and delete them individually
  await db.put({
    ...allItems,
    items: updatedItems,
    updatedAt: new Date().toISOString(),
  });
  for (const item of bibleItemsToBeDeleted) {
    try {
      const doc = await db.get(item._id);
      db.remove(doc);
    } catch (error) {
      console.error(error);
    }
  }
};

export const deleteUnusedHeadings = async ({ db, allItems }: propsType) => {
  const items = allItems.items;
  const headingItems = items.filter((item) => item.type === "heading");

  const allItemLists: DBItemLists | undefined = await db.get("ItemLists");
  const itemLists = allItemLists?.itemLists || [];
  const headingsInLists: ServiceItem[] = [];

  for (const itemList of itemLists) {
    const listDetails: DBItemListDetails = await db.get(itemList._id);
    const listItems = listDetails?.items || [];
    headingsInLists.push(
      ...listItems.filter((item) => item.type === "heading"),
    );
  }

  const headingsToBeDeleted = headingItems.filter(
    (headingItem) =>
      !headingsInLists.some(
        (headingInList) => headingInList._id === headingItem._id,
      ),
  );

  if (headingsToBeDeleted.length === 0) return;

  const updatedItems = items.filter(
    (item) => !headingsToBeDeleted.includes(item),
  );

  await db.put({
    ...allItems,
    items: updatedItems,
    updatedAt: new Date().toISOString(),
  });
  for (const item of headingsToBeDeleted) {
    try {
      const doc = await db.get(item._id);
      db.remove(doc);
    } catch (error) {
      console.error(error);
    }
  }
};

/**
 * Returns a map of overlay id -> list of item list names that include that overlay.
 */
export const getOverlayUsageByList = async (
  db: PouchDB.Database,
): Promise<Map<string, string[]>> => {
  const usage = new Map<string, string[]>();
  const allItemLists: DBItemLists | undefined = await db.get("ItemLists");
  const itemLists = allItemLists?.itemLists || [];
  for (const itemList of itemLists) {
    try {
      const details: DBItemListDetails = await db.get(itemList._id);
      const overlayIds = details?.overlays || [];
      const name = details?.name ?? itemList.name;
      for (const id of overlayIds) {
        const existing = usage.get(id) ?? [];
        if (!existing.includes(name)) existing.push(name);
        usage.set(id, existing);
      }
    } catch {
      // skip missing or invalid list docs
    }
  }
  return usage;
};

export const getOverlaysByIds = async (
  db: PouchDB.Database,
  overlayIds: string[],
): Promise<DBOverlay[]> => {
  if (overlayIds.length === 0) return [];
  const keys = overlayIds.map((id) => `overlay-${id}`);
  const result = (await db.allDocs({
    keys,
    include_docs: true,
  })) as { rows: { doc?: DBOverlay }[] };
  return result.rows
    .filter((row) => row.doc != null)
    .map((row) => row.doc as DBOverlay);
};

export const getAllOverlayDocs = async (
  db: PouchDB.Database,
): Promise<DBOverlay[]> => {
  const result = (await db.allDocs({
    include_docs: true,
    startkey: "overlay-",
    endkey: "overlay-\uffff",
  })) as allDocsType;
  return result.rows
    .filter(
      (row) =>
        row.doc &&
        (row.doc as { _id: string })._id !== "overlay-templates" &&
        !(row.doc as { _id: string })._id.startsWith("overlay-history-"),
    )
    .map((row) => row.doc as DBOverlay);
};

/** Load all credit history docs and return a map of heading -> lines. */
export const getAllCreditsHistory = async (
  db: PouchDB.Database,
): Promise<Record<string, string[]>> => {
  const result = await db.allDocs({
    startkey: CREDIT_HISTORY_ID_PREFIX,
    endkey: CREDIT_HISTORY_ID_PREFIX + "\uffff",
    include_docs: true,
  });
  const map: Record<string, string[]> = {};
  for (const row of result.rows) {
    const doc = row.doc as DBCreditHistory | undefined;
    if (!doc || !Array.isArray(doc.lines)) continue;
    const heading =
      doc.heading ??
      decodeURIComponent(doc._id.slice(CREDIT_HISTORY_ID_PREFIX.length));
    map[heading] = doc.lines;
  }
  return map;
};

/** Persist credit history docs for the given headings. Call after dispatch(updatePublishedCreditsList()) so creditsHistory in state is updated. */
export const putCreditHistoryDocs = async (
  db: PouchDB.Database,
  creditsHistory: Record<string, string[]>,
  headings: string[],
): Promise<void> => {
  const now = new Date().toISOString();
  for (const heading of headings) {
    const lines = creditsHistory[heading];
    if (!lines?.length) continue;
    const id = getCreditHistoryDocId(heading);
    let doc: DBCreditHistory;
    try {
      const existing = (await db.get(id)) as DBCreditHistory;
      doc = {
        ...existing,
        heading,
        lines,
        updatedAt: now,
      };
    } catch {
      doc = {
        _id: id,
        heading,
        lines,
        createdAt: now,
        updatedAt: now,
        docType: "credit-history",
      };
    }
    await db.put(doc);
  }
};

/** Persist a single credit history doc. Call when user edits a history entry in the drawer. */
export const putCreditHistoryDoc = async (
  db: PouchDB.Database,
  heading: string,
  lines: string[],
): Promise<void> => {
  const now = new Date().toISOString();
  const id = getCreditHistoryDocId(heading);
  let doc: DBCreditHistory;
  try {
    const existing = (await db.get(id)) as DBCreditHistory;
    doc = {
      ...existing,
      heading,
      lines,
      updatedAt: now,
    };
  } catch {
    doc = {
      _id: id,
      heading,
      lines,
      createdAt: now,
      updatedAt: now,
      docType: "credit-history",
    };
  }
  await db.put(doc);
};

/** Remove a credit history doc by heading. Call when user deletes a history entry from the drawer. */
export const removeCreditHistoryDoc = async (
  db: PouchDB.Database,
  heading: string,
): Promise<void> => {
  const id = getCreditHistoryDocId(heading);
  try {
    const doc = await db.get(id);
    await db.remove(doc);
  } catch (e: unknown) {
    if ((e as { status?: number }).status !== 404) throw e;
  }
};

/** Load all overlay history docs and return a map of key -> values. */
export const getAllOverlayHistory = async (
  db: PouchDB.Database,
): Promise<Record<string, string[]>> => {
  const result = await db.allDocs({
    startkey: OVERLAY_HISTORY_ID_PREFIX,
    endkey: OVERLAY_HISTORY_ID_PREFIX + "\uffff",
    include_docs: true,
  });
  const map: Record<string, string[]> = {};
  for (const row of result.rows) {
    const doc = row.doc as DBOverlayHistory | undefined;
    if (!doc || !Array.isArray(doc.values)) continue;
    const key =
      doc.key ??
      decodeURIComponent(doc._id.slice(OVERLAY_HISTORY_ID_PREFIX.length));
    map[key] = doc.values;
  }
  return map;
};

/** Persist overlay history docs for the given keys. */
export const putOverlayHistoryDocs = async (
  db: PouchDB.Database,
  overlayHistory: Record<string, string[]>,
  keys: string[],
): Promise<void> => {
  const now = new Date().toISOString();
  for (const key of keys) {
    const values = overlayHistory[key];
    if (!values?.length) continue;
    const id = getOverlayHistoryDocId(key as OverlayHistoryKey);
    let doc: DBOverlayHistory;
    try {
      const existing = (await db.get(id)) as DBOverlayHistory;
      doc = {
        ...existing,
        key: key as OverlayHistoryKey,
        values,
        updatedAt: now,
      };
    } catch {
      doc = {
        _id: id,
        key: key as OverlayHistoryKey,
        values,
        createdAt: now,
        updatedAt: now,
        docType: "overlay-history",
      };
    }
    await db.put(doc);
  }
};

/** Persist a single overlay history doc. */
export const putOverlayHistoryDoc = async (
  db: PouchDB.Database,
  key: string,
  values: string[],
): Promise<void> => {
  const now = new Date().toISOString();
  const id = getOverlayHistoryDocId(key as OverlayHistoryKey);
  let doc: DBOverlayHistory;
  try {
    const existing = (await db.get(id)) as DBOverlayHistory;
    doc = {
      ...existing,
      key: key as OverlayHistoryKey,
      values,
      updatedAt: now,
    };
  } catch {
    doc = {
      _id: id,
      key: key as OverlayHistoryKey,
      values,
      createdAt: now,
      updatedAt: now,
      docType: "overlay-history",
    };
  }
  await db.put(doc);
};

/** Remove an overlay history doc by key. */
export const removeOverlayHistoryDoc = async (
  db: PouchDB.Database,
  key: string,
): Promise<void> => {
  const id = getOverlayHistoryDocId(key as OverlayHistoryKey);
  try {
    const doc = await db.get(id);
    await db.remove(doc);
  } catch (e: unknown) {
    if ((e as { status?: number }).status !== 404) throw e;
  }
};

export const getCreditsByIds = async (
  db: PouchDB.Database,
  creditIds: string[],
): Promise<CreditsInfo[]> => {
  if (creditIds.length === 0) return [];
  const keys = creditIds.map((id) => `credit-${id}`);
  const result = (await db.allDocs({
    keys,
    include_docs: true,
  })) as { rows: { doc?: DBCredit }[] };
  const byId = new Map<string, CreditsInfo>();
  for (const row of result.rows) {
    const doc = row.doc;
    if (doc && doc.id != null) {
      byId.set(doc.id, {
        id: doc.id,
        heading: doc.heading,
        text: doc.text,
        hidden: doc.hidden,
      });
    }
  }
  return creditIds
    .map((id) => byId.get(id))
    .filter((c): c is CreditsInfo => c != null);
};

/**
 * Persist a single credit to the db (get-then-put; does not touch _rev). Returns the doc for broadcasting, or null on error.
 */
export const putCreditDoc = async (
  db: PouchDB.Database,
  credit: CreditsInfo,
): Promise<DBCredit | null> => {
  try {
    const existing: DBCredit = await db.get(`credit-${credit.id}`);
    existing.heading = credit.heading;
    existing.text = credit.text;
    existing.hidden = credit.hidden;
    existing.updatedAt = new Date().toISOString();
    await db.put(existing);
    return existing;
  } catch (e) {
    console.error("putCreditDoc failed", credit.id, e);
    return null;
  }
};

export const updateAllDocs = async (dispatch: Function) => {
  if (!globalDb) return;
  try {
    const allDocs: allDocsType = (await globalDb.allDocs({
      include_docs: true,
    })) as allDocsType;
    const allSongs = allDocs.rows
      .filter((row) => (row.doc as any)?.type === "song")
      .map((row) => row.doc as DBItem);

    const allFreeFormDocs = allDocs.rows
      .filter((row) => (row.doc as any)?.type === "free")
      .map((row) => row.doc as DBItem);

    const allTimers = allDocs.rows
      .filter((row) => (row.doc as any)?.type === "timer")
      .map((row) => row.doc as DBItem);

    const allBibles = allDocs.rows
      .filter((row) => (row.doc as any)?.type === "bible")
      .map((row) => row.doc as DBItem);

    dispatch(updateAllSongDocs(allSongs));
    dispatch(updateAllFreeFormDocs(allFreeFormDocs));
    dispatch(updateAllTimerDocs(allTimers));
    dispatch(updateAllBibleDocs(allBibles));
  } catch (error) {
    console.error("Failed to save all docs", error);
  }
};

export const formatAllDocs = async (
  db: PouchDB.Database,
  cloud: Cloudinary,
) => {
  if (!db) return;
  try {
    const allDocs: allDocsType = (await db.allDocs({
      include_docs: true,
    })) as allDocsType;

    const allItems = allDocs.rows.filter(
      (row) =>
        (row.doc as any)?.type === "song" ||
        (row.doc as any)?.type === "free" ||
        (row.doc as any)?.type === "timer" ||
        (row.doc as any)?.type === "bible",
    );

    for (const item of allItems) {
      try {
        const formattedItem = formatItemInfo(item.doc as DBItem, cloud);
        const updatedItem = {
          ...item.doc,
          name: formattedItem.name,
          background: formattedItem.background,
          arrangements: formattedItem.arrangements,
          selectedArrangement: formattedItem.selectedArrangement,
          slides: formattedItem.slides,
          timerInfo: formattedItem.timerInfo,
          bibleInfo: formattedItem.bibleInfo,
          shouldSendTo: formattedItem.shouldSendTo,
          updatedAt: new Date().toISOString(),
        };
        if (item.doc) {
          await db.put(updatedItem);
        }
        console.log("formattedItem", updatedItem);
      } catch (error) {
        console.log("Failed to format item", item.doc);
        console.error("Failed to format item", error);
      }
    }
  } catch (error) {
    console.error("Failed to format all items", error);
  }
};

export const formatAllSongs = async (
  db: PouchDB.Database,
  cloud: Cloudinary,
) => {
  if (!db) return;
  try {
    const allDocs: allDocsType = (await db.allDocs({
      include_docs: true,
    })) as allDocsType;
    const allSongs = allDocs.rows
      .filter((row) => (row.doc as any)?.type === "song")
      .map((row) => row.doc as DBItem);

    for (const song of allSongs) {
      const retrievedSong: DBItem | undefined = await db.get(song._id);
      const formattedItem = formatItemInfo(retrievedSong, cloud);
      const formattedSong = formatSong(formattedItem);
      const updatedItem = {
        ...retrievedSong,
        name: formattedSong.name,
        background: formattedSong.background,
        arrangements: formattedSong.arrangements,
        selectedArrangement: formattedSong.selectedArrangement,
        slides: formattedSong.slides,
        timerInfo: formattedSong.timerInfo,
        bibleInfo: formattedSong.bibleInfo,
        updatedAt: new Date().toISOString(),
      };
      if (retrievedSong) {
        await db.put(updatedItem);
      }
      console.log("formattedSong", formattedSong);
    }
  } catch (error) {
    console.error("Failed to format all songs", error);
  }
};

export const formatAllItems = async (
  db: PouchDB.Database,
  cloud: Cloudinary,
) => {
  if (!db) return;
  try {
    const allItems: DBAllItems | undefined = await db.get("allItems");
    const formattedItems = allItems?.items.map((item) => {
      const updatedBackground =
        item.background?.includes("http") || !item.background
          ? item.background
          : `https://res.cloudinary.com/portable-media/image/upload/v1/${item.background}`;
      return {
        ...item,
        background: updatedBackground,
      };
    });
    await db.put({
      ...allItems,
      items: formattedItems,
      updatedAt: new Date().toISOString(),
    });
    console.log("formattedItems", formattedItems);
  } catch (error) {
    console.error("Failed to format all items", error);
  }
};

/**
 * Migration function to add formattedSections to all existing free form items.
 * This should be run once to migrate existing data.
 */
export const migrateFreeFormItemsToFormattedSections = async (
  db: PouchDB.Database,
) => {
  if (!db) return;
  try {
    const allDocs: allDocsType = (await db.allDocs({
      include_docs: true,
    })) as allDocsType;

    const allFreeFormItems = allDocs.rows
      .filter((row) => (row.doc as any)?.type === "free")
      .map((row) => row.doc as DBItem);

    let migratedCount = 0;
    let skippedCount = 0;

    for (const item of allFreeFormItems) {
      try {
        // Skip if already has formattedSections
        if (item.formattedSections && item.formattedSections.length > 0) {
          skippedCount++;
          continue;
        }

        // Get the item with all its data
        const fullItem: DBItem = await db.get(item._id);

        // Calculate formattedSections from existing slides
        // For free form items, selectedBox is typically 1 (the text box)
        const selectedBox = 1;
        const formattedSections = getFormattedSections(
          fullItem.slides || [],
          selectedBox,
        );

        // Update the item with formattedSections
        const updatedItem: DBItem = {
          ...fullItem,
          formattedSections,
          updatedAt: new Date().toISOString(),
        };

        await db.put(updatedItem);
        migratedCount++;
        console.log(`Migrated item: ${fullItem.name}`);
      } catch (error) {
        console.error(`Failed to migrate item ${item._id}:`, error);
      }
    }

    console.log(
      `Migration complete: ${migratedCount} items migrated, ${skippedCount} items skipped`,
    );
    return { migratedCount, skippedCount };
  } catch (error) {
    console.error("Failed to migrate free form items", error);
    throw error;
  }
};

/** Old scale to new: stored value was (fontSize * 200/4.5) px; new stored value is fontSize in px = old * 4.5 */
const FONT_SIZE_MIGRATION_FACTOR = 4.5;

function migrateBoxFontSize(box: { fontSize?: number }): { fontSize?: number } {
  if (box.fontSize == null) return box;
  return {
    ...box,
    fontSize: Math.round(box.fontSize * FONT_SIZE_MIGRATION_FACTOR),
  };
}

function migrateSlideFontSizes(slide: ItemSlideType): ItemSlideType {
  return {
    ...slide,
    boxes: slide.boxes?.map(
      (b) => migrateBoxFontSize(b) as ItemSlideType["boxes"][0],
    ),
    monitorCurrentBandBoxes: slide.monitorCurrentBandBoxes?.map(
      (b) => migrateBoxFontSize(b) as ItemSlideType["boxes"][0],
    ),
    monitorNextBandBoxes: slide.monitorNextBandBoxes?.map(
      (b) => migrateBoxFontSize(b) as ItemSlideType["boxes"][0],
    ),
  };
}

/**
 * Migration: convert item box font sizes from multiplier scale to stored pixels.
 * Old: fontSize * (200/4.5) = display px. New: fontSize is stored as px (old * 4.5).
 * Run once per database to convert existing items to pixel-stored font sizes.
 */
export const migrateFontSizesToPixels = async (
  db: PouchDB.Database,
): Promise<{ migratedCount: number; errorCount: number }> => {
  if (!db) return { migratedCount: 0, errorCount: 0 };
  try {
    const allDocs: allDocsType = (await db.allDocs({
      include_docs: true,
    })) as allDocsType;
    const itemRows = allDocs.rows.filter(
      (row) =>
        (row.doc as { type?: string })?.type === "song" ||
        (row.doc as { type?: string })?.type === "free" ||
        (row.doc as { type?: string })?.type === "timer" ||
        (row.doc as { type?: string })?.type === "bible",
    );
    let migratedCount = 0;
    let errorCount = 0;
    for (const row of itemRows) {
      const doc = row.doc as DBItem;
      if (!doc) continue;
      try {
        const updated: DBItem = {
          ...doc,
          slides: (doc.slides ?? []).map(migrateSlideFontSizes),
          arrangements: (doc.arrangements ?? []).map((arr) => ({
            ...arr,
            slides: (arr.slides ?? []).map(migrateSlideFontSizes),
          })),
          updatedAt: new Date().toISOString(),
        };
        await db.put(updated);
        migratedCount++;
      } catch (e) {
        console.error("migrateFontSizesToPixels item failed", doc?._id, e);
        errorCount++;
      }
    }
    console.log(
      `migrateFontSizesToPixels: ${migratedCount} items updated, ${errorCount} errors`,
    );
    return { migratedCount, errorCount };
  } catch (error) {
    console.error("migrateFontSizesToPixels failed", error);
    throw error;
  }
};

const FONT_SONG_FIRST_SLIDE = 180;
const FONT_SONG_REST = 108;
const FONT_BIBLE_FIRST_SLIDE = 180;
const FONT_BIBLE_BOX1 = 108;
const FONT_BIBLE_BOX2 = 90;
const FONT_FREE_ALL = 108;
const FONT_TIMER_ALL = 180;

function setBoxFontSize(box: Box, px: number): Box {
  return { ...box, fontSize: px };
}

function migrateSlideFontSizesToDefaults(
  slide: ItemSlideType,
  itemType: string,
  slideIndex: number,
): ItemSlideType {
  const boxes = slide.boxes ?? [];
  if (itemType === "song") {
    const px = slideIndex === 0 ? FONT_SONG_FIRST_SLIDE : FONT_SONG_REST;
    return {
      ...slide,
      boxes: boxes.map((b) => setBoxFontSize(b, px)),
    };
  }
  if (itemType === "bible") {
    if (slideIndex === 0) {
      return {
        ...slide,
        boxes: boxes.map((b) => setBoxFontSize(b, FONT_BIBLE_FIRST_SLIDE)),
      };
    }
    const newBoxes = boxes.map((b, i) => {
      if (i === 1) return setBoxFontSize(b, FONT_BIBLE_BOX1);
      if (i === 2) return setBoxFontSize(b, FONT_BIBLE_BOX2);
      return b;
    });
    return { ...slide, boxes: newBoxes };
  }
  if (itemType === "free") {
    return {
      ...slide,
      boxes: boxes.map((b) => setBoxFontSize(b, FONT_FREE_ALL)),
    };
  }
  if (itemType === "timer") {
    return {
      ...slide,
      boxes: boxes.map((b) => setBoxFontSize(b, FONT_TIMER_ALL)),
    };
  }
  return slide;
}

/**
 * Migration: set font sizes to default values by item type.
 * Songs: 1st slide 180px, rest 100px. Bible: 1st slide 180px; rest boxes[1]=100, boxes[2]=90.
 * Free form: all boxes 100px. Timers: all boxes 180px.
 * Processes in batches of 40; pauses 3s after each batch. Logs each document updated.
 */
export const migrateFontSizesToDefaults = async (
  db: PouchDB.Database,
): Promise<{ migratedCount: number; errorCount: number }> => {
  if (!db) return { migratedCount: 0, errorCount: 0 };
  try {
    const allDocs: allDocsType = (await db.allDocs({
      include_docs: true,
    })) as allDocsType;
    const itemRows = allDocs.rows.filter(
      (row) =>
        (row.doc as { type?: string })?.type === "song" ||
        (row.doc as { type?: string })?.type === "free" ||
        (row.doc as { type?: string })?.type === "timer" ||
        (row.doc as { type?: string })?.type === "bible",
    );
    let migratedCount = 0;
    let errorCount = 0;
    for (const row of itemRows) {
      const doc = row.doc as DBItem;
      if (!doc) continue;
      const itemType = doc.type;
      try {
        const updated: DBItem = {
          ...doc,
          slides: (doc.slides ?? []).map((slide, i) =>
            migrateSlideFontSizesToDefaults(slide, itemType, i),
          ),
          arrangements: (doc.arrangements ?? []).map((arr) => ({
            ...arr,
            slides: (arr.slides ?? []).map((slide, i) =>
              migrateSlideFontSizesToDefaults(slide, itemType, i),
            ),
          })),
          updatedAt: new Date().toISOString(),
        };
        await db.put(updated);
        migratedCount++;
        console.log(
          `migrateFontSizesToDefaults: updated ${doc._id} (${itemType}) "${doc.name}"`,
        );
      } catch (e) {
        console.error("migrateFontSizesToDefaults item failed", doc?._id, e);
        errorCount++;
      }
    }
    console.log(
      `migrateFontSizesToDefaults: ${migratedCount} documents updated, ${errorCount} errors`,
    );
    return { migratedCount, errorCount };
  } catch (error) {
    console.error("migrateFontSizesToDefaults failed", error);
    throw error;
  }
};

const ITEM_TYPES = ["song", "free", "bible", "timer", "image"] as const;

function inferDocType(
  doc: PouchDB.Core.IdMeta & Record<string, unknown>,
): DocType {
  const id = doc._id;
  if (id === "allItems") return "allItems";
  if (id === "ItemLists") return "itemLists";
  if (id === "credits") return "credits";
  if (id === "media") return "media";
  if (id === "preferences") return "preferences";
  if (id === "overlay-templates") return "overlayTemplates";
  if (id === "services") return "services";
  if (typeof id === "string" && id.startsWith(OVERLAY_HISTORY_ID_PREFIX))
    return "overlay-history";
  if (typeof id === "string" && id.startsWith(CREDIT_HISTORY_ID_PREFIX))
    return "credit-history";
  if (typeof id === "string" && id.startsWith("credit-")) return "credit";
  if (typeof id === "string" && id.startsWith("overlay-")) return "overlay";
  const type = doc.type as string | undefined;
  if (type === "heading") return "heading";
  if (type && ITEM_TYPES.includes(type as (typeof ITEM_TYPES)[number]))
    return "item";
  if (
    Array.isArray((doc as DBItemListDetails).items) &&
    Array.isArray((doc as DBItemListDetails).overlays) &&
    id !== "ItemLists"
  ) {
    return "itemListDetails";
  }
  return "unknown";
}

/**
 * Migration: set docType on every document that is missing it or has a wrong value.
 * Run once per database. Call from console or a one-off UI: migrateDocTypes(db).
 */
export const migrateDocTypes = async (
  db: PouchDB.Database,
): Promise<{
  updatedCount: number;
  errorCount: number;
  skippedCount: number;
}> => {
  if (!db) return { updatedCount: 0, errorCount: 0, skippedCount: 0 };
  try {
    const result = (await db.allDocs({ include_docs: true })) as allDocsType;
    let updatedCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    for (const row of result.rows) {
      const doc = row.doc as DBDoc | undefined;
      if (!doc || doc._id.startsWith("_design/")) {
        skippedCount++;
        continue;
      }
      const inferred: DocType = inferDocType(doc);
      const current = doc.docType as DocType | undefined;
      if (current === inferred) {
        skippedCount++;
        continue;
      }
      try {
        const updated: DBDoc = {
          ...doc,
          docType: inferred,
          updatedAt: new Date().toISOString(),
        };
        await db.put(updated);
        updatedCount++;
        console.log(`migrateDocTypes: set docType="${inferred}" on ${doc._id}`);
      } catch (e) {
        console.error(`migrateDocTypes failed for ${doc._id}`, e);
        errorCount++;
      }
    }
    console.log(
      `migrateDocTypes: ${updatedCount} updated, ${skippedCount} skipped, ${errorCount} errors`,
    );
    return { updatedCount, errorCount, skippedCount };
  } catch (error) {
    console.error("migrateDocTypes failed", error);
    throw error;
  }
};
