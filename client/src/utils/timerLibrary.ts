import type { DBItem, ServiceItem } from "../types";
import { sortNamesInList } from "./sort";

const timerDocToServiceItem = (doc: DBItem): ServiceItem => ({
  _id: doc._id,
  name: doc.name,
  type: "timer",
  listId: doc._id,
  background: typeof doc.background === "string" ? doc.background : "",
});

/** Restores valid durable timer docs without replacing existing library rows. */
export const reconcileTimerLibraryIndex = (
  allItems: ServiceItem[],
  allTimerDocs: DBItem[],
): ServiceItem[] => {
  const indexedIds = new Set(allItems.map((item) => item._id));
  const recovered: ServiceItem[] = [];

  for (const doc of allTimerDocs) {
    if (
      doc.type !== "timer" ||
      !doc._id ||
      !doc.name?.trim() ||
      indexedIds.has(doc._id)
    ) {
      continue;
    }
    indexedIds.add(doc._id);
    recovered.push(timerDocToServiceItem(doc));
  }

  return recovered.length === 0
    ? allItems
    : sortNamesInList([...allItems, ...recovered]);
};
