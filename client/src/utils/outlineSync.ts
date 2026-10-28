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
  localRow?: ServiceItem;
  remoteRow?: ServiceItem;
};
export type OutlineItemChoices = Record<string, "local" | "remote">;
type ChooseConflict = (conflict: OutlineItemConflict) => "local" | "remote" | undefined;

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

const sameOrder = (left: string[], right: string[]) =>
  left.length === right.length && left.every((id, index) => id === right[index]);

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
): OutlineMergeResult => {
  const knownRows = [...baseline, ...localItems];
  const base = stableRows(baseline, knownRows);
  const local = stableRows(localItems, [...base, ...localItems]);
  const remote = stableRows(remoteItems, [...base, ...local]);
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
  const localOrderChanged = !sameOrder(
    localBaseOrder,
    base.map((row) => row.listId).filter((id) => localById.has(id)),
  );
  const remoteOrderChanged = !sameOrder(
    remoteBaseOrder,
    base.map((row) => row.listId).filter((id) => remoteById.has(id)),
  );
  const commonOrderDiffers = !sameOrder(
    localBaseOrder.filter((id) => remoteById.has(id)),
    remoteBaseOrder.filter((id) => localById.has(id)),
  );
  const overlappingReplacements = [...localRemovedIds].some((id) =>
    remoteRemovedIds.has(id),
  ) && localAddedIds.size > 0 && remoteAddedIds.size > 0;
  const orderConflict = localOrderChanged && remoteOrderChanged && commonOrderDiffers;
  const orderChoice = orderConflict ? choose?.({ key: "order", reason: "order" }) : undefined;
  // Replacing the same removed rows with different identities is ambiguous.
  // Keep the existing whole-version review for that case.
  if (overlappingReplacements) choose?.({ key: "replacement", reason: "replacement" });
  let conflict = (orderConflict && !orderChoice) || overlappingReplacements;
  const chooseRow = (id: string, localRow?: ServiceItem, remoteRow?: ServiceItem, reason: "row" | "delete-edit" = "delete-edit") => {
    const choice = choose?.({
      key: JSON.stringify([id]), listId: id, reason, localRow, remoteRow,
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
      if (remoteRow && !rowEqual(remoteRow, baseRow)) {
        const item = chooseRow(id, localRow, remoteRow);
        if (item) rowsById.set(id, item);
      }
      return;
    }
    if (!remoteRow) {
      if (rowEqual(localRow, baseRow)) return;
      const item = chooseRow(id, localRow, remoteRow);
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
    if (!localRow && remoteRow && rowEqual(remoteRow, row)) deletedIds.add(row.listId);
    if (!remoteRow && localRow && rowEqual(localRow, row)) deletedIds.add(row.listId);
    if (!localRow && !remoteRow) deletedIds.add(row.listId);
  });

  let preferredRows = base;
  if (orderChoice === "remote") preferredRows = remote;
  else if (conflict || localOrderChanged) preferredRows = local;
  else if (remoteOrderChanged) preferredRows = remote;
  const preferredOrder = preferredRows.map((row) => row.listId)
    .filter((id) => !deletedIds.has(id) && rowsById.has(id));
  const order = [...preferredOrder];
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
): OutlineItemConflict[] => {
  const conflicts: OutlineItemConflict[] = [];
  reconcileOutlineItems(baseline, local, remote, (conflict) => {
    conflicts.push(conflict);
    return undefined;
  });
  return conflicts;
};
