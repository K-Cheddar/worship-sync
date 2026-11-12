import isEqual from "lodash/isEqual";
import type { ServiceItem } from "../types";
import generateRandomId from "./generateRandomId";

export type OutlineMergeResult =
  | { kind: "merged"; items: ServiceItem[]; remoteItems: ServiceItem[] }
  | { kind: "conflict"; items: ServiceItem[]; remoteItems: ServiceItem[] };

export type OutlineItemConflict = {
  key: string;
  listId?: string;
  field?: string;
  reason: "field" | "row" | "delete-edit" | "order" | "replacement";
  movedIds?: string[];
  localDestination?: OutlineMoveIntent;
  remoteMoved?: boolean;
  orderAmbiguous?: boolean;
  localRow?: ServiceItem;
  remoteRow?: ServiceItem;
};
export type OutlineItemChoices = Record<string, "local" | "remote">;
type ChooseConflict = (conflict: OutlineItemConflict) => "local" | "remote" | undefined;

/** Runtime-only description of a drag; never serialized into the outline document. */
export type OutlineMoveIntent = {
  outlineId: string;
  ownerKey: string;
  movedIds: string[];
  beforeId?: string;
  afterId?: string;
  edge?: "start" | "end";
};

export const createOutlineMoveIntent = ({
  outlineId, ownerKey, resultingItems, movedIds,
}: {
  outlineId: string;
  ownerKey: string;
  resultingItems: ServiceItem[];
  movedIds: string[];
}): OutlineMoveIntent | undefined => {
  const moved = new Set(movedIds);
  const start = resultingItems.findIndex(item => moved.has(item.listId));
  if (start < 0 || resultingItems.slice(start, start + moved.size).some(item => !moved.has(item.listId))) return undefined;
  const beforeId = resultingItems[start - 1]?.listId;
  const afterId = resultingItems[start + moved.size]?.listId;
  return {
    outlineId,
    ownerKey,
    movedIds: resultingItems.slice(start, start + moved.size).map(item => item.listId),
    ...(beforeId ? { beforeId } : {}),
    ...(afterId ? { afterId } : {}),
    ...(!beforeId ? { edge: "start" as const } : !afterId ? { edge: "end" as const } : {}),
  };
};

const stableRows = (
  rows: ServiceItem[],
  knownRows: ServiceItem[],
): ServiceItem[] => {
  const unusedKnown = new Map<string, ServiceItem[]>();
  knownRows.forEach((row) => {
    const sameDocument = unusedKnown.get(row._id) ?? [];
    sameDocument.push(row);
    unusedKnown.set(row._id, sameDocument);
  });
  const usedIds = new Set<string>();

  return rows.map((row) => {
    if (row.listId && !usedIds.has(row.listId)) {
      usedIds.add(row.listId);
      return row;
    }
    const match = unusedKnown.get(row._id)?.find((known) => !usedIds.has(known.listId));
    const listId = match?.listId ?? generateRandomId();
    usedIds.add(listId);
    return { ...row, listId };
  });
};

const orderedBaseIds = (rows: ServiceItem[], baseIds: Set<string>) =>
  rows.map((row) => row.listId).filter((id) => baseIds.has(id));

const rowEqual = (left: ServiceItem, right: ServiceItem) => isEqual(left, right);

const mergeRow = (
  base: ServiceItem,
  local: ServiceItem,
  remote: ServiceItem,
  choose?: ChooseConflict,
): { item: ServiceItem; conflict: boolean } => {
  const merged: Record<string, unknown> = { ...remote };
  let conflict = false;
  const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);

  keys.forEach((key) => {
    if (key === "listId") return;
    const hadBase = Object.prototype.hasOwnProperty.call(base, key);
    const hasLocal = Object.prototype.hasOwnProperty.call(local, key);
    const hasRemote = Object.prototype.hasOwnProperty.call(remote, key);
    const baseValue = (base as unknown as Record<string, unknown>)[key];
    const localValue = (local as unknown as Record<string, unknown>)[key];
    const remoteValue = (remote as unknown as Record<string, unknown>)[key];
    const localChanged = hadBase !== hasLocal || !isEqual(baseValue, localValue);
    const remoteChanged = hadBase !== hasRemote || !isEqual(baseValue, remoteValue);

    if (!localChanged) return;
    if (remoteChanged && (hasLocal !== hasRemote || !isEqual(localValue, remoteValue))) {
      const choice = choose?.({
        key: JSON.stringify([local.listId, key]), listId: local.listId,
        field: key, reason: "field", localRow: local, remoteRow: remote,
      });
      if (choice === "remote") return;
      if (!choice) conflict = true;
    }
    if (hasLocal) merged[key] = localValue;
    else delete merged[key];
  });

  return { item: merged as unknown as ServiceItem, conflict };
};

const insertAddedRows = (
  order: string[],
  sourceRows: ServiceItem[],
  addedIds: Set<string>,
) => {
  sourceRows.forEach((row, sourceIndex) => {
    if (!addedIds.has(row.listId) || order.includes(row.listId)) return;
    const nextAnchor = sourceRows
      .slice(sourceIndex + 1)
      .find((candidate) => order.includes(candidate.listId));
    if (nextAnchor) {
      order.splice(order.indexOf(nextAnchor.listId), 0, row.listId);
      return;
    }
    const previousAnchor = sourceRows
      .slice(0, sourceIndex)
      .reverse()
      .find((candidate) => order.includes(candidate.listId));
    if (previousAnchor) {
      order.splice(order.indexOf(previousAnchor.listId) + 1, 0, row.listId);
      return;
    }
    order.push(row.listId);
  });
};

const relativeOrder = (order: string[], left: string, right: string): boolean | undefined => {
  const leftIndex = order.indexOf(left);
  const rightIndex = order.indexOf(right);
  return leftIndex < 0 || rightIndex < 0 ? undefined : leftIndex < rightIndex;
};

type OrderMerge = { order: string[]; conflictIds: string[]; unresolvedCycle: boolean };

const cyclicIds = (edges: Map<string, Set<string>>): string[] => {
  let nextIndex = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const result = new Set<string>();
  const visit = (id: string) => {
    index.set(id, nextIndex);
    low.set(id, nextIndex);
    nextIndex += 1;
    stack.push(id);
    onStack.add(id);
    for (const next of edges.get(id) ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(id, Math.min(low.get(id)!, low.get(next)!));
      } else if (onStack.has(next)) {
        low.set(id, Math.min(low.get(id)!, index.get(next)!));
      }
    }
    if (low.get(id) !== index.get(id)) return;
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
    } while (member !== id);
    if (component.length > 1) component.forEach(value => result.add(value));
  };
  edges.forEach((_targets, id) => { if (!index.has(id)) visit(id); });
  return [...result];
};

const mergeBaseOrder = (
  baseline: string[],
  local: string[],
  remote: string[],
  finalIds: string[],
  orderChoice?: "local" | "remote",
  choiceIds: string[] = [],
): OrderMerge => {
  const baseSet = new Set(baseline);
  const nodes = finalIds.filter(id => baseSet.has(id));
  const edges = new Map(nodes.map(id => [id, new Set<string>()]));
  const addBefore = (before: string, after: string) => edges.get(before)?.add(after);
  const conflictIds = new Set<string>();
  const overrideIds = new Set(choiceIds);
  const preliminary = new Map<string, boolean>();

  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const left = nodes[leftIndex];
      const right = nodes[rightIndex];
      const baseBefore = relativeOrder(baseline, left, right);
      const localBefore = relativeOrder(local, left, right);
      const remoteBefore = relativeOrder(remote, left, right);
      if (baseBefore === undefined) continue;
      let chosen = baseBefore;
      if (localBefore !== undefined && remoteBefore !== undefined) {
        const localChanged = localBefore !== baseBefore;
        const remoteChanged = remoteBefore !== baseBefore;
        if (localChanged && remoteChanged && localBefore !== remoteBefore) {
          conflictIds.add(left);
          conflictIds.add(right);
          chosen = localBefore;
        } else if (localChanged) chosen = localBefore;
        else if (remoteChanged) chosen = remoteBefore;
      } else if (localBefore !== undefined && localBefore !== baseBefore) chosen = localBefore;
      else if (remoteBefore !== undefined && remoteBefore !== baseBefore) chosen = remoteBefore;
      preliminary.set(JSON.stringify([left, right]), chosen);
    }
  }

  // A single choice resolves only the cycle that combines incompatible moves;
  // all order constraints outside that cycle remain merged automatically.
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const left = nodes[leftIndex];
      const right = nodes[rightIndex];
      let before = preliminary.get(JSON.stringify([left, right]));
      if (before === undefined) continue;
      if (orderChoice && (overrideIds.size ? overrideIds.has(left) && overrideIds.has(right)
        : conflictIds.has(left) && conflictIds.has(right))) {
        before = relativeOrder(orderChoice === "local" ? local : remote, left, right) ?? before;
      }
      addBefore(before ? left : right, before ? right : left);
    }
  }

  const cycleIds = cyclicIds(edges);
  const indegree = new Map(nodes.map(id => [id, 0]));
  edges.forEach(targets => targets.forEach(target => indegree.set(target, (indegree.get(target) ?? 0) + 1)));
  const priority = (id: string) => {
    const remoteIndex = remote.indexOf(id);
    const localIndex = local.indexOf(id);
    const baseIndex = baseline.indexOf(id);
    return remoteIndex >= 0 ? remoteIndex : localIndex >= 0 ? localIndex : baseIndex;
  };
  const ready = nodes.filter(id => indegree.get(id) === 0).sort((a, b) => priority(a) - priority(b));
  const order: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const next of edges.get(id) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) {
        ready.push(next);
        ready.sort((a, b) => priority(a) - priority(b));
      }
    }
  }
  return {
    order: order.length === nodes.length ? order : [],
    conflictIds: cycleIds.length ? cycleIds : [...conflictIds],
    unresolvedCycle: cycleIds.length > 0,
  };
};

const rebaseMovesOntoRemote = (
  local: ServiceItem[],
  remote: ServiceItem[],
  moveIntents: OutlineMoveIntent[],
): ServiceItem[] => {
  if (!moveIntents.length) return local;
  const localById = new Map(local.map(row => [row.listId, row]));
  const remoteById = new Map(remote.map(row => [row.listId, row]));
  const localAdded = new Set(local.filter(row => !remoteById.has(row.listId)).map(row => row.listId));
  const order = remote.map(row => row.listId);
  insertAddedRows(order, local, localAdded);

  moveIntents.forEach(intent => {
    const movedIds = intent.movedIds.filter(id => order.includes(id) && localById.has(id));
    if (!movedIds.length) return;
    const moved = new Set(movedIds);
    const block = movedIds.sort((left, right) =>
      local.findIndex(row => row.listId === left) - local.findIndex(row => row.listId === right));
    const from = order.findIndex(id => moved.has(id));
    order.splice(0, order.length, ...order.filter(id => !moved.has(id)));

    let destination = intent.afterId ? order.indexOf(intent.afterId) : -1;
    if (destination < 0 && intent.beforeId) {
      const previous = order.indexOf(intent.beforeId);
      if (previous >= 0) destination = previous + 1;
    }
    if (destination < 0 && intent.edge === "start") destination = 0;
    if (destination < 0 && intent.edge === "end") destination = order.length;
    if (destination < 0) {
      const sourceIndex = local.findIndex(row => row.listId === block[0]);
      const next = local.slice(sourceIndex + block.length).find(row => order.includes(row.listId));
      if (next) destination = order.indexOf(next.listId);
      else {
        const previous = local.slice(0, sourceIndex).reverse().find(row => order.includes(row.listId));
        destination = previous ? order.indexOf(previous.listId) + 1 : Math.min(from, order.length);
      }
    }
    order.splice(destination, 0, ...block);
  });

  const allRows = new Map([...remoteById, ...localById]);
  return order.flatMap(id => {
    const row = allRows.get(id);
    return row ? [row] : [];
  });
};

const movedRowCandidates = (baseline: string[], order: string[]) => {
  if (baseline.length !== order.length || baseline.some(id => !order.includes(id))) return undefined;
  if (isEqual(baseline, order)) return new Set<string>();
  const candidates = new Set<string>();
  for (const id of baseline) {
    const remainder = baseline.filter(value => value !== id);
    for (let index = 0; index < order.length; index += 1) {
      const proposedOrder = [...remainder];
      proposedOrder.splice(index, 0, id);
      if (isEqual(proposedOrder, order)) candidates.add(id);
    }
  }
  return candidates;
};

const hasSingleUnambiguousMovedRow = (baseline: string[], order: string[]) =>
  movedRowCandidates(baseline, order)?.size === 1;

/**
 * Reconcile edits from one operator against the last shared outline baseline.
 * Row fields merge independently by listId. Independent insertions/deletions
 * are combined; conflicting reorders, delete-vs-edit, and same-field edits are
 * returned with both versions so the operator can choose explicitly.
 */
export const reconcileOutlineItems = (
  baseline: ServiceItem[],
  localItems: ServiceItem[],
  remoteItems: ServiceItem[],
  choose?: ChooseConflict,
  moveIntents: OutlineMoveIntent[] = [],
): OutlineMergeResult => {
  const knownRows = [...baseline, ...localItems];
  const base = stableRows(baseline, knownRows);
  const normalizedLocal = stableRows(localItems, [...base, ...localItems]);
  const remote = stableRows(remoteItems, [...base, ...normalizedLocal]);
  const local = rebaseMovesOntoRemote(normalizedLocal, remote, moveIntents);
  const baseById = new Map(base.map((row) => [row.listId, row]));
  const localById = new Map(local.map((row) => [row.listId, row]));
  const remoteById = new Map(remote.map((row) => [row.listId, row]));
  const baseIds = new Set(baseById.keys());
  const localAddedIds = new Set(local.filter((row) => !baseById.has(row.listId)).map((row) => row.listId));
  const remoteAddedIds = new Set(remote.filter((row) => !baseById.has(row.listId)).map((row) => row.listId));
  const localRemovedIds = new Set(base.filter((row) => !localById.has(row.listId)).map((row) => row.listId));
  const remoteRemovedIds = new Set(base.filter((row) => !remoteById.has(row.listId)).map((row) => row.listId));
  const localBaseOrder = orderedBaseIds(local, baseIds);
  const remoteBaseOrder = orderedBaseIds(remote, baseIds);
  const overlappingReplacements = [...localRemovedIds].some((id) =>
    remoteRemovedIds.has(id),
  ) && localAddedIds.size > 0 && remoteAddedIds.size > 0;
  const finalBaseIds = base.map(row => row.listId).filter(id =>
    localById.has(id) || remoteById.has(id));
  const initialOrder = mergeBaseOrder(base.map(row => row.listId), localBaseOrder, remoteBaseOrder, finalBaseIds);
  const baseOrder = base.map(row => row.listId);
  const exactLocalOrder = orderedBaseIds(normalizedLocal, baseIds);
  const localPresentBaseOrder = baseOrder.filter(id => localById.has(id));
  const remotePresentBaseOrder = baseOrder.filter(id => remoteById.has(id));
  const localOrderChanged = !isEqual(exactLocalOrder, localPresentBaseOrder);
  const remoteOrderChanged = !isEqual(remoteBaseOrder, remotePresentBaseOrder);
  const remoteMoveCandidates = remoteOrderChanged
    ? movedRowCandidates(remotePresentBaseOrder, remoteBaseOrder)
    : new Set<string>();
  const remoteMovedId = remoteMoveCandidates?.size === 1 ? [...remoteMoveCandidates][0] : undefined;
  const localOrderKnown = moveIntents.length > 0 || !localOrderChanged ||
    hasSingleUnambiguousMovedRow(localPresentBaseOrder, exactLocalOrder);
  const remoteOrderKnown = !remoteOrderChanged || remoteMovedId !== undefined;
  const latestMoveIntentFor = (id: string) => [...moveIntents].reverse().find(intent => intent.movedIds.includes(id));
  const orderConflict = initialOrder.conflictIds.length > 0;
  const ambiguousLegacyOrder = !moveIntents.length && orderConflict && (!localOrderKnown || !remoteOrderKnown);
  const orderChoiceIds = ambiguousLegacyOrder ? baseOrder : initialOrder.conflictIds;
  const movedIds = [...new Set(moveIntents.flatMap(intent => intent.movedIds))]
    .filter(id => initialOrder.conflictIds.includes(id));
  const orderMoveIntent = [...moveIntents].reverse()
    .find(intent => intent.movedIds.some(id => initialOrder.conflictIds.includes(id)));
  const orderChoice = orderConflict ? choose?.({
    key: "order", reason: "order", movedIds: movedIds.length ? movedIds : orderChoiceIds,
    ...(ambiguousLegacyOrder ? { orderAmbiguous: true } : {}),
    ...(orderMoveIntent ? { localDestination: orderMoveIntent } : {}),
  }) : undefined;
  // Replacing the same removed rows with different identities is ambiguous.
  // Keep the existing whole-version review for that case.
  if (overlappingReplacements) choose?.({ key: "replacement", reason: "replacement" });
  const orderMerge = orderConflict
    ? mergeBaseOrder(base.map(row => row.listId), localBaseOrder, remoteBaseOrder, finalBaseIds,
      orderChoice, orderChoiceIds)
    : initialOrder;
  let conflict = (orderConflict && (orderMerge.unresolvedCycle || !orderChoice)) || overlappingReplacements;
  const chooseRow = (
    id: string,
    localRow?: ServiceItem,
    remoteRow?: ServiceItem,
    reason: "row" | "delete-edit" = "delete-edit",
    moveDetails?: Pick<OutlineItemConflict, "movedIds" | "localDestination" | "remoteMoved">,
  ) => {
    const choice = choose?.({
      key: JSON.stringify([id]), listId: id, reason, localRow, remoteRow, ...moveDetails,
    });
    if (!choice) conflict = true;
    return choice === "remote" ? remoteRow : localRow;
  };

  const rowsById = new Map<string, ServiceItem>();
  const allIds = new Set([...baseById.keys(), ...localById.keys(), ...remoteById.keys()]);
  allIds.forEach((id) => {
    const baseRow = baseById.get(id);
    const localRow = localById.get(id);
    const remoteRow = remoteById.get(id);

    if (!baseRow) {
      if (localRow && remoteRow) {
        const item = rowEqual(localRow, remoteRow) ? localRow : chooseRow(id, localRow, remoteRow, "row");
        if (item) rowsById.set(id, item);
      } else if (localRow || remoteRow) {
        rowsById.set(id, (localRow ?? remoteRow)!);
      }
      return;
    }

    if (!localRow && !remoteRow) return;
    if (!localRow) {
      const remoteMoveMayOverlap = remoteRow && (remoteMoveCandidates === undefined
        ? remoteOrderChanged
        : remoteMoveCandidates.has(id));
      if (remoteRow && (!rowEqual(remoteRow, baseRow) || remoteMoveMayOverlap)) {
        const item = chooseRow(id, localRow, remoteRow, "delete-edit", remoteMoveMayOverlap
          ? { movedIds: [id], remoteMoved: true }
          : undefined);
        if (item) rowsById.set(id, item);
      }
      return;
    }
    if (!remoteRow) {
      const localMoveIntent = latestMoveIntentFor(id);
      if (rowEqual(localRow, baseRow) && !localMoveIntent) return;
      const item = chooseRow(id, localRow, remoteRow, "delete-edit", localMoveIntent
        ? { movedIds: [id], localDestination: localMoveIntent }
        : undefined);
      if (item) rowsById.set(id, item);
      return;
    }

    const merged = mergeRow(baseRow, localRow, remoteRow, choose);
    conflict ||= merged.conflict;
    rowsById.set(id, merged.item);
  });

  const deletedIds = new Set<string>();
  base.forEach((row) => {
    const localRow = localById.get(row.listId);
    const remoteRow = remoteById.get(row.listId);
    if (!localRow && remoteRow && rowEqual(remoteRow, row) && !rowsById.has(row.listId)) deletedIds.add(row.listId);
    if (!remoteRow && localRow && rowEqual(localRow, row) && !rowsById.has(row.listId)) deletedIds.add(row.listId);
    if (!localRow && !remoteRow) deletedIds.add(row.listId);
  });

  const preferredRows = orderMerge.order.length ? [] : (orderChoice === "remote" ? remote : local);
  const preferredOrder = orderMerge.order.length
    ? orderMerge.order
    : preferredRows.map((row) => row.listId).filter(id => finalBaseIds.includes(id));
  const order = preferredOrder.filter((id) => !deletedIds.has(id) && rowsById.has(id));
  // Even when a field conflicts, keep unrelated remote insertions in the
  // candidate, including when the operator chooses an order. Ambiguous
  // replacements still need an explicit whole-version review.
  if (!overlappingReplacements) {
    insertAddedRows(order, remote, remoteAddedIds);
  }
  insertAddedRows(order, local, localAddedIds);
  rowsById.forEach((_row, id) => {
    if (
      !deletedIds.has(id) &&
      !order.includes(id) &&
      (!overlappingReplacements || localById.has(id))
    ) order.push(id);
  });

  const items = order
    .map((id) => rowsById.get(id))
    .filter((row): row is ServiceItem => Boolean(row));
  return conflict
    ? { kind: "conflict", items, remoteItems: remote }
    : { kind: "merged", items, remoteItems: remote };
};

export const getOutlineItemConflicts = (
  baseline: ServiceItem[], local: ServiceItem[], remote: ServiceItem[],
  moveIntents: OutlineMoveIntent[] = [],
): OutlineItemConflict[] => {
  const conflicts: OutlineItemConflict[] = [];
  reconcileOutlineItems(baseline, local, remote, (conflict) => {
    conflicts.push(conflict);
    return undefined;
  }, moveIntents);
  return conflicts;
};
