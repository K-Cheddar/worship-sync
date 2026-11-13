import isEqual from "lodash/isEqual";
import type { DBItemListDetails, ServiceItem } from "../types";
import { isPouchConflict } from "./persistOverlayDoc";
import {
  getOutlineItemConflicts,
  reconcileOutlineItems,
  type OutlineItemChoices,
  type OutlineMoveIntent,
} from "./outlineSync";

const SERVICE_LIST_PUT_MAX_ATTEMPTS = 4;
type QueuedFieldSave = { document: DBItemListDetails; didWrite: boolean; intent: ServiceItem[] | string[] };
type FieldSaveQueue = { pending?: Promise<QueuedFieldSave>; lastWritten?: QueuedFieldSave };
const savesByDatabase = new WeakMap<ServiceListFieldDb, Map<string, FieldSaveQueue>>();
const saveVersionsByDatabase = new WeakMap<ServiceListFieldDb, Map<string, number>>();

type RevisionHistory = { _rev?: string; _revisions?: { start: number; ids: string[] } };
type PersistedOutlineMove = Omit<OutlineMoveIntent, "ownerKey">;
type PersistedOutlineMoveMarker = { baseRevision: string; baselineOrder: string[]; moves: PersistedOutlineMove[] };
type RevisionDoc = DBItemListDetails & RevisionHistory & {
  _conflicts?: string[];
  outlineMoveIntent?: PersistedOutlineMoveMarker;
};

export type OutlineRevisionGraph = {
  winningRevision: string;
  conflictRevisions: string[];
  histories: Record<string, string[]>;
};

export type OutlineRevisionConflict = {
  graph: OutlineRevisionGraph;
  versions: Array<{ revision: string; items: ServiceItem[]; document?: DBItemListDetails }>;
  /** Baseline-proven merge of non-item fields; items may still need review. */
  remoteDocument?: DBItemListDetails;
  itemReview?: OutlineItemReview;
  documentConflicts?: string[];
};

export type OutlineItemReview = {
  baselineItems: ServiceItem[];
  localItems: ServiceItem[];
  remoteItems: ServiceItem[];
};
export type OutlineRevisionSelection =
  | { kind: "rows"; review: OutlineItemReview; choices: OutlineItemChoices }
  | { kind: "whole"; revision?: string };

/** Whole-version fallback still retains baseline-proven independent metadata. */
export const outlineRevisionChoiceDocument = (
  reviewed: OutlineRevisionConflict,
  selected: DBItemListDetails,
): DBItemListDetails => {
  if (!reviewed.remoteDocument) return selected;
  const document = { ...reviewed.remoteDocument } as unknown as Record<string, unknown>;
  const source = selected as unknown as Record<string, unknown>;
  for (const field of reviewed.documentConflicts ?? []) {
    if (Object.prototype.hasOwnProperty.call(source, field)) document[field] = source[field];
    else delete document[field];
  }
  return document as unknown as DBItemListDetails;
};

/** Incorporate a draft only when it can be rebased onto the first saved
 * version without another unresolved choice. Otherwise preview whole versions. */
export const outlineRevisionItemReview = (
  conflict: OutlineRevisionConflict,
  draft: ServiceItem[],
  draftBaseline: ServiceItem[],
): OutlineItemReview | undefined => {
  const review = conflict.itemReview;
  if (!review || !hasStableRowIds(draft) || !hasStableRowIds(draftBaseline)) return undefined;
  const local = reconcileOutlineItems(draftBaseline, draft, review.localItems);
  if (local.kind === "conflict") return undefined;
  const combined = { ...review, localItems: local.items };
  if (getOutlineItemConflicts(combined.baselineItems, combined.localItems, combined.remoteItems)
    .some((entry) => entry.reason === "replacement")) return undefined;
  return combined;
};

export type ServiceListFieldDb = {
  get: (
    id: string,
    options?: { conflicts?: boolean; rev?: string; revs?: boolean },
  ) => Promise<unknown>;
  put: (doc: DBItemListDetails) => Promise<{ rev?: string } | unknown>;
  remove?: (id: string, rev: string) => Promise<unknown>;
};

export class ServiceListConflictError extends Error {
  readonly revisionConflict?: OutlineRevisionConflict;

  constructor(
    readonly remoteItems: ServiceItem[],
    revisionConflict?: OutlineRevisionConflict,
  ) {
    super("The outline changed in another session while local edits were pending");
    this.name = "ServiceListConflictError";
    this.revisionConflict = revisionConflict;
  }
}

type RevisionBranchSet = {
  graph: OutlineRevisionGraph;
  winner: RevisionDoc;
  versions: RevisionDoc[];
};

const revisionHistory = (doc: RevisionHistory) => doc._revisions?.ids.map(
  (id, index) => `${doc._revisions!.start - index}-${id}`,
) ?? [];

const readRevisionBranchSet = async (
  db: ServiceListFieldDb,
  listId: string,
): Promise<RevisionBranchSet> => {
  const head = await db.get(listId, { conflicts: true, revs: true }) as RevisionDoc;
  const conflictRevisions = [...(head._conflicts ?? [])].sort();
  const winner = head._rev
    ? head
    : await db.get(listId, { revs: true }) as RevisionDoc;
  const loadedVersions = await Promise.all(conflictRevisions.map(async (rev) => {
    try {
      return await db.get(listId, { rev, revs: true }) as RevisionDoc;
    } catch {
      return undefined;
    }
  }));
  const versions = loadedVersions.filter((version): version is RevisionDoc => Boolean(version));
  const histories: Record<string, string[]> = {};
  if (winner._rev) histories[winner._rev] = revisionHistory(winner);
  loadedVersions.forEach((version, index) => {
    histories[conflictRevisions[index]] = version ? revisionHistory(version) : [];
  });
  return {
    graph: {
      winningRevision: winner._rev ?? "",
      conflictRevisions,
      histories,
    },
    winner,
    versions: [winner, ...versions],
  };
};

const sameRevisionGraph = (left: OutlineRevisionGraph, right: OutlineRevisionGraph) =>
  left.winningRevision === right.winningRevision &&
  isEqual(left.conflictRevisions, right.conflictRevisions) &&
  isEqual(left.histories, right.histories);

const conflictDetails = (
  branches: RevisionBranchSet,
  remoteDocument?: DBItemListDetails,
  itemReview?: OutlineItemReview,
  documentConflicts?: string[],
): OutlineRevisionConflict => ({
  graph: branches.graph,
  versions: branches.versions.map((version) => ({
    revision: version._rev ?? "",
    items: (version.items ?? []).map((item) => ({ ...item })),
    document: version,
  })),
  ...(remoteDocument ? { remoteDocument } : {}),
  ...(itemReview ? { itemReview } : {}),
  ...(documentConflicts?.length ? { documentConflicts } : {}),
});

const hasStableRowIds = (items: ServiceItem[]) => {
  const ids = items.map((item) => item.listId);
  return ids.every((id) => typeof id === "string" && id.length > 0) &&
    new Set(ids).size === ids.length;
};

const hasOwn = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

const sameField = (left: Record<string, unknown>, right: Record<string, unknown>, key: string) =>
  hasOwn(left, key) === hasOwn(right, key) && isEqual(left[key], right[key]);

const mergeRevisionDocuments = (
  baseline: DBItemListDetails,
  left: DBItemListDetails,
  right: DBItemListDetails,
): { document: DBItemListDetails; conflictingFields: string[] } => {
  const merged: Record<string, unknown> = { ...left };
  const conflictingFields: string[] = [];
  const keys = new Set([
    ...Object.keys(baseline),
    ...Object.keys(left),
    ...Object.keys(right),
  ]);
  keys.forEach((key) => {
    if (["_rev", "_revisions", "_conflicts", "outlineMoveIntent"].includes(key)) return;
    const base = baseline as unknown as Record<string, unknown>;
    const local = left as unknown as Record<string, unknown>;
    const remote = right as unknown as Record<string, unknown>;
    const localChanged = !sameField(base, local, key);
    const remoteChanged = !sameField(base, remote, key);
    if (!remoteChanged) return;

    if (key === "items") {
      const baseItems = (baseline.items ?? []) as ServiceItem[];
      const result = reconcileOutlineItems(
        baseItems,
        (left.items ?? []) as ServiceItem[],
        (right.items ?? []) as ServiceItem[],
      );
      const rowConflict = result.kind === "conflict" ||
        !hasStableRowIds(baseItems) ||
        !hasStableRowIds((left.items ?? []) as ServiceItem[]) ||
        !hasStableRowIds((right.items ?? []) as ServiceItem[]);
      if (rowConflict) conflictingFields.push(key);
      merged.items = result.items;
      return;
    }

    // updatedAt is generated by every outline save. Keep the later valid
    // timestamp while preserving all other metadata by field-level merge.
    if (key === "updatedAt" && localChanged && !isEqual(left.updatedAt, right.updatedAt)) {
      const localTime = typeof left.updatedAt === "string" ? Date.parse(left.updatedAt) : NaN;
      const remoteTime = typeof right.updatedAt === "string" ? Date.parse(right.updatedAt) : NaN;
      if (Number.isFinite(localTime) && Number.isFinite(remoteTime)) {
        merged.updatedAt = localTime >= remoteTime ? left.updatedAt : right.updatedAt;
        return;
      }
    }

    if (!localChanged) {
      if (hasOwn(remote, key)) merged[key] = remote[key];
      else delete merged[key];
      return;
    }
    if (!sameField(local, remote, key)) conflictingFields.push(key);
  });
  return {
    document: merged as unknown as DBItemListDetails,
    conflictingFields,
  };
};

const mergeRevisionBranches = async (
  db: ServiceListFieldDb,
  listId: string,
  branches: RevisionBranchSet,
) => {
  if (branches.versions.length !== branches.graph.conflictRevisions.length + 1) {
    return undefined;
  }
  const histories = branches.versions.map(revisionHistory);
  if (histories.some((history) => history.length === 0)) return undefined;
  const commonRevisions = histories[0].filter((revision) =>
    histories.every((history) => history.includes(revision)),
  ).sort((left, right) => Number(right.split("-")[0]) - Number(left.split("-")[0]));
  const commonRevision = commonRevisions[0];
  if (!commonRevision) return undefined;

  let baseline: DBItemListDetails;
  try {
    baseline = await db.get(listId, { rev: commonRevision }) as DBItemListDetails;
  } catch {
    return undefined;
  }
  if (!hasStableRowIds(baseline.items ?? []) || !hasStableRowIds(branches.winner.items ?? [])) return undefined;

  let merged = { ...branches.winner } as DBItemListDetails;
  const conflictingFields = new Set<string>();
  for (const branch of branches.versions.slice(1)) {
    if (!hasStableRowIds(branch.items ?? [])) return undefined;
    const result = mergeRevisionDocuments(baseline, merged, branch);
    merged = result.document;
    result.conflictingFields.forEach((field) => conflictingFields.add(field));
  }
  const documentConflicts = [...conflictingFields].filter((field) => field !== "items");
  const requiresReview = conflictingFields.size > 0;
  delete (merged as RevisionDoc)._conflicts;
  delete (merged as RevisionDoc)._revisions;
  merged._rev = branches.graph.winningRevision;
  const itemReview = conflictingFields.has("items") && !documentConflicts.length && branches.versions.length === 2 ? {
    baselineItems: baseline.items ?? [],
    localItems: branches.winner.items ?? [],
    remoteItems: branches.versions[1].items ?? [],
  } : undefined;
  return { document: merged, requiresReview, itemReview, documentConflicts, baseline };
};

const updatedDocument = <K extends "items" | "overlays">(
  current: DBItemListDetails,
  field: K,
  value: K extends "items" ? ServiceItem[] : string[],
) => {
  const document = { ...current } as RevisionDoc;
  delete document._conflicts;
  delete document._revisions;
  delete document.outlineMoveIntent;
  return {
    ...document,
    [field]: value,
    updatedAt: new Date().toISOString(),
  } as DBItemListDetails;
};

const resultRevision = (result: unknown) =>
  typeof result === "object" && result !== null && "rev" in result
    ? (result as { rev?: string }).rev
    : undefined;

const retireReviewedBranches = async (
  db: ServiceListFieldDb,
  listId: string,
  reviewed: OutlineRevisionGraph,
  committedRevision: string,
  expected: DBItemListDetails,
  isCurrent = () => true,
) => {
  if (!db.remove || !isCurrent()) return false;
  const current = await readRevisionBranchSet(db, listId);
  const winnerHistory = current.graph.histories[current.graph.winningRevision] ?? [];
  if (
    !isCurrent() || current.graph.winningRevision !== committedRevision ||
    !winnerHistory.includes(reviewed.winningRevision) ||
    !isEqual(current.graph.conflictRevisions, reviewed.conflictRevisions)
  ) return false;
  if (reviewed.conflictRevisions.some((revision) =>
    !isEqual(current.graph.histories[revision], reviewed.histories[revision]),
  )) return false;

  // Verify the acknowledged body, including non-item fields, before deleting
  // any reviewed leaf. A successful put response alone does not prove content.
  const { _rev: _expectedRev, _revisions: _expectedHistory, _conflicts: _expectedConflicts, ...expectedBody } = expected as RevisionDoc;
  const { _rev: _actualRev, _revisions: _actualHistory, _conflicts: _actualConflicts, ...actualBody } = current.winner;
  if (!isEqual(expectedBody, actualBody)) return false;

  for (const revision of reviewed.conflictRevisions) {
    if (!isCurrent()) return false;
    await db.remove(listId, revision);
  }
  const verified = await db.get(listId, { conflicts: true }) as RevisionDoc;
  return !(verified._conflicts?.length);
};

function persistServiceListField<K extends "items" | "overlays">(
  db: ServiceListFieldDb,
  listId: string,
  field: K,
  value: K extends "items" ? ServiceItem[] : string[],
  baseline?: ServiceItem[],
  isCurrent = () => true,
  moveIntents: OutlineMoveIntent[] = [],
): Promise<DBItemListDetails> {
  let saves = savesByDatabase.get(db);
  if (!saves) {
    saves = new Map();
    savesByDatabase.set(db, saves);
  }
  let versions = saveVersionsByDatabase.get(db);
  if (!versions) {
    versions = new Map();
    saveVersionsByDatabase.set(db, versions);
  }
  const key = JSON.stringify([listId, field]);
  const version = (versions.get(key) ?? 0) + 1;
  versions.set(key, version);
  const queue = saves.get(key) ?? {};
  saves.set(key, queue);
  const previous = queue.pending;
  // Serialize same-field writes so the last user intention is always the last
  // database write, even when an earlier PouchDB put is already in flight.
  const saving = (previous?.catch(() => undefined) ?? Promise.resolve(undefined)).then(async () => {
    const result = await persistServiceListFieldNow(
      db,
      listId,
      field,
      value,
      field === "items" && queue.lastWritten?.didWrite
        ? queue.lastWritten.intent as ServiceItem[]
        : baseline,
      isCurrent,
      () => versions?.get(key) === version,
      moveIntents,
    );
    if (result.didWrite) queue.lastWritten = result;
    return result;
  });
  queue.pending = saving;
  return saving.then(({ document }) => document).finally(() => {
    if (saves?.get(key) === queue && queue.pending === saving) {
      saves.delete(key);
      if (versions?.get(key) === version) versions.delete(key);
    }
  });
}

async function persistServiceListFieldNow<K extends "items" | "overlays">(
  db: ServiceListFieldDb,
  listId: string,
  field: K,
  value: K extends "items" ? ServiceItem[] : string[],
  baseline?: ServiceItem[],
  isCurrent = () => true,
  isLatest = () => true,
  moveIntents: OutlineMoveIntent[] = [],
): Promise<QueuedFieldSave> {
  let lastError: unknown;

  for (let attempt = 0; attempt < SERVICE_LIST_PUT_MAX_ATTEMPTS; attempt += 1) {
    if (!isCurrent()) throw new Error("The outline save session ended");
    let current = await db.get(listId, { conflicts: true }) as RevisionDoc;
    if (!isLatest()) return { document: current, didWrite: false, intent: value };
    if (field === "items" && baseline && current._conflicts?.length) {
      const branches = await readRevisionBranchSet(db, listId);
      const branchMerge = await mergeRevisionBranches(db, listId, branches);
      const winnerHistory = branches.graph.histories[branches.graph.winningRevision] ?? [];
      let latestBaselineRevision: string | undefined;
      for (const revision of winnerHistory) {
        try {
          const ancestor = revision === branches.winner._rev
            ? branches.winner
            : await db.get(listId, { rev: revision }) as DBItemListDetails;
          if (isEqual(ancestor.items ?? [], baseline)) {
            latestBaselineRevision = revision;
            break;
          }
        } catch {
          break;
        }
      }
      // A losing leaf that forked before the Controller's loaded baseline is
      // historical, even when an older ancestor happens to have identical rows.
      if (branchMerge && isEqual(branchMerge.baseline.items ?? [], baseline) &&
        branchMerge.baseline._rev === latestBaselineRevision) {
        if (branchMerge.requiresReview) {
          if (branchMerge.itemReview && !branchMerge.documentConflicts.length) {
            const branchesReconciled = reconcileOutlineItems(
              branchMerge.itemReview.baselineItems,
              branchMerge.itemReview.localItems,
              branchMerge.itemReview.remoteItems,
            );
            if (branchesReconciled.kind === "merged") {
              current = { ...branchMerge.document, items: branchesReconciled.items,
                _rev: branches.winner._rev } as RevisionDoc;
            } else {
              const focusedReview = {
                baselineItems: branchMerge.itemReview.baselineItems,
                localItems: value as ServiceItem[],
                remoteItems: branchMerge.itemReview.localItems,
              };
              throw new ServiceListConflictError(
                focusedReview.remoteItems,
                conflictDetails(branches, branchMerge.document, focusedReview),
              );
            }
          } else {
          throw new ServiceListConflictError(
            (branchMerge.document.items ?? []) as ServiceItem[],
            conflictDetails(branches, branchMerge.document, branchMerge.itemReview, branchMerge.documentConflicts),
          );
          }
        } else {
          current = { ...branchMerge.document, _rev: branches.winner._rev } as RevisionDoc;
        }
      }
    }
    if (!isCurrent()) throw new Error("The outline save session ended");
    if (!isLatest()) return { document: current, didWrite: false, intent: value };
    // Ordinary edits extend the winner using its CAS revision. Historical
    // losing leaves are preserved for separately authorized maintenance.
    let nextValue = value;
    if (field === "items" && baseline) {
      const reconciled = reconcileOutlineItems(
        baseline,
        value as ServiceItem[],
        (current.items ?? []) as ServiceItem[],
        undefined,
        moveIntents,
      );
      if (reconciled.kind === "conflict") {
        throw new ServiceListConflictError(
          reconciled.remoteItems,
        );
      }
      nextValue = reconciled.items as typeof value;
    }

    const next = updatedDocument(current, field, nextValue);
    if (field === "items" && baseline && moveIntents.length && current._rev &&
      isEqual(current.items ?? [], baseline) && sameOutlineRowsIgnoringOrder(baseline, nextValue as ServiceItem[]) &&
      !isEqual(baseline.map(item => item.listId), (nextValue as ServiceItem[]).map(item => item.listId))) {
      const marker: PersistedOutlineMoveMarker = {
        baseRevision: current._rev,
        baselineOrder: baseline.map(item => item.listId),
        moves: moveIntents.map(({ ownerKey: _ownerKey, ...move }) => move),
      };
      if (rowsMatchPersistedMove(baseline, nextValue as ServiceItem[], marker)) {
        (next as RevisionDoc).outlineMoveIntent = marker;
      }
    }

    try {
      if (!isCurrent()) throw new Error("The outline save session ended");
      if (!isLatest()) return { document: current, didWrite: false, intent: value };
      const result = await db.put(next);
      const rev = resultRevision(result);
      const saved = rev ? { ...next, _rev: rev } : next;
      return { document: saved, didWrite: true, intent: value };
    } catch (error) {
      lastError = error;
      if (!isLatest()) return { document: current, didWrite: false, intent: value };
      if (
        isPouchConflict(error) &&
        attempt < SERVICE_LIST_PUT_MAX_ATTEMPTS - 1
      ) continue;
      throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Service outline save failed");
}

export const persistServiceListItems = (
  db: ServiceListFieldDb,
  listId: string,
  items: ServiceItem[],
  baseline?: ServiceItem[],
  isCurrent?: () => boolean,
  moveIntents?: OutlineMoveIntent[],
) => persistServiceListField(db, listId, "items", items, baseline, isCurrent, moveIntents);

const sameOutlineRowsIgnoringOrder = (left: ServiceItem[], right: ServiceItem[]) => {
  if (!hasStableRowIds(left) || !hasStableRowIds(right) || left.length !== right.length) return false;
  const rightById = new Map(right.map(item => [item.listId, item]));
  return left.every(item => isEqual(item, rightById.get(item.listId)));
};

const withoutOutlineRevisionMetadata = (document: DBItemListDetails) =>
  Object.fromEntries(Object.entries(document).filter(([key]) =>
    !["_rev", "_revisions", "_conflicts", "outlineMoveIntent"].includes(key),
  ));

const validPersistedMoveMarker = (
  marker: PersistedOutlineMoveMarker | undefined,
  listId: string,
): marker is PersistedOutlineMoveMarker => Boolean(
  marker && typeof marker === "object" && !Array.isArray(marker) &&
  typeof marker.baseRevision === "string" && marker.baseRevision &&
  Array.isArray(marker.baselineOrder) && marker.baselineOrder.length > 0 &&
  marker.baselineOrder.every(id => typeof id === "string" && id.length > 0) &&
  new Set(marker.baselineOrder).size === marker.baselineOrder.length &&
  Array.isArray(marker.moves) && marker.moves.length > 0 && marker.moves.every(move =>
    !!move && typeof move === "object" && !Array.isArray(move) &&
    move.outlineId === listId && Array.isArray(move.movedIds) && move.movedIds.length > 0 &&
    move.movedIds.every(id => typeof id === "string" && id.length > 0) &&
    (move.beforeId === undefined || typeof move.beforeId === "string") &&
    (move.afterId === undefined || typeof move.afterId === "string") &&
    (move.edge === undefined || move.edge === "start" || move.edge === "end"),
  ),
);

const overlappingMoveDestinationsAgree = (
  left: PersistedOutlineMoveMarker,
  right: PersistedOutlineMoveMarker,
) => {
  const leftIds = new Set(left.moves.flatMap(move => move.movedIds));
  const rightIds = new Set(right.moves.flatMap(move => move.movedIds));
  return [...leftIds].filter(id => rightIds.has(id)).every(id => {
    const leftMove = [...left.moves].reverse().find(move => move.movedIds.includes(id));
    const rightMove = [...right.moves].reverse().find(move => move.movedIds.includes(id));
    return isEqual(leftMove, rightMove);
  });
};

const rowsMatchPersistedMove = (
  baseline: ServiceItem[],
  branch: ServiceItem[],
  marker: PersistedOutlineMoveMarker,
) => {
  const moves = marker.moves.map(move => ({ ...move, ownerKey: "saved-outline-reconciliation" }));
  const result = reconcileOutlineItems(baseline, branch, baseline, undefined, moves);
  return result.kind === "merged" && isEqual(
    result.items.map(item => item.listId),
    branch.map(item => item.listId),
  );
};

/** Incorporates only a pair of directly concurrent, order-only edits. This is
 * called from Controller refresh paths after runtime drag intentions have
 * already been acknowledged and cleared. Historical graphs remain untouched. */
export const reconcileConcurrentOutlineMoves = async (
  db: ServiceListFieldDb,
  listId: string,
  isCurrent = () => true,
  isAuthorized = (_movedRows: ServiceItem[]) => true,
  initialHead?: DBItemListDetails & { _conflicts?: string[]; outlineMoveIntent?: PersistedOutlineMoveMarker },
): Promise<DBItemListDetails | undefined> => {
  if (!isCurrent()) return;
  const head = initialHead
    ? initialHead as RevisionDoc
    : await db.get(listId, { conflicts: true }) as RevisionDoc;
  if (!isCurrent() || !head._conflicts?.length ||
    !validPersistedMoveMarker(head.outlineMoveIntent, listId)) return;

  const branches = await readRevisionBranchSet(db, listId);
  if (!isCurrent() || branches.graph.winningRevision !== head._rev ||
    !isEqual([...head._conflicts].sort(), branches.graph.conflictRevisions) ||
    !isEqual(head.outlineMoveIntent, branches.winner.outlineMoveIntent) ||
    branches.versions.length !== 2 || branches.graph.conflictRevisions.length !== 1) return;
  const losingMarker = branches.versions[1].outlineMoveIntent;
  if (!validPersistedMoveMarker(losingMarker, listId) ||
    losingMarker.baseRevision !== head.outlineMoveIntent.baseRevision ||
    !isEqual(losingMarker.baselineOrder, head.outlineMoveIntent.baselineOrder) ||
    !overlappingMoveDestinationsAgree(head.outlineMoveIntent, losingMarker)) return;
  const histories = branches.versions.map(revisionHistory);
  const commonParent = head.outlineMoveIntent.baseRevision;
  if (!commonParent || histories.some(history => history.length !== 2 || history[1] !== commonParent)) return;

  const winningItems = branches.winner.items ?? [];
  const losingItems = branches.versions[1].items ?? [];
  if (!hasStableRowIds(winningItems) || !sameOutlineRowsIgnoringOrder(winningItems, losingItems) ||
    !isEqual([...winningItems.map(item => item.listId)].sort(), [...head.outlineMoveIntent.baselineOrder].sort()) ||
    isEqual(head.outlineMoveIntent.baselineOrder, winningItems.map(item => item.listId)) ||
    isEqual(head.outlineMoveIntent.baselineOrder, losingItems.map(item => item.listId))) return;
  const rowsById = new Map(winningItems.map(item => [item.listId, item]));
  const baselineItems = head.outlineMoveIntent.baselineOrder
    .flatMap(id => rowsById.has(id) ? [rowsById.get(id)!] : []);
  if (baselineItems.length !== head.outlineMoveIntent.baselineOrder.length ||
    !rowsMatchPersistedMove(baselineItems, winningItems, head.outlineMoveIntent) ||
    !rowsMatchPersistedMove(baselineItems, losingItems, losingMarker)) return;
  const mergedItems = reconcileOutlineItems(
    baselineItems,
    winningItems,
    losingItems,
    undefined,
    [...head.outlineMoveIntent.moves, ...losingMarker.moves]
      .map(move => ({ ...move, ownerKey: "saved-outline-reconciliation" })),
  );
  if (mergedItems.kind !== "merged") return;
  // The reconciliation path is intentionally limited to order changes. A
  // different edit to outline details or row content remains for normal save
  // or the existing review flow.
  const withoutItemsOrRevision = (document: DBItemListDetails) =>
    Object.fromEntries(Object.entries(document).filter(([key]) =>
      !["items", "_rev", "_revisions", "_conflicts", "outlineMoveIntent", "updatedAt"].includes(key),
    ));
  if (!isEqual(withoutItemsOrRevision(branches.winner), withoutItemsOrRevision(branches.versions[1]))) return;

  const baselineRowsById = new Map(baselineItems.map(item => [item.listId, item]));
  const movedIds = [...new Set([
    ...head.outlineMoveIntent.moves.flatMap(move => move.movedIds),
    ...losingMarker.moves.flatMap(move => move.movedIds),
  ])];
  const movedRows = movedIds
    .flatMap(id => baselineRowsById.has(id) ? [baselineRowsById.get(id)!] : []);
  if (movedRows.length !== movedIds.length || !isAuthorized(movedRows)) return;

  const expectedGraph = branches.graph;
  const latest = await readRevisionBranchSet(db, listId);
  if (!isCurrent() || !sameRevisionGraph(expectedGraph, latest.graph)) return;
  const allowedToMutate = () => isCurrent() && isAuthorized(movedRows);
  if (!allowedToMutate()) return;

  const next = { ...branches.winner, items: mergedItems.items, _rev: expectedGraph.winningRevision } as RevisionDoc;
  delete next._conflicts;
  delete next._revisions;
  delete next.outlineMoveIntent;
  let writtenRevision: string | undefined;
  try {
    writtenRevision = resultRevision(await db.put(next));
  } catch (error) {
    if (isPouchConflict(error)) return;
    throw error;
  }
  if (!writtenRevision) return;

  const verified = await readRevisionBranchSet(db, listId);
  if (verified.graph.winningRevision !== writtenRevision ||
    !isEqual(verified.graph.conflictRevisions, expectedGraph.conflictRevisions) ||
    expectedGraph.conflictRevisions.some(revision =>
      !isEqual(verified.graph.histories[revision], expectedGraph.histories[revision]),
    ) ||
    !isEqual(withoutOutlineRevisionMetadata(verified.winner), withoutOutlineRevisionMetadata(next))) return;

  // A failed cleanup leaves the original leaves available; the merged winner
  // is already verified and can still be presented and edited.
  await retireReviewedBranches(db, listId, expectedGraph, writtenRevision, next, allowedToMutate)
    .catch(() => false);
  return verified.winner;
};

export const persistServiceListOverlays = (
  db: ServiceListFieldDb,
  listId: string,
  overlays: string[],
  isCurrent?: () => boolean,
) => persistServiceListField(db, listId, "overlays", overlays, undefined, isCurrent);

/** Explicit diagnostic/maintenance inspection only. Controller reads and
 * ordinary saves never inspect or reconcile historical branches. */
export const inspectServiceListRevisions = async (
  db: ServiceListFieldDb,
  listId: string,
  head: DBItemListDetails & { _conflicts?: string[] },
): Promise<{ document: DBItemListDetails; conflict?: ServiceListConflictError }> => {
  if (!head._conflicts?.length) return { document: head };
  const branches = await readRevisionBranchSet(db, listId);
  const merged = await mergeRevisionBranches(db, listId, branches);
  return { document: branches.winner, conflict: new ServiceListConflictError(
    (merged?.document.items ?? branches.winner.items ?? []) as ServiceItem[],
    conflictDetails(branches, merged?.document, merged?.itemReview, merged?.documentConflicts),
  ) };
};

/** Commits the previewed row or whole-version choice after graph validation. */
export const resolveServiceListRevisionConflict = async (
  db: ServiceListFieldDb,
  listId: string,
  selectedItems: ServiceItem[],
  reviewed: OutlineRevisionConflict,
  selection?: OutlineRevisionSelection,
  isCurrent = () => true,
): Promise<DBItemListDetails> => {
  const current = await readRevisionBranchSet(db, listId);
  if (!isCurrent()) throw new Error("The outline review session ended");
  const winnerHistory = current.graph.histories[current.graph.winningRevision] ?? [];
  if (
    current.graph.conflictRevisions.length === 0 &&
    winnerHistory.includes(reviewed.graph.winningRevision) &&
    isEqual(current.winner.items ?? [], selectedItems)
  ) return current.winner;
  if (!sameRevisionGraph(reviewed.graph, current.graph)) {
    throw new ServiceListConflictError(
      (current.winner.items ?? []) as ServiceItem[],
      current.graph.conflictRevisions.length ? conflictDetails(current) : undefined,
    );
  }
  if (!db.remove || current.versions.length !== current.graph.conflictRevisions.length + 1 ||
    reviewed.versions.length !== current.versions.length ||
    reviewed.versions.some((version) => !current.versions.some((latest) =>
      latest._rev === version.revision && isEqual(latest.items ?? [], version.items)))) {
    throw new ServiceListConflictError(
      (current.winner.items ?? []) as ServiceItem[],
      conflictDetails(current),
    );
  }

  if (selection?.kind === "rows") {
    const fresh = await mergeRevisionBranches(db, listId, current);
    const review = selection.review;
    const result = reconcileOutlineItems(review.baselineItems, review.localItems, review.remoteItems,
      (conflict) => selection.choices[conflict.key]);
    if (!fresh?.itemReview ||
      !isEqual(review.baselineItems, fresh.itemReview.baselineItems) ||
      !isEqual(review.remoteItems, fresh.itemReview.remoteItems) ||
      result.kind === "conflict" || !isEqual(result.items, selectedItems) || !hasStableRowIds(selectedItems)) {
      throw new Error("The outline choices no longer match the reviewed result");
    }
  }

  const commitChoice = async () => {
    const latest = await readRevisionBranchSet(db, listId);
    if (!isCurrent() || !sameRevisionGraph(reviewed.graph, latest.graph)) {
      throw new ServiceListConflictError(
        (latest.winner.items ?? []) as ServiceItem[],
        conflictDetails(latest),
      );
    }
    const selectedVersion = selection?.kind === "whole" && selection.revision
      ? latest.versions.find((version) => version._rev === selection.revision)
      : undefined;
    if (selection?.kind === "whole" && selection.revision &&
      (!selectedVersion || !isEqual(selectedVersion.items ?? [], selectedItems))) {
      throw new Error("The selected outline version no longer matches its preview");
    }
    const choiceDocument = {
      ...outlineRevisionChoiceDocument(reviewed, selectedVersion ?? latest.winner),
      _rev: latest.winner._rev,
    };
    const next = updatedDocument(choiceDocument, "items", selectedItems);
    const result = await db.put(next);
    const rev = resultRevision(result);
    if (!rev) throw new Error("The outline resolution was not acknowledged with a revision");
    const saved = { ...next, _rev: rev };
    const retired = await retireReviewedBranches(db, listId, reviewed.graph, rev, saved, isCurrent);
    if (!retired) {
      const changed = await readRevisionBranchSet(db, listId);
      throw new ServiceListConflictError(
        (changed.winner.items ?? []) as ServiceItem[],
        changed.graph.conflictRevisions.length ? conflictDetails(changed) : undefined,
      );
    }
    return saved;
  };

  return commitChoice();
};
