import isEqual from "lodash/isEqual";
import type { DBItemLists, ItemList } from "../types";
import { isPouchConflict } from "./persistOverlayDoc";

const MAX_REGISTRY_PUT_ATTEMPTS = 4;

export type ItemListsRegistrySnapshot = {
  currentLists: ItemList[];
  activeList?: ItemList;
  selectedIdByScope: Record<string, string>;
};

export type ItemListsRegistryIntent = {
  before: ItemListsRegistrySnapshot;
  after: ItemListsRegistrySnapshot;
};

export type ItemListsRegistryDb = {
  get: (id: string, options?: { conflicts?: boolean }) => Promise<unknown>;
  put: (doc: unknown) => Promise<{ rev?: string } | unknown>;
};

export type ItemListsRegistryConflict = {
  outlineId?: string;
  field?: string;
  reason: "same-field" | "delete-versus-edit" | "revision-branches";
  revisions?: string[];
};

export class ItemListsRegistryConflictError extends Error {
  constructor(readonly conflicts: ItemListsRegistryConflict[]) {
    super("The ItemLists registry changed in another session. Local changes were retained.");
    this.name = "ItemListsRegistryConflictError";
  }
}

const longestCommonSubsequenceIds = (left: string[], right: string[]) => {
  const lengths = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0),
  );
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      lengths[i][j] = left[i] === right[j]
        ? lengths[i + 1][j + 1] + 1
        : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const result = new Set<string>();
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      result.add(left[i]);
      i += 1;
      j += 1;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return result;
};

const changedKeys = <T extends Record<string, unknown>>(before: T, after: T) =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => !isEqual(before[key], after[key]),
  );

const sameField = <T extends Record<string, unknown>>(
  left: T,
  right: T,
  key: string,
) => Object.prototype.hasOwnProperty.call(left, key) ===
  Object.prototype.hasOwnProperty.call(right, key) && isEqual(left[key], right[key]);

const patchChangedFields = <T extends Record<string, unknown>>(
  base: T,
  desired: T,
  current: T,
) => {
  const result: Record<string, unknown> = { ...current };
  changedKeys(base, desired).forEach((key) => {
    if (!sameField(base, current, key) && !sameField(desired, current, key)) {
      throw new ItemListsRegistryConflictError([{
        outlineId: typeof desired._id === "string" ? desired._id : undefined,
        field: key,
        reason: "same-field",
      }]);
    }
    if (Object.prototype.hasOwnProperty.call(desired, key)) {
      result[key] = desired[key];
    } else {
      delete result[key];
    }
  });
  return result;
};

const applyListIntent = (
  latestLists: ItemList[],
  beforeLists: ItemList[],
  afterLists: ItemList[],
) => {
  const beforeById = new Map(beforeLists.map((item) => [item._id, item]));
  const afterById = new Map(afterLists.map((item) => [item._id, item]));
  const currentById = new Map(latestLists.map((item) => [item._id, item]));

  beforeLists.forEach((item) => {
    if (!afterById.has(item._id)) {
      const current = currentById.get(item._id);
      if (current && !isEqual(current, item)) {
        throw new ItemListsRegistryConflictError([{
          outlineId: item._id,
          reason: "delete-versus-edit",
        }]);
      }
      currentById.delete(item._id);
    }
  });

  afterLists.forEach((desired) => {
    const base = beforeById.get(desired._id);
    const current = currentById.get(desired._id);
    if (!base) {
      if (!current) currentById.set(desired._id, desired);
      else if (!isEqual(current, desired)) {
        throw new ItemListsRegistryConflictError([{
          outlineId: desired._id,
          reason: "same-field",
        }]);
      }
      return;
    }
    if (!current) {
      if (!isEqual(base, desired)) {
        throw new ItemListsRegistryConflictError([{
          outlineId: desired._id,
          reason: "delete-versus-edit",
        }]);
      }
      return;
    }
    currentById.set(
      desired._id,
      patchChangedFields(
        base as unknown as Record<string, unknown>,
        desired as unknown as Record<string, unknown>,
        current as unknown as Record<string, unknown>,
      ) as unknown as ItemList,
    );
  });

  const latestOrder = latestLists
    .map((item) => item._id)
    .filter((id) => currentById.has(id));
  currentById.forEach((_item, id) => {
    if (!latestOrder.includes(id)) latestOrder.push(id);
  });

  const baseOrder = beforeLists.map((item) => item._id);
  const desiredOrder = afterLists.map((item) => item._id);
  const desiredExisting = desiredOrder.filter((id) => beforeById.has(id));
  const baseKept = baseOrder.filter((id) => afterById.has(id));
  const stableIds = longestCommonSubsequenceIds(baseKept, desiredExisting);
  const localMovedOrAdded = new Set(
    desiredOrder.filter((id) => !beforeById.has(id) || !stableIds.has(id)),
  );

  desiredOrder.forEach((id, index) => {
    if (!localMovedOrAdded.has(id) || !currentById.has(id)) return;
    const existingIndex = latestOrder.indexOf(id);
    if (existingIndex >= 0) latestOrder.splice(existingIndex, 1);
    const nextAnchor = desiredOrder
      .slice(index + 1)
      .find((candidate) => latestOrder.includes(candidate));
    if (nextAnchor) {
      latestOrder.splice(latestOrder.indexOf(nextAnchor), 0, id);
      return;
    }
    const previousAnchor = desiredOrder
      .slice(0, index)
      .reverse()
      .find((candidate) => latestOrder.includes(candidate));
    if (previousAnchor) {
      latestOrder.splice(latestOrder.indexOf(previousAnchor) + 1, 0, id);
    } else {
      latestOrder.push(id);
    }
  });

  return latestOrder
    .map((id) => currentById.get(id))
    .filter((item): item is ItemList => Boolean(item));
};

export const mergeItemListsRegistrySnapshot = (
  latest: ItemListsRegistrySnapshot,
  intent: ItemListsRegistryIntent,
): ItemListsRegistrySnapshot => {
  const itemLists = applyListIntent(
    latest.currentLists ?? [],
    intent.before.currentLists,
    intent.after.currentLists,
  );

  const selectedIdByScope = { ...(latest.selectedIdByScope ?? {}) };
  const scopeKeys = new Set([
    ...Object.keys(intent.before.selectedIdByScope),
    ...Object.keys(intent.after.selectedIdByScope),
  ]);
  scopeKeys.forEach((scope) => {
    const previous = intent.before.selectedIdByScope[scope];
    const desired = intent.after.selectedIdByScope[scope];
    if (previous === desired) return;
    if (desired) selectedIdByScope[scope] = desired;
    else delete selectedIdByScope[scope];
  });

  const beforeActiveId = intent.before.activeList?._id;
  const desiredActiveId = intent.after.activeList?._id;
  const latestActiveId = latest.activeList?._id;
  if (
    desiredActiveId !== beforeActiveId &&
    latestActiveId !== beforeActiveId &&
    latestActiveId !== desiredActiveId
  ) {
    throw new ItemListsRegistryConflictError([{
      field: "activeList",
      reason: "same-field",
    }]);
  }
  const activeId = desiredActiveId !== beforeActiveId
    ? desiredActiveId
    : latestActiveId;
  const activeList = itemLists.find((item) => item._id === activeId) ??
    (activeId === latestActiveId ? latest.activeList : undefined) ??
    itemLists.find((item) => !item.controllerScope) ?? itemLists[0];

  return {
    currentLists: itemLists,
    ...(activeList ? { activeList } : {}),
    selectedIdByScope,
  };
};

export const applyItemListsRegistryIntent = (
  latest: DBItemLists,
  intent: ItemListsRegistryIntent,
): DBItemLists => {
  const merged = mergeItemListsRegistrySnapshot({
    currentLists: latest.itemLists ?? [],
    activeList: latest.activeList,
    selectedIdByScope: latest.selectedIdByScope ?? {},
  }, intent);
  return {
    ...latest,
    itemLists: merged.currentLists,
    ...(merged.activeList ? { activeList: merged.activeList } : {}),
    selectedIdByScope: merged.selectedIdByScope,
    updatedAt: new Date().toISOString(),
  };
};

export const persistItemListsRegistry = async (
  db: ItemListsRegistryDb,
  intents: ItemListsRegistryIntent[],
): Promise<DBItemLists> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_REGISTRY_PUT_ATTEMPTS; attempt += 1) {
    const latest = (await db.get("ItemLists", { conflicts: true })) as DBItemLists & { _conflicts?: string[] };
    if (latest._conflicts?.length) {
      throw new ItemListsRegistryConflictError([{
        reason: "revision-branches",
        revisions: [...latest._conflicts],
      }]);
    }
    const next = intents.reduce(applyItemListsRegistryIntent, latest);
    try {
      const result = await db.put(next);
      const rev =
        typeof result === "object" && result !== null && "rev" in result
          ? (result as { rev?: string }).rev
          : undefined;
      return rev ? { ...next, _rev: rev } : next;
    } catch (error) {
      lastError = error;
      if (
        !isPouchConflict(error) ||
        attempt === MAX_REGISTRY_PUT_ATTEMPTS - 1
      ) throw error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("ItemLists registry save failed");
};
