import type { Dispatch } from "@reduxjs/toolkit";
import isEqual from "lodash/isEqual";
import type { DBItem, DBHeading, SongV2RootDocument } from "../types";
import {
  activateSongV2Roots,
  applyItemDocumentChanges,
  applySongLibraryRefresh,
  hydrateItemCache,
  invalidateSongContents,
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
import { recordStartupAggregate, recordStartupDiagnostic } from "../utils/startupDiagnostics";

type ItemCacheSyncOptions = {
  onHydrated?: () => void;
  getCachedDocuments?: () => readonly (DBItem | DBHeading)[];
};
export { isItemDocument } from "./allDocsSlice";

const PROJECTION_RETRY_DELAYS_MS = [250, 1000, 3000];
const MAX_CHANGE_BATCH_SIZE = 128;
const MAX_PENDING_CHANGE_EVENTS = 256;
const MAX_PROJECTION_READS = 4;

type IncomingChange = {
  id: string;
  seq: string | number;
  deleted?: boolean;
  doc?: unknown;
};

type CacheChange = { id: string; doc?: DBItem | DBHeading; deleted?: boolean };

const itemCacheDrainers = new WeakMap<object, () => Promise<void>>();

/** Wait until the current database's queued change batches have been applied. */
export const flushItemCacheChanges = (db: PouchDB.Database) =>
  itemCacheDrainers.get(db)?.() ?? Promise.resolve();

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
  const incompleteV2SongIds = new Set<string>();
  const readFailedSongIds = new Set<string>();
  const cachedDocumentsById = new Map<string, DBItem | DBHeading>();
  const projectionGenerations = new Map<string, number>();
  const projectionRetryAttempts = new Map<string, number>();
  const projectionRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const queuedProjectionSongIds = new Set<string>();
  const inFlightProjections = new Map<string, Set<{ generation: number }>>();
  let activeProjectionReads = 0;

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
      requestSongProjectionRefresh(songId, true);
    }, delay);
    projectionRetryTimers.set(songId, timer);
  };

  const performSongProjectionRefresh = async (songId: string, generation: number) => {
    const isCurrent = () => active && projectionGenerations.get(songId) === generation;
    const commit = (result: {
      authority: "legacy" | "v2" | "unknown";
      projection?: DBItem;
      diagnostic?: SongLibraryDiagnostic;
      preserveProjection?: boolean;
    }) => {
      if (!isCurrent()) return;
      dispatch(applySongLibraryRefresh({ songId, ...result }));
      if (result.projection) cachedDocumentsById.set(songId, result.projection);
      else if (!result.preserveProjection && result.authority !== "unknown") cachedDocumentsById.delete(songId);
      incompleteV2SongIds.delete(songId);
      readFailedSongIds.delete(songId);
      if (result.diagnostic?.code === "incomplete-v2") incompleteV2SongIds.add(songId);
      if (result.diagnostic?.code === "read-failed") readFailedSongIds.add(songId);
      if (result.authority === "legacy") activatedSongIds.delete(songId);
      else if (result.authority === "v2") activatedSongIds.add(songId);
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

  const finishSongProjectionRead = (songId: string, task: { generation: number }) => {
    activeProjectionReads = Math.max(0, activeProjectionReads - 1);
    const currentTasks = inFlightProjections.get(songId);
    currentTasks?.delete(task);
    if (currentTasks?.size === 0) {
      inFlightProjections.delete(songId);
    }
    recordStartupAggregate("song-projection", { activeReads: activeProjectionReads });
    pumpSongProjectionRefreshes();
  };

  const pumpSongProjectionRefreshes = () => {
    while (active && activeProjectionReads < MAX_PROJECTION_READS && queuedProjectionSongIds.size > 0) {
      const songId = [...queuedProjectionSongIds].find((queuedSongId) =>
        (inFlightProjections.get(queuedSongId)?.size ?? 0) < 2,
      );
      if (!songId) return;
      queuedProjectionSongIds.delete(songId);
      const generation = projectionGenerations.get(songId) ?? 0;
      const task = { generation };
      const tasks = inFlightProjections.get(songId) ?? new Set<{ generation: number }>();
      tasks.add(task);
      inFlightProjections.set(songId, tasks);
      activeProjectionReads += 1;
      recordStartupAggregate("song-projection", {
        actualRefreshes: 1,
        activeReads: activeProjectionReads,
        maximumConcurrentReads: activeProjectionReads,
      });
      void performSongProjectionRefresh(songId, generation).finally(() => finishSongProjectionRead(songId, task));
    }
  };

  const requestSongProjectionRefresh = (songId: string, isRetry = false) => {
    if (!isRetry) clearProjectionRetry(songId);
    const generation = (projectionGenerations.get(songId) ?? 0) + 1;
    projectionGenerations.set(songId, generation);
    recordStartupAggregate("song-projection", { refreshRequests: 1 });
    if (queuedProjectionSongIds.has(songId) || (inFlightProjections.get(songId)?.size ?? 0) > 0) {
      recordStartupAggregate("song-projection", { coalescedRequests: 1 });
    }
    queuedProjectionSongIds.add(songId);
    pumpSongProjectionRefreshes();
  };

  invalidateSongLibraryRefresh(db);
  dispatch(resetItemCache());

  const pendingChanges: IncomingChange[] = [];
  const drainWaiters = new Set<() => void>();
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let processingChanges = false;

  const resolveDrainWaiters = () => {
    if (pendingChanges.length || processingChanges) return;
    for (const resolve of drainWaiters) resolve();
    drainWaiters.clear();
  };

  const processChangeBatch = (batch: IncomingChange[]) => {
    const startedAt = performance.now();
    const cacheChanges: CacheChange[] = [];
    const hasDocumentCacheChanges = batch.some((change) =>
      !getSongV2DocumentIdentity(change.id) &&
      (change.deleted || isItemDocument(change.doc)),
    );
    const authoritativeCachedDocuments = hasDocumentCacheChanges ? options.getCachedDocuments?.() : undefined;
    const nextCachedDocumentsById = authoritativeCachedDocuments
      ? new Map(authoritativeCachedDocuments.map((document) => [document._id, document]))
      : new Map(cachedDocumentsById);
    const nextActivatedSongIds = new Set(activatedSongIds);
    const nextIncompleteV2SongIds = new Set(incompleteV2SongIds);
    const nextReadFailedSongIds = new Set(readFailedSongIds);
    const songsToActivate = new Set<string>();
    const songsToInvalidate = new Set<string>();
    const songsWithLibraryChanges = new Set<string>();
    const songsWithRootChanges = new Set<string>();
    let relevantEvents = 0;
    let redundantRevisions = 0;

    for (const change of batch) {
      const songIdentity = getSongV2DocumentIdentity(change.id);
      if (songIdentity) {
        relevantEvents += 1;
        const { songId, kind } = songIdentity;
        songsToInvalidate.add(songId);
        if (kind === "root") {
          songsWithLibraryChanges.add(songId);
          songsWithRootChanges.add(songId);
          const rootWasDeleted = Boolean(change.deleted || (change.doc as { _deleted?: boolean } | undefined)?._deleted);
          if (!rootWasDeleted) {
            nextActivatedSongIds.add(songId);
            nextIncompleteV2SongIds.delete(songId);
            nextReadFailedSongIds.delete(songId);
            nextCachedDocumentsById.delete(songId);
            songsToActivate.add(songId);
          }
        } else if (kind === "arrangement") {
          songsWithLibraryChanges.add(songId);
        }
        continue;
      }

      if ((change.doc as { docType?: string } | undefined)?.docType?.startsWith("song-v2-")) continue;
      const doc = isItemDocument(change.doc) ? change.doc : undefined;
      if (doc) {
        if (doc.type === "song" && doc.docType !== "song-v2-root" &&
          (nextActivatedSongIds.has(doc._id) || nextIncompleteV2SongIds.has(doc._id))) continue;
        const existing = nextCachedDocumentsById.get(change.id);
        const clearsReadFailure = doc.type === "song" && doc.docType !== "song-v2-root" &&
          nextReadFailedSongIds.has(doc._id);
        if (!clearsReadFailure && existing && existing.type === doc.type && (
          (doc._rev && existing._rev === doc._rev) || (!doc._rev && isEqual(existing, doc))
        )) {
          relevantEvents += 1;
          redundantRevisions += 1;
          continue;
        }
        relevantEvents += 1;
        cacheChanges.push({ id: change.id, doc });
        nextCachedDocumentsById.set(change.id, doc);
        if (doc.type === "song" && doc.docType === "song-v2-root") nextIncompleteV2SongIds.delete(doc._id);
        if (doc.type === "song" && doc.docType !== "song-v2-root") nextReadFailedSongIds.delete(doc._id);
        continue;
      }

      if (change.deleted && nextCachedDocumentsById.has(change.id)) {
        relevantEvents += 1;
        cacheChanges.push({ id: change.id, deleted: true });
        nextCachedDocumentsById.delete(change.id);
      }
    }

    if (songsToActivate.size) dispatch(activateSongV2Roots([...songsToActivate]));
    if (songsToInvalidate.size) dispatch(invalidateSongContents([...songsToInvalidate]));
    if (songsWithLibraryChanges.size || cacheChanges.length) invalidateSongLibraryRefresh(db);
    if (cacheChanges.length) {
      dispatch(applyItemDocumentChanges(cacheChanges));
    }

    cachedDocumentsById.clear();
    nextCachedDocumentsById.forEach((document, id) => cachedDocumentsById.set(id, document));
    activatedSongIds.clear();
    nextActivatedSongIds.forEach((songId) => activatedSongIds.add(songId));
    incompleteV2SongIds.clear();
    nextIncompleteV2SongIds.forEach((songId) => incompleteV2SongIds.add(songId));
    readFailedSongIds.clear();
    nextReadFailedSongIds.forEach((songId) => readFailedSongIds.add(songId));

    for (const songId of songsWithLibraryChanges) {
      if (songsWithRootChanges.has(songId) || activatedSongIds.has(songId)) requestSongProjectionRefresh(songId);
    }

    const lastSequence = batch.at(-1)?.seq;
    if (lastSequence !== undefined) sequence = lastSequence;
    recordStartupAggregate("item-cache", {
      changeFeedEvents: batch.length,
      relevantEvents,
      skippedEvents: batch.length - relevantEvents,
      redundantWinningRevisionUpdates: redundantRevisions,
      reduxCacheBatches: cacheChanges.length ? 1 : 0,
      reduxCacheDocuments: cacheChanges.length,
      cacheProcessingDurationMs: performance.now() - startedAt,
    });
  };

  const processNextChangeBatch = () => {
    if (flushTimer !== undefined) clearTimeout(flushTimer);
    flushTimer = undefined;
    if (!active || processingChanges) return;
    if (pendingChanges.length === 0) {
      resolveDrainWaiters();
      return;
    }
    processingChanges = true;
    const batch = pendingChanges.splice(0, MAX_CHANGE_BATCH_SIZE);
    try {
      processChangeBatch(batch);
    } catch (error) {
      // Keep the last applied sequence so the feed can replay this batch.
      pendingChanges.unshift(...batch);
      processingChanges = false;
      recover(error);
      return;
    }
    processingChanges = false;
    if (pendingChanges.length) scheduleChangeFlush();
    else resolveDrainWaiters();
  };

  const scheduleChangeFlush = () => {
    if (flushTimer !== undefined || processingChanges || !active) return;
    flushTimer = setTimeout(processNextChangeBatch, 0);
  };

  const drainPendingChanges = () => new Promise<void>((resolve) => {
    if (pendingChanges.length === 0 && !processingChanges) {
      resolve();
      return;
    }
    drainWaiters.add(resolve);
    if (flushTimer !== undefined) clearTimeout(flushTimer);
    flushTimer = undefined;
    scheduleChangeFlush();
  });

  itemCacheDrainers.set(db, drainPendingChanges);

  const recover = (error: unknown) => {
    if (!active) return;
    console.error("Item cache synchronization failed:", error);
    dispatch(setItemCacheError("The item library could not be loaded. Try again."));
    const failedFeed = feed;
    feed = undefined;
    failedFeed?.cancel();
    clearTimeout(retry);
    retry = setTimeout(() => {
      void drainPendingChanges().then(() => connect());
    }, 1000);
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
        cachedDocumentsById.clear();
        for (const document of documents) cachedDocumentsById.set(document._id, document);
        songLibrary.activatedSongIds.forEach((songId) => activatedSongIds.add(songId));
        songLibrary.diagnostics
          .filter((diagnostic) => diagnostic.code === "incomplete-v2")
          .forEach((diagnostic) => incompleteV2SongIds.add(diagnostic.songId));
        songLibrary.diagnostics
          .filter((diagnostic) => diagnostic.code === "read-failed")
          .forEach((diagnostic) => readFailedSongIds.add(diagnostic.songId));
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
        if (pendingChanges.length >= MAX_PENDING_CHANGE_EVENTS) processNextChangeBatch();
        pendingChanges.push(change as IncomingChange);
        recordStartupAggregate("item-cache", { pendingQueueDepth: pendingChanges.length });
        scheduleChangeFlush();
      })
        .on("error", (error) => {
          if (feed !== nextFeed) return;
          void drainPendingChanges().then(() => recover(error));
        });
    } catch (error) {
      recover(error);
    }
  };

  void connect();

  return () => {
    active = false;
    if (flushTimer !== undefined) clearTimeout(flushTimer);
    flushTimer = undefined;
    pendingChanges.length = 0;
    for (const resolve of drainWaiters) resolve();
    drainWaiters.clear();
    if (itemCacheDrainers.get(db) === drainPendingChanges) itemCacheDrainers.delete(db);
    queuedProjectionSongIds.clear();
    inFlightProjections.clear();
    clearTimeout(retry);
    projectionRetryTimers.forEach(timer => clearTimeout(timer));
    projectionRetryTimers.clear();
    projectionRetryAttempts.clear();
    feed?.cancel();
    invalidateSongLibraryRefresh(db);
    dispatch(resetItemCache());
  };
};
