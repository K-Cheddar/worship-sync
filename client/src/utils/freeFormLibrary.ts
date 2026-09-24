import type { DBItem, ServiceItem } from "../types";
import { sortNamesInList } from "./sort";

export const freeFormDocToServiceItem = (doc: DBItem): ServiceItem => {
  // Local media references are persisted on some older item documents but are
  // not yet part of the shared DBItem type.
  const mediaDoc = doc as DBItem &
    Pick<ServiceItem, "localImage" | "localVideoFile">;
  return {
    _id: doc._id,
    name: doc.name,
    type: "free",
    listId: doc._id,
    background: typeof doc.background === "string" ? doc.background : "",
    ...(mediaDoc.localImage ? { localImage: mediaDoc.localImage } : {}),
    ...(mediaDoc.localVideoFile
      ? { localVideoFile: mediaDoc.localVideoFile }
      : {}),
  };
};

/**
 * Restores durable custom documents missing from allItems without replacing
 * existing rows. Deleted PouchDB documents do not appear in allFreeFormDocs.
 */
export const reconcileFreeFormLibraryIndex = (
  allItems: ServiceItem[],
  allFreeFormDocs: DBItem[],
): ServiceItem[] => {
  const indexedIds = new Set(allItems.map((item) => item._id));
  const recovered: ServiceItem[] = [];

  for (const doc of allFreeFormDocs) {
    if (
      doc.type !== "free" ||
      !doc._id ||
      !doc.name?.trim() ||
      !Array.isArray(doc.slides) ||
      indexedIds.has(doc._id)
    ) {
      continue;
    }
    indexedIds.add(doc._id);
    recovered.push(freeFormDocToServiceItem(doc));
  }

  return recovered.length === 0
    ? allItems
    : sortNamesInList([...allItems, ...recovered]);
};
