import type { ItemContentOwner, ItemState } from "../types";
import type PouchDB from "pouchdb-browser";

export type ItemMutationOwner = ItemContentOwner & {
  itemId: string;
  itemType: ItemState["type"];
};

const pendingByOwner = new Map<string, Map<symbol, () => void>>();
const contentDatabasesByScope = new Map<string, PouchDB.Database>();
let activeContentDatabaseOwner: ItemContentOwner | null = null;
const contentDatabaseFlushHandlers = new Set<(scopeId: string) => Promise<void>>();

const flushPendingByKey = (key: string) => {
  let attempts = 0;
  while (pendingByOwner.has(key) && attempts < 100) {
    const pending = pendingByOwner.get(key);
    const flush = pending?.values().next().value as (() => void) | undefined;
    if (!flush) return;
    flush();
    attempts += 1;
  }
};

export type PendingItemMutationHandle = {
  flush: () => void;
  cancel: () => void;
};

export const setActiveContentDatabase = (
  owner: ItemContentOwner | null,
  database?: PouchDB.Database,
) => {
  activeContentDatabaseOwner = owner;
  if (owner && database) contentDatabasesByScope.set(owner.scopeId, database);
};

export const getActiveContentDatabaseOwner = () => activeContentDatabaseOwner;

export const getContentDatabaseForOwner = (owner: ItemContentOwner) =>
  contentDatabasesByScope.get(owner.scopeId);

export const getItemMutationOwner = (
  item: Pick<ItemState, "_id" | "type" | "contentOwner">,
): ItemMutationOwner | null => {
  if (!item.contentOwner || !item._id) return null;
  return {
    ...item.contentOwner,
    itemId: item._id,
    itemType: item.type,
  };
};

export const getItemMutationOwnerKey = (owner: ItemMutationOwner): string =>
  JSON.stringify([
    owner.scopeId,
    owner.databaseKey,
    owner.churchId,
    owner.itemId,
    owner.itemType,
  ]);

export const sameItemMutationOwner = (
  left: ItemMutationOwner | null,
  right: ItemMutationOwner | null,
): boolean =>
  !!left &&
  !!right &&
  left.scopeId === right.scopeId &&
  left.databaseKey === right.databaseKey &&
  left.churchId === right.churchId &&
  left.itemId === right.itemId &&
  left.itemType === right.itemType;

export const registerPendingItemMutation = (
  owner: ItemMutationOwner,
  flush: () => void,
): (() => void) => {
  const key = getItemMutationOwnerKey(owner);
  const token = Symbol(key);
  const pending = pendingByOwner.get(key) ?? new Map<symbol, () => void>();
  pending.set(token, flush);
  pendingByOwner.set(key, pending);

  return () => {
    const current = pendingByOwner.get(key);
    current?.delete(token);
    if (current?.size === 0) pendingByOwner.delete(key);
  };
};

export const scheduleOwnedItemMutation = (
  owner: ItemMutationOwner,
  delayMs: number,
  run: () => void,
): PendingItemMutationHandle => {
  let completed = false;
  let timer: ReturnType<typeof setTimeout>;
  let unregister: () => void = () => {};

  const complete = () => {
    if (completed) return;
    completed = true;
    clearTimeout(timer);
    unregister();
    run();
  };
  const cancel = () => {
    if (completed) return;
    completed = true;
    clearTimeout(timer);
    unregister();
  };

  unregister = registerPendingItemMutation(owner, complete);
  timer = setTimeout(complete, delayMs);
  return { flush: complete, cancel };
};

/** Flushes accepted debounced work before the Redux editor changes owners. */
export const flushPendingItemMutations = (
  owner: ItemMutationOwner | null,
): void => {
  if (!owner) return;
  flushPendingByKey(getItemMutationOwnerKey(owner));
};

export const flushPendingItemMutationsForContentDatabase = (
  scopeId: string,
): void => {
  for (const key of [...pendingByOwner.keys()]) {
    try {
      if (JSON.parse(key)[0] === scopeId) flushPendingByKey(key);
    } catch {
      // Ignore malformed keys; all keys are generated locally by this module.
    }
  }
};

export const registerContentDatabaseFlushHandler = (
  handler: (scopeId: string) => Promise<void>,
) => {
  contentDatabaseFlushHandlers.add(handler);
  return () => contentDatabaseFlushHandlers.delete(handler);
};

export const flushContentDatabaseBeforeTeardown = async (scopeId: string) => {
  flushPendingItemMutationsForContentDatabase(scopeId);
  await Promise.all(
    [...contentDatabaseFlushHandlers].map((handler) => handler(scopeId)),
  );
};
