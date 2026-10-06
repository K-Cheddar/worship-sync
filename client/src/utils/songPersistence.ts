import type { DBItem, SongV2ArrangementDocument, SongV2Documents, SongV2RootDocument, SongV2SlideDocument } from "../types";
import { applyPouchAudit } from "./pouchAudit";
import { normalizeItemSlides, normalizeSongForPersistence } from "./activeItemSlides";
import {
  SongV2DocumentError,
  SongV2BaselineRequiredError,
  SongV2WriteNotEnabledError,
  assertValidV2Root,
  buildSongV2LibraryProjection,
  getSongV2ArrangementDocId,
  getSongV2RootDocId,
  getSongV2SlideDocId,
  hydrateSongFromV2Documents as hydrateSongV2DocumentsStructural,
  hydrateSongFromV2DocumentsWithNormalizer,
} from "./songV2Codec";
export * from "./songV2Codec";

/** Resolves only the ordered arrangement manifest, never slide documents. */
export async function loadSongV2LibraryProjection(
  db: PouchDB.Database,
  root: SongV2RootDocument,
): Promise<DBItem> {
  assertValidV2Root(root);
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
): Promise<T | null> => {
  try {
    return (await db.get(id)) as T;
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
): Promise<T[]> => {
  if (!ids.length) return [];
  const result = await db.allDocs({ keys: ids, include_docs: true });
  return result.rows.flatMap((row) =>
    "doc" in row && row.doc ? [row.doc as unknown as T] : [],
  );
};

export type SongV2Snapshot = SongV2Documents & { hydrated: DBItem };

const loadV2Documents = async (
  db: PouchDB.Database,
  root: SongV2RootDocument,
): Promise<SongV2Documents> => {
  const arrangementIds = root.arrangementIds.map((arrangementId) =>
    getSongV2ArrangementDocId(root.songId, arrangementId),
  );
  const arrangements = await getReferencedDocuments<SongV2ArrangementDocument>(
    db,
    arrangementIds,
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
  const slides = await getReferencedDocuments<SongV2SlideDocument>(db, slideIds);
  return { root, arrangements, slides };
};

/** Loads only authoritative v2 documents, retaining their physical revisions. */
export async function loadSongV2Snapshot(
  db: PouchDB.Database,
  songId: string,
): Promise<SongV2Snapshot> {
  const root = await db.get<SongV2RootDocument>(getSongV2RootDocId(songId));
  if (root.songId !== songId) throw new SongV2DocumentError("V2 snapshot song identity mismatch");
  assertValidV2Root(root);
  const documents = await loadV2Documents(db, root);
  return {
    ...documents,
    hydrated: hydrateSongFromV2Documents(documents.root, documents.arrangements, documents.slides, true),
  };
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
  );
  if (v2Root) {
    if (v2Root.songId !== songId) {
      throw new SongV2DocumentError(
        `Song ${songId} has an invalid schema v2 root document.`,
      );
    }
    assertValidV2Root(v2Root);
    const snapshot = await loadV2Documents(db, v2Root);
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
    return (await saveSongV2FromBaseline(db, currentSong, song)).song;
  }
  const existing = currentSong ?? await loadSong(db, song._id);
  if (isSongV2Root(existing)) {
    if (!currentSong || !isSongV2Root(currentSong)) {
      throw new SongV2BaselineRequiredError(song._id);
    }
    const { saveSongV2FromBaseline } = await import("./songV2Writer");
    return (await saveSongV2FromBaseline(db, currentSong, song)).song;
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
  const result = await db.put(persisted);
  return normalizeItemSlides({ ...persisted, _rev: result.rev });
}

/** Tombstones the single song document and returns its prior value for cleanup. */
export async function deleteSong(
  db: PouchDB.Database,
  songId: string,
): Promise<DBItem> {
  const v2Root = await getOptionalDocument<SongV2RootDocument>(
    db,
    getSongV2RootDocId(songId),
  );
  if (v2Root) throw new SongV2WriteNotEnabledError(songId, "delete");
  const document = (await db.get(songId)) as DBItem;
  if (document.type !== "song") {
    throw new Error(`Document ${songId} is not a song`);
  }
  await db.remove(document as PouchDB.Core.RemoveDocument);
  return document;
}
