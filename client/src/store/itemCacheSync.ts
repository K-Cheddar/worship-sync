import type { Dispatch } from "@reduxjs/toolkit";
import type { DBItem, DBHeading, SongV2RootDocument } from "../types";
import {
  activateSongV2Root,
  applyItemDocumentChange,
  applySongLibraryRefresh,
  hydrateItemCache,
  invalidateSongContent,
  isItemDocument,
  resetItemCache,
  setItemCacheError,
} from "./allDocsSlice";
import { discoverSongLibrary, type SongLibraryDiagnostic } from "../utils/songLibraryDiscovery";
import { invalidateSongLibraryRefresh } from "../utils/songLibraryRefreshGeneration";
import {
  classifySongV2RootState,
  getSongV2DocumentIdentity,
  getSongV2RootDocId,
  isPouchNotFoundError,
  loadSongV2LibraryProjection,
  SongV2DocumentError,
} from "../utils/songPersistence";
import { recordStartupDiagnostic } from "../utils/startupDiagnostics";

type ItemCacheSyncOptions = {
  onHydrated?: () => void;
};
export { isItemDocument } from "./allDocsSlice";

const PROJECTION_RETRY_DELAYS_MS = [250, 1000, 3000];

/** One owner per database session. Cleanup invalidates every pending continuation. */
export const startItemCacheSync = (
  db: PouchDB.Database,
  dispatch: Dispatch,
  options: ItemCacheSyncOptions = {},
) => {
  let active = true;
  let feed: PouchDB.Core.Changes<{}> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let sequence: string | number | undefined;
  const activatedSongIds = new Set<string>();
  const projectionGenerations = new Map<string, number>();
  const projectionRetryAttempts = new Map<string, number>();
  const projectionRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const clearProjectionRetry = (songId: string, resetAttempts = true) => {
    const timer = projectionRetryTimers.get(songId);
    if (timer !== undefined) clearTimeout(timer);
    projectionRetryTimers.delete(songId);
    if (resetAttempts) projectionRetryAttempts.delete(songId);
  };

  const scheduleProjectionRetry = (songId: string, generation: number) => {
    const attempt = projectionRetryAttempts.get(songId) ?? 0;
    const delay = PROJECTION_RETRY_DELAYS_MS[attempt];
    if (delay === undefined) return;
    projectionRetryAttempts.set(songId, attempt + 1);
    const timer = setTimeout(() => {
      projectionRetryTimers.delete(songId);
      if (!active || projectionGenerations.get(songId) !== generation) return;
      void refreshSongProjection(songId, true);
    }, delay);
    projectionRetryTimers.set(songId, timer);
  };

  const refreshSongProjection = async (songId: string, isRetry = false) => {
    if (!isRetry) clearProjectionRetry(songId);
    const generation = (projectionGenerations.get(songId) ?? 0) + 1;
    projectionGenerations.set(songId, generation);
    const isCurrent = () => active && projectionGenerations.get(songId) === generation;
    const commit = (result: {
      authority: "legacy" | "v2" | "unknown";
      projection?: DBItem;
      diagnostic?: SongLibraryDiagnostic;
      preserveProjection?: boolean;
    }) => {
      if (isCurrent()) dispatch(applySongLibraryRefresh({ songId, ...result }));
    };

    const reportReadFailure = (error: unknown, authority: "legacy" | "v2" | "unknown", preserveProjection = false) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not refresh song ${songId} after a database read failed:`, error);
      commit({
        authority,
        preserveProjection,
        diagnostic: {
          songId,
          rootId: getSongV2RootDocId(songId),
          code: "read-failed",
          message,
        },
      });
      scheduleProjectionRetry(songId, generation);
    };

    const applyLiveRoot = async (root: SongV2RootDocument) => {
      activatedSongIds.add(songId);
      const authority = classifySongV2RootState({ kind: "found", root });
      if (authority !== "v2" || root.songId !== songId || root._id !== getSongV2RootDocId(songId)) {
        const error = new Error("Invalid Song V2 root identity");
        commit({ authority: "v2", diagnostic: {
          songId,
          rootId: getSongV2RootDocId(songId),
          code: "incomplete-v2",
          message: error.message,
        } });
        return;
      }
      if (root.deletedAt) {
        commit({ authority: "v2" });
        clearProjectionRetry(songId);
        return;
      }
      try {
        const projection = await loadSongV2LibraryProjection(db, root);
        if (!isCurrent()) return;
        commit({ authority: "v2", projection });
        clearProjectionRetry(songId);
      } catch (error) {
        if (!isCurrent()) return;
        if (error instanceof SongV2DocumentError) {
          commit({ authority: "v2", diagnostic: {
            songId,
            rootId: getSongV2RootDocId(songId),
            code: "incomplete-v2",
            message: error.message,
          } });
          return;
        }
        reportReadFailure(error, "v2", true);
      }
    };

    let root: SongV2RootDocument;
    try {
      root = await db.get<SongV2RootDocument>(getSongV2RootDocId(songId));
    } catch (error) {
      if (isPouchNotFoundError(error)) {
        // A missing/tombstoned physical root is a confirmed return to legacy
        // authority. Read legacy and verify the root again before publishing.
        let legacy: DBItem | undefined;
        let legacyReadError: unknown;
        try {
          const candidate = await db.get<DBItem>(songId);
          if (
            candidate._id === songId && candidate.type === "song" &&
            candidate.docType !== "song-v2-root" && isItemDocument(candidate)
          ) legacy = candidate;
        } catch (legacyError) {
          if (!isPouchNotFoundError(legacyError)) legacyReadError = legacyError;
        }
        if (!isCurrent()) return;

        let confirmedRoot: SongV2RootDocument | undefined;
        try {
          confirmedRoot = await db.get<SongV2RootDocument>(getSongV2RootDocId(songId));
        } catch (confirmError) {
          if (!isPouchNotFoundError(confirmError)) {
            reportReadFailure(confirmError, "unknown", true);
            return;
          }
        }
        if (!isCurrent()) return;
        if (confirmedRoot) {
          await applyLiveRoot(confirmedRoot);
          return;
        }
        activatedSongIds.delete(songId);
        if (legacyReadError) {
          commit({
            authority: "legacy",
            diagnostic: {
              songId,
              rootId: getSongV2RootDocId(songId),
              code: "read-failed",
              message: legacyReadError instanceof Error ? legacyReadError.message : String(legacyReadError),
            },
          });
          console.error(`Could not restore legacy song ${songId} after Song V2 rollback:`, legacyReadError);
          scheduleProjectionRetry(songId, generation);
        } else {
          commit({ authority: "legacy", projection: legacy });
          clearProjectionRetry(songId);
        }
        return;
      }
      reportReadFailure(error, "unknown", true);
      return;
    }

    if (!isCurrent()) return;
    await applyLiveRoot(root);
  };

  invalidateSongLibraryRefresh(db);
  dispatch(resetItemCache());

  const recover = (error: unknown) => {
    if (!active) return;
    console.error("Item cache synchronization failed:", error);
    dispatch(setItemCacheError("The item library could not be loaded. Try again."));
    const failedFeed = feed;
    feed = undefined;
    failedFeed?.cancel();
    clearTimeout(retry);
    retry = setTimeout(() => { void connect(); }, 1000);
  };

  const connect = async () => {
    try {
      if (sequence === undefined) {
        const hydrationStartedAt = performance.now();
        const snapshot = await db.allDocs<DBItem | DBHeading>({ include_docs: true, update_seq: true });
        if (!active) return;
        // An empty IndexedDB database can omit the sequence; replay from zero.
        sequence = snapshot.update_seq ?? 0;
        const snapshotDocs: unknown[] = snapshot.rows.map((row) => row.doc);
        const songLibrary = discoverSongLibrary(snapshotDocs);
        songLibrary.activatedSongIds.forEach(songId => activatedSongIds.add(songId));
        const otherItems = snapshotDocs.filter((doc): doc is DBItem | DBHeading =>
          isItemDocument(doc) && (doc as DBItem).type !== "song",
        );
        const documents = [...otherItems, ...songLibrary.songs];
        dispatch(hydrateItemCache({
          documents,
          activatedSongIds: songLibrary.activatedSongIds,
          songLibraryDiagnostics: songLibrary.diagnostics,
        }));
        recordStartupDiagnostic("redux", "item-cache.hydrated", {
          databaseDocuments: snapshot.rows.length,
          cachedDocuments: documents.length,
          songDocuments: songLibrary.songs.length,
          activatedSongs: songLibrary.activatedSongIds.length,
          diagnostics: songLibrary.diagnostics.length,
          durationMs: Math.round(performance.now() - hydrationStartedAt),
        });
        options.onHydrated?.();
      }
      if (!active) return;
      dispatch(setItemCacheError(null));
      const nextFeed = db.changes({ since: sequence, live: true, include_docs: true });
      feed = nextFeed;
      nextFeed.on("change", (change) => {
        if (!active || feed !== nextFeed) return;
        sequence = change.seq;
        const songV2Identity = getSongV2DocumentIdentity(change.id);
        if (songV2Identity) {
          const { songId, kind } = songV2Identity;
          if (kind === "root") {
            invalidateSongLibraryRefresh(db);
            const rootWasDeleted = Boolean(change.deleted || (change.doc as { _deleted?: boolean } | undefined)?._deleted);
            invalidateProjectionForChange(songId);
            dispatch(invalidateSongContent(songId));
            if (!rootWasDeleted) {
              activatedSongIds.add(songId);
              if ((change.doc as SongV2RootDocument | undefined)?.deletedAt) {
                dispatch(applySongLibraryRefresh({ songId, authority: "v2" }));
              } else dispatch(activateSongV2Root(songId));
            }
            void refreshSongProjection(songId);
          } else {
            if (kind === "slide") {
              dispatch(invalidateSongContent(songId));
              return;
            }
            if (kind === "arrangement") {
              invalidateSongLibraryRefresh(db);
              dispatch(invalidateSongContent(songId));
            }
            if (activatedSongIds.has(songId)) {
              invalidateProjectionForChange(songId);
              void refreshSongProjection(songId);
            }
          }
          return;
        }
        if ((change.doc as { docType?: string } | undefined)?.docType?.startsWith("song-v2-")) return;
        const doc = isItemDocument(change.doc) ? change.doc : undefined;
        if (!doc && !change.deleted) return;
        invalidateSongLibraryRefresh(db);
        dispatch(applyItemDocumentChange({
          id: change.id,
          deleted: change.deleted,
          doc,
        }));
      })
        .on("error", (error) => { if (feed === nextFeed) recover(error); });
    } catch (error) {
      recover(error);
    }
  };

  const invalidateProjectionForChange = (songId: string) => {
    clearProjectionRetry(songId);
    projectionGenerations.set(songId, (projectionGenerations.get(songId) ?? 0) + 1);
  };

  void connect();

  return () => {
    active = false;
    clearTimeout(retry);
    projectionRetryTimers.forEach(timer => clearTimeout(timer));
    projectionRetryTimers.clear();
    projectionRetryAttempts.clear();
    feed?.cancel();
    invalidateSongLibraryRefresh(db);
    dispatch(resetItemCache());
  };
};
