import isEqual from "lodash/isEqual";
import type { DBItemLists, ItemList } from "../types";
import { isPouchConflict } from "./persistOverlayDoc";

const MAX_REGISTRY_PUT_ATTEMPTS = 4;
const sameRegistryDocument = (left: DBItemLists, right: DBItemLists) =>
  isEqual({ ...left, updatedAt: undefined }, { ...right, updatedAt: undefined });

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
  get: (id: string, options?: { conflicts?: boolean; rev?: string; revs?: boolean }) => Promise<unknown>;
  put: (doc: unknown) => Promise<{ rev?: string } | unknown>;
  remove?: (id: string, rev: string) => Promise<unknown>;
};

export type ItemListsRegistryConflict = {
  outlineId?: string;
  field?: string;
  reason: "same-field" | "delete-versus-edit" | "revision-branches";
  revisions?: string[];
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
    selectedIdByScope,
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
    selectedIdByScope: latest.selectedIdByScope ?? {},
  }, intent, choose);
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
    const next = intents.reduce((document, intent) => applyItemListsRegistryIntent(document, intent), latest);
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

type RegistryRevisionDoc = DBItemLists & {
  _conflicts?: string[];
  _revisions?: { start: number; ids: string[] };
};

export type RegistryRecoveryReview = {
  graph: string;
  hasBranches: boolean;
  document: DBItemLists;
  conflicts: Array<ItemListsRegistryConflict & { key: string }>;
  choices: Record<string, "local" | "remote">;
};

export class RegistryReviewChangedError extends Error {
  constructor(readonly review: RegistryRecoveryReview) {
    super("A choice changed another value in this review");
  }
}

const registryGraph = (head: RegistryRevisionDoc) =>
  JSON.stringify([head._rev, [...(head._conflicts ?? [])].sort()]);

const registryMetadata = (value: RegistryRevisionDoc) => Object.fromEntries(Object.entries(value).filter(([key]) =>
  !["_rev", "_conflicts", "_revisions", "itemLists", "activeList", "selectedIdByScope", "updatedAt"].includes(key),
));

/** Without an available ancestor, a differing value or presence is ambiguous.
 * Review each property rather than guessing which branch added/deleted it. */
const mergeUnbasedRegistryDocuments = (left: DBItemLists, right: DBItemLists, choose: ConflictChoice): DBItemLists => {
  const mergeValues = (local: Record<string, unknown>, remote: Record<string, unknown>, outlineId?: string, prefix = "") => {
    const merged: Record<string, unknown> = { ...local };
    const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
    keys.forEach((field) => {
      if (sameField(local, remote, field)) return;
      const reviewValue = (value: unknown) => prefix === "selection:" && typeof value === "string"
        ? { _id: value, name: [...left.itemLists, ...right.itemLists].find((list) => list._id === value)?.name ?? "Outline no longer available" }
        : value;
      if (choose({ outlineId, field: `${prefix}${field}`, reason: "same-field", localValue: reviewValue(local[field]), remoteValue: reviewValue(remote[field]) }) === "remote") {
        if (Object.prototype.hasOwnProperty.call(remote, field)) merged[field] = remote[field];
        else delete merged[field];
      }
    });
    return merged;
  };
  const rows = new Map<string, ItemList>();
  const ids = new Set([...left.itemLists, ...right.itemLists].map((list) => list._id));
  ids.forEach((id) => {
    const local = left.itemLists.find((list) => list._id === id);
    const remote = right.itemLists.find((list) => list._id === id);
    if (local && remote) {
      rows.set(id, mergeValues(local as unknown as Record<string, unknown>, remote as unknown as Record<string, unknown>, id) as unknown as ItemList);
    } else {
      const value = choose({ outlineId: id, reason: "delete-versus-edit", localValue: local, remoteValue: remote }) === "local" ? local : remote;
      if (value) rows.set(id, value);
    }
  });
  const localOrder = left.itemLists.map((list) => list._id).filter((id) => rows.has(id));
  const remoteOrder = right.itemLists.map((list) => list._id).filter((id) => rows.has(id));
  const commonLocalOrder = localOrder.filter((id) => remoteOrder.includes(id));
  const commonRemoteOrder = remoteOrder.filter((id) => localOrder.includes(id));
  const useRemoteOrder = !isEqual(commonLocalOrder, commonRemoteOrder) && choose({ field: "order", reason: "same-field", localValue: left.itemLists, remoteValue: right.itemLists }) === "remote";
  const preferred = useRemoteOrder ? remoteOrder : localOrder;
  const order = [...preferred, ...[...rows.keys()].filter((id) => !preferred.includes(id))];
  const active = left.activeList?._id === right.activeList?._id || choose({ field: "activeList", reason: "same-field", localValue: left.activeList, remoteValue: right.activeList }) === "local" ? left.activeList : right.activeList;
  return {
    ...mergeValues(registryMetadata(left), registryMetadata(right)),
    _id: left._id, _rev: left._rev,
    itemLists: order.map((id) => rows.get(id)!),
    activeList: rows.get(active?._id) ?? active,
    selectedIdByScope: mergeValues(left.selectedIdByScope ?? {}, right.selectedIdByScope ?? {}, undefined, "selection:") as Record<string, string>,
  };
};

export const registrySnapshot = (doc: DBItemLists): ItemListsRegistrySnapshot => ({
  currentLists: doc.itemLists ?? [], activeList: doc.activeList,
  selectedIdByScope: doc.selectedIdByScope ?? {},
});

/** Read-only review. No revision is written or retired until choices have been
 * made against this exact graph and the graph has been checked again. */
export const reviewItemListsRegistry = async (
  db: ItemListsRegistryDb,
  intents: ItemListsRegistryIntent[],
  choices: Record<string, "local" | "remote"> = {},
): Promise<RegistryRecoveryReview> => {
  const head = await db.get("ItemLists", { conflicts: true }) as RegistryRevisionDoc;
  const conflicts: RegistryRecoveryReview["conflicts"] = [];
  const chooser = (stage: string): ConflictChoice => (conflict) => {
    const key = `${stage}:${conflict.outlineId ?? "registry"}:${conflict.field ?? "outline"}`;
    conflicts.push({ ...conflict, key });
    return choices[key] ?? "local";
  };
  let document: DBItemLists = { ...head };
  if (head._conflicts?.length) {
    const leaves = await Promise.all([head._rev, ...[...head._conflicts].sort()].map((rev) =>
      db.get("ItemLists", { rev, revs: true }) as Promise<RegistryRevisionDoc>,
    ));
    const histories = leaves.map((leaf) => leaf._revisions?.ids.map((id, index) =>
      `${leaf._revisions!.start - index}-${id}`,
    ) ?? []);
    const commonRevision = histories[0]?.find((revision) => histories.every((history) => history.includes(revision)));
    let baseline: ItemListsRegistrySnapshot = { currentLists: [], selectedIdByScope: {} };
    let baseDocument: RegistryRevisionDoc | undefined;
    if (commonRevision) {
      try {
        baseDocument = await db.get("ItemLists", { rev: commonRevision }) as RegistryRevisionDoc;
        baseline = registrySnapshot(baseDocument);
      } catch {
        // Compacted ancestor: every difference requires explicit review below.
      }
    }
    for (let index = 1; index < leaves.length; index += 1) {
      const branch = leaves[index];
      const choose = chooser(`saved-${index}`);
      if (!baseDocument) {
        document = mergeUnbasedRegistryDocuments(document, branch, choose);
        continue;
      }
      const merged = mergeItemListsRegistrySnapshot(registrySnapshot(branch), {
        before: baseline, after: registrySnapshot(document),
      }, choose);
      document = {
        ...patchChangedFields(registryMetadata(baseDocument), registryMetadata(document), registryMetadata(branch), choose),
        _id: head._id, _rev: head._rev,
        itemLists: merged.currentLists, activeList: merged.activeList ?? document.activeList,
        selectedIdByScope: merged.selectedIdByScope,
      };
    }
  }
  intents.forEach((intent, index) => {
    document = applyItemListsRegistryIntent(document, intent, chooser(`change-${index}`));
  });
  delete (document as RegistryRevisionDoc)._conflicts;
  delete (document as RegistryRevisionDoc)._revisions;
  document.updatedAt = new Date().toISOString();
  return { graph: registryGraph(head), hasBranches: Boolean(head._conflicts?.length), document, conflicts, choices };
};

export const resolveItemListsRegistry = async (
  db: ItemListsRegistryDb,
  intents: ItemListsRegistryIntent[],
  reviewed: RegistryRecoveryReview,
  choices: Record<string, "local" | "remote">,
): Promise<DBItemLists> => {
  const selected = { ...reviewed.choices, ...choices };
  const latest = await reviewItemListsRegistry(db, intents, selected);
  const unresolved = latest.conflicts.some((conflict) => !selected[conflict.key]);
  const head = await db.get("ItemLists", { conflicts: true }) as RegistryRevisionDoc;
  if (latest.graph !== reviewed.graph || registryGraph(head) !== reviewed.graph || unresolved) {
    throw new ItemListsRegistryConflictError([{ reason: "revision-branches" }]);
  }
  if (!isEqual(latest.conflicts, reviewed.conflicts)) {
    const retainedChoices = { ...selected };
    latest.conflicts.forEach((conflict) => {
      if (!isEqual(conflict, reviewed.conflicts.find((previous) => previous.key === conflict.key))) {
        delete retainedChoices[conflict.key];
      }
    });
    throw new RegistryReviewChangedError({ ...latest, choices: retainedChoices });
  }
  const branches = [...(head._conflicts ?? [])].sort();
  if (!branches.length && sameRegistryDocument(head, latest.document)) return head;
  if (branches.length && !db.remove) throw new Error("The outline list cannot resolve saved versions in this session");
  const result = await db.put(latest.document);
  const revision = typeof result === "object" && result !== null && "rev" in result ? (result as { rev?: string }).rev : undefined;
  if (!revision) throw new Error("The outline list save was not acknowledged");
  for (const branch of branches) {
    const current = await db.get("ItemLists", { conflicts: true, revs: true }) as RegistryRevisionDoc;
    const expected = branches.filter((rev) => rev >= branch);
    const history = current._revisions?.ids.map((id, index) => `${current._revisions!.start - index}-${id}`) ?? [];
    if (current._rev !== revision || !history.includes(head._rev) || !isEqual([...(current._conflicts ?? [])].sort(), expected)) {
      throw new ItemListsRegistryConflictError([{ reason: "revision-branches" }]);
    }
    await db.remove!("ItemLists", branch);
  }
  const verified = await db.get("ItemLists", { conflicts: true }) as RegistryRevisionDoc;
  if (verified._conflicts?.length || verified._rev !== revision) {
    throw new ItemListsRegistryConflictError([{ reason: "revision-branches" }]);
  }
  return { ...latest.document, _rev: revision };
};
