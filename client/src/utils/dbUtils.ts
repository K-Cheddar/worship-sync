import { Cloudinary } from "@cloudinary/url-gen";
import { globalDb } from "../context/controllerInfo";
import { globalHostId } from "../context/globalInfo";
import {
  updateAllFreeFormDocs,
  updateAllSongDocs,
  updateAllTimerDocs,
} from "../store/allDocsSlice";
import { setTimersFromDocs } from "../store/timersSlice";
import {
  allDocsType,
  DBAllItems,
  DBItem,
  DBItemListDetails,
  DBItemLists,
  ServiceItem,
  TimerInfo,
} from "../types";
import { formatItemInfo } from "./formatItemInfo";
import { formatSong } from "./overflow";

type propsType = {
  db: PouchDB.Database;
  allItems: DBAllItems;
};

export const deleteUnusedBibleItems = async ({ db, allItems }: propsType) => {
  const items = allItems.items;

  let bibleItems = items.filter((item) => item.type === "bible");

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
  await db.put({ ...allItems, items: updatedItems });
  for (const item of bibleItemsToBeDeleted) {
    try {
      const doc = await db.get(item._id);
      db.remove(doc);
    } catch (error) {
      console.error(error);
    }
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

    const timersFromDocs = allTimers.map((timer) => {
      return {
        ...timer.timerInfo,
        hostId: globalHostId,
      } as TimerInfo;
    });

    dispatch(setTimersFromDocs(timersFromDocs));

    dispatch(updateAllSongDocs(allSongs));
    dispatch(updateAllFreeFormDocs(allFreeFormDocs));
    dispatch(updateAllTimerDocs(allTimers));
  } catch (error) {
    console.error("Failed to save all songs", error);
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
