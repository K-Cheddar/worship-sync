import type { DBItem, ServiceItem } from "../types";
import { sortNamesInList } from "./sort";

const songDocToServiceItem = (doc: DBItem): ServiceItem => ({
  _id: doc._id,
  name: doc.name,
  type: "song",
  listId: doc._id,
  background: typeof doc.background === "string" ? doc.background : "",
});

/**
 * Builds the complete song library from the lightweight allItems index and
 * the persisted song documents. Either source can be temporarily partial
 * while a Controller or Service Plan surface is initializing.
 */
export const mergeSongLibraryItems = (
  allItems: ServiceItem[],
  allSongDocs: DBItem[],
): ServiceItem[] => {
  const songsById = new Map(
    allSongDocs.map((doc) => [doc._id, songDocToServiceItem(doc)]),
  );

  for (const item of allItems) {
    if (item.type === "song") songsById.set(item._id, item);
  }

  return sortNamesInList([...songsById.values()]);
};

/**
 * Restores durable song documents that are missing from the lightweight
 * allItems index. Returns the original array when no repair is needed so
 * listeners can avoid redundant writes and sync traffic.
 */
export const reconcileSongLibraryIndex = (
  allItems: ServiceItem[],
  allSongDocs: DBItem[],
): ServiceItem[] => {
  const indexedSongIds = new Set(
    allItems
      .filter((item) => item.type === "song")
      .map((item) => item._id),
  );
  const missingSongDocs = allSongDocs.filter(
    (doc) => doc.type === "song" && !indexedSongIds.has(doc._id),
  );

  if (missingSongDocs.length === 0) return allItems;

  const missingSongItems = missingSongDocs.map(songDocToServiceItem);
  return sortNamesInList([...allItems, ...missingSongItems]);
};
