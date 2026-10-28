import "core-js/stable/structured-clone";
import type { DBItemLists } from "../types";
import { ItemListsRegistryQueue } from "./itemListsRegistryQueue";
import { registrySnapshot, type ItemListsRegistryIntent } from "./persistItemListsRegistry";

const setup = () => {
  let document: DBItemLists = {
    _id: "ItemLists", _rev: "1-base",
    itemLists: [{ _id: "a", name: "A" }, { _id: "b", name: "B" }],
    activeList: { _id: "a", name: "A" }, selectedIdByScope: { presentation: "a", aux: "b" },
  };
  let revision = 1;
  const db = {
    get: jest.fn(async () => structuredClone(document)),
    put: jest.fn(async (value: unknown) => {
      const next = value as DBItemLists;
      if (next._rev !== document._rev) throw Object.assign(new Error("conflict"), { status: 409 });
      document = { ...structuredClone(next), _rev: `${++revision}-saved` };
      return { rev: document._rev };
    }),
  };
  const saved = jest.fn();
  const status = jest.fn();
  const queue = new ItemListsRegistryQueue(db, saved, status);
  const initial = registrySnapshot(document);
  const rename = (id: string, name: string, before = initial): ItemListsRegistryIntent => ({
    before, after: { ...before, currentLists: before.currentLists.map((item) => item._id === id ? { ...item, name } : item) },
  });
  return { db, queue, saved, status, initial, rename, document: () => document, setDocument: (next: DBItemLists) => { document = next; } };
};

describe("database-owned registry pending changes", () => {
  it("retains temporary failures for Retry save and removes acknowledged changes", async () => {
    const env = setup();
    env.db.put.mockRejectedValueOnce(new Error("offline"));
    env.queue.enqueue(env.rename("a", "Local"));
    await env.queue.flush();
    expect(env.queue.state.status).toBe("review");
    expect(env.document().itemLists[0].name).toBe("A");
    await env.queue.flush(true);
    expect(env.document().itemLists[0].name).toBe("Local");
    expect(env.queue.state.status).toBe("idle");
    const writes = env.db.put.mock.calls.length;
    await env.queue.flush(true);
    expect(env.db.put).toHaveBeenCalledTimes(writes);
    expect(env.saved).toHaveBeenCalledTimes(1);
  });

  it("parks same-field conflicts while independent properties and other outlines save", async () => {
    const env = setup();
    env.setDocument({ ...env.document(), _rev: "2-remote", itemLists: [{ _id: "a", name: "Remote" }, { _id: "b", name: "B" }] });
    env.queue.enqueue(env.rename("a", "Local"));
    await env.queue.flush();
    const conflictingReadCount = env.db.get.mock.calls.length;
    env.queue.enqueue(env.rename("b", "B local"));
    await env.queue.flush();
    expect(env.document().itemLists).toEqual([{ _id: "a", name: "Remote" }, { _id: "b", name: "B local" }]);
    expect(env.db.put).toHaveBeenCalledTimes(1);
    // One safe write read and one read-only review, with no resubmission of A.
    expect(env.db.get.mock.calls.length - conflictingReadCount).toBe(2);
    expect(env.queue.state.conflicts).toEqual([expect.objectContaining({ outlineId: "a", field: "name", localValue: "Local", remoteValue: "Remote" })]);
  });

  it.each(["local", "remote"] as const)("explicitly resolves a disputed name with %s values without discarding unrelated fields", async (choice) => {
    const env = setup();
    env.setDocument({ ...env.document(), _rev: "2-remote", itemLists: [{ _id: "a", name: "Remote", controllerScope: "aux" }, { _id: "b", name: "B remote" }] });
    env.queue.enqueue(env.rename("a", "Local"));
    await env.queue.flush();
    const state = env.queue.state;
    const choices = Object.fromEntries(state.conflicts!.map((conflict) => [conflict.key, choice]));
    await env.queue.resolve(state.reviewId!, choices);
    expect(env.document().itemLists).toEqual([{ _id: "a", name: choice === "local" ? "Local" : "Remote", controllerScope: "aux" }, { _id: "b", name: "B remote" }]);
    expect(env.queue.state.status).toBe("idle");
  });

  it("does not automatically retry an unchanged conflict and supersedes its older value", async () => {
    const env = setup();
    env.setDocument({ ...env.document(), _rev: "2-remote", itemLists: [{ _id: "a", name: "Remote" }, { _id: "b", name: "B" }] });
    const first = env.rename("a", "Old local");
    env.queue.enqueue(first);
    await env.queue.flush();
    env.queue.enqueue(env.rename("a", "Latest local", first.after));
    await env.queue.flush();
    expect(env.queue.state.conflicts?.map((conflict) => conflict.localValue)).toEqual(["Latest local"]);
    const state = env.queue.state;
    await env.queue.resolve(state.reviewId!, { [state.conflicts![0].key]: "local" });
    expect(env.document().itemLists[0].name).toBe("Latest local");
    expect(env.db.put).toHaveBeenCalledTimes(1);
  });

  it("serializes overlapping drains and edits arriving during an unacknowledged write", async () => {
    const env = setup();
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const put = env.db.put.getMockImplementation()!;
    env.db.put.mockImplementationOnce(async (document) => { await gate; return put(document); });
    const first = env.rename("a", "First");
    env.queue.enqueue(first);
    const running = env.queue.flush();
    await Promise.resolve();
    env.queue.enqueue(env.rename("a", "Second", first.after));
    expect(env.queue.flush(true)).toBe(running);
    finish();
    await running;
    expect(env.document().itemLists[0].name).toBe("Second");
    expect(env.db.put).toHaveBeenCalledTimes(2);
    expect(env.queue.state.status).toBe("idle");
  });

  it("invalidates reviewed choices after another writer changes the registry", async () => {
    const env = setup();
    env.setDocument({ ...env.document(), _rev: "2-remote", itemLists: [{ _id: "a", name: "Remote" }, { _id: "b", name: "B" }] });
    env.queue.enqueue(env.rename("a", "Local"));
    await env.queue.flush();
    const state = env.queue.state;
    env.setDocument({ ...env.document(), _rev: "3-new-remote", itemLists: [{ _id: "a", name: "New remote" }, { _id: "b", name: "B" }] });
    await env.queue.resolve(state.reviewId!, { [state.conflicts![0].key]: "local" });
    expect(env.db.put).not.toHaveBeenCalled();
    expect(env.queue.state.reviewId).not.toBe(state.reviewId);
    expect(env.queue.state.conflicts?.[0].remoteValue).toBe("New remote");
  });

  it("isolates queues even when databases contain matching outline IDs", async () => {
    const a = setup();
    const b = setup();
    a.db.put.mockRejectedValueOnce(new Error("offline"));
    a.queue.enqueue(a.rename("a", "Church A"));
    await a.queue.flush();
    b.queue.enqueue(b.rename("a", "Church B"));
    await b.queue.flush();
    await a.queue.flush(true);
    expect(a.document().itemLists[0].name).toBe("Church A");
    expect(b.document().itemLists[0].name).toBe("Church B");
  });

  it("recognizes a committed write after a lost response without submitting it twice", async () => {
    const env = setup();
    const put = env.db.put.getMockImplementation()!;
    env.db.put.mockImplementationOnce(async (document) => { await put(document); throw new Error("response lost"); });
    env.queue.enqueue(env.rename("a", "Acknowledgment lost"));
    await env.queue.flush();
    expect(env.queue.state.status).toBe("review");
    await env.queue.flush(true);
    expect(env.document().itemLists[0].name).toBe("Acknowledgment lost");
    expect(env.db.put).toHaveBeenCalledTimes(1);
    expect(env.queue.state.status).toBe("idle");
  });

  it("retains reorder intent until a failed outline creation can be saved", async () => {
    const env = setup();
    const added = { ...env.initial, currentLists: [...env.initial.currentLists, { _id: "c", name: "C" }] };
    env.queue.enqueue({ before: env.initial, after: added });
    env.queue.enqueue({ before: added, after: { ...added, currentLists: [added.currentLists[2], ...added.currentLists.slice(0, 2)] } });
    env.db.put.mockRejectedValueOnce(new Error("offline"));
    await env.queue.flush();
    expect(env.document().itemLists.map((item) => item._id)).toEqual(["a", "b"]);
    expect(env.queue.pendingIntents).toHaveLength(2);
    await env.queue.flush(true);
    expect(env.document().itemLists.map((item) => item._id)).toEqual(["c", "a", "b"]);
    expect(env.queue.pendingIntents).toHaveLength(0);
  });

  it("continues safe edits queued while an explicit resolution is awaiting acknowledgment", async () => {
    const env = setup();
    env.setDocument({ ...env.document(), _rev: "2-remote", itemLists: [{ _id: "a", name: "Remote" }, { _id: "b", name: "B" }] });
    env.queue.enqueue(env.rename("a", "Local"));
    await env.queue.flush();
    const state = env.queue.state;
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const put = env.db.put.getMockImplementation()!;
    env.db.put.mockImplementationOnce(async (document) => { await gate; return put(document); });
    const resolving = env.queue.resolve(state.reviewId!, { [state.conflicts![0].key]: "local" });
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
    expect(env.db.put).toHaveBeenCalledTimes(1);
    env.queue.enqueue(env.rename("b", "Queued during resolution"));
    expect(env.queue.flush()).toBe(resolving);
    finish();
    await resolving;
    expect(env.document().itemLists.map((item) => item.name)).toEqual(["Local", "Queued during resolution"]);
    expect(env.queue.pendingIntents).toHaveLength(0);
    expect(env.queue.state.status).toBe("idle");
  });
});
