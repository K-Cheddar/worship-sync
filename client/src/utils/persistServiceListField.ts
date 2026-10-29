import isEqual from "lodash/isEqual";
import type { DBItemListDetails, ServiceItem } from "../types";
import { isPouchConflict } from "./persistOverlayDoc";
import { getOutlineItemConflicts, reconcileOutlineItems, type OutlineItemChoices } from "./outlineSync";

const SERVICE_LIST_PUT_MAX_ATTEMPTS = 4;

type RevisionHistory = { _rev?: string; _revisions?: { start: number; ids: string[] } };
type RevisionDoc = DBItemListDetails & RevisionHistory & { _conflicts?: string[] };

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
    if (["_rev", "_revisions", "_conflicts"].includes(key)) return;
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
  return { document: merged, requiresReview, itemReview, documentConflicts };
};

const updatedDocument = <K extends "items" | "overlays">(
  current: DBItemListDetails,
  field: K,
  value: K extends "items" ? ServiceItem[] : string[],
) => {
  const document = { ...current } as RevisionDoc;
  delete document._conflicts;
  delete document._revisions;
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

async function persistServiceListField<K extends "items" | "overlays">(
  db: ServiceListFieldDb,
  listId: string,
  field: K,
  value: K extends "items" ? ServiceItem[] : string[],
  baseline?: ServiceItem[],
  isCurrent = () => true,
): Promise<DBItemListDetails> {
  let lastError: unknown;

  for (let attempt = 0; attempt < SERVICE_LIST_PUT_MAX_ATTEMPTS; attempt += 1) {
    if (!isCurrent()) throw new Error("The outline save session ended");
    let current = await db.get(listId, { conflicts: true }) as RevisionDoc;
    let reviewedGraph: OutlineRevisionGraph | undefined;
    let revisionConflict: OutlineRevisionConflict | undefined;

    if (current._conflicts?.length) {
      const branches = await readRevisionBranchSet(db, listId);
      const mergedRemote = await mergeRevisionBranches(db, listId, branches);
      if (!mergedRemote) {
        throw new ServiceListConflictError(
          (branches.winner.items ?? []) as ServiceItem[],
          conflictDetails(branches),
        );
      }
      if (mergedRemote.requiresReview) {
        throw new ServiceListConflictError(
          mergedRemote.document.items ?? [],
          conflictDetails(branches, mergedRemote.document, mergedRemote.itemReview, mergedRemote.documentConflicts),
        );
      }
      const latestBranches = await readRevisionBranchSet(db, listId);
      if (!sameRevisionGraph(branches.graph, latestBranches.graph)) {
        throw new ServiceListConflictError(
          (latestBranches.winner.items ?? []) as ServiceItem[],
          conflictDetails(latestBranches),
        );
      }
      current = mergedRemote.document as RevisionDoc;
      reviewedGraph = branches.graph;
      revisionConflict = conflictDetails(branches, mergedRemote.document);
    }

    let nextValue = value;
    if (field === "items" && baseline) {
      const reconciled = reconcileOutlineItems(
        baseline,
        value as ServiceItem[],
        (current.items ?? []) as ServiceItem[],
      );
      if (reconciled.kind === "conflict") {
        throw new ServiceListConflictError(
          reconciled.remoteItems,
          revisionConflict
            ? { ...revisionConflict, remoteDocument: current }
            : undefined,
        );
      }
      nextValue = reconciled.items as typeof value;
    } else if (field === "overlays" && reviewedGraph) {
      const commonHistory = Object.values(reviewedGraph.histories);
      const commonRevision = commonHistory[0]?.find((revision) =>
        commonHistory.every((history) => history.includes(revision)),
      );
      const baseDoc = commonRevision
        ? await db.get(listId, { rev: commonRevision }) as DBItemListDetails
        : undefined;
      if (!baseDoc) {
        throw new ServiceListConflictError(
          (current.items ?? []) as ServiceItem[],
          revisionConflict,
        );
      }
      const baseOverlays = baseDoc.overlays ?? [];
      const remoteOverlays = current.overlays ?? [];
      if (
        !isEqual(value, baseOverlays) &&
        !isEqual(remoteOverlays, baseOverlays) &&
        !isEqual(value, remoteOverlays)
      ) {
        throw new ServiceListConflictError(
          (current.items ?? []) as ServiceItem[],
          revisionConflict,
        );
      }
      if (isEqual(value, baseOverlays)) nextValue = remoteOverlays as typeof value;
    }

    const next = updatedDocument(current, field, nextValue);

    try {
      if (reviewedGraph) {
        const latestBranches = await readRevisionBranchSet(db, listId);
        if (!sameRevisionGraph(reviewedGraph, latestBranches.graph)) {
          throw new ServiceListConflictError(
            (latestBranches.winner.items ?? []) as ServiceItem[],
            conflictDetails(latestBranches),
          );
        }
      }
      if (!isCurrent()) throw new Error("The outline save session ended");
      const result = await db.put(next);
      const rev = resultRevision(result);
      if (reviewedGraph && !rev) {
        throw new Error("The outline merge was not acknowledged with a revision");
      }
      const saved = rev ? { ...next, _rev: rev } : next;
      if (reviewedGraph && rev) {
        const retired = await retireReviewedBranches(db, listId, reviewedGraph, rev, saved, isCurrent);
        if (!retired) {
          const latestBranches = await readRevisionBranchSet(db, listId);
          throw new ServiceListConflictError(
            (latestBranches.winner.items ?? []) as ServiceItem[],
            latestBranches.graph.conflictRevisions.length
              ? conflictDetails(latestBranches)
              : undefined,
          );
        }
      }
      return saved;
    } catch (error) {
      lastError = error;
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
) => persistServiceListField(db, listId, "items", items, baseline, isCurrent);

export const persistServiceListOverlays = (
  db: ServiceListFieldDb,
  listId: string,
  overlays: string[],
  isCurrent?: () => boolean,
) => persistServiceListField(db, listId, "overlays", overlays, undefined, isCurrent);

/** The normal read requests only leaf metadata. Branch bodies/history are
 * inspected only when the database reports competing saved versions. */
export const inspectServiceListRevisions = async (
  db: ServiceListFieldDb,
  listId: string,
  head: DBItemListDetails & { _conflicts?: string[] },
  allowReconciliation = true,
): Promise<{ document: DBItemListDetails; conflict?: ServiceListConflictError }> => {
  if (!head._conflicts?.length) return { document: head };
  if (!allowReconciliation) {
    const branches = await readRevisionBranchSet(db, listId);
    const merged = await mergeRevisionBranches(db, listId, branches);
    return { document: branches.winner, conflict: new ServiceListConflictError(
      (merged?.document.items ?? branches.winner.items ?? []) as ServiceItem[],
      conflictDetails(branches, merged?.document, merged?.itemReview, merged?.documentConflicts),
    ) };
  }
  try {
    return { document: await persistServiceListItems(db, listId, head.items ?? [], head.items ?? []) };
  } catch (error) {
    if (!(error instanceof ServiceListConflictError)) throw error;
    return { document: head, conflict: error };
  }
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
