import {
  globalBroadcastRef,
  globalDb as activeDb,
} from "../context/controllerInfo";
import { globalHostId } from "../context/globalInfo";
import { setMediaCacheMap } from "../store/mediaCacheMapSlice";
import store from "../store/store";
import type { DBMedia, MediaFolder, MediaType } from "../types";
import { extractMediaUrlsFromBackgrounds } from "./mediaCacheUtils";

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

/** Persist media list + folders immediately (broadcast + Electron cache when applicable). */
export async function flushMediaLibraryDocToPouch(
  db: PouchDB.Database | undefined,
  list: MediaType[],
  folders: MediaFolder[],
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  if (!db) {
    return { ok: false, error: new Error(FLUSH_MEDIA_NO_DB_MESSAGE) };
  }
  const databaseIsActive = () => activeDb === db;
  if (!databaseIsActive()) {
    return { ok: false, error: new Error(FLUSH_MEDIA_STALE_DB_MESSAGE) };
  }
  try {
    const db_media: DBMedia = await db.get("media");
    if (!databaseIsActive()) {
      return { ok: false, error: new Error(FLUSH_MEDIA_STALE_DB_MESSAGE) };
    }
    db_media.list = [...list];
    db_media.folders = [...folders];
    db_media.updatedAt = new Date().toISOString();
    await db.put(db_media);
    // The intended database was updated, but do not publish/cache its result
    // into a different church if the active database changed during the put.
    if (!databaseIsActive()) return { ok: true };
    safePostMessage({
      type: "update",
      data: {
        docs: db_media,
        hostId: globalHostId,
      },
    });
    if (window.electronAPI) {
      try {
        const urlArray = extractMediaUrlsFromBackgrounds(list);
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
