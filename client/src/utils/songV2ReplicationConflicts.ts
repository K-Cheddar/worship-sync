import type {
  DBItem, ItemState, SongV2ArrangementDocument, SongV2RootDocument,
  SongV2SlideDocument,
} from "../types";
import {
  getSongV2ArrangementDocId, getSongV2RootDocId, getSongV2SlideDocId,
  hydrateSongFromV2Documents, loadSongV2Snapshot, serializeSongToV2Documents,
  type SongV2RevisionConflict, type SongV2Snapshot,
} from "./songPersistence";
import { saveSongV2FromBaseline } from "./songV2Writer";
import { formatSong } from "./overflow";
import { mergeLyricText } from "./mergeLyricText";
import _ from "lodash";

type RevisionDocument = SongV2RootDocument | SongV2ArrangementDocument | SongV2SlideDocument;
export type SongV2ConflictRevisionOption = { revision: string; document: RevisionDocument };
export type SongV2ConflictRevisionOptions = {
  conflict: SongV2RevisionConflict;
  options: SongV2ConflictRevisionOption[];
};
export type SongV2RevisionSelection = { song: DBItem; sourceRevisions: Record<string, string> };

export class SongV2ReplicationConflictError extends Error {
  constructor(readonly snapshot: SongV2Snapshot) {
    super("Concurrent song revisions need review.");
    this.name = "SongV2ReplicationConflictError";
  }
}

export class SongV2ConflictReviewStaleError extends Error {
  constructor(readonly songId: string) {
    super("The song changed while its saved versions were being reviewed. Reload the review before saving.");
    this.name = "SongV2ConflictReviewStaleError";
  }
}

type RevisionHistory = { _revisions?: { start: number; ids: string[] } };
type RevisionMetadata = RevisionHistory & { _conflicts?: string[] };
const revisions = (doc: RevisionHistory) => doc._revisions?.ids.map((id, i) => `${doc._revisions!.start - i}-${id}`) ?? [];
const withoutRevisionMetadata = <T extends RevisionDocument>(doc: T): T => {
  return _.omit(doc as T & RevisionMetadata, ["_revisions", "_conflicts"]) as T;
};
const structure = (doc: SongV2ArrangementDocument) => ({
  ..._.omit(doc, ["_rev", "_revisions", "_conflicts", "createdAt", "createdBy", "updatedAt", "updatedBy", "monitorLayout"]),
  formattedLyrics: doc.formattedLyrics.map(lyric => ({ ...lyric, words: undefined, slideSpan: undefined })),
});

const unresolvedFingerprints = new WeakMap<PouchDB.Database, Map<string, string>>();
const conflictFingerprint = (snapshot: SongV2Snapshot) => JSON.stringify(
  [...(snapshot.conflicts ?? [])]
    .map(conflict => [conflict.documentId, conflict.winningRevision, [...conflict.revisions].sort()])
    .sort(([a], [b]) => String(a).localeCompare(String(b))),
);
const getUnresolvedFingerprint = (db: PouchDB.Database, songId: string) => unresolvedFingerprints.get(db)?.get(songId);
const setUnresolvedFingerprint = (db: PouchDB.Database, songId: string, fingerprint: string) => {
  let bySong = unresolvedFingerprints.get(db);
  if (!bySong) { bySong = new Map(); unresolvedFingerprints.set(db, bySong); }
  bySong.set(songId, fingerprint);
};
const clearUnresolvedFingerprint = (db: PouchDB.Database, songId: string) => unresolvedFingerprints.get(db)?.delete(songId);

const documentsIn = (snapshot: SongV2Snapshot): RevisionDocument[] => [
  snapshot.root, ...snapshot.arrangements, ...snapshot.slides,
];

const sameRevisionGraph = (expected: SongV2Snapshot, current: SongV2Snapshot) => {
  const expectedById = new Map(documentsIn(expected).map(doc => [doc._id, doc._rev]));
  const currentById = new Map(documentsIn(current).map(doc => [doc._id, doc._rev]));
  return expectedById.size === currentById.size && [...expectedById].every(([id, rev]) => currentById.get(id) === rev);
};

const sameConflictSet = (expected: SongV2RevisionConflict[], current: SongV2RevisionConflict[]) => {
  if (expected.length !== current.length) return false;
  const currentById = new Map(current.map(conflict => [conflict.documentId, conflict]));
  return expected.every(conflict => {
    const latest = currentById.get(conflict.documentId);
    return latest?.winningRevision === conflict.winningRevision &&
      _.isEqual([...latest.revisions].sort(), [...conflict.revisions].sort());
  });
};

const sameConflictLeaves = (expected: SongV2RevisionConflict[], current: SongV2RevisionConflict[]) => {
  if (expected.length !== current.length) return false;
  const currentById = new Map(current.map(conflict => [conflict.documentId, conflict]));
  return expected.every(conflict => {
    const latest = currentById.get(conflict.documentId);
    return !!latest && _.isEqual([...latest.revisions].sort(), [...conflict.revisions].sort());
  });
};

async function prune(
  db: PouchDB.Database,
  conflicts: SongV2RevisionConflict[],
  committed: SongV2Snapshot,
): Promise<boolean> {
  const committedById = new Map(documentsIn(committed).map(doc => [doc._id, doc]));
  const pending: SongV2RevisionConflict[] = [];

  // Validate the full set before removing any leaf. A newer unseen branch must
  // stop the whole retirement pass rather than leave a partial decision.
  for (const conflict of conflicts) {
    const expected = committedById.get(conflict.documentId);
    if (!expected?._rev) return false;
    let current: RevisionDocument & { _conflicts?: string[] };
    try {
      current = await db.get<RevisionDocument & { _conflicts?: string[] }>(conflict.documentId, { conflicts: true });
    } catch {
      return false;
    }
    if (current._rev !== expected._rev ||
      !_.isEqual([...(current._conflicts ?? [])].sort(), [...conflict.revisions].sort())) return false;
    pending.push(conflict);
  }

  for (const conflict of pending) {
    for (const rev of conflict.revisions) {
      try { await db.remove(conflict.documentId, rev); }
      catch (error) {
        if (![404, 409].includes((error as { status?: number }).status ?? 0)) throw error;
      }
    }
  }
  return true;
}

/** Reads every recorded leaf body by revision. This function never writes. */
export async function loadSongV2ConflictRevisionOptions(
  db: PouchDB.Database,
  snapshot: SongV2Snapshot,
): Promise<SongV2ConflictRevisionOptions[]> {
  const byId = new Map(documentsIn(snapshot).map(doc => [doc._id, doc]));
  const options: SongV2ConflictRevisionOptions[] = [];
  for (const conflict of snapshot.conflicts ?? []) {
    const winner = byId.get(conflict.documentId);
    if (!winner || winner._rev !== conflict.winningRevision) throw new SongV2ConflictReviewStaleError(snapshot.root.songId);
    const revisionsToRead = [winner._rev!, ...conflict.revisions];
    const versions = await Promise.all(revisionsToRead.map(async revision => ({
      revision,
      document: await db.get<RevisionDocument>(conflict.documentId, { rev: revision, revs: true }),
    })));
    options.push({ conflict, options: versions });
  }
  return options;
}

/** Builds a complete canonical song from explicit physical revision choices. */
export async function buildSongV2RevisionSelection(
  db: PouchDB.Database,
  snapshot: SongV2Snapshot,
  revisionOptions: SongV2ConflictRevisionOptions[],
  selectedRevisions: Record<string, string>,
): Promise<SongV2RevisionSelection> {
  const optionById = new Map(revisionOptions.map(entry => [entry.conflict.documentId, entry]));
  const currentById = new Map(documentsIn(snapshot).map(doc => [doc._id, doc]));
  const sourceRevisions: Record<string, string> = {};

  const readChosen = async <T extends RevisionDocument>(id: string): Promise<T> => {
    const entry = optionById.get(id);
    if (entry) {
      const selected = selectedRevisions[id] ?? entry.conflict.winningRevision;
      const option = entry.options.find(candidate => candidate.revision === selected);
      if (!option) throw new SongV2ConflictReviewStaleError(snapshot.root.songId);
      sourceRevisions[id] = option.revision;
      return withoutRevisionMetadata(option.document) as T;
    }
    const current = currentById.get(id);
    if (current) {
      sourceRevisions[id] = current._rev ?? "";
      return withoutRevisionMetadata(current) as T;
    }
    const document = await db.get<T & { _conflicts?: string[] }>(id, { conflicts: true, revs: true });
    if (document._conflicts?.length) throw new SongV2ConflictReviewStaleError(snapshot.root.songId);
    sourceRevisions[id] = document._rev ?? "";
    return withoutRevisionMetadata(document) as T;
  };

  const root = await readChosen<SongV2RootDocument>(getSongV2RootDocId(snapshot.root.songId));
  const arrangements: SongV2ArrangementDocument[] = [];
  for (const arrangementId of root.arrangementIds) {
    arrangements.push(await readChosen<SongV2ArrangementDocument>(
      getSongV2ArrangementDocId(root.songId, arrangementId),
    ));
  }
  const slides: SongV2SlideDocument[] = [];
  for (const arrangement of arrangements) {
    for (const slideId of arrangement.slideIds) {
      slides.push(await readChosen<SongV2SlideDocument>(
        getSongV2SlideDocId(root.songId, arrangement.arrangementId, slideId),
      ));
    }
  }
  return {
    song: hydrateSongFromV2Documents(root, arrangements, slides, true),
    sourceRevisions,
  };
}

/** Saves a reviewed choice only if the reviewed winning graph and every leaf are still current. */
export async function resolveSongV2ConflictReview(
  db: PouchDB.Database,
  reviewed: SongV2Snapshot,
  adopted: DBItem,
  approved: SongV2RevisionConflict[],
  sourceRevisions: Record<string, string>,
): Promise<{ song: DBItem; conflictsRetired: boolean }> {
  const current = await loadSongV2Snapshot(db, reviewed.root.songId, true);
  const currentConflicts = current.conflicts ?? [];
  if (!sameRevisionGraph(reviewed, current) ||
    !sameConflictSet(approved, currentConflicts) ||
    !sameConflictSet(reviewed.conflicts ?? [], currentConflicts)) {
    throw new SongV2ConflictReviewStaleError(reviewed.root.songId);
  }

  const conflictById = new Map(approved.map(conflict => [conflict.documentId, conflict]));
  const currentById = new Map(documentsIn(current).map(doc => [doc._id, doc]));
  for (const [id, revision] of Object.entries(sourceRevisions)) {
    const conflict = conflictById.get(id);
    if (conflict) {
      if (revision !== conflict.winningRevision && !conflict.revisions.includes(revision)) {
        throw new SongV2ConflictReviewStaleError(reviewed.root.songId);
      }
      continue;
    }
    const expected = currentById.get(id);
    const latest = expected ?? await db.get<RevisionDocument & { _conflicts?: string[] }>(id, { conflicts: true });
    const latestConflicts = (latest as RevisionDocument & { _conflicts?: string[] })._conflicts;
    if (latest._rev !== revision || latestConflicts?.length) {
      throw new SongV2ConflictReviewStaleError(reviewed.root.songId);
    }
  }

  const saved = await saveSongV2FromBaseline(db, current.hydrated, adopted, current);
  const pruned = await pruneResolvedSongV2Conflicts(db, saved.song, approved, saved.snapshot);
  clearUnresolvedFingerprint(db, reviewed.root.songId);
  return { song: saved.song, conflictsRetired: Boolean(pruned) };
}

/** Retires only explicitly approved leaves after their intended content is already durable. */
export async function pruneResolvedSongV2Conflicts(
  db: PouchDB.Database,
  adopted: DBItem,
  approved: SongV2RevisionConflict[],
  expectedSnapshot?: SongV2Snapshot,
): Promise<DBItem | undefined> {
  const snapshot = await loadSongV2Snapshot(db, adopted._id, true);
  if (expectedSnapshot && !sameRevisionGraph(expectedSnapshot, snapshot)) return;
  if (!sameConflictLeaves(approved, snapshot.conflicts ?? [])) return;
  const canonicalContent = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonicalContent);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalContent(child)]));
    }
    return value;
  };
  const content = (song: DBItem) => {
    const docs = serializeSongToV2Documents(song);
    return [docs.root, ...docs.arrangements, ...docs.slides]
      .map(doc => _.omit(doc, ["_rev", "_revisions", "_conflicts", "createdAt", "createdBy", "updatedAt", "updatedBy"]))
      .map(canonicalContent)
      .sort((left, right) => String((left as { _id: string })._id).localeCompare(String((right as { _id: string })._id)));
  };
  if (!_.isEqual(content(snapshot.hydrated), content(adopted))) return;
  if (!(await prune(db, approved, snapshot))) return;
  clearUnresolvedFingerprint(db, adopted._id);
  return snapshot.hydrated;
}

/** Reconcile only provably disjoint canonical lyric text. */
export async function loadReconciledSongV2Snapshot(
  db: PouchDB.Database,
  songId: string,
  initial?: SongV2Snapshot,
): Promise<SongV2Snapshot> {
  const snapshot = initial ?? await loadSongV2Snapshot(db, songId, true);
  if (!snapshot.conflicts?.length) {
    clearUnresolvedFingerprint(db, songId);
    return snapshot;
  }
  const fingerprint = conflictFingerprint(snapshot);
  const unresolved = (): never => {
    setUnresolvedFingerprint(db, songId, fingerprint);
    throw new SongV2ReplicationConflictError(snapshot);
  };
  if (getUnresolvedFingerprint(db, songId) === fingerprint) unresolved();

  const desired = JSON.parse(JSON.stringify(snapshot.hydrated)) as DBItem;
  for (const conflict of snapshot.conflicts) {
    const winner = snapshot.arrangements.find(doc => doc._id === conflict.documentId);
    // Independent page text can share an arrangement revision. Competing slide
    // bodies or structural changes require the explicit revision chooser.
    if (!winner) return unresolved();
    const winningHistory = await db.get<SongV2ArrangementDocument & RevisionHistory>(winner._id, { rev: winner._rev, revs: true });
    let lyrics = winner.formattedLyrics;
    for (const rev of conflict.revisions) {
      const branch = await db.get<SongV2ArrangementDocument & RevisionHistory>(winner._id, { rev, revs: true });
      const branchHistory = new Set(revisions(branch));
      const ancestorRev = revisions(winningHistory).find(candidate => branchHistory.has(candidate));
      if (!ancestorRev) return unresolved();
      let ancestor: SongV2ArrangementDocument;
      try { ancestor = await db.get<SongV2ArrangementDocument>(winner._id, { rev: ancestorRev }); }
      catch { return unresolved(); }
      if (ancestor.formattedLyrics.some(lyric => lyric.textDocument) ||
        !_.isEqual(structure(ancestor), structure(winner)) || !_.isEqual(structure(ancestor), structure(branch))) {
        return unresolved();
      }
      lyrics = lyrics.map((lyric, i) => {
        const words = mergeLyricText(ancestor.formattedLyrics[i].words, lyric.words, branch.formattedLyrics[i].words);
        if (words === null) return unresolved();
        return { ...lyric, words };
      });
    }
    const index = desired.arrangements.findIndex(arr => arr.id === winner.arrangementId);
    if (index < 0) return unresolved();
    desired.arrangements[index].formattedLyrics = lyrics;
    desired.arrangements[index] = formatSong({ ...desired, selectedArrangement: index, selectedSlide: 1, selectedBox: 1 } as ItemState).arrangements[index];
  }

  const latest = await loadSongV2Snapshot(db, songId, true);
  if (!sameRevisionGraph(snapshot, latest) || !sameConflictSet(snapshot.conflicts, latest.conflicts ?? [])) {
    throw new SongV2ReplicationConflictError(latest);
  }
  const saved = await saveSongV2FromBaseline(db, latest.hydrated, desired, latest);
  const retired = await pruneResolvedSongV2Conflicts(db, saved.song, snapshot.conflicts, saved.snapshot);
  if (!retired) throw new SongV2ReplicationConflictError(await loadSongV2Snapshot(db, songId, true));
  return saved.snapshot;
}
