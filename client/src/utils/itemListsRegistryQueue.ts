import isEqual from "lodash/isEqual";
import type { DBItemLists } from "../types";
import {
  mergeItemListsRegistrySnapshot,
  persistItemListsRegistry,
  resolveItemListsRegistry,
  reviewItemListsRegistry,
  type ItemListsRegistryDb,
  type ItemListsRegistryIntent,
  type RegistryRecoveryReview,
  registrySnapshot,
  RegistryReviewChangedError,
} from "./persistItemListsRegistry";

export type RegistrySaveState = {
  status: "idle" | "saving" | "error" | "review";
  conflicts?: RegistryRecoveryReview["conflicts"];
  reviewId?: number;
  hasBranches?: boolean;
  choices?: Record<string, "local" | "remote">;
  reviewChanged?: boolean;
};

type Entry = { key: string; outlineId?: string; intent: ItemListsRegistryIntent; failed?: boolean };

/** Separate independent properties so one overlapping rename cannot block a
 * selection or another outline's safe edit. Each entry still uses a baseline. */
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
  const desiredExistingOrder = after.currentLists.filter((list) => before.currentLists.some((base) => base._id === list._id));
  const baseKeptOrder = before.currentLists.filter((list) => after.currentLists.some((desired) => desired._id === list._id));
  if (!isEqual(baseKeptOrder.map((list) => list._id), desiredExistingOrder.map((list) => list._id))) {
    result.push({ key: "order", intent: { before, after: {
      ...before, currentLists: [
        ...desiredExistingOrder.map((list) => before.currentLists.find((base) => base._id === list._id)!),
        ...before.currentLists.filter((list) => !after.currentLists.some((desired) => desired._id === list._id)),
      ],
    } } });
  }
  if (before.activeList?._id !== after.activeList?._id) {
    result.push({ key: "activeList", intent: { before, after: { ...before, activeList: after.activeList } } });
  }
  const scopes = new Set([...Object.keys(before.selectedIdByScope), ...Object.keys(after.selectedIdByScope)]);
  scopes.forEach((scope) => {
    if (before.selectedIdByScope[scope] === after.selectedIdByScope[scope]) return;
    const selected = { ...before.selectedIdByScope };
    if (after.selectedIdByScope[scope]) selected[scope] = after.selectedIdByScope[scope];
    else delete selected[scope];
    result.push({ key: `selection:${scope}`, intent: { before, after: { ...before, selectedIdByScope: selected } } });
  });
  return result;
};

/** Owned by the concrete database, not by a picker component or debounce task.
 * Failed entries are parked until explicit retry/review or a superseding edit. */
export class ItemListsRegistryQueue {
  private entries: Entry[] = [];
  private running?: Promise<void>;
  private review?: { value: RegistryRecoveryReview; entries: Entry[]; id: number };
  private version = 0;
  private reviewVersion = 0;
  private observedBranches = false;
  state: RegistrySaveState = { status: "idle" };

  get pendingIntents() { return this.entries.map((entry) => entry.intent); }

  constructor(
    private readonly db: ItemListsRegistryDb,
    private readonly saved: (doc: DBItemLists, pending: ItemListsRegistryIntent[]) => void,
    private readonly status: (state: RegistrySaveState) => void,
  ) {}

  private publish(state: RegistrySaveState) {
    this.state = state;
    this.status(state);
  }

  private trackRun(operation: Promise<void>): Promise<void> {
    this.running = operation.finally(async () => {
      this.running = undefined;
      // An edit may arrive during the final review read, after the drain loop
      // ended. Resume those new entries; parked failures stay parked.
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
        // Replace the object so acknowledgment of a running old entry cannot
        // remove the newer intent.
        this.entries.splice(this.entries.indexOf(previous), 1);
      }
      if (entry.outlineId && entry.key === `outline:${entry.outlineId}`) {
        this.entries = this.entries.filter((candidate) => candidate.outlineId !== entry.outlineId);
      }
      this.entries.push(entry);
    }
    this.version += 1;
    this.review = undefined;
  }

  private async prepareReview(observe = false, changed = false) {
    const version = this.version;
    const entries = [...this.entries];
    if (!entries.length && !observe) { this.publish({ status: "idle" }); return; }
    try {
      const value = await reviewItemListsRegistry(this.db, entries.map((entry) => entry.intent));
      if (version !== this.version) return;
      this.observedBranches = value.hasBranches;
      if (!entries.length && !value.hasBranches) { this.publish({ status: "idle" }); return; }
      this.review = { value, entries, id: ++this.reviewVersion };
      this.publish({ status: "review", conflicts: value.conflicts, reviewId: this.review.id, hasBranches: value.hasBranches, reviewChanged: changed });
    } catch {
      if (version === this.version) this.publish({ status: "error" });
    }
  }

  flush(retry = false): Promise<void> {
    if (this.running) return this.running;
    if (retry) this.entries.forEach((entry) => { entry.failed = false; });
    const observeBranches = this.observedBranches;
    const nextEntry = () => this.entries.find((entry) => !entry.failed && entry.key !== "order") ?? this.entries.find((entry) => !entry.failed);
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
          const doc = await persistItemListsRegistry(this.db, [entry.intent]);
          const savedEntry = entry;
          this.entries = this.entries.filter((candidate) => candidate !== currentEntry);
          this.entries.forEach((candidate) => {
            if (candidate.key !== savedEntry.key) return;
            const before = registrySnapshot(doc);
            candidate.intent = { before, after: mergeItemListsRegistrySnapshot(before, candidate.intent, () => "local") };
          });
          this.saved(doc, this.entries.map((candidate) => candidate.intent));
        } catch {
          entry.failed = true;
        }
        entry = nextEntry();
      }
      await this.prepareReview(observeBranches);
    };
    return this.trackRun(run());
  }

  resolve(reviewId: number, choices: Record<string, "local" | "remote">): Promise<void> {
    if (this.running) return this.running;
    const review = this.review;
    if (!review || review.id !== reviewId) return this.flush();
    const version = this.version;
    const run = async () => {
      this.publish({ status: "saving" });
      try {
        const doc = await resolveItemListsRegistry(this.db, review.entries.map((entry) => entry.intent), review.value, choices);
        this.entries = this.entries.filter((entry) => !review.entries.includes(entry));
        this.review = undefined;
        this.observedBranches = false;
        this.saved(doc, this.entries.map((entry) => entry.intent));
      } catch (error) {
        if (error instanceof RegistryReviewChangedError && version === this.version) {
          this.review = { ...review, value: error.review, id: ++this.reviewVersion };
          this.publish({ status: "review", conflicts: error.review.conflicts, reviewId: this.review.id,
            hasBranches: error.review.hasBranches, choices: error.review.choices, reviewChanged: true });
          return;
        }
        // Stale graph/choices require another review, never a forced retry.
      }
      if (version !== this.version) this.review = undefined;
      if (this.entries.some((entry) => !entry.failed)) return;
      await this.prepareReview(this.observedBranches, true);
    };
    return this.trackRun(run());
  }

  /** Revision branches can be detected before any local registry edit. */
  observeRevisionConflict(hasBranches: boolean) {
    this.observedBranches = hasBranches;
    if (this.entries.length || this.running) return this.running;
    if (!hasBranches) {
      this.review = undefined;
      this.publish({ status: "idle" });
      return;
    }
    if (this.review) return;
    return this.trackRun(this.prepareReview(true));
  }
}
