import type { DBItem, SongV2RootDocument, SongV2ArrangementDocument } from "../types";
import { buildSongV2LibraryProjection, getSongV2RootDocId } from "./songPersistence";

export type SongLibraryDiagnostic = {
  songId: string;
  rootId: string;
  code: "incomplete-v2";
  message: string;
};

/** Uses the root activation marker even when its referenced children are incomplete. */
export function discoverSongLibrary(documents: unknown[]): {
  songs: DBItem[];
  diagnostics: SongLibraryDiagnostic[];
} {
  const songs = new Map<string, DBItem>();
  const roots: SongV2RootDocument[] = [];
  const arrangements = new Map<string, SongV2ArrangementDocument[]>();
  for (const input of documents) {
    if (!input || typeof input !== "object") continue;
    const doc = input as Record<string, unknown>;
    if (doc.docType === "song-v2-root") roots.push(input as SongV2RootDocument);
    else if (doc.docType === "song-v2-arrangement") {
      const arrangement = input as SongV2ArrangementDocument;
      const group = arrangements.get(arrangement.songId) ?? [];
      group.push(arrangement);
      arrangements.set(arrangement.songId, group);
    }
    else if (doc.type === "song" && !doc.docType?.toString().startsWith("song-v2-")) {
      songs.set(String(doc._id), input as DBItem);
    }
  }
  const diagnostics: SongLibraryDiagnostic[] = [];
  for (const root of roots) {
    // The physical root ID also suppresses a stale predecessor if songId is corrupt.
    let physicalSongId = root.songId;
    try {
      if (root._id.startsWith("song-v2:root:")) physicalSongId = decodeURIComponent(root._id.slice("song-v2:root:".length));
    } catch { /* Invalid encoding is reported by root validation below. */ }
    songs.delete(physicalSongId);
    songs.delete(root.songId);
    try {
      if (root._id !== getSongV2RootDocId(root.songId)) throw new Error("Invalid root identity");
      songs.set(root.songId, buildSongV2LibraryProjection(root, arrangements.get(root.songId) ?? []));
    } catch (error) {
      diagnostics.push({
        songId: physicalSongId, rootId: root._id, code: "incomplete-v2",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { songs: [...songs.values()], diagnostics };
}
