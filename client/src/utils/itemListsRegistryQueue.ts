import isEqual from "lodash/isEqual";
import type { DBItemLists } from "../types";
import {
  ItemListsRegistryConflictError,
  mergeItemListsRegistrySnapshot,
  persistItemListsRegistry,
  type ItemListsRegistryDb,
  type ItemListsRegistryIntent,
} from "./persistItemListsRegistry";

export type RegistrySaveState = {
  status: "idle" | "saving" | "error";
  hasCurrentConflicts?: boolean;
};

type Entry = {
  key: string;
  outlineId?: string;
  intent: ItemListsRegistryIntent;
  failed?: boolean;
  conflict?: boolean;
};

/** Split changes so a conflicting outline field does not block unrelated saves. */
const splitIntent = (intent: ItemListsRegistryIntent): Entry[] => {
  const { before, after } = intent;
  const result: Entry[] = [];
  const ids = new Set([...before.currentLists, ...after.currentLists].map((list) => list._id));
  ids.forEach((id) => {
    const base = before.currentLists.find((list) => list._id === id);
    const desired = after.currentLists.find((list) => list._id === id);
    if (isEqual(base, desired)) return;
    if (!base || !desired) {
      result.push({ key: `outline:${id}`, outlineId: id, intent: { before, after: {
        ...before, currentLists: desired
          ? [...before.currentLists, desired]
          : before.currentLists.filter((list) => list._id !== id),
      } } });
      return;
    }
    const keys = new Set([...Object.keys(base), ...Object.keys(desired)]);
    keys.forEach((field) => {
      const b = base as unknown as Record<string, unknown>;
      const d = desired as unknown as Record<string, unknown>;
      if (isEqual(b[field], d[field])) return;
      const patched = { ...b };
      if (Object.prototype.hasOwnProperty.call(d, field)) patched[field] = d[field];
      else delete patched[field];
      result.push({ key: `outline:${id}:${field}`, outlineId: id, intent: { before, after: {
        ...before, currentLists: before.currentLists.map((list) => list._id === id ? patched as unknown as typeof list : list),
      } } });
    });
  });

  const desiredOrder = after.currentLists.filter((list) => before.currentLists.some((base) => base._id === list._id));
  const baseOrder = before.currentLists.filter((list) => after.currentLists.some((desired) => desired._id === list._id));
  if (!isEqual(baseOrder.map((list) => list._id), desiredOrder.map((list) => list._id))) {
    result.push({ key: "order", intent: { before, after: {
      ...before, currentLists: [
        ...desiredOrder.map((list) => before.currentLists.find((base) => base._id === list._id)!),
        ...before.currentLists.filter((list) => !after.currentLists.some((desired) => desired._id === list._id)),
      ],
    } } });
  }
  if (before.activeList?._id !== after.activeList?._id) {
    result.push({ key: "activeList", intent: { before, after: { ...before, activeList: after.activeList } } });
  }
  return result;
};

/** A database-owned queue keeps unsaved registry edits alive across controller unmounts. */
export class ItemListsRegistryQueue {
  private entries: Entry[] = [];
  private running?: Promise<void>;
  state: RegistrySaveState = { status: "idle" };

  get pendingIntents(): ItemListsRegistryIntent[] {
    return this.entries.map(({ intent }) => ({
      before: {
        currentLists: intent.before.currentLists.map((list) => ({ ...list })),
        activeList: intent.before.activeList ? { ...intent.before.activeList } : undefined,
      },
      after: {
        currentLists: intent.after.currentLists.map((list) => ({ ...list })),
        activeList: intent.after.activeList ? { ...intent.after.activeList } : undefined,
      },
    }));
  }

  constructor(
    private readonly db: ItemListsRegistryDb,
    private readonly saved: (doc: DBItemLists) => void,
    private readonly status: (state: RegistrySaveState) => void,
  ) {}

  private publish(state: RegistrySaveState) {
    this.state = state;
    this.status(state);
  }

  private trackRun(operation: Promise<void>): Promise<void> {
    this.running = operation.finally(async () => {
      this.running = undefined;
      if (this.entries.some((entry) => !entry.failed)) await this.flush();
    });
    return this.running;
  }

  enqueue(intent: ItemListsRegistryIntent) {
    for (const entry of splitIntent(intent)) {
      const changesMembership = entry.outlineId && entry.key === `outline:${entry.outlineId}`;
      const previous = this.entries.find((candidate) => candidate.key === entry.key ||
        (entry.outlineId && (candidate.key === `outline:${entry.outlineId}` ||
          (entry.key === `outline:${entry.outlineId}` && candidate.outlineId === entry.outlineId))));
      if (previous) {
        if (!changesMembership) entry.key = previous.key;
        entry.intent = {
          before: previous.intent.before,
          after: mergeItemListsRegistrySnapshot(previous.intent.after, entry.intent, () => "local"),
        };
        this.entries.splice(this.entries.indexOf(previous), 1);
      }
      if (entry.outlineId && entry.key === `outline:${entry.outlineId}`) {
        this.entries = this.entries.filter((candidate) => candidate.outlineId !== entry.outlineId);
      }
      this.entries.push(entry);
    }
  }

  /** Retry transient failures, or explicitly keep current edits after a field conflict. */
  flush(retry = false, keepCurrentConflicts = false): Promise<void> {
    if (this.running) return this.running;
    if (retry) this.entries.forEach((entry) => { entry.failed = false; });

    const nextEntry = () => this.entries.find((entry) => !entry.failed && entry.key !== "order") ??
      this.entries.find((entry) => !entry.failed);
    const run = async () => {
      this.publish({ status: "saving" });
      let entry = nextEntry();
      while (entry) {
        const currentEntry = entry;
        if (entry.key === "order" && this.entries.some((candidate) => candidate.outlineId && candidate.key === `outline:${candidate.outlineId}`)) {
          entry.failed = true;
          entry = nextEntry();
          continue;
        }
        try {
          const doc = await persistItemListsRegistry(
            this.db,
            [entry.intent],
            keepCurrentConflicts && entry.conflict === true,
          );
          this.entries = this.entries.filter((candidate) => candidate !== currentEntry);
          this.entries.forEach((candidate) => {
            if (candidate.key !== currentEntry.key) return;
            const before = { currentLists: doc.itemLists ?? [], activeList: doc.activeList };
            candidate.intent = {
              before,
              after: mergeItemListsRegistrySnapshot(before, candidate.intent, () => "local"),
            };
          });
          this.saved(doc);
        } catch (error) {
          entry.failed = true;
          entry.conflict = error instanceof ItemListsRegistryConflictError;
        }
        entry = nextEntry();
      }

      const hasCurrentConflicts = this.entries.some((entry) => entry.failed && entry.conflict);
      this.publish(this.entries.some((entry) => entry.failed)
        ? { status: "error", hasCurrentConflicts }
        : { status: "idle" });
    };
    return this.trackRun(run());
  }
}
