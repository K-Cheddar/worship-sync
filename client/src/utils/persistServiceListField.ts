import type { DBItemListDetails, ServiceItem } from "../types";
import { isPouchConflict } from "./persistOverlayDoc";

const SERVICE_LIST_PUT_MAX_ATTEMPTS = 4;

export type ServiceListFieldDb = {
  get: (id: string) => Promise<unknown>;
  put: (doc: unknown) => Promise<{ rev?: string } | unknown>;
};

async function persistServiceListField<
  K extends "items" | "overlays",
>(
  db: ServiceListFieldDb,
  listId: string,
  field: K,
  value: K extends "items" ? ServiceItem[] : string[],
): Promise<DBItemListDetails> {
  let lastError: unknown;

  for (let attempt = 0; attempt < SERVICE_LIST_PUT_MAX_ATTEMPTS; attempt += 1) {
    const current = (await db.get(listId)) as DBItemListDetails;
    const next: DBItemListDetails = {
      ...current,
      [field]: value,
      updatedAt: new Date().toISOString(),
    };

    try {
      const result = await db.put(next);
      const rev =
        typeof result === "object" && result !== null && "rev" in result
          ? (result as { rev?: string }).rev
          : undefined;
      return rev ? { ...next, _rev: rev } : next;
    } catch (error) {
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
