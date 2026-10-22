import type PouchDB from "pouchdb-browser";
import type {
  DBItemListDetails,
  ServicePlanOutlineBinding,
} from "../types";
import type { ServiceOutline } from "../types/importedPlan";

// Binding writes update the same outline document, so keep their read/modify/
// write sequence ordered per concrete database and outline. Other item-list
// writers can still race; the conflict retry below re-reads their latest doc.
const servicePlanBindingWrites = new WeakMap<object, Map<string, Promise<void>>>();

const isPouchConflict = (error: unknown) =>
  Boolean(error && typeof error === "object" && (
    ("status" in error && error.status === 409) ||
    ("name" in error && error.name === "conflict")
  ));

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

export const persistItemListServicePlanBinding = async (
  db: PouchDB.Database | undefined,
  itemListId: string | undefined,
  binding: ServicePlanOutlineBinding,
): Promise<void> => {
  if (!db || !itemListId) return;

  const database = db as object;
  let writesByOutline = servicePlanBindingWrites.get(database);
  if (!writesByOutline) {
    writesByOutline = new Map();
    servicePlanBindingWrites.set(database, writesByOutline);
  }

  const previousWrite = writesByOutline.get(itemListId) || Promise.resolve();
  const write = previousWrite.catch(() => undefined).then(async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const existingList: DBItemListDetails = await db.get(itemListId);
      try {
        await db.put({
          ...existingList,
          servicePlanBinding: binding,
          updatedAt: new Date().toISOString(),
        });
        return;
      } catch (error) {
        if (!isPouchConflict(error) || attempt === 2) throw error;
      }
    }
  });
  writesByOutline.set(itemListId, write);
  try {
    await write;
  } finally {
    if (writesByOutline.get(itemListId) === write) {
      writesByOutline.delete(itemListId);
    }
  }
};
