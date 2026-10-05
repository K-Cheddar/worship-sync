import type {
  DBItem, SongV2RootDocument, SongV2ArrangementDocument,
  SongV2SlideDocument, SongV2Documents,
} from "../types";
import {
  getSongV2ArrangementDocId, hydrateSongFromV2Documents, loadSongV2Snapshot, serializeSongToV2Documents,
  SongV2DocumentError, type SongV2Snapshot,
} from "./songPersistence";
import { applyPouchAudit } from "./pouchAudit";

type Document = SongV2RootDocument | SongV2ArrangementDocument | SongV2SlideDocument;
type Update<T> = { current: T; next: T };
type Changes<T> = { create: T[]; update: Update<T>[]; delete: T[] };
export type SongV2ChangePlan = {
  root?: Update<SongV2RootDocument>;
  arrangements: Changes<SongV2ArrangementDocument>;
  slides: Changes<SongV2SlideDocument>;
};

export class SongV2ConcurrentEditError extends Error {
  readonly status = 409;
  constructor(
    readonly songId: string,
    readonly documentId: string,
    readonly documentKind: "root" | "arrangement" | "slide",
    readonly reason: "changed" | "already-exists" | "missing",
  ) {
    super(`Song ${songId} ${documentKind} ${documentId} ${reason === "changed" ? "changed while you were editing" : reason === "missing" ? "is no longer available" : "already exists"}.`);
    this.name = "SongV2ConcurrentEditError";
  }
}

// Compare authored JSON values, ignoring object key order and absent/undefined
// equivalence. Only top-level physical revision and audit fields are excluded.
const auditKeys = new Set(["_rev", "createdAt", "createdBy", "updatedAt", "updatedBy"]);
const canonicalValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, canonicalValue(child)]));
  }
  return value;
};
const authoredContent = (doc: Document) => JSON.stringify(canonicalValue(
  Object.fromEntries(Object.entries(doc).filter(([key]) => !auditKeys.has(key))),
));
const changed = (a: Document, b: Document) => authoredContent(a) !== authoredContent(b);

function planChildren<T extends Document>(current: T[], desired: T[]): Changes<T> {
  const before = new Map(current.map(doc => [doc._id, doc]));
  const after = new Set(desired.map(doc => doc._id));
  return {
    create: desired.filter(doc => !before.has(doc._id)),
    update: desired.flatMap(next => {
      const previous = before.get(next._id);
      return previous && changed(previous, next) ? [{ current: previous, next }] : [];
    }),
    delete: current.filter(doc => !after.has(doc._id)),
  };
}

/** The caller's original snapshot is the baseline; never rebase a stale draft. */
export function planSongV2Changes(current: SongV2Snapshot, desired: DBItem): SongV2ChangePlan {
  if (current.root.songId !== desired._id) {
    throw new SongV2DocumentError("Cannot plan a write using another song's snapshot");
  }
  hydrateSongFromV2Documents(current.root, current.arrangements, current.slides, true);
  const next = serializeSongToV2Documents(desired);
  return {
    ...(changed(current.root, next.root) ? { root: { current: current.root, next: next.root } } : {}),
    arrangements: planChildren(current.arrangements, next.arrangements),
    slides: planChildren(current.slides, next.slides),
  };
}

/** Derives authored intent without using a newly-read database snapshot. */
export function planSongV2Intent(baselineSong: DBItem, desiredSong: DBItem): SongV2ChangePlan {
  if (baselineSong._id !== desiredSong._id || baselineSong.type !== "song" || desiredSong.type !== "song") {
    throw new SongV2DocumentError("Cannot plan song v2 intent for different songs");
  }
  const baseline = serializeSongToV2Documents(JSON.parse(JSON.stringify(baselineSong)));
  const desired = serializeSongToV2Documents(JSON.parse(JSON.stringify(desiredSong)));
  return {
    ...(changed(baseline.root, desired.root) ? { root: { current: baseline.root, next: desired.root } } : {}),
    arrangements: planChildren(baseline.arrangements, desired.arrangements),
    slides: planChildren(baseline.slides, desired.slides),
  };
}

export type SongV2WriteProgress = {
  written: string[];
  created: string[];
  deleted: string[];
  cleanupErrors: { documentId: string; cause: unknown }[];
};
export type SongV2WriteResult = SongV2WriteProgress & {
  song: DBItem;
  snapshot: SongV2Snapshot;
};
type WriteStep = { kind: "put" | "remove"; document: Document; isNew: boolean };
type WriteState = {
  documents: SongV2Documents;
  steps: WriteStep[];
  progress: SongV2WriteProgress;
};
export class SongV2WriteError extends Error {
  readonly status?: number;
  constructor(
    readonly documentId: string,
    readonly cause: unknown,
    readonly state: WriteState,
  ) {
    super(`Song v2 write failed for ${documentId}; earlier writes may have committed.`);
    this.name = "SongV2WriteError";
    this.status = typeof cause === "object" && cause !== null && "status" in cause
      ? Number(cause.status) : undefined;
  }
  get progress(): SongV2WriteProgress { return this.state.progress; }
  get remainingDocumentIds(): string[] { return this.state.steps.map(step => step.document._id); }
}

const audited = (next: Document, current?: Document): Document => {
  if (current && !current._rev) throw new SongV2DocumentError(`Missing revision for ${current._id}`);
  const now = new Date().toISOString();
  const { _rev: _ignoredRevision, createdAt: _ignoredCreatedAt,
    createdBy: _ignoredCreatedBy, updatedAt: _ignoredUpdatedAt,
    updatedBy: _ignoredUpdatedBy, ...authored } = next;
  return applyPouchAudit(current, {
    ...authored,
    ...(current ? { _rev: current._rev, createdAt: current.createdAt, createdBy: current.createdBy }
      : { createdAt: now }),
    updatedAt: now,
  }, { isNew: !current });
};

const emptyProgress = (): SongV2WriteProgress => ({
  written: [], created: [], deleted: [], cleanupErrors: [],
});
const putStep = (next: Document, current?: Document): WriteStep => ({
  kind: "put", document: audited(next, current), isNew: !current,
});
const removeStep = (document: Document): WriteStep => {
  if (!document._rev) throw new SongV2DocumentError(`Missing revision for ${document._id}`);
  return { kind: "remove", document, isNew: false };
};
function remember(documents: SongV2Documents, document: Document): void {
  if (document.docType === "song-v2-root") {
    documents.root = document;
  } else if (document.docType === "song-v2-arrangement") {
    documents.arrangements = [...documents.arrangements.filter(doc => doc._id !== document._id), document];
  } else {
    documents.slides = [...documents.slides.filter(doc => doc._id !== document._id), document];
  }
}

async function execute(db: PouchDB.Database, initial: WriteState): Promise<SongV2WriteResult> {
  // Copy state so a retry does not mutate the error's diagnostic history.
  const state: WriteState = {
    documents: { ...initial.documents, arrangements: [...initial.documents.arrangements], slides: [...initial.documents.slides] },
    steps: [...initial.steps],
    progress: {
      written: [...initial.progress.written], created: [...initial.progress.created],
      deleted: [...initial.progress.deleted], cleanupErrors: [...initial.progress.cleanupErrors],
    },
  };
  while (state.steps.length) {
    const step = state.steps[0];
    const doc = step.document;
    try {
      if (step.kind === "put") {
        const response = await db.put(doc);
        remember(state.documents, { ...doc, _rev: response.rev });
        state.progress.written.push(doc._id);
        if (step.isNew) state.progress.created.push(doc._id);
      } else {
        await db.remove(doc._id, doc._rev!);
        state.progress.deleted.push(doc._id);
      }
    } catch (cause) {
      if (step.kind === "put") throw new SongV2WriteError(doc._id, cause, state);
      // All references have already been removed; cleanup is not logical failure.
      state.progress.cleanupErrors.push({ documentId: doc._id, cause });
    }
    state.steps.shift();
  }
  const { root } = state.documents;
  const arrangements = state.documents.arrangements.filter(doc => root.arrangementIds.includes(doc.arrangementId));
  const slides = state.documents.slides.filter(doc => arrangements.some(arr =>
    arr.arrangementId === doc.arrangementId && arr.slideIds.includes(doc.id)));
  const snapshot: SongV2Snapshot = {
    root, arrangements, slides,
    hydrated: hydrateSongFromV2Documents(root, arrangements, slides, true),
  };
  return { ...state.progress, snapshot, song: snapshot.hydrated };
}

function buildSteps(plan: SongV2ChangePlan): WriteStep[] {
  return [
    ...plan.slides.create.map(doc => putStep(doc)),
    ...plan.slides.update.map(({ current: before, next }) => putStep(next, before)),
    ...plan.arrangements.create.map(doc => putStep(doc)),
    ...plan.arrangements.update.map(({ current: before, next }) => putStep(next, before)),
    ...(plan.root ? [putStep(plan.root.next, plan.root.current)] : []),
    ...plan.arrangements.delete.map(removeStep),
    ...plan.slides.delete.map(removeStep),
  ];
}

export type SongV2IntentClassification = "pending" | "already-applied" | "conflict" | "missing";

/** Classifies authored content only; physical revisions and audit fields are ignored. */
export function classifyIntendedDocument<T extends Document>({
  baseline, desired, current,
}: { baseline: T; desired: T; current?: T }): SongV2IntentClassification {
  if (!current) return "missing";
  if (!changed(current, baseline)) return "pending";
  if (!changed(current, desired)) return "already-applied";
  return "conflict";
}

/** Applies only baseline-to-desired intent after validating touched documents against current state. */
export async function saveSongV2FromBaseline(
  db: PouchDB.Database, baselineSong: DBItem, desiredSong: DBItem,
): Promise<SongV2WriteResult> {
  if (baselineSong.docType !== "song-v2-root") {
    throw new SongV2DocumentError("Song v2 interactive saves require a v2 authored baseline");
  }
  const baseline = JSON.parse(JSON.stringify(baselineSong)) as DBItem;
  const desired = JSON.parse(JSON.stringify(desiredSong)) as DBItem;
  const intent = planSongV2Intent(baseline, desired);
  let current: SongV2Snapshot;
  try {
    current = await loadSongV2Snapshot(db, baseline._id);
  } catch (error) {
    if (typeof error === "object" && error !== null && "status" in error && error.status === 404) {
      throw new SongV2ConcurrentEditError(baseline._id, `song-v2:root:${encodeURIComponent(baseline._id)}`, "root", "missing");
    }
    throw error;
  }
  const currentArrangements = new Map(current.arrangements.map(doc => [doc._id, doc]));
  const currentSlides = new Map(current.slides.map(doc => [doc._id, doc]));
  const baselineDocs = serializeSongToV2Documents(baseline);
  const baselineArrangements = new Map(baselineDocs.arrangements.map(doc => [doc._id, doc]));
  const baselineSlides = new Map(baselineDocs.slides.map(doc => [doc._id, doc]));
  const classifyUpdate = <T extends Document>(kind: "root" | "arrangement" | "slide", base: T, desired: T, currentDoc?: T) => {
    const classification = classifyIntendedDocument({ baseline: base, desired, current: currentDoc });
    if (classification === "conflict" || classification === "missing") {
      throw new SongV2ConcurrentEditError(baseline._id, base._id, kind, classification === "missing" ? "missing" : "changed");
    }
    return classification;
  };
  const rootClassification = intent.root
    ? classifyUpdate("root", baselineDocs.root, intent.root.next, current.root)
    : undefined;
  const updateClassifications = <T extends Document>(kind: "arrangement" | "slide", updates: Update<T>[], currentDocs: Map<string, T>, baselineDocsById: Map<string, T>) => new Map(updates.map(({ current: authoredBaseline, next }) => {
    const baseDoc = baselineDocsById.get(authoredBaseline._id);
    if (!baseDoc) throw new SongV2ConcurrentEditError(baseline._id, authoredBaseline._id, kind, "missing");
    return [authoredBaseline._id, classifyUpdate(kind, baseDoc, next, currentDocs.get(authoredBaseline._id))];
  }));
  const arrangementUpdateStatus = updateClassifications("arrangement", intent.arrangements.update, currentArrangements, baselineArrangements);
  const slideUpdateStatus = updateClassifications("slide", intent.slides.update, currentSlides, baselineSlides);

  const currentRootIds = new Set(current.root.arrangementIds);
  const currentArrangementDocs = [...current.arrangements];
  const currentSlideDocs = [...current.slides];
  const recoveredArrangementIds = new Set<string>();
  const recoveredSlideIds = new Set<string>();

  const checkDeletes = async <T extends Document>(kind: "arrangement" | "slide", deletes: T[], currentDocs: Map<string, T>, baselineDocsById: Map<string, T>) => {
    const classifications = new Map<string, "pending" | "already-applied">();
    for (const authoredBaseline of deletes) {
      const baseDoc = baselineDocsById.get(authoredBaseline._id);
      if (!baseDoc) throw new SongV2ConcurrentEditError(baseline._id, authoredBaseline._id, kind, "missing");
      let dbDoc = currentDocs.get(authoredBaseline._id);
      if (!dbDoc) {
        try {
          dbDoc = await db.get(authoredBaseline._id) as T;
          currentDocs.set(authoredBaseline._id, dbDoc);
        } catch (error) {
          if (!(typeof error === "object" && error !== null && "status" in error && error.status === 404)) throw error;
        }
      }
      if (dbDoc) {
        if (changed(dbDoc, baseDoc)) throw new SongV2ConcurrentEditError(baseline._id, authoredBaseline._id, kind, "changed");
        classifications.set(authoredBaseline._id, "pending");
        continue;
      }
      // Absence is converged only when the authoritative parent no longer
      // references the child. Otherwise it is an invalid/incomplete snapshot.
      const parentReflectsRemoval = kind === "arrangement"
        ? !currentRootIds.has((baseDoc as SongV2ArrangementDocument).arrangementId)
        : (() => {
          const slide = baseDoc as SongV2SlideDocument;
          const arrangement = currentArrangements.get(getSongV2ArrangementDocId(baseline._id, slide.arrangementId));
          if (!currentRootIds.has(slide.arrangementId)) return true;
          return arrangement ? !arrangement.slideIds.includes(slide.id) : false;
        })();
      if (!parentReflectsRemoval) throw new SongV2ConcurrentEditError(baseline._id, authoredBaseline._id, kind, "missing");
      classifications.set(authoredBaseline._id, "already-applied");
    }
    return classifications;
  };
  const arrangementDeleteStatus = await checkDeletes("arrangement", intent.arrangements.delete, currentArrangements, baselineArrangements);
  const slideDeleteStatus = await checkDeletes("slide", intent.slides.delete, currentSlides, baselineSlides);

  const checkCreateIds = async <T extends Document>(kind: "arrangement" | "slide", creates: T[], currentDocs: Map<string, T>, recoveredIds: Set<string>, appendCurrent: (doc: T) => void) => {
    for (const doc of creates) {
      const existingInSnapshot = currentDocs.get(doc._id);
      if (existingInSnapshot) {
        if (changed(existingInSnapshot, doc)) throw new SongV2ConcurrentEditError(baseline._id, doc._id, kind, "already-exists");
        recoveredIds.add(doc._id);
        continue;
      }
      try {
        const existing = await db.get(doc._id) as T;
        // Exact authored matches are safe to adopt: the persisted child already
        // satisfies this deterministic create intent and only needs publication.
        if (changed(existing, doc)) throw new SongV2ConcurrentEditError(baseline._id, doc._id, kind, "already-exists");
        recoveredIds.add(doc._id);
        currentDocs.set(doc._id, existing);
        appendCurrent(existing);
      } catch (error) {
        if (error instanceof SongV2ConcurrentEditError) throw error;
        if (!(typeof error === "object" && error !== null && "status" in error && error.status === 404)) throw error;
      }
    }
  };
  await checkCreateIds("arrangement", intent.arrangements.create, currentArrangements, recoveredArrangementIds, doc => currentArrangementDocs.push(doc));
  await checkCreateIds("slide", intent.slides.create, currentSlides, recoveredSlideIds, doc => currentSlideDocs.push(doc));

  const rebase = <T extends Document>(changes: Changes<T>, currentDocs: Map<string, T>, deleteStatus: Map<string, "pending" | "already-applied">): Changes<T> => ({
    create: changes.create.filter(doc => !(doc.docType === "song-v2-arrangement" ? recoveredArrangementIds : recoveredSlideIds).has(doc._id)),
    update: changes.update.filter(({ next }) => (next.docType === "song-v2-arrangement" ? arrangementUpdateStatus : slideUpdateStatus).get(next._id) === "pending").map(({ next }) => ({ current: currentDocs.get(next._id)!, next })),
    delete: changes.delete.filter(doc => deleteStatus.get(doc._id) === "pending").map(doc => currentDocs.get(doc._id)!),
  });
  const plan: SongV2ChangePlan = {
    ...(intent.root && rootClassification === "pending" ? { root: { current: current.root, next: intent.root.next } } : {}),
    arrangements: rebase(intent.arrangements, currentArrangements, arrangementDeleteStatus),
    slides: rebase(intent.slides, currentSlides, slideDeleteStatus),
  };
  return execute(db, { documents: { ...current, arrangements: currentArrangementDocs, slides: currentSlideDocs }, steps: buildSteps(plan), progress: emptyProgress() });
}

/** Snapshot-based low-level writer retained for migration tooling and focused tests. */
export async function saveSongV2(
  db: PouchDB.Database, current: SongV2Snapshot, desired: DBItem,
): Promise<SongV2WriteResult> {
  const baseline: SongV2Snapshot = JSON.parse(JSON.stringify(current));
  const plan = planSongV2Changes(baseline, JSON.parse(JSON.stringify(desired)));
  return execute(db, { documents: baseline, steps: buildSteps(plan), progress: emptyProgress() });
}

/** Root-last publication. Existing children/root cause normal Couch conflicts. */
export async function createSongV2(db: PouchDB.Database, song: DBItem): Promise<SongV2WriteResult> {
  const documents = serializeSongToV2Documents(JSON.parse(JSON.stringify(song)));
  const steps = [
    ...documents.slides.map(doc => putStep(doc)),
    ...documents.arrangements.map(doc => putStep(doc)),
    putStep(documents.root),
  ];
  return execute(db, { documents, steps, progress: emptyProgress() });
}

/** Explicit retry only: skips acknowledged durable writes, retains failed revisions.
 * A 409 requires caller resolution; this never reloads/merges to bypass it.
 * A lost acknowledgement has unknown outcome and may conflict on retry.
 */
export async function resumeSongV2Write(db: PouchDB.Database, error: SongV2WriteError): Promise<SongV2WriteResult> {
  return execute(db, error.state);
}

