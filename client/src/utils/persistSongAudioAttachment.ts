import PouchDB from "pouchdb-browser";

import { DBItem, SongAudio } from "../types";
import { applyPouchAudit } from "./pouchAudit";

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
}: {
  db: PouchDB.Database;
  songId: string;
  audio: SongAudio | null;
}): Promise<DBItem> => {
  const existing = (await db.get(songId)) as DBItem;
  const next: DBItem = { ...existing };
  if (audio) {
    next.songAudio = audio;
  } else {
    delete next.songAudio;
  }

  const audited = applyPouchAudit(existing, next, { isNew: false });
  const result = await db.put(audited);
  return { ...audited, _rev: result.rev };
};
