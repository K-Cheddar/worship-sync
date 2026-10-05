import type { DBItem } from "../types";
import { applyPouchAudit } from "./pouchAudit";
import { normalizeItemSlides, normalizeSongForPersistence } from "./activeItemSlides";

/** Loads a document and hydrates songs into the editor's canonical shape. */
export async function loadItemWithSongHydration(
  db: PouchDB.Database,
  itemId: string,
): Promise<DBItem> {
  const document = (await db.get(itemId)) as DBItem;
  return document.type === "song" ? normalizeItemSlides(document) : document;
}

/** Loads one song document and returns its canonical hydrated application shape. */
export async function loadSong(
  db: PouchDB.Database,
  songId: string,
): Promise<DBItem> {
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
  const existing = currentSong ?? await loadSong(db, song._id);
  if (existing.type !== "song") {
    throw new Error(`Document ${song._id} is not a song`);
  }
  if (existing._id !== song._id) {
    throw new Error("Cannot save a song using another song's revision");
  }
  const persisted = applyPouchAudit(
    existing,
    normalizeSongForPersistence({
      ...existing,
      ...song,
      _rev: existing._rev,
    }),
    { isNew: false },
  );
  const result = await db.put(persisted);
  return normalizeItemSlides({ ...persisted, _rev: result.rev });
}

/** Tombstones the single song document and returns its prior value for cleanup. */
export async function deleteSong(
  db: PouchDB.Database,
  songId: string,
): Promise<DBItem> {
  const document = (await db.get(songId)) as DBItem;
  if (document.type !== "song") {
    throw new Error(`Document ${songId} is not a song`);
  }
  await db.remove(document);
  return document;
}
