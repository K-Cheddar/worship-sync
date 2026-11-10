import type { DBItem, ItemContentOwner, ItemState } from "../types";

const DATABASE_NAME = "worshipsync-song-v2-recovery";
const DATABASE_VERSION = 1;
const STORE_NAME = "autosaves";
let recoveryDatabasePromise: Promise<IDBDatabase> | null = null;

export type SongV2AutosaveRecovery = {
  id: string;
  owner: ItemContentOwner;
  itemId: string;
  desired: ItemState;
  baseline: DBItem;
  mutationVersion: number;
  resolveReplicationConflicts?: ItemState["pendingSongV2Conflicts"];
  status: "pending" | "needs-review" | "discarded";
};

export const getSongV2AutosaveRecoveryId = (
  owner: ItemContentOwner,
  itemId: string,
) => JSON.stringify([
  owner.scopeId,
  owner.databaseKey,
  owner.churchId,
  owner.accountId ?? null,
  itemId,
  "song",
]);

const isSameOwner = (left: ItemContentOwner, right: ItemContentOwner) =>
  left.scopeId === right.scopeId &&
  left.databaseKey === right.databaseKey &&
  left.churchId === right.churchId &&
  left.accountId === right.accountId;

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

export const putSongV2AutosaveRecovery = (record: SongV2AutosaveRecovery) =>
  withRecoveryStore<IDBValidKey>("readwrite", store => store.put(record));

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
    if (record && isSameOwner(record.owner, owner)) {
      store.put({ ...record, status: "needs-review" });
    }
  },
).then(() => undefined);

export const markSongV2AutosaveRecoveryDiscarded = async (
  id: string,
  owner: ItemContentOwner,
) => withRecoveryStore<SongV2AutosaveRecovery | undefined>(
  "readwrite",
  store => store.get(id),
  (store, record) => {
    if (record && isSameOwner(record.owner, owner)) {
      store.put({ ...record, status: "discarded" });
    }
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
