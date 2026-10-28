import "core-js/stable/structured-clone";
import "fake-indexeddb/auto";
import PouchDB from "pouchdb-browser";
import type { DBItemListDetails, DBItemLists, ServiceItem } from "../types";
import {
  ItemListsRegistryConflictError,
  persistItemListsRegistry,
} from "./persistItemListsRegistry";
import {
  persistServiceListItems,
  persistServiceListOverlays,
  resolveServiceListRevisionConflict,
  ServiceListConflictError,
} from "./persistServiceListField";

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

  it("merges compatible offline revision branches and preserves outline metadata", async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const shared = new PouchDB(`outline-branches-shared-${suffix}`);
    const clientA = new PouchDB(`outline-branches-a-${suffix}`);
    const clientB = new PouchDB(`outline-branches-b-${suffix}`);
    const baselineItems = [row("row-a", "A"), row("row-b", "B")];
    const binding = { serviceId: "service-1", servicePlanId: "plan-1" };
    try {
      await shared.put({
        _id: "outline-branches",
        docType: "itemListDetails",
        name: "Sunday",
        items: baselineItems,
        overlays: ["overlay-1"],
        servicePlanBinding: binding,
        createdAt: "2026-01-01T00:00:00.000Z",
        metadata: { source: "service-plan", custom: true },
      });
      await Promise.all([clientA.replicate.from(shared), clientB.replicate.from(shared)]);
      await Promise.all([
        persistServiceListItems(
          clientA as unknown as Parameters<typeof persistServiceListItems>[0],
          "outline-branches",
          [row("row-a", "A from A"), baselineItems[1]],
          baselineItems,
        ),
        persistServiceListItems(
          clientB as unknown as Parameters<typeof persistServiceListItems>[0],
          "outline-branches",
          [baselineItems[0], row("row-b", "B from B")],
          baselineItems,
        ),
      ]);
      await clientA.replicate.to(shared);
      await clientB.replicate.to(shared);
      await clientA.replicate.from(shared);

      const saved = await persistServiceListItems(
        clientA as unknown as Parameters<typeof persistServiceListItems>[0],
        "outline-branches",
        [row("row-a", "A from A"), baselineItems[1]],
        baselineItems,
      );
      expect(saved.items).toEqual([row("row-a", "A from A"), row("row-b", "B from B")]);
      expect(saved).toMatchObject({
        overlays: ["overlay-1"],
        servicePlanBinding: binding,
        createdAt: "2026-01-01T00:00:00.000Z",
        metadata: { source: "service-plan", custom: true },
      });
      expect((await clientA.get("outline-branches", { conflicts: true }))._conflicts).toBeUndefined();

      await clientA.replicate.to(shared);
      await clientB.replicate.from(shared);
      const final = await clientB.get<DBItemListDetails & { metadata?: unknown }>("outline-branches", { conflicts: true });
      expect(final._conflicts).toBeUndefined();
      expect(final.items).toEqual(saved.items);
      expect(final.servicePlanBinding).toEqual(binding);
      expect(final.overlays).toEqual(["overlay-1"]);
      expect(final.metadata).toEqual({ source: "service-plan", custom: true });
    } finally {
      await Promise.all([shared.destroy(), clientA.destroy(), clientB.destroy()]);
    }
  });

  it("retains safely merged document fields when the current draft still has a row conflict", async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const shared = new PouchDB(`outline-branch-draft-shared-${suffix}`);
    const clientA = new PouchDB(`outline-branch-draft-a-${suffix}`);
    const clientB = new PouchDB(`outline-branch-draft-b-${suffix}`);
    const baselineItems = [row("row-a", "A"), row("row-b", "B")];
    const binding = { serviceId: "service-1", servicePlanId: "plan-1" };
    try {
      await shared.put({
        _id: "outline-branch-draft",
        docType: "itemListDetails",
        name: "Sunday",
        items: baselineItems,
        overlays: ["overlay-before"],
        servicePlanBinding: binding,
      });
      await Promise.all([clientA.replicate.from(shared), clientB.replicate.from(shared)]);
      await Promise.all([
        persistServiceListItems(
          clientA as unknown as Parameters<typeof persistServiceListItems>[0],
          "outline-branch-draft",
          [row("row-a", "A remote"), baselineItems[1]],
          baselineItems,
        ),
        persistServiceListItems(
          clientB as unknown as Parameters<typeof persistServiceListItems>[0],
          "outline-branch-draft",
          [baselineItems[0], row("row-b", "B remote")],
          baselineItems,
        ),
      ]);
      await persistServiceListOverlays(
        clientB as unknown as Parameters<typeof persistServiceListOverlays>[0],
        "outline-branch-draft",
        ["overlay-from-b"],
      );
      await clientA.replicate.to(shared);
      await clientB.replicate.to(shared);
      await clientA.replicate.from(shared);

      let conflict: ServiceListConflictError | undefined;
      try {
        await persistServiceListItems(
          clientA as unknown as Parameters<typeof persistServiceListItems>[0],
          "outline-branch-draft",
          [row("row-a", "A local draft"), baselineItems[1]],
          baselineItems,
        );
      } catch (error) {
        if (error instanceof ServiceListConflictError) conflict = error;
        else throw error;
      }
      expect(conflict?.revisionConflict?.remoteDocument).toMatchObject({
        items: [row("row-a", "A remote"), row("row-b", "B remote")],
        overlays: ["overlay-from-b"],
        servicePlanBinding: binding,
      });

      const chosen = await resolveServiceListRevisionConflict(
        clientA as unknown as Parameters<typeof resolveServiceListRevisionConflict>[0],
        "outline-branch-draft",
        conflict!.remoteItems,
        conflict!.revisionConflict!,
      );
      expect(chosen.items).toEqual([row("row-a", "A remote"), row("row-b", "B remote")]);
      expect(chosen.overlays).toEqual(["overlay-from-b"]);
      expect(chosen.servicePlanBinding).toEqual(binding);
      expect((await clientA.get("outline-branch-draft", { conflicts: true }))._conflicts)
        .toBeUndefined();
    } finally {
      await Promise.all([shared.destroy(), clientA.destroy(), clientB.destroy()]);
    }
  });

  it("keeps conflicting branch versions until an explicit choice is committed", async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const shared = new PouchDB(`outline-conflict-shared-${suffix}`);
    const clientA = new PouchDB(`outline-conflict-a-${suffix}`);
    const clientB = new PouchDB(`outline-conflict-b-${suffix}`);
    const baselineItems = [row("row-a", "A"), row("row-b", "B")];
    try {
      await shared.put({
        _id: "outline-conflict",
        docType: "itemListDetails",
        name: "Sunday",
        items: baselineItems,
        overlays: ["overlay-before"],
        servicePlanBinding: { serviceId: "service-1", servicePlanId: "plan-1" },
      });
      await Promise.all([clientA.replicate.from(shared), clientB.replicate.from(shared)]);
      await Promise.all([
        persistServiceListItems(
          clientA as unknown as Parameters<typeof persistServiceListItems>[0],
          "outline-conflict",
          [row("row-a", "A from A"), baselineItems[1]],
          baselineItems,
        ),
        persistServiceListItems(
          clientB as unknown as Parameters<typeof persistServiceListItems>[0],
          "outline-conflict",
          [row("row-a", "A from B"), baselineItems[1]],
          baselineItems,
        ),
      ]);
      await persistServiceListOverlays(
        clientB as unknown as Parameters<typeof persistServiceListOverlays>[0],
        "outline-conflict",
        ["overlay-from-b"],
      );
      await clientA.replicate.to(shared);
      await clientB.replicate.to(shared);
      await clientA.replicate.from(shared);
      const put = jest.spyOn(clientA, "put");
      const remove = jest.spyOn(clientA, "remove");
      let conflict: ServiceListConflictError | undefined;
      try {
        await persistServiceListItems(
          clientA as unknown as Parameters<typeof persistServiceListItems>[0],
          "outline-conflict",
          [row("row-a", "A local draft"), baselineItems[1]],
          baselineItems,
        );
      } catch (error) {
        if (error instanceof ServiceListConflictError) conflict = error;
        else throw error;
      }
      expect(conflict?.revisionConflict?.versions.map((version) => version.items[0].name))
        .toEqual(expect.arrayContaining(["A from A", "A from B"]));
      expect(conflict?.revisionConflict?.remoteDocument?.overlays).toEqual(["overlay-from-b"]);
      expect(put).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();

      const chosen = await resolveServiceListRevisionConflict(
        clientA as unknown as Parameters<typeof resolveServiceListRevisionConflict>[0],
        "outline-conflict",
        conflict!.remoteItems,
        conflict!.revisionConflict!,
      );
      expect(chosen.items).toEqual(conflict!.remoteItems);
      expect(chosen.overlays).toEqual(["overlay-from-b"]);
      expect((await clientA.get("outline-conflict", { conflicts: true }))._conflicts).toBeUndefined();
      await clientA.replicate.to(shared);
      await clientB.replicate.from(shared);
      expect((await clientB.get<DBItemListDetails>("outline-conflict")).items).toEqual(chosen.items);
    } finally {
      await Promise.all([shared.destroy(), clientA.destroy(), clientB.destroy()]);
    }
  });

  it("rejects an explicit branch choice if another revision arrives during review", async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const shared = new PouchDB(`outline-review-shared-${suffix}`);
    const clientA = new PouchDB(`outline-review-a-${suffix}`);
    const clientB = new PouchDB(`outline-review-b-${suffix}`);
    const clientC = new PouchDB(`outline-review-c-${suffix}`);
    const baselineItems = [row("row-a", "A"), row("row-b", "B")];
    try {
      await shared.put({
        _id: "outline-review",
        docType: "itemListDetails",
        name: "Sunday",
        items: baselineItems,
        overlays: [],
      });
      await Promise.all([
        clientA.replicate.from(shared),
        clientB.replicate.from(shared),
        clientC.replicate.from(shared),
      ]);
      await Promise.all([
        persistServiceListItems(
          clientA as unknown as Parameters<typeof persistServiceListItems>[0],
          "outline-review",
          [row("row-a", "A from A"), baselineItems[1]],
          baselineItems,
        ),
        persistServiceListItems(
          clientB as unknown as Parameters<typeof persistServiceListItems>[0],
          "outline-review",
          [row("row-a", "A from B"), baselineItems[1]],
          baselineItems,
        ),
      ]);
      await clientA.replicate.to(shared);
      await clientB.replicate.to(shared);
      await clientA.replicate.from(shared);
      let conflict: ServiceListConflictError | undefined;
      try {
        await persistServiceListItems(
          clientA as unknown as Parameters<typeof persistServiceListItems>[0],
          "outline-review",
          [row("row-a", "A draft"), baselineItems[1]],
          baselineItems,
        );
      } catch (error) {
        if (error instanceof ServiceListConflictError) conflict = error;
        else throw error;
      }
      expect(conflict?.revisionConflict).toBeDefined();

      await persistServiceListItems(
        clientC as unknown as Parameters<typeof persistServiceListItems>[0],
        "outline-review",
        [baselineItems[0], row("row-b", "B from C")],
        baselineItems,
      );
      await clientC.replicate.to(shared);
      await clientA.replicate.from(shared);
      const remove = jest.spyOn(clientA, "remove");
      await expect(resolveServiceListRevisionConflict(
        clientA as unknown as Parameters<typeof resolveServiceListRevisionConflict>[0],
        "outline-review",
        conflict!.remoteItems,
        conflict!.revisionConflict!,
      )).rejects.toBeInstanceOf(ServiceListConflictError);
      expect(remove).not.toHaveBeenCalled();
      const latest = await clientA.get<DBItemListDetails & { _conflicts?: string[] }>(
        "outline-review",
        { conflicts: true },
      );
      expect(latest._conflicts?.length).toBeGreaterThan(1);
      const losingVersions = await Promise.all((latest._conflicts ?? []).map((rev) =>
        clientA.get<DBItemListDetails>("outline-review", { rev }),
      ));
      const branchVersions = [latest, ...losingVersions];
      expect(branchVersions.some((version) => version.items.some((item) => item.name === "B from C"))).toBe(true);
    } finally {
      await Promise.all([shared.destroy(), clientA.destroy(), clientB.destroy(), clientC.destroy()]);
    }
  });

  it("preserves unresolved ItemLists registry branches instead of writing over the winner", async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const shared = new PouchDB(`registry-branches-shared-${suffix}`);
    const clientA = new PouchDB(`registry-branches-a-${suffix}`);
    const clientB = new PouchDB(`registry-branches-b-${suffix}`);
    const currentLists = [
      { _id: "outline-a", name: "A" },
      { _id: "outline-b", name: "B" },
    ];
    const before = {
      currentLists,
      activeList: currentLists[0],
      selectedIdByScope: { presentation: "outline-a", aux: "outline-b" },
    };
    const intentA = {
      before,
      after: {
        ...before,
        currentLists: [{ _id: "outline-a", name: "A from A" }, currentLists[1]],
      },
    };
    const intentB = {
      before,
      after: {
        ...before,
        currentLists: [{ _id: "outline-a", name: "A from B" }, currentLists[1]],
      },
    };
    try {
      await shared.put({
        _id: "ItemLists",
        itemLists: currentLists,
        activeList: currentLists[0],
        selectedIdByScope: before.selectedIdByScope,
      });
      await Promise.all([clientA.replicate.from(shared), clientB.replicate.from(shared)]);
      await Promise.all([
        persistItemListsRegistry(
          clientA as unknown as Parameters<typeof persistItemListsRegistry>[0],
          [intentA],
        ),
        persistItemListsRegistry(
          clientB as unknown as Parameters<typeof persistItemListsRegistry>[0],
          [intentB],
        ),
      ]);
      await clientA.replicate.to(shared);
      await clientB.replicate.to(shared);
      await clientA.replicate.from(shared);
      const put = jest.spyOn(clientA, "put");
      await expect(persistItemListsRegistry(
        clientA as unknown as Parameters<typeof persistItemListsRegistry>[0],
        [intentA],
      )).rejects.toBeInstanceOf(ItemListsRegistryConflictError);
      expect(put).not.toHaveBeenCalled();
      const branches = await clientA.get<DBItemLists & { _conflicts?: string[] }>(
        "ItemLists",
        { conflicts: true },
      );
      expect(branches._conflicts).toHaveLength(1);
      const losing = await clientA.get<DBItemLists>("ItemLists", {
        rev: branches._conflicts![0],
      });
      expect([branches.itemLists[0].name, losing.itemLists[0].name])
        .toEqual(expect.arrayContaining(["A from A", "A from B"]));
    } finally {
      await Promise.all([shared.destroy(), clientA.destroy(), clientB.destroy()]);
    }
  });
});
