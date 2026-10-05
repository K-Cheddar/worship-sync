import type {
  DBItem, SongV2RootDocument, SongV2ArrangementDocument,
  SongV2SlideDocument, SongV2Documents,
} from "../types";
import {
  hydrateSongFromV2Documents, serializeSongToV2Documents,
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

/** Dormant v2 save: baseline revisions are required and never silently reloaded. */
export async function saveSongV2(
  db: PouchDB.Database, current: SongV2Snapshot, desired: DBItem,
): Promise<SongV2WriteResult> {
  // Detach all input before the first await so later draft mutations cannot
  // change the payload or original owner of pending work.
  const baseline: SongV2Snapshot = JSON.parse(JSON.stringify(current));
  const plan = planSongV2Changes(baseline, JSON.parse(JSON.stringify(desired)));
  const steps = [
    ...plan.slides.create.map(doc => putStep(doc)),
    ...plan.slides.update.map(({ current: before, next }) => putStep(next, before)),
    ...plan.arrangements.create.map(doc => putStep(doc)),
    ...plan.arrangements.update.map(({ current: before, next }) => putStep(next, before)),
    ...(plan.root ? [putStep(plan.root.next, plan.root.current)] : []),
    ...plan.arrangements.delete.map(removeStep),
    ...plan.slides.delete.map(removeStep),
  ];
  return execute(db, { documents: baseline, steps, progress: emptyProgress() });
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

