import type { DBItem, SongV2ArrangementDocument, SongV2Documents, SongV2RootDocument, SongV2SlideDocument } from "../types";
import { applyPouchAudit } from "./pouchAudit";
import { normalizeItemSlides, normalizeSongForPersistence } from "./activeItemSlides";
import {
  SongV2DocumentError,
  SongV2BaselineRequiredError,
  assertValidV2Root,
  buildSongV2LibraryProjection,
  getSongV2ArrangementDocId,
  getSongV2RootDocId,
  getSongV2SlideDocId,
  hydrateSongFromV2Documents as hydrateSongV2DocumentsStructural,
  hydrateSongFromV2DocumentsWithNormalizer,
} from "./songV2Codec";
export * from "./songV2Codec";

export class SongV2VersionTransitionError extends Error {
  readonly status = 409;
  readonly code = "SONG_V2_VERSION_TRANSITION";
  constructor(readonly songId: string) {
    super(`Song ${songId} was migrated while it was open. Reload it before saving.`);
    this.name = "SongV2VersionTransitionError";
  }
}

export class SongV2DeletedError extends Error {
  readonly status = 404;
  constructor(readonly songId: string) {
    super(`Song ${songId} has been deleted.`);
    this.name = "SongV2DeletedError";
  }
}

export class SongV2DeletionDeferredError extends Error {
  readonly code = "SONG_V2_DELETION_DEFERRED";
  constructor(readonly songId: string) {
    super(`Song ${songId} is migrated. Deleting migrated songs is deferred until migration validation is complete.`);
    this.name = "SongV2DeletionDeferredError";
  }
}

export class SongV2DeletionIncompleteError extends Error {
  readonly code = "SONG_V2_DELETION_INCOMPLETE";
  constructor(readonly songId: string, readonly cause: unknown) {
    super(`Cleanup discovery for deleted song ${songId} is incomplete and remains queued for recovery.`);
    this.name = "SongV2DeletionIncompleteError";
  }
}

export type SongSaveDiagnostics = {
  onCleanupErrors?: (errors: { documentId: string; revision?: string; cause: unknown }[]) => void;
};

const reportV2CleanupErrors = async (
  db: PouchDB.Database,
  songId: string,
  errors: { documentId: string; revision?: string; cause: unknown }[],
  diagnostics?: SongSaveDiagnostics,
): Promise<void> => {
  if (errors.length) {
    console.error(`Song ${songId} saved, but v2 child cleanup needs reconciliation:`, errors);
    try { diagnostics?.onCleanupErrors?.(errors); }
    catch (error) { console.error("Song cleanup diagnostic handler failed:", error); }
  }
  try {
    const { persistSongV2CleanupErrors, reconcileSongV2CleanupQueue } = await import("./songV2Writer");
    await persistSongV2CleanupErrors(db, songId, errors);
    const result = await reconcileSongV2CleanupQueue(db, songId);
    if (result.quarantined.length) {
      console.warn(`Song ${songId} cleanup records were quarantined after their target revisions changed:`, result.quarantined);
    }
    if (result.cleanupErrors.length) {
      console.error(`Song ${songId} has v2 child cleanup retries remaining:`, result.cleanupErrors);
    }
  } catch (error) {
    // Cleanup is maintenance after a committed logical save. A queue or retry
    // failure must stay observable without turning the song save into failure.
    console.error(`Could not reconcile v2 child cleanup for ${songId}:`, error);
  }
};

/** Resolves only the ordered arrangement manifest, never slide documents. */
export async function loadSongV2LibraryProjection(
  db: PouchDB.Database,
  root: SongV2RootDocument,
): Promise<DBItem> {
  assertValidV2Root(root);
  if (root.deletedAt) throw new SongV2DeletedError(root.songId);
  const arrangements = await getReferencedDocuments<SongV2ArrangementDocument>(
    db, root.arrangementIds.map((id) => getSongV2ArrangementDocId(root.songId, id)),
  );
  return buildSongV2LibraryProjection(root, arrangements);
}

/** Keeps the established client hydration normalization, including DOM measurement where needed. */
export const hydrateSongFromV2Documents = (
  root: SongV2RootDocument,
  arrangements: SongV2ArrangementDocument[],
  slides: SongV2SlideDocument[],
  structural = false,
): DBItem => structural
  ? hydrateSongV2DocumentsStructural(root, arrangements, slides, true)
  : hydrateSongFromV2DocumentsWithNormalizer(root, arrangements, slides, normalizeItemSlides);

export const isPouchNotFoundError = (error: unknown) =>
  typeof error === "object" && error !== null &&
  (("status" in error && error.status === 404) ||
    ("name" in error && error.name === "not_found"));

const getOptionalDocument = async <T,>(
  db: PouchDB.Database,
  id: string,
  conflicts = false,
): Promise<T | null> => {
  try {
    return (conflicts ? await db.get(id, { conflicts: true }) : await db.get(id)) as T;
  } catch (error) {
    if (isPouchNotFoundError(error)) return null;
    throw error;
  }
};

const isSongV2Root = (song: DBItem | undefined): boolean =>
  (song?.docType as string | undefined) === "song-v2-root";

const getReferencedDocuments = async <T,>(
  db: PouchDB.Database,
  ids: string[],
  conflicts = false,
): Promise<T[]> => {
  if (!ids.length) return [];
  const result = await db.allDocs({ keys: ids, include_docs: true, ...(conflicts ? { conflicts: true } : {}) });
  return result.rows.flatMap((row) =>
    "doc" in row && row.doc ? [row.doc as unknown as T] : [],
  );
};

export type SongV2RevisionConflict = { documentId: string; revisions: string[] };
export type SongV2Snapshot = SongV2Documents & { hydrated: DBItem; conflicts?: SongV2RevisionConflict[] };

const snapshotFromDocuments = (documents: SongV2Documents): SongV2Snapshot => {
  const conflicts: SongV2RevisionConflict[] = [];
  for (const doc of [documents.root, ...documents.arrangements, ...documents.slides]) {
    const physical = doc as typeof doc & { _conflicts?: string[] };
    if (physical._conflicts?.length) conflicts.push({ documentId: doc._id, revisions: physical._conflicts });
    delete physical._conflicts;
  }
  return { ...documents, ...(conflicts.length ? { conflicts } : {}),
    hydrated: hydrateSongFromV2Documents(documents.root, documents.arrangements, documents.slides, true) };
};

const loadV2Documents = async (
  db: PouchDB.Database,
  root: SongV2RootDocument,
  conflicts = false,
): Promise<SongV2Documents> => {
  const arrangementIds = root.arrangementIds.map((arrangementId) =>
    getSongV2ArrangementDocId(root.songId, arrangementId),
  );
  const arrangements = await getReferencedDocuments<SongV2ArrangementDocument>(
    db,
    arrangementIds,
    conflicts,
  );
  for (const arrangement of arrangements) {
    if (!Array.isArray(arrangement.slideIds)) {
      throw new SongV2DocumentError(
        `Song ${root.songId} arrangement ${arrangement.arrangementId} has no valid slide reference list.`,
      );
    }
  }
  const slideIds = arrangements.flatMap((arrangement) =>
    arrangement.slideIds.map((slideId) =>
      getSongV2SlideDocId(root.songId, arrangement.arrangementId, slideId),
    ),
  );
  const slides = await getReferencedDocuments<SongV2SlideDocument>(db, slideIds, conflicts);
  return { root, arrangements, slides };
};

/** Loads only authoritative v2 documents, retaining their physical revisions. */
export async function loadSongV2Snapshot(
  db: PouchDB.Database,
  songId: string,
  includeConflicts = false,
): Promise<SongV2Snapshot> {
  const root = includeConflicts
    ? await db.get<SongV2RootDocument>(getSongV2RootDocId(songId), { conflicts: true })
    : await db.get<SongV2RootDocument>(getSongV2RootDocId(songId));
  if (root.songId !== songId) throw new SongV2DocumentError("V2 snapshot song identity mismatch");
  if (root.deletedAt) throw new SongV2DeletedError(songId);
  assertValidV2Root(root);
  const documents = await loadV2Documents(db, root, includeConflicts);
  return snapshotFromDocuments(documents);
}

/** Loads a document and hydrates songs into the editor's canonical shape. */
export async function loadItemWithSongHydration(
  db: PouchDB.Database,
  itemId: string,
): Promise<DBItem> {
  const document = await getOptionalDocument<DBItem>(db, itemId);
  if (!document) return loadSong(db, itemId);
  return document.type === "song" ? loadSong(db, itemId) : document;
}

/** Loads one song document and returns its canonical hydrated application shape. */
export async function loadSong(
  db: PouchDB.Database,
  songId: string,
): Promise<DBItem> {
  const v2Root = await getOptionalDocument<SongV2RootDocument>(
    db,
    getSongV2RootDocId(songId),
    true,
  );
  if (v2Root) {
    if (v2Root.deletedAt) throw new SongV2DeletedError(songId);
    if (v2Root.songId !== songId) {
      throw new SongV2DocumentError(
        `Song ${songId} has an invalid schema v2 root document.`,
      );
    }
    assertValidV2Root(v2Root);
    const snapshot = await loadV2Documents(db, v2Root, true);
    if ([snapshot.root, ...snapshot.arrangements, ...snapshot.slides]
      .some(doc => (doc as typeof doc & { _conflicts?: string[] })._conflicts?.length)) {
      const { loadReconciledSongV2Snapshot } = await import("./songV2ReplicationConflicts");
      const resolved = await loadReconciledSongV2Snapshot(db, songId, snapshotFromDocuments(snapshot));
      return normalizeItemSlides(resolved.hydrated);
    }
    return hydrateSongFromV2Documents(snapshot.root, snapshot.arrangements, snapshot.slides);
  }
  const document = (await db.get(songId)) as DBItem;
  if (document.type !== "song") {
    throw new Error(`Document ${songId} is not a song`);
  }
  return normalizeItemSlides(document);
}

/** Creates a song as one canonical Pouch document with the normal audit fields. */
export async function createSong(
  db: PouchDB.Database,
  song: DBItem,
): Promise<DBItem> {
  if (song.type !== "song") throw new Error("Only songs can be created here");
  const now = new Date().toISOString();
  const persisted = applyPouchAudit(
    null,
    normalizeSongForPersistence({
      ...song,
      createdAt: song.createdAt ?? now,
      updatedAt: song.updatedAt ?? now,
    }),
    { isNew: true },
  );
  const result = await db.put(persisted);
  return normalizeItemSlides({ ...persisted, _rev: result.rev });
}

/** Saves a song as one canonical Pouch document, preserving its current audit identity. */
export async function saveSong(
  db: PouchDB.Database,
  song: DBItem,
  currentSong?: DBItem,
  diagnostics?: SongSaveDiagnostics,
  snapshot?: SongV2Snapshot,
): Promise<DBItem> {
  if (song.type !== "song") throw new Error("Only songs can be saved here");
  if (song.docType === "song-v2-root" || isSongV2Root(currentSong)) {
    if (
      !currentSong ||
      !isSongV2Root(currentSong) ||
      currentSong._id !== song._id
    ) {
      throw new SongV2BaselineRequiredError(song._id);
    }
    const { saveSongV2FromBaseline } = await import("./songV2Writer");
    let result;
    try { result = await saveSongV2FromBaseline(db, currentSong, song, snapshot); }
    catch (error) {
      // Another writer can win between validation and put. Re-read once and
      // recompute against the original authored baseline; never blind retry.
      if (!(error instanceof Error && error.name === "SongV2WriteError" &&
        "status" in error && error.status === 409)) throw error;
      result = await saveSongV2FromBaseline(db, currentSong, song);
    }
    if (result.cleanupErrors.length) await reportV2CleanupErrors(db, song._id, result.cleanupErrors, diagnostics);
    return result.song;
  }
  const existing = currentSong ?? await loadSong(db, song._id);
  if (isSongV2Root(existing)) {
    if (!currentSong || !isSongV2Root(currentSong)) {
      throw new SongV2BaselineRequiredError(song._id);
    }
    const { saveSongV2FromBaseline } = await import("./songV2Writer");
    const result = await saveSongV2FromBaseline(db, currentSong, song, snapshot);
    if (result.cleanupErrors.length) await reportV2CleanupErrors(db, song._id, result.cleanupErrors, diagnostics);
    return result.song;
  }
  if (existing.type !== "song") {
    throw new Error(`Document ${song._id} is not a song`);
  }
  if (existing._id !== song._id) {
    throw new Error("Cannot save a song using another song's revision");
  }
  const normalized = normalizeSongForPersistence({
    ...existing,
    ...song,
    _rev: existing._rev,
  });
  const persistedFields = normalized as Record<string, unknown>;
  for (const [key, value] of Object.entries(persistedFields)) {
    if (value === undefined) delete persistedFields[key];
  }
  const persisted = applyPouchAudit(existing, normalized, { isNew: false });
  // Recheck at the commit boundary: this editor may have stayed open while a
  // migration published the authoritative root after the baseline was read.
  if (await getOptionalDocument<SongV2RootDocument>(db, getSongV2RootDocId(song._id))) {
    throw new SongV2VersionTransitionError(song._id);
  }
  const result = await db.put(persisted);
  return normalizeItemSlides({ ...persisted, _rev: result.rev });
}

/**
 * Internal deletion implementation. Keep disconnected from normal application
 * deleteSong until the migration validation rollout explicitly enables it.
 */
export async function deleteSongV2AfterValidation(
  db: PouchDB.Database,
  songId: string,
): Promise<DBItem> {
  const v2Root = await getOptionalDocument<SongV2RootDocument>(
    db,
    getSongV2RootDocId(songId),
  );
  if (v2Root) {
    const previousSong: DBItem = {
      _id: songId,
      _rev: v2Root._rev,
      type: "song",
      docType: "song-v2-root",
      name: v2Root.name,
      selectedArrangement: v2Root.selectedArrangement,
      songAudio: v2Root.songAudio,
      arrangements: [],
    } as unknown as DBItem;

    const { ensureSongV2CleanupDiscovery, reconcileSongV2CleanupDiscovery, reconcileSongV2CleanupQueue } =
      await import("./songV2Writer");
    // The durable discovery record precedes the tombstone so an interrupted
    // scan always has a restart point, including when no children were found yet.
    await ensureSongV2CleanupDiscovery(db, songId);
    if (!v2Root.deletedAt) {
      const tombstone = applyPouchAudit(v2Root, {
        ...v2Root,
        arrangementIds: [],
        deletedAt: new Date().toISOString(),
      }, { isNew: false });
      await db.put(tombstone);
    }

    try {
      const discovery = await reconcileSongV2CleanupDiscovery(db, songId);
      if (!discovery.complete) {
        throw new Error("Cleanup discovery continues in bounded pages.");
      }
    } catch (cause) {
      throw new SongV2DeletionIncompleteError(songId, cause);
    }

    const childCleanup = await reconcileSongV2CleanupQueue(db, songId);
    if (childCleanup.cleanupErrors.length) {
      console.error(`Song ${songId} has v2 child cleanup retries remaining:`, childCleanup.cleanupErrors);
    }
    let legacy: DBItem | null = null;
    try { legacy = await getOptionalDocument<DBItem>(db, songId); }
    catch (error) { console.error("Could not inspect deleted song legacy document for cleanup:", songId, error); }
    if (legacy) {
      try { await db.remove(legacy as PouchDB.Core.RemoveDocument); }
      catch (error) { console.error("Could not clean deleted song legacy document:", songId, error); }
    }
    return previousSong;
  }
  throw new Error(`Song ${songId} is not backed by a v2 root.`);
}

/** Deletes v1 songs unchanged; v2 deletion remains deferred through this app path. */
export async function deleteSong(
  db: PouchDB.Database,
  songId: string,
): Promise<DBItem> {
  const v2Root = await getOptionalDocument<SongV2RootDocument>(
    db,
    getSongV2RootDocId(songId),
  );
  if (v2Root) throw new SongV2DeletionDeferredError(songId);

  const document = (await db.get(songId)) as DBItem;
  if (document.type !== "song") {
    throw new Error(`Document ${songId} is not a song`);
  }
  await db.remove(document as PouchDB.Core.RemoveDocument);
  return document;
}
