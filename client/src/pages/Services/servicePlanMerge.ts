import type { ServicePlan, ServicePlanSection } from "../../types/servicePlan";
import { richTextToPlainText } from "../../types/richText";

export type ServicePlanMergeConflict = {
  path: string;
  label: string;
  localValue: unknown;
  remoteValue: unknown;
  kind: "field" | "delete-modify" | "order";
};

export type ServicePlanMergeResult = {
  plan: Pick<ServicePlan, "name" | "timezone" | "sourceImport" | "sections">;
  conflicts: ServicePlanMergeConflict[];
};

const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const labelFor = (path: string) => path.split(".").filter(Boolean).join(" / ");

type MergeContext = { conflicts: ServicePlanMergeConflict[] };

const mergeValue = (
  base: unknown,
  local: unknown,
  remote: unknown,
  path: string,
  context: MergeContext,
): unknown => {
  if (equal(local, base)) return remote;
  if (equal(remote, base) || equal(local, remote)) return local;

  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
    if ([...base, ...local, ...remote].every((value) => isRecord(value) && typeof value.id === "string")) {
      return mergeIdArray(base as Identified[], local as Identified[], remote as Identified[], path, context);
    }
  }
  if (isRecord(base) && isRecord(local) && isRecord(remote)) {
    const result: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
      const merged = mergeValue(base[key], local[key], remote[key], `${path}.${key}`, context);
      if (merged !== undefined) result[key] = merged;
    }
    return result;
  }

  context.conflicts.push({ path, label: labelFor(path), localValue: local, remoteValue: remote, kind: "field" });
  return local;
};

type Identified = Record<string, unknown> & { id: string };

const mergeIdArray = (
  base: Identified[], local: Identified[], remote: Identified[], path: string, context: MergeContext,
): Identified[] => {
  const baseById = new Map(base.map((item) => [item.id, item]));
  const localById = new Map(local.map((item) => [item.id, item]));
  const remoteById = new Map(remote.map((item) => [item.id, item]));
  const baseOrderIds = base.map((item) => item.id);
  const movedInOrder = (id: string, sideOrder: string[]) => {
    const baseIndex = baseOrderIds.indexOf(id);
    const sideIndex = sideOrder.indexOf(id);
    if (baseIndex < 0 || sideIndex < 0) return false;
    return baseOrderIds.some((otherId, otherBaseIndex) => {
      if (otherId === id || !sideOrder.includes(otherId)) return false;
      const sideOtherIndex = sideOrder.indexOf(otherId);
      return (baseIndex < otherBaseIndex) !== (sideIndex < sideOtherIndex);
    });
  };
  const ids = new Set([...baseById.keys(), ...localById.keys(), ...remoteById.keys()]);
  const merged = new Map<string, Identified>();

  for (const id of ids) {
    const before = baseById.get(id);
    const mine = localById.get(id);
    const theirs = remoteById.get(id);
    if (!before) {
      if (mine && theirs) merged.set(id, mergeValue({}, mine, theirs, `${path}.${id}`, context) as Identified);
      else if (mine || theirs) merged.set(id, (mine || theirs)!);
      continue;
    }
    if (!mine && !theirs) continue;
    if (!mine || !theirs) {
      const remaining = mine || theirs;
      const localDelete = !mine;
      const survivingOrder = localDelete ? remote.map((item) => item.id) : local.map((item) => item.id);
      if (equal(remaining, before) && !movedInOrder(id, survivingOrder)) continue;
      context.conflicts.push({
        path: `${path}.${id}`,
        label: labelFor(`${path}.${id}`),
        localValue: localDelete ? undefined : mine,
        remoteValue: localDelete ? theirs : undefined,
        kind: "delete-modify",
      });
      merged.set(id, remaining!);
      continue;
    }
    merged.set(id, mergeValue(before, mine, theirs, `${path}.${id}`, context) as Identified);
  }

  const baseOrder = base.map((item) => item.id).filter((id) => merged.has(id));
  const localOrder = local.map((item) => item.id).filter((id) => merged.has(id));
  const remoteOrder = remote.map((item) => item.id).filter((id) => merged.has(id));
  const baseCommon = baseOrder.filter((id) => localOrder.includes(id) && remoteOrder.includes(id));
  const localCommon = localOrder.filter((id) => baseCommon.includes(id));
  const remoteCommon = remoteOrder.filter((id) => baseCommon.includes(id));
  const localMoved = !equal(localCommon, baseCommon);
  const remoteMoved = !equal(remoteCommon, baseCommon);
  let order: string[];
  if (!localMoved) order = remoteOrder;
  else if (!remoteMoved || equal(localCommon, remoteCommon)) order = localOrder;
  else {
    const movedIds = (sequence: string[]) => {
      const moved = new Set<string>();
      for (let left = 0; left < baseCommon.length; left += 1) {
        for (let right = left + 1; right < baseCommon.length; right += 1) {
          if ((sequence.indexOf(baseCommon[left]) < sequence.indexOf(baseCommon[right])) !== (left < right)) {
            moved.add(baseCommon[left]);
            moved.add(baseCommon[right]);
          }
        }
      }
      return moved;
    };
    const localMovedIds = movedIds(localCommon);
    const remoteMovedIds = movedIds(remoteCommon);
    const overlappingMoves = [...localMovedIds].some((id) => remoteMovedIds.has(id));
    if (overlappingMoves) {
      context.conflicts.push({ path: `${path}.__order`, label: `${labelFor(path)} order`, localValue: localOrder, remoteValue: remoteOrder, kind: "order" });
      order = localOrder;
    } else {
    const nodes = new Set(baseCommon);
    const edges = new Map([...nodes].map((id) => [id, new Set<string>()]));
    const addChangedPairs = (sequence: string[]) => {
      for (let left = 0; left < baseCommon.length; left += 1) {
        for (let right = left + 1; right < baseCommon.length; right += 1) {
          const first = baseCommon[left];
          const second = baseCommon[right];
          const firstIndex = sequence.indexOf(first);
          const secondIndex = sequence.indexOf(second);
          if ((firstIndex < secondIndex) !== (baseCommon.indexOf(first) < baseCommon.indexOf(second))) {
            edges.get(second)?.add(first);
          }
        }
      }
    };
    addChangedPairs(localCommon);
    addChangedPairs(remoteCommon);
    const sorted: string[] = [];
    const remaining = new Set(nodes);
    while (remaining.size) {
      const rank = new Map(baseCommon.map((id, index) => [id, index]));
      const next = [...remaining].filter((id) => ![...remaining].some((other) => edges.get(other)?.has(id))).sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0))[0];
      if (!next) break;
      sorted.push(next);
      remaining.delete(next);
    }
    if (remaining.size) {
      context.conflicts.push({ path: `${path}.__order`, label: `${labelFor(path)} order`, localValue: localOrder, remoteValue: remoteOrder, kind: "order" });
      order = localOrder;
    } else order = sorted;
    }
  }
  // Additions made independently have no shared anchor. Keep the merged order
  // for surviving base records, then append additions in stable ID order.
  const baseIds = new Set(baseOrder);
  const orderedBaseIds = order.filter((id) => baseIds.has(id));
  const additions = [...merged.keys()].filter((id) => !baseIds.has(id)).sort();
  order = [...orderedBaseIds, ...additions];
  return order.map((id) => merged.get(id)!).filter(Boolean);
};

export const mergeServicePlan = (base: ServicePlan, local: ServicePlan, remote: ServicePlan): ServicePlanMergeResult => {
  const context: MergeContext = { conflicts: [] };
  const merged = mergeValue(
    { name: base.name, timezone: base.timezone, sourceImport: base.sourceImport, sections: base.sections },
    { name: local.name, timezone: local.timezone, sourceImport: local.sourceImport, sections: local.sections },
    { name: remote.name, timezone: remote.timezone, sourceImport: remote.sourceImport, sections: remote.sections },
    "plan",
    context,
  ) as { name: string; timezone?: string; sourceImport?: ServicePlan["sourceImport"]; sections: ServicePlanSection[] };
  const names = new Map<string, string>();
  for (const source of [base, local, remote]) {
    for (const section of source.sections || []) {
      names.set(section.id, `Section “${section.name}”`);
      for (const element of section.elements || []) {
        const title = richTextToPlainText(element.title).trim();
        names.set(element.id, title ? `Item “${title}”` : "Item");
        for (const record of [
          ...(element.teamNotes || []).map((entry) => [entry.id, entry.label] as const),
          ...(element.resources || []).map((entry) => [entry.id, entry.title] as const),
          ...(element.assignees || []).map((entry) => [entry.id, entry.name || "Assignee"] as const),
        ]) names.set(record[0], record[1]);
      }
    }
  }
  const conflicts = context.conflicts.map((conflict) => {
    const parts = conflict.path.replace(/^plan\./, "").split(".");
    if (parts[parts.length - 1] === "blocks") parts.pop();
    return {
    ...conflict,
    label: parts.map((part) =>
      names.get(part) || part.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase()),
    ).join(" / "),
    };
  });
  return { plan: merged, conflicts };
};

export const applyServicePlanMergeChoices = (
  plan: ServicePlanMergeResult["plan"],
  conflicts: ServicePlanMergeConflict[],
  choices: Record<string, "local" | "remote">,
) => {
  const result = structuredClone(plan) as ServicePlanMergeResult["plan"];
  const setAtPath = (path: string, value: unknown) => {
    const segments = path.replace(/^plan\./, "").split(".");
    let cursor: unknown = result;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index];
      if (Array.isArray(cursor)) cursor = cursor.find((entry) => isRecord(entry) && entry.id === segment);
      else if (isRecord(cursor)) cursor = cursor[segment];
      if (!cursor) return;
    }
    const final = segments[segments.length - 1];
    if (Array.isArray(cursor)) {
      const found = cursor.findIndex((entry) => isRecord(entry) && entry.id === final);
      if (value === undefined) { if (found >= 0) cursor.splice(found, 1); }
      else if (found >= 0) cursor[found] = value;
      else cursor.push(value);
    } else if (isRecord(cursor)) {
      if (value === undefined) delete cursor[final];
      else cursor[final] = value;
    }
  };
  for (const conflict of conflicts) {
    const choice = choices[conflict.path];
    if (!choice) continue;
    if (conflict.kind === "order") {
      const path = conflict.path.replace(/\.__order$/, "");
      const ids = (choice === "local" ? conflict.localValue : conflict.remoteValue) as string[];
      const segments = path.replace(/^plan\./, "").split(".");
      let cursor: unknown = result;
      for (const segment of segments) cursor = Array.isArray(cursor)
        ? cursor.find((entry) => isRecord(entry) && entry.id === segment)
        : isRecord(cursor) ? cursor[segment] : undefined;
      if (Array.isArray(cursor)) {
        const byId = new Map(cursor.map((entry) => [isRecord(entry) ? entry.id : "", entry]));
        cursor.splice(0, cursor.length, ...ids.map((id) => byId.get(id)).filter(Boolean), ...cursor.filter((entry) => !ids.includes(isRecord(entry) ? String(entry.id) : "")));
      }
    } else {
      setAtPath(conflict.path, choice === "local" ? conflict.localValue : conflict.remoteValue);
    }
  }
  return result;
};
