import isEqual from "lodash/isEqual";
import type { DBItemLists, ItemList } from "../types";
import { isPouchConflict } from "./persistOverlayDoc";

const MAX_REGISTRY_PUT_ATTEMPTS = 4;
const sameRegistryDocument = (left: DBItemLists, right: DBItemLists) =>
  isEqual({ ...left, updatedAt: undefined }, { ...right, updatedAt: undefined });

export type ItemListsRegistrySnapshot = {
  currentLists: ItemList[];
  activeList?: ItemList;
};

export type ItemListsRegistryIntent = {
  before: ItemListsRegistrySnapshot;
  after: ItemListsRegistrySnapshot;
};

export type ItemListsRegistryDb = {
  get: (id: string) => Promise<unknown>;
  put: (doc: unknown) => Promise<{ rev?: string } | unknown>;
};

export type ItemListsRegistryConflict = {
  outlineId?: string;
  field?: string;
  reason: "same-field" | "delete-versus-edit";
  localValue?: unknown;
  remoteValue?: unknown;
};

type ConflictChoice = (conflict: ItemListsRegistryConflict) => "local" | "remote";
const chooseConflict = (conflict: ItemListsRegistryConflict, choose?: ConflictChoice) => {
  if (!choose) throw new ItemListsRegistryConflictError([conflict]);
  return choose(conflict);
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
  choose?: ConflictChoice,
) => {
  const result: Record<string, unknown> = { ...current };
  changedKeys(base, desired).forEach((key) => {
    if (!sameField(base, current, key) && !sameField(desired, current, key)) {
      const choice = chooseConflict({
        outlineId: typeof desired._id === "string" ? desired._id : undefined,
        field: key,
        reason: "same-field",
        localValue: desired[key], remoteValue: current[key],
      }, choose);
      if (choice === "remote") return;
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
  choose?: ConflictChoice,
) => {
  const beforeById = new Map(beforeLists.map((item) => [item._id, item]));
  const afterById = new Map(afterLists.map((item) => [item._id, item]));
  const currentById = new Map(latestLists.map((item) => [item._id, item]));

  beforeLists.forEach((item) => {
    if (!afterById.has(item._id)) {
      const current = currentById.get(item._id);
      if (current && !isEqual(current, item)) {
        const choice = chooseConflict({
          outlineId: item._id,
          reason: "delete-versus-edit",
          localValue: undefined, remoteValue: current,
        }, choose);
        if (choice === "remote") return;
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
        const choice = chooseConflict({
          outlineId: desired._id,
          reason: "same-field",
          localValue: desired, remoteValue: current,
        }, choose);
        if (choice === "local") currentById.set(desired._id, desired);
      }
      return;
    }
    if (!current) {
      if (!isEqual(base, desired)) {
        const choice = chooseConflict({
          outlineId: desired._id,
          reason: "delete-versus-edit",
          localValue: desired, remoteValue: undefined,
        }, choose);
        if (choice === "local") currentById.set(desired._id, desired);
      }
      return;
    }
    currentById.set(
      desired._id,
      patchChangedFields(
        base as unknown as Record<string, unknown>,
        desired as unknown as Record<string, unknown>,
        current as unknown as Record<string, unknown>,
        choose,
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
  choose?: ConflictChoice,
): ItemListsRegistrySnapshot => {
  const itemLists = applyListIntent(
    latest.currentLists ?? [],
    intent.before.currentLists,
    intent.after.currentLists,
    choose,
  );

  const beforeActiveId = intent.before.activeList?._id;
  const desiredActiveId = intent.after.activeList?._id;
  const latestActiveId = latest.activeList?._id;
  let activeConflictChoice: "local" | "remote" | undefined;
  if (
    desiredActiveId !== beforeActiveId &&
    latestActiveId !== beforeActiveId &&
    latestActiveId !== desiredActiveId
  ) {
    activeConflictChoice = chooseConflict({
      field: "activeList",
      reason: "same-field",
      localValue: intent.after.activeList, remoteValue: latest.activeList,
    }, choose);
  }
  const activeId = desiredActiveId !== beforeActiveId && activeConflictChoice !== "remote"
    ? desiredActiveId
    : latestActiveId;
  const activeList = itemLists.find((item) => item._id === activeId) ??
    (activeId === latestActiveId ? latest.activeList : undefined) ??
    itemLists.find((item) => !item.controllerScope) ?? itemLists[0];

  return {
    currentLists: itemLists,
    ...(activeList ? { activeList } : {}),
  };
};

export const applyItemListsRegistryIntent = (
  latest: DBItemLists,
  intent: ItemListsRegistryIntent,
  choose?: ConflictChoice,
): DBItemLists => {
  const merged = mergeItemListsRegistrySnapshot({
    currentLists: latest.itemLists ?? [],
    activeList: latest.activeList,
  }, intent, choose);
  return {
    ...latest,
    itemLists: merged.currentLists,
    ...(merged.activeList ? { activeList: merged.activeList } : {}),
    updatedAt: new Date().toISOString(),
  };
};

export const registrySnapshot = (doc: DBItemLists): ItemListsRegistrySnapshot => ({
  currentLists: doc.itemLists ?? [],
  activeList: doc.activeList,
});

export const persistItemListsRegistry = async (
  db: ItemListsRegistryDb,
  intents: ItemListsRegistryIntent[],
  keepLocalConflicts = false,
): Promise<DBItemLists> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_REGISTRY_PUT_ATTEMPTS; attempt += 1) {
    // A normal read returns CouchDB's winning revision. Losing historical
    // branches remain untouched and do not prevent writes to this revision.
    const latest = (await db.get("ItemLists")) as DBItemLists;
    const choose = keepLocalConflicts ? () => "local" as const : undefined;
    const next = intents.reduce(
      (document, intent) => applyItemListsRegistryIntent(document, intent, choose),
      latest,
    );
    if (sameRegistryDocument(latest, next)) return latest;
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
