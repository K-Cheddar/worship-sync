import type { DBItemLists } from "../types";
import {
  applyItemListsRegistryIntent,
  persistItemListsRegistry,
  ItemListsRegistryConflictError,
  type ItemListsRegistryIntent,
} from "./persistItemListsRegistry";

const doc = (patch: Partial<DBItemLists> = {}): DBItemLists => ({
  _id: "ItemLists",
  _rev: "1-base",
  itemLists: [
    { _id: "outline-a", name: "A" },
    { _id: "outline-b", name: "B" },
  ],
  activeList: { _id: "outline-a", name: "A" },
  selectedIdByScope: { presentation: "outline-a", aux: "outline-b" },
  ...patch,
});

const snapshot = (patch: Partial<ItemListsRegistryIntent["before"]> = {}) => ({
  currentLists: [
    { _id: "outline-a", name: "A" },
    { _id: "outline-b", name: "B" },
  ],
  activeList: { _id: "outline-a", name: "A" },
  ...patch,
});

describe("ItemLists registry persistence", () => {
  it("applies a local rename over unrelated latest changes and leaves legacy selection metadata alone", () => {
    const latest = doc({
      _rev: "2-remote",
      itemLists: [
        { _id: "outline-a", name: "A" },
        { _id: "outline-b", name: "B renamed remotely" },
        { _id: "outline-c", name: "Remote addition", controllerScope: "aux" },
      ],
      selectedIdByScope: {
        presentation: "outline-b",
        aux: "outline-c",
        anotherController: "outline-z",
      },
    });
    const intent: ItemListsRegistryIntent = {
      before: snapshot(),
      after: snapshot({
        currentLists: [
          { _id: "outline-a", name: "A renamed locally" },
          { _id: "outline-b", name: "B" },
        ],
      }),
    };

    const merged = applyItemListsRegistryIntent(latest, intent);
    expect(merged.itemLists).toEqual([
      { _id: "outline-a", name: "A renamed locally" },
      { _id: "outline-b", name: "B renamed remotely" },
      { _id: "outline-c", name: "Remote addition", controllerScope: "aux" },
    ]);
    expect(merged.selectedIdByScope).toEqual(latest.selectedIdByScope);
  });

  it("preserves different fields while rejecting a same-field concurrent rename", () => {
    const intent: ItemListsRegistryIntent = {
      before: snapshot(),
      after: snapshot({
        currentLists: [
          { _id: "outline-a", name: "Local rename" },
          { _id: "outline-b", name: "B" },
        ],
      }),
    };
    const latest = doc({
      itemLists: [
        { _id: "outline-a", name: "Remote rename", controllerScope: "aux" },
        { _id: "outline-b", name: "B" },
      ],
    });

    expect(() => applyItemListsRegistryIntent(latest, intent)).toThrow(ItemListsRegistryConflictError);
    const independent = applyItemListsRegistryIntent(doc({
      itemLists: [
        { _id: "outline-a", name: "A", controllerScope: "aux" },
        { _id: "outline-b", name: "B" },
      ],
    }), intent);
    expect(independent.itemLists).toEqual([
      { _id: "outline-a", name: "Local rename", controllerScope: "aux" },
      { _id: "outline-b", name: "B" },
    ]);
  });

  it("rejects delete-versus-edit registry intents in either direction", () => {
    const deletion: ItemListsRegistryIntent = {
      before: snapshot(),
      after: snapshot({
        currentLists: [{ _id: "outline-b", name: "B" }],
      }),
    };
    const rename: ItemListsRegistryIntent = {
      before: snapshot(),
      after: snapshot({
        currentLists: [
          { _id: "outline-a", name: "A renamed" },
          { _id: "outline-b", name: "B" },
        ],
      }),
    };

    expect(() => applyItemListsRegistryIntent(doc({
      itemLists: [
        { _id: "outline-a", name: "Remote rename" },
        { _id: "outline-b", name: "B" },
      ],
    }), deletion)).toThrow(ItemListsRegistryConflictError);
    expect(() => applyItemListsRegistryIntent(doc({
      itemLists: [{ _id: "outline-b", name: "B" }],
    }), rename)).toThrow(ItemListsRegistryConflictError);
  });

  it("preserves local additions, ordering, and active selection", () => {
    const intent: ItemListsRegistryIntent = {
      before: snapshot(),
      after: snapshot({
        currentLists: [
          { _id: "outline-b", name: "B" },
          { _id: "outline-a", name: "A" },
          { _id: "outline-c", name: "C" },
        ],
        activeList: { _id: "outline-b", name: "B" },
      }),
    };
    const latest = doc({
      itemLists: [
        { _id: "outline-a", name: "A" },
        { _id: "outline-b", name: "B" },
        { _id: "outline-r", name: "Remote addition" },
      ],
    });

    const merged = applyItemListsRegistryIntent(latest, intent);
    const mergedIds = merged.itemLists.map((item) => item._id);
    expect(mergedIds.indexOf("outline-b")).toBeLessThan(mergedIds.indexOf("outline-a"));
    expect(mergedIds.indexOf("outline-a")).toBeLessThan(mergedIds.indexOf("outline-c"));
    expect(mergedIds).toContain("outline-r");
    expect(merged.activeList?._id).toBe("outline-b");
  });

  it("applies an intentional deletion without dropping unrelated remote registry rows", () => {
    const intent: ItemListsRegistryIntent = {
      before: snapshot(),
      after: snapshot({
        currentLists: [{ _id: "outline-b", name: "B" }],
        activeList: { _id: "outline-b", name: "B" },
      }),
    };
    const latest = doc({
      itemLists: [
        { _id: "outline-a", name: "A" },
        { _id: "outline-b", name: "B" },
        { _id: "outline-r", name: "Remote addition" },
      ],
    });

    const merged = applyItemListsRegistryIntent(latest, intent);
    expect(merged.itemLists.map((item) => item._id)).toEqual([
      "outline-b",
      "outline-r",
    ]);
    expect(merged.activeList?._id).toBe("outline-b");
  });

  it("re-reads and reapplies the local patch after a revision conflict", async () => {
    let current = doc();
    const get = jest.fn(async () => ({ ...current }));
    const put = jest.fn(async (raw: unknown) => {
      const next = raw as DBItemLists;
      if (put.mock.calls.length === 1) {
        current = doc({
          _rev: "2-remote",
          itemLists: [
            { _id: "outline-a", name: "A" },
            { _id: "outline-b", name: "B changed remotely" },
            { _id: "outline-c", name: "Added remotely" },
          ],
        });
        throw Object.assign(new Error("conflict"), { status: 409 });
      }
      expect(next._rev).toBe("2-remote");
      current = { ...next, _rev: "3-saved" };
      return { ok: true, rev: current._rev };
    });
    const intent: ItemListsRegistryIntent = {
      before: snapshot(),
      after: snapshot({
        currentLists: [
          { _id: "outline-a", name: "A renamed locally" },
          { _id: "outline-b", name: "B" },
        ],
      }),
    };

    const saved = await persistItemListsRegistry({ get, put }, [intent]);
    expect(get).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenCalledTimes(2);
    expect(saved.itemLists).toEqual([
      { _id: "outline-a", name: "A renamed locally" },
      { _id: "outline-b", name: "B changed remotely" },
      { _id: "outline-c", name: "Added remotely" },
    ]);
  });

  it("does not commit after repeated 409 conflicts", async () => {
    const conflict = Object.assign(new Error("conflict"), { status: 409 });
    const get = jest.fn().mockResolvedValue(doc());
    const put = jest.fn().mockRejectedValue(conflict);
    const intent: ItemListsRegistryIntent = {
      before: snapshot(),
      after: snapshot({
        currentLists: [{ _id: "outline-a", name: "A renamed" }, { _id: "outline-b", name: "B" }],
      }),
    };

    await expect(persistItemListsRegistry({ get, put }, [intent])).rejects.toBe(conflict);
    expect(get).toHaveBeenCalledTimes(4);
    expect(put).toHaveBeenCalledTimes(4);
  });

});
