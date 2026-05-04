import type PouchDB from "pouchdb-browser";
import type { DBItemListDetails } from "../types";
import type { ServiceOutline } from "../types/importedPlan";

export const persistItemListServiceOutline = async (
  db: PouchDB.Database | undefined,
  itemListId: string | undefined,
  serviceOutline: ServiceOutline,
): Promise<void> => {
  if (!db || !itemListId) return;

  const existingList: DBItemListDetails = await db.get(itemListId);
  await db.put({
    ...existingList,
    serviceOutline,
    updatedAt: new Date().toISOString(),
  });
};
