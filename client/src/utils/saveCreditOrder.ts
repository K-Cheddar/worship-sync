import isEqual from "lodash/isEqual";
import { getCreditsDocId, type DBCredits } from "../types";
import { applyOrderedIdMoves } from "./applyOrderedIdMoves";
import { isPouchConflict } from "./persistOverlayDoc";

const pending = new WeakMap<PouchDB.Database, Map<string, Promise<DBCredits | undefined>>>();

/** Serialize local edit intentions, then rebase each on the winning revision at write time. */
export function saveCreditOrder(
  db: PouchDB.Database, outlineId: string, before: string[], intended: string[],
): Promise<DBCredits | undefined> {
  const id = getCreditsDocId(outlineId);
  const save = async () => {
    for (let attempt = 0; ; attempt++) {
      let existing: DBCredits | undefined;
      try {
        existing = await db.get<DBCredits>(id);
      } catch (error) {
        if ((error as { status?: number }).status !== 404) throw error;
      }
      const current = existing?.creditIds ?? [];
      if (isEqual(current, intended) || (!existing && isEqual(before, intended))) return;
      let creditIds = intended;
      if (existing && !isEqual(current, before)) {
        if (isEqual(before, intended)) return;
        const retained = current.filter(key => !before.includes(key) || intended.includes(key));
        const added = intended.filter(key => !before.includes(key) && !retained.includes(key));
        creditIds = applyOrderedIdMoves(before, intended, [...retained, ...added]);
        if (isEqual(current, creditIds)) return;
      }
      const now = new Date().toISOString();
      const doc = { ...(existing ?? { _id: id, docType: "credits" as const, outlineId, createdAt: now }),
        creditIds, updatedAt: now };
      try {
        const { rev } = await db.put(doc);
        return { ...doc, _rev: rev };
      } catch (error) {
        if (!isPouchConflict(error) || attempt >= 2) throw error;
      }
    }
  };
  const databaseQueue = pending.get(db) ?? new Map<string, Promise<DBCredits | undefined>>();
  const next = (databaseQueue.get(id) ?? Promise.resolve()).then(save, save);
  databaseQueue.set(id, next);
  pending.set(db, databaseQueue);
  const release = () => {
    if (databaseQueue.get(id) !== next) return;
    databaseQueue.delete(id);
    if (databaseQueue.size === 0) pending.delete(db);
  };
  void next.then(release, release);
  return next;
}
