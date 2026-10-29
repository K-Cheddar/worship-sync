import PouchDB from "pouchdb-browser";

import { DBItem, SongAudio } from "../types";
import { loadSong, saveSong } from "./songPersistence";

/**
 * Deletes the private object before removing its only durable pointer. If the
 * metadata write fails afterward, the visible attachment provides an
 * idempotent retry path because storage deletion treats a missing key as
 * success.
 */
export const deleteSongAudioBeforeClearingMetadata = async <T>({
  deleteAudio,
  clearMetadata,
}: {
  deleteAudio: () => Promise<unknown>;
  clearMetadata: () => Promise<T>;
}): Promise<T> => {
  await deleteAudio();
  return clearMetadata();
};

export const persistSongAudioAttachment = async ({
  db,
  songId,
  audio,
  baselineSong,
}: {
  db: PouchDB.Database;
  songId: string;
  audio: SongAudio | null;
  baselineSong?: DBItem;
}): Promise<DBItem> => {
  const existing = baselineSong ?? await loadSong(db, songId);
  if (existing._id !== songId) throw new Error("Cannot save audio using another song's baseline");
  const next: DBItem = { ...existing };
  next.songAudio = audio ?? undefined;

  return saveSong(db, next, existing);
};
