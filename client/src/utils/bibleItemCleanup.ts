import type { DBItem, DBItemListDetails, DBItemLists } from "../types";

export const BIBLE_ITEM_CLEANUP_GRACE_PERIOD_MS = 60 * 60 * 1000;

type DeleteUnusedBibleItemsOptions = {
  db: PouchDB.Database;
  bibleItems: DBItem[];
  /** Rechecked across async boundaries; return false while writes or sync are active. */
  canRun?: () => boolean;
};

const activeBibleCleanupByDatabase = new WeakMap<object, Promise<number | null>>();

const getBibleItemAge = (item: DBItem, now: number): "recent" | "old" | "unknown" => {
  const values = [item.createdAt, item.updatedAt].filter(
    (value) => value !== undefined,
  );
  if (values.length === 0 || values.some((value) => typeof value !== "string")) {
    return "unknown";
  }
  const timestamps = (values as string[]).map((value) => Date.parse(value));
  if (timestamps.some((value) => !Number.isFinite(value))) return "unknown";
  return Math.max(...timestamps) > now - BIBLE_ITEM_CLEANUP_GRACE_PERIOD_MS
    ? "recent"
    : "old";
};

/**
 * Delete Bible documents only when a complete persisted outline inventory
 * proves that no saved outline references them. The caller supplies the
 * per-document Bible candidates; a missing, malformed, or changing inventory
 * aborts the entire cleanup.
 *
 * Returns null when safety could not be established or recent orphan documents
 * need a later retry. Timestamp-uncertain documents are kept permanently.
 */
export const deleteUnusedBibleItems = async ({
  db,
  bibleItems,
  canRun = () => true,
}: DeleteUnusedBibleItemsOptions): Promise<number | null> => {
  const active = activeBibleCleanupByDatabase.get(db);
  if (active) return active;

  const cleanup = (async (): Promise<number | null> => {
    try {
      if (!canRun()) return null;

      const lists = (await db.get("ItemLists")) as DBItemLists;
      if (!lists || typeof lists._rev !== "string" || !Array.isArray(lists.itemLists)) {
        return null;
      }

      const outlineIds: string[] = [];
      const seenOutlineIds = new Set<string>();
      for (const itemList of lists.itemLists) {
        if (!itemList || typeof itemList._id !== "string" || !itemList._id) {
          return null;
        }
        if (seenOutlineIds.has(itemList._id)) return null;
        seenOutlineIds.add(itemList._id);
        outlineIds.push(itemList._id);
      }

      const bibleById = new Map<string, DBItem>();
      for (const item of bibleItems) {
        if (item?.type !== "bible" || typeof item._id !== "string" || !item._id) {
          return null;
        }
        if (bibleById.has(item._id)) return null;
        bibleById.set(item._id, item);
      }
      if (bibleById.size === 0) return 0;

      const inventory = (await db.allDocs({
        keys: [...outlineIds, ...bibleById.keys()],
        include_docs: true,
        update_seq: true,
      })) as {
        rows: Array<{ id?: string; doc?: unknown }>;
        update_seq?: unknown;
      };
      if (
        !Array.isArray(inventory.rows) ||
        inventory.rows.length !== outlineIds.length + bibleById.size ||
        inventory.update_seq === undefined
      ) {
        return null;
      }

      const expectedIds = new Set([...outlineIds, ...bibleById.keys()]);
      const seenRowIds = new Set<string>();
      const docsById = new Map<string, Record<string, unknown>>();
      for (const row of inventory.rows) {
        const rowId =
          typeof row.id === "string"
            ? row.id
            : typeof (row as { key?: unknown }).key === "string"
              ? (row as { key: string }).key
              : null;
        if (!rowId || !expectedIds.has(rowId) || seenRowIds.has(rowId)) return null;
        seenRowIds.add(rowId);
        if (!row.doc || typeof row.doc !== "object") continue;
        const doc = row.doc as Record<string, unknown>;
        if (doc._id !== rowId) return null;
        docsById.set(rowId, doc);
      }
      if (seenRowIds.size !== expectedIds.size) return null;

      const referencedIds = new Set<string>();
      for (const outlineId of outlineIds) {
        const outline = docsById.get(outlineId) as DBItemListDetails | undefined;
        if (!outline || outline._id !== outlineId || !Array.isArray(outline.items)) {
          return null;
        }
        for (const item of outline.items) {
          if (!item || typeof item._id !== "string" || !item._id) return null;
          referencedIds.add(item._id);
        }
      }

      const now = Date.now();
      let hasRecentOrphan = false;
      const candidates: Array<{ _id: string; _rev: string; _deleted: true }> = [];
      for (const id of bibleById.keys()) {
        const persisted = docsById.get(id) as DBItem | undefined;
        if (!persisted) continue;
        if (
          persisted._id !== id ||
          persisted.type !== "bible" ||
          typeof persisted._rev !== "string"
        ) {
          return null;
        }
        if (referencedIds.has(id)) continue;
        const age = getBibleItemAge(persisted, now);
        if (age === "recent") {
          hasRecentOrphan = true;
          continue;
        }
        if (age === "unknown") continue;
        candidates.push({ _id: id, _rev: persisted._rev, _deleted: true });
      }
      if (candidates.length === 0) return hasRecentOrphan ? null : 0;

      if (!canRun()) return null;
      const currentLists = (await db.get("ItemLists")) as DBItemLists;
      if (currentLists?._rev !== lists._rev || !canRun()) return null;
      const currentInfo = await db.info();
      if (
        JSON.stringify(currentInfo.update_seq) !== JSON.stringify(inventory.update_seq) ||
        !canRun()
      ) {
        return null;
      }

      const results = await db.bulkDocs(candidates);
      if (results.some((result) => "error" in result && result.error)) return null;
      return hasRecentOrphan ? null : results.length;
    } catch {
      // Missing, unreadable, or malformed outline inventory must never delete.
      return null;
    }
  })();

  activeBibleCleanupByDatabase.set(db, cleanup);
  try {
    return await cleanup;
  } finally {
    if (activeBibleCleanupByDatabase.get(db) === cleanup) {
      activeBibleCleanupByDatabase.delete(db);
    }
  }
};
