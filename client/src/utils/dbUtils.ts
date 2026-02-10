import { Cloudinary } from "@cloudinary/url-gen";
import { globalDb } from "../context/controllerInfo";
import {
  updateAllFreeFormDocs,
  updateAllSongDocs,
  updateAllTimerDocs,
} from "../store/allDocsSlice";
import {
  allDocsType,
  CreditsInfo,
  DBAllItems,
  DBCredit,
  DBItem,
  DBItemListDetails,
  DBItemLists,
  DBOverlay,
  ServiceItem,
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
      ...listItems.filter((item) => item.type === "bible")
    );
  }

  const bibleItemsToBeDeleted = bibleItems.filter(
    (bibleItem) =>
      !bibleItemsInLists.some(
        (bibleItemInList) => bibleItemInList._id === bibleItem._id
      )
  );

  if (bibleItemsToBeDeleted.length === 0) return; // nothing to delete

  const updatedItems = items.filter(
    (item) => !bibleItemsToBeDeleted.includes(item)
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
      ...listItems.filter((item) => item.type === "heading")
    );
  }

  const headingsToBeDeleted = headingItems.filter(
    (headingItem) =>
      !headingsInLists.some(
        (headingInList) => headingInList._id === headingItem._id
      )
  );

  if (headingsToBeDeleted.length === 0) return;

  const updatedItems = items.filter(
    (item) => !headingsToBeDeleted.includes(item)
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
  db: PouchDB.Database
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
  overlayIds: string[]
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
  db: PouchDB.Database
): Promise<DBOverlay[]> => {
  const result = (await db.allDocs({
    include_docs: true,
    startkey: "overlay-",
    endkey: "overlay-\uffff",
  })) as allDocsType;
  return result.rows
    .filter(
      (row) =>
        row.doc && (row.doc as { _id: string })._id !== "overlay-templates"
    )
    .map((row) => row.doc as DBOverlay);
};

export const getCreditsByIds = async (
  db: PouchDB.Database,
  creditIds: string[]
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
  credit: CreditsInfo
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

    dispatch(updateAllSongDocs(allSongs));
    dispatch(updateAllFreeFormDocs(allFreeFormDocs));
    dispatch(updateAllTimerDocs(allTimers));
  } catch (error) {
    console.error("Failed to save all songs", error);
  }
};

export const formatAllDocs = async (
  db: PouchDB.Database,
  cloud: Cloudinary
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
        (row.doc as any)?.type === "bible"
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
  cloud: Cloudinary
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
  cloud: Cloudinary
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
  db: PouchDB.Database
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
          selectedBox
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
      `Migration complete: ${migratedCount} items migrated, ${skippedCount} items skipped`
    );
    return { migratedCount, skippedCount };
  } catch (error) {
    console.error("Failed to migrate free form items", error);
    throw error;
  }
};
