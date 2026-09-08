import type PouchDB from "pouchdb-browser";
import { preferencesClusterLoadFallback } from "../store/preferencesSlice";
import type {
  DBAllItems,
  DBItemLists,
  DBMonitorSettingsDoc,
  DBMediaRouteFoldersDoc,
  DBPreferences,
  DBQuickLinksDoc,
  ItemList,
  PreferencesType,
} from "../types";
import {
  MEDIA_ROUTE_FOLDERS_POUCH_ID,
  MONITOR_SETTINGS_POUCH_ID,
  PREFERENCES_POUCH_ID,
  QUICK_LINKS_POUCH_ID,
} from "../types";
import { loadPreferencesBundle, type PreferencesBundle } from "./dbUtils";

type PouchDocumentError = {
  status?: number | string;
  name?: string;
};

const isPouchNotFound = (error: unknown) => {
  const pouchError = error as PouchDocumentError;
  return (
    pouchError?.status === 404 ||
    pouchError?.status === "404" ||
    pouchError?.name === "not_found"
  );
};

const isPouchConflict = (error: unknown) => {
  const pouchError = error as PouchDocumentError;
  return pouchError?.status === 409 || pouchError?.name === "conflict";
};

const nowIso = () => new Date().toISOString();

/**
 * get → on confirmed not_found put empty → re-get.
 * Any other read error is rethrown so we never invent empty data over a real failure.
 */
async function loadOrCreateDoc<T extends { _id: string }>(
  db: PouchDB.Database,
  id: string,
  factory: () => Omit<T, "_rev">,
): Promise<T> {
  try {
    return (await db.get(id)) as T;
  } catch (error) {
    if (!isPouchNotFound(error)) throw error;
  }

  try {
    await db.put(factory() as T);
  } catch (error) {
    if (!isPouchConflict(error)) throw error;
  }

  return (await db.get(id)) as T;
}

/** Empty song/library index for a brand-new church content database. */
export async function loadOrCreateAllItemsDoc(
  db: PouchDB.Database,
): Promise<DBAllItems> {
  return loadOrCreateDoc<DBAllItems>(db, "allItems", () => {
    const now = nowIso();
    return {
      _id: "allItems",
      items: [],
      createdAt: now,
      updatedAt: now,
      docType: "allItems",
    };
  });
}

/** Matches the label used when operators click “Add New Service”. */
export const DEFAULT_BOOTSTRAP_OUTLINE: ItemList = {
  _id: "New Outline",
  name: "New Outline",
};

async function ensureEmptyOutlineDetailDoc(
  db: PouchDB.Database,
  outline: ItemList,
) {
  await putIfMissing(db, outline._id, () => {
    const now = nowIso();
    return {
      _id: outline._id,
      name: outline.name,
      items: [],
      overlays: [],
      createdAt: now,
      updatedAt: now,
      docType: "itemListDetails",
    };
  });
}

/**
 * Outline registry. Brand-new churches get one named empty outline so the
 * service plan column is usable immediately (not stuck on skeleton loaders).
 * Also heals registries that were previously seeded with zero outlines.
 */
export async function loadOrCreateItemListsDoc(
  db: PouchDB.Database,
): Promise<DBItemLists> {
  let existing: DBItemLists | undefined;
  try {
    existing = (await db.get("ItemLists")) as DBItemLists;
  } catch (error) {
    if (!isPouchNotFound(error)) throw error;
  }

  if (existing && (existing.itemLists?.length ?? 0) > 0) {
    return existing;
  }

  const outline = DEFAULT_BOOTSTRAP_OUTLINE;
  await ensureEmptyOutlineDetailDoc(db, outline);

  const now = nowIso();
  if (!existing) {
    try {
      await db.put({
        _id: "ItemLists",
        itemLists: [outline],
        activeList: outline,
        createdAt: now,
        updatedAt: now,
        docType: "itemLists",
      } satisfies Omit<DBItemLists, "_rev">);
    } catch (error) {
      if (!isPouchConflict(error)) throw error;
    }
  } else {
    try {
      await db.put({
        ...existing,
        itemLists: [outline],
        activeList: outline,
        updatedAt: now,
        docType: existing.docType ?? "itemLists",
      });
    } catch (error) {
      if (!isPouchConflict(error)) throw error;
    }
  }

  return (await db.get("ItemLists")) as DBItemLists;
}

const putIfMissing = async (
  db: PouchDB.Database,
  id: string,
  factory: () => Record<string, unknown>,
) => {
  try {
    await db.get(id);
  } catch (error) {
    if (!isPouchNotFound(error)) throw error;
    try {
      await db.put(factory());
    } catch (putError) {
      if (!isPouchConflict(putError)) throw putError;
    }
  }
};

/**
 * Load preferences cluster. If the preferences doc is confirmed missing, write
 * defaults (plus empty subsidiary docs) and return them. Invalid existing docs
 * and non-404 failures are not overwritten — they throw so the caller can use
 * session-only fallback without clobbering remote data.
 */
export async function loadOrCreatePreferencesBundle(
  db: PouchDB.Database,
): Promise<PreferencesBundle> {
  let preferencesMissing = false;
  try {
    await db.get(PREFERENCES_POUCH_ID);
  } catch (error) {
    if (!isPouchNotFound(error)) throw error;
    preferencesMissing = true;
  }

  if (preferencesMissing) {
    const now = nowIso();
    const defaults = preferencesClusterLoadFallback;
    const preferences = {
      ...defaults.preferences,
    } as PreferencesType;

    try {
      await db.put({
        _id: PREFERENCES_POUCH_ID,
        preferences,
        createdAt: now,
        updatedAt: now,
        docType: "preferences",
      } satisfies Omit<DBPreferences, "_rev">);
    } catch (error) {
      if (!isPouchConflict(error)) throw error;
    }

    await putIfMissing(
      db,
      QUICK_LINKS_POUCH_ID,
      () =>
        ({
          _id: QUICK_LINKS_POUCH_ID,
          quickLinks: [...defaults.quickLinks],
          createdAt: now,
          updatedAt: now,
          docType: "quickLinks",
        }) satisfies Omit<DBQuickLinksDoc, "_rev">,
    );

    await putIfMissing(
      db,
      MONITOR_SETTINGS_POUCH_ID,
      () =>
        ({
          _id: MONITOR_SETTINGS_POUCH_ID,
          monitorSettings: { ...defaults.monitorSettings },
          createdAt: now,
          updatedAt: now,
          docType: "monitorSettings",
        }) satisfies Omit<DBMonitorSettingsDoc, "_rev">,
    );

    await putIfMissing(
      db,
      MEDIA_ROUTE_FOLDERS_POUCH_ID,
      () =>
        ({
          _id: MEDIA_ROUTE_FOLDERS_POUCH_ID,
          mediaRouteFolders: { ...defaults.mediaRouteFolders },
          createdAt: now,
          updatedAt: now,
          docType: "mediaRouteFolders",
        }) satisfies Omit<DBMediaRouteFoldersDoc, "_rev">,
    );
  }

  return loadPreferencesBundle(db);
}
