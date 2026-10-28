import "core-js/stable/structured-clone";
import "fake-indexeddb/auto";
import PouchDB from "pouchdb-browser";
import type { DBItemLists } from "../types";
import { ItemListsRegistryQueue } from "./itemListsRegistryQueue";
import { registrySnapshot, reviewItemListsRegistry, resolveItemListsRegistry, ItemListsRegistryConflictError } from "./persistItemListsRegistry";

const setup = async () => {
  const id = `registry-recovery-${Date.now()}-${Math.random()}`;
  const a = new PouchDB(`${id}-a`);
  const b = new PouchDB(`${id}-b`);
  const c = new PouchDB(`${id}-c`);
  await a.put({
    _id: "ItemLists", itemLists: [{ _id: "a", name: "A" }, { _id: "b", name: "B" }, { _id: "c", name: "C", controllerScope: "aux" }],
    activeList: { _id: "a", name: "A" }, selectedIdByScope: { presentation: "a", aux: "c" },
  });
  await Promise.all([b.replicate.from(a), c.replicate.from(a)]);
  const base = await a.get<DBItemLists>("ItemLists");
  await a.put({ ...base, itemLists: base.itemLists.map((list) => list._id === "a" ? { ...list, name: "A from first device" } : list) });
  await b.put({ ...base, itemLists: base.itemLists.map((list) => ({ ...list, name: list._id === "a" ? "A from second device" : list._id === "b" ? "Independent B" : list.name })) });
  await a.replicate.from(b);
  return { a, b, c, base, cleanup: () => Promise.all([a.destroy(), b.destroy(), c.destroy()]) };
};

describe("registry conflict recovery with real disconnected replicas", () => {
  it("reviews saved branches even with no local edit and retires only reviewed branches after explicit choices", async () => {
    const env = await setup();
    try {
      const queue = new ItemListsRegistryQueue(env.a, jest.fn(), jest.fn());
      await queue.observeRevisionConflict(true);
      const state = queue.state;
      expect(state.status).toBe("review");
      expect(state.conflicts).toEqual([expect.objectContaining({ outlineId: "a", field: "name" })]);
      expect((await env.a.get("ItemLists", { conflicts: true }))._conflicts).toHaveLength(1);
      await queue.resolve(state.reviewId!, Object.fromEntries(state.conflicts!.map((conflict) => [conflict.key, "local"])));
      const saved = await env.a.get<DBItemLists>("ItemLists", { conflicts: true });
      expect(saved._conflicts).toBeUndefined();
      expect(saved.itemLists.find((list) => list._id === "b")?.name).toBe("Independent B");
      expect(saved.itemLists.find((list) => list._id === "a")?.name).toBe(state.conflicts![0].localValue);
      expect(saved.activeList._id).toBe("a");
      expect(saved.selectedIdByScope).toEqual({ presentation: "a", aux: "c" });
      expect(queue.state.status).toBe("idle");
      await env.b.replicate.from(env.a);
      expect((await env.b.get("ItemLists", { conflicts: true }))._conflicts).toBeUndefined();
    } finally { await env.cleanup(); }
  });

  it("retains pending local work and rejects an obsolete registry review when a third revision arrives", async () => {
    const env = await setup();
    try {
      const before = registrySnapshot(env.base);
      const intents = [{ before, after: { ...before, selectedIdByScope: { ...before.selectedIdByScope, aux: "b" } } }];
      const reviewed = await reviewItemListsRegistry(env.a, intents);
      await env.c.put({ ...env.base, itemLists: env.base.itemLists.map((list) => list._id === "a" ? { ...list, name: "Third device" } : list) });
      await env.a.replicate.from(env.c);
      const put = jest.spyOn(env.a, "put");
      const remove = jest.spyOn(env.a, "remove");
      await expect(resolveItemListsRegistry(env.a, intents, reviewed, Object.fromEntries(reviewed.conflicts.map((conflict) => [conflict.key, "local"])))).rejects.toBeInstanceOf(ItemListsRegistryConflictError);
      expect(put).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect((await env.a.get("ItemLists", { conflicts: true }))._conflicts).toHaveLength(2);
      const refreshed = await reviewItemListsRegistry(env.a, intents);
      await resolveItemListsRegistry(env.a, intents, refreshed, Object.fromEntries(refreshed.conflicts.map((conflict) => [conflict.key, "local"])));
      const saved = await env.a.get<DBItemLists>("ItemLists", { conflicts: true });
      expect(saved._conflicts).toBeUndefined();
      expect(saved.selectedIdByScope?.aux).toBe("b");
      expect(saved.itemLists.find((list) => list._id === "b")?.name).toBe("Independent B");
    } finally { await env.cleanup(); }
  });

  it("refreshes dependent choices instead of saving a different value from the one reviewed", async () => {
    const env = await setup();
    try {
      const before = registrySnapshot(env.base);
      const queue = new ItemListsRegistryQueue(env.a, jest.fn(), jest.fn());
      queue.enqueue({ before, after: { ...before, currentLists: before.currentLists.map((list) => list._id === "a" ? { ...list, name: "Unsaved local draft" } : list) } });
      await queue.flush();
      const reviewed = queue.state;
      expect(reviewed.conflicts).toHaveLength(2);
      const put = jest.spyOn(env.a, "put");
      // Choosing the other saved branch changes the value offered by the next
      // comparison with the unsaved local draft. That value needs fresh review.
      await queue.resolve(reviewed.reviewId!, Object.fromEntries(reviewed.conflicts!.map((conflict) => [conflict.key, "remote"])));
      expect(put).not.toHaveBeenCalled();
      expect(queue.state.reviewId).not.toBe(reviewed.reviewId);
      expect(queue.state.choices).toEqual({ [reviewed.conflicts![0].key]: "remote" });
      const refreshed = queue.state;
      await queue.resolve(refreshed.reviewId!, Object.fromEntries(refreshed.conflicts!.map((conflict) => [conflict.key, "remote"])));
      expect((await env.a.get<DBItemLists>("ItemLists")).itemLists[0].name).toBe(refreshed.conflicts![1].remoteValue);
      expect(queue.state.status).toBe("idle");
    } finally { await env.cleanup(); }
  });

  it("keeps a branch-only review actionable after retry and another revision arriving", async () => {
    const env = await setup();
    try {
      const queue = new ItemListsRegistryQueue(env.a, jest.fn(), jest.fn());
      await queue.observeRevisionConflict(true);
      await queue.flush(true);
      expect(queue.state.status).toBe("review");
      const state = queue.state;
      await env.c.put({ ...env.base, itemLists: env.base.itemLists.map((list) => list._id === "a" ? { ...list, name: "New branch" } : list) });
      await env.a.replicate.from(env.c);
      await queue.resolve(state.reviewId!, Object.fromEntries(state.conflicts!.map((conflict) => [conflict.key, "local"])));
      expect(queue.state.status).toBe("review");
      expect(queue.state.reviewId).not.toBe(state.reviewId);
      expect((await env.a.get("ItemLists", { conflicts: true }))._conflicts).toHaveLength(2);
    } finally { await env.cleanup(); }
  });

  it("requires explicit property and presence choices when the shared ancestor was compacted", async () => {
    const env = await setup();
    try {
      const branch = await env.b.get<DBItemLists>("ItemLists");
      await env.b.put({ ...branch, itemLists: branch.itemLists.filter((list) => list._id !== "c"), selectedIdByScope: { presentation: "a" } });
      await env.a.replicate.from(env.b);
      await env.a.compact();
      await expect(env.a.get("ItemLists", { rev: env.base._rev })).rejects.toMatchObject({ status: 404 });
      const reviewed = await reviewItemListsRegistry(env.a, []);
      expect(reviewed.conflicts).toEqual(expect.arrayContaining([
        expect.objectContaining({ outlineId: "c", reason: "delete-versus-edit" }),
        expect.objectContaining({ outlineId: "b", field: "name" }),
      ]));
      const put = jest.spyOn(env.a, "put");
      await expect(resolveItemListsRegistry(env.a, [], reviewed, {})).rejects.toBeInstanceOf(ItemListsRegistryConflictError);
      expect(put).not.toHaveBeenCalled();
      const choices = Object.fromEntries(reviewed.conflicts.map((conflict): [string, "local" | "remote"] => {
        let choice: "local" | "remote" = "local";
        if (conflict.outlineId === "c") choice = conflict.localValue ? "local" : "remote";
        if (conflict.outlineId === "b") choice = conflict.localValue === "Independent B" ? "local" : "remote";
        return [conflict.key, choice];
      }));
      await resolveItemListsRegistry(env.a, [], reviewed, choices);
      const saved = await env.a.get<DBItemLists>("ItemLists", { conflicts: true });
      expect(saved._conflicts).toBeUndefined();
      expect(saved.itemLists.find((list) => list._id === "c")).toBeDefined();
      expect(saved.itemLists.find((list) => list._id === "b")?.name).toBe("Independent B");
    } finally { await env.cleanup(); }
  });
});
