import type { DBItemListDetails, ServiceItem } from "../types";
import { isPouchConflict } from "./persistOverlayDoc";
import { reconcileOutlineItems } from "./outlineSync";

const SERVICE_LIST_PUT_MAX_ATTEMPTS = 4;

export type ServiceListFieldDb = {
  get: (id: string) => Promise<unknown>;
  put: (doc: DBItemListDetails) => Promise<{ rev?: string } | unknown>;
};

export class ServiceListConflictError extends Error {
  readonly remoteItems: ServiceItem[];

  constructor(remoteItems: ServiceItem[]) {
    super("The outline changed in another session while local edits were pending");
    this.name = "ServiceListConflictError";
    this.remoteItems = remoteItems;
  }
}

async function persistServiceListField<
  K extends "items" | "overlays",
>(
  db: ServiceListFieldDb,
  listId: string,
  field: K,
  value: K extends "items" ? ServiceItem[] : string[],
  baseline?: ServiceItem[],
): Promise<DBItemListDetails> {
  let lastError: unknown;

  for (let attempt = 0; attempt < SERVICE_LIST_PUT_MAX_ATTEMPTS; attempt += 1) {
    const current = (await db.get(listId)) as DBItemListDetails;
    let nextValue = value;
    if (field === "items" && baseline) {
      const reconciled = reconcileOutlineItems(
        baseline,
        value as ServiceItem[],
        (current.items ?? []) as ServiceItem[],
      );
      if (reconciled.kind === "conflict") {
        throw new ServiceListConflictError(reconciled.remoteItems);
      }
      nextValue = reconciled.items as typeof value;
    }
    const next: DBItemListDetails = {
      ...current,
      [field]: nextValue,
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
  baseline?: ServiceItem[],
) => persistServiceListField(db, listId, "items", items, baseline);

export const persistServiceListOverlays = (
  db: ServiceListFieldDb,
  listId: string,
  overlays: string[],
) => persistServiceListField(db, listId, "overlays", overlays);
