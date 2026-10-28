import "core-js/stable/structured-clone";
import "fake-indexeddb/auto";
import PouchDB from "pouchdb-browser";
import type { DBItemLists } from "../types";
import { loadOrCreateItemListsDoc } from "./controllerBootstrapDocs";
import { persistItemListsRegistry, registrySnapshot } from "./persistItemListsRegistry";

const desiredLists = [
  { _id: "canva", name: "Canva Test" },
  { _id: "morning", name: "Morning Service" },
  { _id: "evening", name: "Evening Service" },
  { _id: "aux", name: "Auxiliary Outline", controllerScope: "aux" },
];

const makeLegacyLists = () => [{ _id: "canva", name: "Service Outline (1)" }];

const setup = async () => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const a = new PouchDB(`registry-winning-${suffix}`);
  const b = new PouchDB(`registry-current-${suffix}`);
  const c = new PouchDB(`registry-legacy-a-${suffix}`);
  const d = new PouchDB(`registry-legacy-b-${suffix}`);
  await a.put({
    _id: "ItemLists",
    itemLists: makeLegacyLists(),
    activeList: makeLegacyLists()[0],
    selectedIdByScope: { presentation: "canva" },
    updatedAt: "legacy-base",
  });
  await Promise.all([b.replicate.from(a), c.replicate.from(a), d.replicate.from(a)]);
  const baseDoc = await a.get<DBItemLists>("ItemLists");
  await b.put({
    ...baseDoc,
    itemLists: desiredLists,
    activeList: desiredLists[0],
    updatedAt: "current-candidate",
  });
  await c.put({ ...baseDoc, itemLists: makeLegacyLists(), updatedAt: "legacy-a" });
  await d.put({ ...baseDoc, itemLists: makeLegacyLists(), updatedAt: "legacy-b" });
  await Promise.all([a.replicate.from(b), a.replicate.from(c), a.replicate.from(d)]);

  const competingWinner = await a.get<DBItemLists & { _conflicts?: string[] }>("ItemLists", { conflicts: true });
  const winnerWithoutConflictMetadata = { ...competingWinner };
  delete winnerWithoutConflictMetadata._conflicts;
  await a.put({
    ...winnerWithoutConflictMetadata,
    itemLists: desiredLists,
    activeList: desiredLists[0],
    updatedAt: "established-current-outline",
  });
  return {
    a,
    cleanup: () => Promise.all([a.destroy(), b.destroy(), c.destroy(), d.destroy()]),
  };
};

describe("historical ItemLists branches in replicated PouchDB", () => {
  it("loads and writes on the established winner while leaving old losing revisions intact", async () => {
    const env = await setup();
    try {
      const conflictRead = jest.spyOn(env.a, "get");
      const put = jest.spyOn(env.a, "put");
      const remove = jest.spyOn(env.a, "remove");

      const winner = await loadOrCreateItemListsDoc(env.a);
      expect(winner.itemLists).toEqual(desiredLists);
      expect(winner.activeList).toEqual(desiredLists[0]);
      expect(put).not.toHaveBeenCalled();
      expect(conflictRead).toHaveBeenCalledTimes(1);

      const conflictHead = await env.a.get<DBItemLists & { _conflicts?: string[] }>("ItemLists", { conflicts: true });
      expect(conflictHead._conflicts?.length).toBeGreaterThan(0);
      const losingVersions = await Promise.all(conflictHead._conflicts!.map((rev) =>
        env.a.get<DBItemLists>("ItemLists", { rev }),
      ));
      const oldLosingRevision = conflictHead._conflicts!.find((_rev, index) =>
        losingVersions[index].itemLists[0]?.name === "Service Outline (1)",
      );
      expect(oldLosingRevision).toBeDefined();
      const oldLosingDoc = await env.a.get<DBItemLists>("ItemLists", { rev: oldLosingRevision! });
      expect(oldLosingDoc.itemLists.map((list) => list._id)).toEqual(["canva"]);

      const before = registrySnapshot(winner);
      const intent = {
        before,
        after: {
          ...before,
          currentLists: before.currentLists.map((list) =>
            list._id === "morning" ? { ...list, name: "Morning Worship" } : list,
          ),
        },
      };
      conflictRead.mockClear();
      put.mockClear();
      const saved = await persistItemListsRegistry(
        env.a,
        [intent],
      );

      expect(conflictRead).toHaveBeenCalledTimes(1);
      expect(conflictRead).toHaveBeenCalledWith("ItemLists");
      expect(put).toHaveBeenCalledTimes(1);
      expect(remove).not.toHaveBeenCalled();
      expect(saved.itemLists).toEqual([
        desiredLists[0],
        { ...desiredLists[1], name: "Morning Worship" },
        ...desiredLists.slice(2),
      ]);
      expect(saved.activeList).toEqual(desiredLists[0]);

      const after = await env.a.get<DBItemLists & { _conflicts?: string[] }>("ItemLists", { conflicts: true });
      expect(after._conflicts).toContain(oldLosingRevision);
      await expect(env.a.get("ItemLists", { rev: oldLosingRevision! })).resolves.toMatchObject({
        itemLists: makeLegacyLists(),
      });
      expect(await env.a.get("ItemLists")).toMatchObject({
        itemLists: saved.itemLists,
        activeList: desiredLists[0],
      });
    } finally {
      await env.cleanup();
    }
  });
});
