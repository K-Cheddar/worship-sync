import type { DBItemListDetails, ServiceItem } from "../types";
import { isPouchConflict } from "./persistOverlayDoc";

const SERVICE_LIST_PUT_MAX_ATTEMPTS = 4;

export type ServiceListFieldDb = {
  get: (id: string) => Promise<unknown>;
  put: (doc: unknown) => Promise<{ rev?: string } | unknown>;
};

type SaveLane = { superseded: boolean; done: Promise<unknown> };
const savesByDatabase = new WeakMap<ServiceListFieldDb, Map<string, SaveLane>>();

function persistServiceListField<
  K extends "items" | "overlays",
>(
  db: ServiceListFieldDb,
  listId: string,
  field: K,
  value: K extends "items" ? ServiceItem[] : string[],
): Promise<DBItemListDetails | undefined> {
  let lanes = savesByDatabase.get(db);
  if (!lanes) {
    lanes = new Map();
    savesByDatabase.set(db, lanes);
  }
  const key = JSON.stringify([listId, field]);
  const previous = lanes.get(key);
  if (previous) previous.superseded = true;
  const lane: SaveLane = { superseded: false, done: Promise.resolve() };
  const save = async () => {
    // A put already in flight cannot be cancelled. The latest intention must
    // run after it, while independent fields remain free to write/retry.
    await previous?.done.catch(() => undefined);
    return persistLatestField(db, listId, field, value, () => !lane.superseded);
  };
  const done = save().finally(() => {
    if (lanes.get(key) === lane) lanes.delete(key);
  });
  lane.done = done;
  lanes.set(key, lane);
  return done;
}

async function persistLatestField<K extends "items" | "overlays">(
  db: ServiceListFieldDb,
  listId: string,
  field: K,
  value: K extends "items" ? ServiceItem[] : string[],
  isCurrent: () => boolean,
): Promise<DBItemListDetails | undefined> {
  let lastError: unknown;

  for (let attempt = 0; attempt < SERVICE_LIST_PUT_MAX_ATTEMPTS; attempt += 1) {
    if (!isCurrent()) return;
    const current = (await db.get(listId)) as DBItemListDetails;
    if (!isCurrent()) return;
    const next: DBItemListDetails = {
      ...current,
      [field]: value,
      updatedAt: new Date().toISOString(),
    };

    try {
      const result = await db.put(next);
      if (!isCurrent()) return;
      const rev =
        typeof result === "object" && result !== null && "rev" in result
          ? (result as { rev?: string }).rev
          : undefined;
      return rev ? { ...next, _rev: rev } : next;
    } catch (error) {
      if (isPouchConflict(error) && !isCurrent()) return;
      lastError = error;
      if (
        isPouchConflict(error) &&
        attempt < SERVICE_LIST_PUT_MAX_ATTEMPTS - 1
      ) {
        continue;
      }
      throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Service outline save failed");
}

export const persistServiceListItems = (
  db: ServiceListFieldDb,
  listId: string,
  items: ServiceItem[],
) => persistServiceListField(db, listId, "items", items);

export const persistServiceListOverlays = (
  db: ServiceListFieldDb,
  listId: string,
  overlays: string[],
) => persistServiceListField(db, listId, "overlays", overlays);
