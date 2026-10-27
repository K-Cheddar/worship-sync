import type { DBItem, ItemState, SongV2ArrangementDocument } from "../types";
import {
  loadSongV2Snapshot, serializeSongToV2Documents, type SongV2Snapshot, type SongV2RevisionConflict,
} from "./songPersistence";
import { saveSongV2FromBaseline } from "./songV2Writer";
import { formatSong } from "./overflow";
import { mergeLyricText } from "./mergeLyricText";
import _ from "lodash";

export class SongV2ReplicationConflictError extends Error {
  constructor(readonly snapshot: SongV2Snapshot) {
    super("Concurrent song revisions need review.");
    this.name = "SongV2ReplicationConflictError";
  }
}
type RevisionHistory = { _revisions?: { start: number; ids: string[] } };
const revisions = (doc: RevisionHistory) => doc._revisions?.ids.map((id, i) => `${doc._revisions!.start - i}-${id}`) ?? [];
const structure = (doc: SongV2ArrangementDocument) => ({
  ..._.omit(doc, ["_rev", "_revisions", "_conflicts", "createdAt", "createdBy", "updatedAt", "updatedBy", "monitorLayout"]),
  formattedLyrics: doc.formattedLyrics.map(lyric => ({ ...lyric, words: undefined, slideSpan: undefined })),
});

async function prune(db: PouchDB.Database, conflicts: SongV2RevisionConflict[], committed: SongV2Snapshot) {
  for (const conflict of conflicts) {
    const expected = [committed.root, ...committed.arrangements, ...committed.slides].find(doc => doc._id === conflict.documentId);
    if (!expected) continue;
    const current = await db.get(conflict.documentId);
    // Never prune a branch based on a superseded resolution decision.
    if (current._rev !== expected._rev) continue;
    for (const rev of conflict.revisions) {
      try { await db.remove(conflict.documentId, rev); }
      catch (error) {
        if (![404, 409].includes((error as { status?: number }).status ?? 0)) throw error;
      }
    }
  }
}

/** Called only after an explicit conflict choice or a proven disjoint merge. */
export async function pruneResolvedSongV2Conflicts(
  db: PouchDB.Database, adopted: DBItem, approved: SongV2RevisionConflict[],
): Promise<DBItem | undefined> {
  const snapshot = await loadSongV2Snapshot(db, adopted._id, true);
  const content = (song: DBItem) => {
    const docs = serializeSongToV2Documents(song);
    return [docs.root, ...docs.arrangements, ...docs.slides].map(doc =>
      _.omit(doc, ["_rev", "createdAt", "createdBy", "updatedAt", "updatedBy"]));
  };
  if (!_.isEqual(content(snapshot.hydrated), content(adopted))) return;
  // Couch independently chooses each physical winner. An explicit choice of
  // canonical lyrics must also render those lyrics before retiring branches.
  let desired = JSON.parse(JSON.stringify(adopted)) as DBItem;
  for (const [index, arrangement] of desired.arrangements.entries()) {
    const touched = approved.some(conflict =>
      snapshot.arrangements.some(doc => doc._id === conflict.documentId && doc.arrangementId === arrangement.id) ||
      snapshot.slides.some(doc => doc._id === conflict.documentId && doc.arrangementId === arrangement.id));
    if (touched && arrangement.formattedLyrics.length) {
      desired = formatSong({ ...desired, selectedArrangement: index, selectedSlide: 1, selectedBox: 1 } as ItemState) as DBItem;
    }
  }
  const saved = await saveSongV2FromBaseline(db, snapshot.hydrated, desired, snapshot);
  await prune(db, approved, saved.snapshot);
  return saved.song;
}

/** Reconcile eventual Pouch conflicts separately from immediate put/409 races. */
export async function loadReconciledSongV2Snapshot(db: PouchDB.Database, songId: string, initial?: SongV2Snapshot): Promise<SongV2Snapshot> {
  const snapshot = initial ?? await loadSongV2Snapshot(db, songId, true);
  if (!snapshot.conflicts?.length) return snapshot;
  const desired = JSON.parse(JSON.stringify(snapshot.hydrated)) as DBItem;
  for (const conflict of snapshot.conflicts) {
    const winner = snapshot.arrangements.find(doc => doc._id === conflict.documentId);
    // Independent page text can share an arrangement revision. Competing slide
    // bodies or structural changes require the existing explicit choice UI.
    if (!winner) throw new SongV2ReplicationConflictError(snapshot);
    const winningHistory = await db.get<SongV2ArrangementDocument & RevisionHistory>(winner._id, { rev: winner._rev, revs: true });
    let lyrics = winner.formattedLyrics;
    for (const rev of conflict.revisions) {
      const branch = await db.get<SongV2ArrangementDocument & RevisionHistory>(winner._id, { rev, revs: true });
      const branchHistory = new Set(revisions(branch));
      const ancestorRev = revisions(winningHistory).find(candidate => branchHistory.has(candidate));
      if (!ancestorRev) throw new SongV2ReplicationConflictError(snapshot);
      let ancestor: SongV2ArrangementDocument;
      try { ancestor = await db.get<SongV2ArrangementDocument>(winner._id, { rev: ancestorRev }); }
      catch { throw new SongV2ReplicationConflictError(snapshot); }
      if (ancestor.formattedLyrics.some(lyric => lyric.textDocument) ||
        !_.isEqual(structure(ancestor), structure(winner)) || !_.isEqual(structure(ancestor), structure(branch))) {
        throw new SongV2ReplicationConflictError(snapshot);
      }
      lyrics = lyrics.map((lyric, i) => {
        const words = mergeLyricText(ancestor.formattedLyrics[i].words, lyric.words, branch.formattedLyrics[i].words);
        if (words === null) throw new SongV2ReplicationConflictError(snapshot);
        return { ...lyric, words };
      });
    }
    const index = desired.arrangements.findIndex(arr => arr.id === winner.arrangementId);
    desired.arrangements[index].formattedLyrics = lyrics;
    desired.arrangements[index] = formatSong({ ...desired, selectedArrangement: index, selectedSlide: 1, selectedBox: 1 } as ItemState).arrangements[index];
  }
  const saved = await saveSongV2FromBaseline(db, snapshot.hydrated, desired, snapshot);
  await prune(db, snapshot.conflicts, saved.snapshot);
  return saved.snapshot;
}
