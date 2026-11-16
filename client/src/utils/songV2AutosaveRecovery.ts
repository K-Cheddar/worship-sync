import type { DBItem, ItemContentOwner, ItemState } from "../types";

const DATABASE_NAME = "worshipsync-song-v2-recovery";
const DATABASE_VERSION = 1;
const STORE_NAME = "autosaves";
let recoveryDatabasePromise: Promise<IDBDatabase> | null = null;

type PendingSongV2AutosaveRecovery = {
  id: string;
  owner: ItemContentOwner;
  itemId: string;
  desired: ItemState;
  baseline: DBItem;
  mutationVersion: number;
  resolveReplicationConflicts?: ItemState["pendingSongV2Conflicts"];
  status: "pending" | "needs-review";
};

type DiscardedSongV2AutosaveRecovery = {
  id: string;
  owner: ItemContentOwner;
  itemId: string;
  status: "discarded";
};

export type SongV2AutosaveRecovery =
  | PendingSongV2AutosaveRecovery
  | DiscardedSongV2AutosaveRecovery;

/** Serializes writes to one physical Song V2 document set across same-origin windows. */
export const withSongV2AutosaveLock = <T,>(
  itemId: string,
  databaseName: string,
  operation: () => Promise<T>,
) => {
  if (typeof navigator === "undefined" || !navigator.locks) {
    return Promise.reject<T>(new Error("Cross-window Song V2 write coordination is unavailable."));
  }
  const name = JSON.stringify([
    "worshipsync-song-v2",
    databaseName,
    itemId,
  ]);
  return navigator.locks.request(name, { mode: "exclusive" }, operation);
};

let fallbackOperationSequence = 0;

const createRecoveryOperationId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  fallbackOperationSequence += 1;
  return `${Date.now().toString(36)}-${fallbackOperationSequence.toString(36)}-${Math.random().toString(36).slice(2)}`;
};

export const createSongV2AutosaveRecoveryId = (
  owner: ItemContentOwner,
  itemId: string,
) => JSON.stringify([
  owner.scopeId,
  owner.databaseKey,
  owner.churchId,
  owner.accountId ?? null,
  itemId,
  "song",
  createRecoveryOperationId(),
]);

const isSameOwner = (left: ItemContentOwner, right: ItemContentOwner) =>
  left.scopeId === right.scopeId &&
  left.databaseKey === right.databaseKey &&
  left.churchId === right.churchId &&
  left.accountId === right.accountId;

const recoveryOwner = ({ scopeId, databaseKey, churchId, accountId }: ItemContentOwner) => ({
  scopeId,
  databaseKey,
  churchId,
  ...(accountId === undefined ? {} : { accountId }),
});

const openRecoveryDatabase = () => {
  if (typeof indexedDB === "undefined") {
    return Promise.reject<IDBDatabase>(new Error("Durable song recovery storage is unavailable."));
  }
  if (!recoveryDatabasePromise) {
    recoveryDatabasePromise = new Promise((resolve, reject) => {
      const openRequest = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      openRequest.onupgradeneeded = () => {
        const database = openRequest.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      openRequest.onerror = () => {
        recoveryDatabasePromise = null;
        reject(openRequest.error ?? new Error("Could not open durable song recovery storage."));
      };
      openRequest.onblocked = () => {
        recoveryDatabasePromise = null;
        reject(new Error("Durable song recovery storage is blocked by another WorshipSync window."));
      };
      openRequest.onsuccess = () => {
        const database = openRequest.result;
        database.onversionchange = () => {
          database.close();
          recoveryDatabasePromise = null;
        };
        resolve(database);
      };
    });
  }
  return recoveryDatabasePromise;
};

const withRecoveryStore = async <T,>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
  afterRequestSuccess?: (store: IDBObjectStore, result: T) => void,
): Promise<T> => {
  const database = await openRecoveryDatabase();
  return new Promise((resolve, reject) => {
    let result: T;
    let settled = false;
    let transaction: IDBTransaction;
    let request: IDBRequest<T>;
    try {
      transaction = database.transaction(STORE_NAME, mode);
      request = action(transaction.objectStore(STORE_NAME));
    } catch (error) {
      reject(error);
      return;
    }
    request.addEventListener("success", () => { result = request.result; });
    request.addEventListener("success", () => afterRequestSuccess?.(
      transaction.objectStore(STORE_NAME),
      request.result,
    ));
    request.addEventListener("error", () => {
      if (settled) return;
      settled = true;
      reject(request.error ?? new Error("Song recovery storage request failed."));
    });
    transaction.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    transaction.onerror = () => {
      if (settled) return;
      settled = true;
      reject(transaction.error ?? new Error("Song recovery storage transaction failed."));
    };
    transaction.onabort = () => {
      if (settled) return;
      settled = true;
      reject(transaction.error ?? new Error("Song recovery storage transaction was aborted."));
    };
  });
};

export const putSongV2AutosaveRecovery = (record: SongV2AutosaveRecovery) => {
  let accepted = false;
  return withRecoveryStore<SongV2AutosaveRecovery | undefined>(
    "readwrite",
    store => store.get(record.id),
    (store, existing) => {
      if (
        existing &&
        (!isSameOwner(existing.owner, record.owner) || existing.status === "discarded")
      ) return;
      store.put({ ...record, owner: recoveryOwner(record.owner) });
      accepted = true;
    },
  ).then(() => accepted);
};

export const listSongV2AutosaveRecoveries = async (owner: ItemContentOwner) => {
  const records = await withRecoveryStore<SongV2AutosaveRecovery[]>("readonly", store => store.getAll());
  return records.filter(record => isSameOwner(record.owner, owner));
};

export const markSongV2AutosaveRecoveryNeedsReview = async (
  id: string,
  owner: ItemContentOwner,
) => withRecoveryStore<SongV2AutosaveRecovery | undefined>(
  "readwrite",
  store => store.get(id),
  (store, record) => {
    if (record && record.status !== "discarded" && isSameOwner(record.owner, owner)) {
      store.put({ ...record, status: "needs-review" });
    }
  },
).then(() => undefined);

export const markSongV2AutosaveRecoveryDiscarded = async (
  id: string,
  owner: ItemContentOwner,
  itemId: string,
) => withRecoveryStore<SongV2AutosaveRecovery | undefined>(
  "readwrite",
  store => store.get(id),
  (store, record) => {
    if (record && !isSameOwner(record.owner, owner)) return;
    store.put({
      id,
      owner: recoveryOwner(record?.owner ?? owner),
      itemId: record?.itemId ?? itemId,
      status: "discarded",
    });
  },
).then(() => undefined);

export const deleteSongV2AutosaveRecovery = async (
  id: string,
  owner: ItemContentOwner,
) => withRecoveryStore<SongV2AutosaveRecovery | undefined>(
  "readwrite",
  store => store.get(id),
  (store, record) => {
    if (record && isSameOwner(record.owner, owner)) store.delete(id);
  },
).then(() => undefined);

/** Clears recovery drafts for the focused IndexedDB storage tests. */
export const clearSongV2AutosaveRecoveriesForTests = () =>
  withRecoveryStore<undefined>("readwrite", store => store.clear());
