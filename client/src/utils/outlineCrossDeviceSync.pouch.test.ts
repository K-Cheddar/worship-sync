import "core-js/stable/structured-clone";
import "fake-indexeddb/auto";
import PouchDB from "pouchdb-browser";
import type { DBItemListDetails, DBItemLists, ServiceItem } from "../types";
import { persistItemListsRegistry } from "./persistItemListsRegistry";
import { persistServiceListItems } from "./persistServiceListField";

const row = (listId: string, name: string): ServiceItem => ({
  _id: `song-${listId}`,
  listId,
  name,
  type: "song",
});

describe("two-client outline synchronization with replicated PouchDB state", () => {
  it("preserves independent outline and registry edits after replication", async () => {
    const suffix = Date.now();
    const shared = new PouchDB(`outline-shared-${suffix}`);
    const clientA = new PouchDB(`outline-client-a-${suffix}`);
    const clientB = new PouchDB(`outline-client-b-${suffix}`);
    const baselineItems = [row("row-a", "A"), row("row-b", "B")];
    const initialRegistry: DBItemLists = {
      _id: "ItemLists",
      _rev: "1-placeholder",
      itemLists: [
        { _id: "outline-a", name: "A" },
        { _id: "outline-b", name: "B" },
      ],
      activeList: { _id: "outline-a", name: "A" },
      selectedIdByScope: { presentation: "outline-a", aux: "outline-b" },
    };
    try {
      await shared.put({
        _id: "ItemLists",
        itemLists: initialRegistry.itemLists,
        activeList: initialRegistry.activeList,
        selectedIdByScope: initialRegistry.selectedIdByScope,
      });
      await shared.put({
        _id: "outline-a",
        docType: "itemListDetails",
        name: "A",
        items: baselineItems,
        overlays: [],
      });
      await Promise.all([
        clientA.replicate.from(shared),
        clientB.replicate.from(shared),
      ]);

      const registryA = await clientA.get<DBItemLists>("ItemLists");
      const registryB = await clientB.get<DBItemLists>("ItemLists");
      const outlineB = await clientB.get<DBItemListDetails>("outline-a");
      await persistServiceListItems(
        clientB as unknown as Parameters<typeof persistServiceListItems>[0],
        "outline-a",
        [baselineItems[0], row("row-b", "B changed by B")],
        baselineItems,
      );
      await persistItemListsRegistry(
        clientB as unknown as Parameters<typeof persistItemListsRegistry>[0],
        [{
          before: {
            currentLists: registryB.itemLists,
            activeList: registryB.activeList,
            selectedIdByScope: registryB.selectedIdByScope ?? {},
          },
          after: {
            currentLists: registryB.itemLists,
            activeList: registryB.activeList,
            selectedIdByScope: {
              ...(registryB.selectedIdByScope ?? {}),
              aux: "outline-a",
            },
          },
        }],
      );
      expect(outlineB.items.map((item) => item.name)).toEqual(["A", "B"]);

      await Promise.all([
        clientB.replicate.to(shared),
      ]);
      await clientA.replicate.from(shared);

      const outlineReadCount = jest.spyOn(clientA, "get");
      const remoteOutline = await clientA.get<DBItemListDetails>("outline-a");
      const localOutlineItems = [row("row-a", "A changed by A"), baselineItems[1]];
      const mergedOutline = await persistServiceListItems(
        clientA as unknown as Parameters<typeof persistServiceListItems>[0],
        "outline-a",
        localOutlineItems,
        baselineItems,
      );

      const registryIntent = {
        before: {
          currentLists: registryA.itemLists,
          activeList: registryA.activeList,
          selectedIdByScope: registryA.selectedIdByScope ?? {},
        },
        after: {
          currentLists: [
            { _id: "outline-a", name: "A renamed by A" },
            ...registryA.itemLists.filter((item) => item._id !== "outline-a"),
            { _id: "outline-c", name: "Added by A", controllerScope: "aux" },
          ],
          activeList: registryA.activeList,
          selectedIdByScope: {
            ...(registryA.selectedIdByScope ?? {}),
            presentation: "outline-b",
          },
        },
      };
      const mergedRegistry = await persistItemListsRegistry(
        clientA as unknown as Parameters<typeof persistItemListsRegistry>[0],
        [registryIntent],
      );
      expect(outlineReadCount).toHaveBeenCalledTimes(3); // Explicit read plus one baseline-aware write read and registry read.
      outlineReadCount.mockRestore();
      expect(remoteOutline.items).toEqual([
        baselineItems[0],
        row("row-b", "B changed by B"),
      ]);
      expect(mergedOutline.items).toEqual([
        row("row-a", "A changed by A"),
        row("row-b", "B changed by B"),
      ]);
      expect(mergedRegistry.itemLists).toEqual([
        { _id: "outline-a", name: "A renamed by A" },
        { _id: "outline-b", name: "B" },
        { _id: "outline-c", name: "Added by A", controllerScope: "aux" },
      ]);
      expect(mergedRegistry.selectedIdByScope).toEqual({
        presentation: "outline-b",
        aux: "outline-a",
      });

      await clientA.replicate.to(shared);
      await clientB.replicate.from(shared);
      const finalOutline = await clientB.get<DBItemListDetails>("outline-a");
      const finalRegistry = await clientB.get<DBItemLists>("ItemLists");
      expect(finalOutline.items).toEqual(mergedOutline.items);
      expect(finalRegistry.itemLists).toEqual(mergedRegistry.itemLists);
      expect(finalRegistry.selectedIdByScope).toEqual(mergedRegistry.selectedIdByScope);
    } finally {
      await Promise.all([shared.destroy(), clientA.destroy(), clientB.destroy()]);
    }
  });
});
