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
