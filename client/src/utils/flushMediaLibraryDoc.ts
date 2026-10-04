import {
  globalBroadcastRef,
  globalDb as activeDb,
} from "../context/controllerInfo";
import { globalHostId } from "../context/globalInfo";
import { setMediaCacheMap } from "../store/mediaCacheMapSlice";
import store from "../store/store";
import type { MediaFolder, MediaType } from "../types";
import { extractMediaUrlsFromBackgrounds } from "./mediaCacheUtils";
import {
  mediaItemDocId,
  persistMediaLibraryChanges,
  persistMediaLibrarySnapshot,
  removeMediaItem,
} from "./mediaDocUtils";

const safePostMessage = (message: unknown) => {
  if (globalBroadcastRef) {
    globalBroadcastRef.postMessage(message);
  }
};

/** `error.message` when {@link flushMediaLibraryDocToPouch} could not run because `db` is unset. */
export const FLUSH_MEDIA_NO_DB_MESSAGE =
  "flushMediaLibraryDocToPouch: no database instance";
export const FLUSH_MEDIA_STALE_DB_MESSAGE =
  "flushMediaLibraryDocToPouch: database is no longer active";

/** Tombstone known v2 rows directly and publish those tombstones to other local controllers. */
export async function deleteMediaItemsFromPouch(
  db: PouchDB.Database,
  ids: string[],
): Promise<{ deletedIds: string[]; failed: Array<{ id: string; error: unknown }> }> {
  const deletedIds: string[] = [];
  const failed: Array<{ id: string; error: unknown }> = [];
  for (const id of [...new Set(ids)]) {
    if (activeDb !== db) {
      failed.push({ id, error: new Error(FLUSH_MEDIA_STALE_DB_MESSAGE) });
      continue;
    }
    try {
      await removeMediaItem(db, id, () => activeDb === db);
      if (activeDb !== db) {
        failed.push({ id, error: new Error(FLUSH_MEDIA_STALE_DB_MESSAGE) });
        continue;
      }
      deletedIds.push(id);
    } catch (error) {
      console.error("Failed to tombstone media library item:", { id, error });
      failed.push({ id, error });
    }
  }
  if (deletedIds.length > 0 && activeDb === db) {
    safePostMessage({
      type: "update",
      data: {
        docs: deletedIds.map((id) => ({ _id: mediaItemDocId(id), id, _deleted: true })),
        hostId: globalHostId,
      },
    });
  }
  return { deletedIds, failed };
}

/** Reconcile a list-shaped workflow to the active schema using item-level writes in v2. */
export async function flushMediaLibraryDocToPouch(
  db: PouchDB.Database | undefined,
  list: MediaType[],
  folders: MediaFolder[],
  getLatestState?: () => { list: MediaType[]; folders: MediaFolder[] },
  changeBase?: { list: MediaType[]; folders: MediaFolder[] },
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  if (!db) {
    return { ok: false, error: new Error(FLUSH_MEDIA_NO_DB_MESSAGE) };
  }
  const databaseIsActive = () => activeDb === db;
  if (!databaseIsActive()) {
    return { ok: false, error: new Error(FLUSH_MEDIA_STALE_DB_MESSAGE) };
  }
  try {
    let stateToPersist = { list, folders };
    const readLatestState = () => {
      stateToPersist = getLatestState?.() ?? stateToPersist;
      return stateToPersist;
    };
    const changedDocs = changeBase
      ? await persistMediaLibraryChanges(db, changeBase, readLatestState(), databaseIsActive)
      : await persistMediaLibrarySnapshot(
          db,
          list,
          folders,
          readLatestState,
          databaseIsActive,
        );
    const { list: listToPersist } = stateToPersist;
    // The intended database was updated, but do not publish/cache its result
    // into a different church if the active database changed during the put.
    if (!databaseIsActive()) return { ok: true };
    if (changedDocs.length > 0) {
      safePostMessage({
        type: "update",
        data: {
          docs: changedDocs,
          hostId: globalHostId,
        },
      });
    }
    if (window.electronAPI) {
      try {
        const urlArray = extractMediaUrlsFromBackgrounds(listToPersist);
        const electronAPI = window.electronAPI as unknown as {
          syncMediaCache: (
            urls: string[],
          ) => Promise<{ downloaded: number; cleaned: number }>;
          getMediaCacheMap: () => Promise<Record<string, string>>;
        };
        if (urlArray.length > 0) {
          await electronAPI.syncMediaCache(urlArray);
        } else {
          await electronAPI.syncMediaCache([]);
        }
        const map = await electronAPI.getMediaCacheMap();
        if (!databaseIsActive()) return { ok: true };
        store.dispatch(setMediaCacheMap(map));
      } catch (error) {
        console.error(
          "Error syncing media cache after flushMediaLibraryDocToPouch:",
          error,
        );
      }
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
