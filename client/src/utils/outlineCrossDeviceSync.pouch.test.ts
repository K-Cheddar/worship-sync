import "core-js/stable/structured-clone";
import "fake-indexeddb/auto";
import PouchDB from "pouchdb-browser";
import type { DBItemListDetails, DBItemLists, ServiceItem } from "../types";
import { persistItemListsRegistry, registrySnapshot } from "./persistItemListsRegistry";
import {
  inspectServiceListRevisions,
  persistServiceListItems,
  persistServiceListOverlays,
  resolveServiceListRevisionConflict,
  ServiceListConflictError,
} from "./persistServiceListField";
import { createOutlineMoveIntent, getOutlineItemConflicts } from "./outlineSync";

const row = (listId: string, name: string): ServiceItem => ({
  _id: `song-${listId}`,
  listId,
  name,
  type: "song",
});

describe("two-client outline synchronization with replicated PouchDB state", () => {
  it("merges different row moves saved on independent replicas before either side replicates", async () => {
    const suffix = Date.now();
    const shared = new PouchDB(`outline-move-shared-${suffix}`);
    const clientA = new PouchDB(`outline-move-a-${suffix}`);
    const clientB = new PouchDB(`outline-move-b-${suffix}`);
    const baseline = ["a", "b", "c", "d", "e"].map(id => row(id, id.toUpperCase()));
    const ownerA = `owner-a-${suffix}`;
    const ownerB = `owner-b-${suffix}`;
    const outlineId = "outline-moves";
    const moveA = [baseline[1], baseline[0], baseline[2], baseline[3], baseline[4]];
    const moveB = [baseline[0], baseline[1], baseline[2], baseline[4], baseline[3]];
    const intentA = createOutlineMoveIntent({ outlineId, ownerKey: ownerA,
      resultingItems: moveA, movedIds: ["b"] })!;
    const intentB = createOutlineMoveIntent({ outlineId, ownerKey: ownerB,
      resultingItems: moveB, movedIds: ["e"] })!;
    try {
      await shared.put({ _id: outlineId, docType: "itemListDetails", name: "Moves", items: baseline, overlays: [] });
      await Promise.all([clientA.replicate.from(shared), clientB.replicate.from(shared)]);
      await Promise.all([
        persistServiceListItems(clientA as unknown as Parameters<typeof persistServiceListItems>[0],
          outlineId, moveA, baseline, undefined, [intentA]),
        persistServiceListItems(clientB as unknown as Parameters<typeof persistServiceListItems>[0],
          outlineId, moveB, baseline, undefined, [intentB]),
      ]);

      await Promise.all([clientA.replicate.to(shared), clientB.replicate.to(shared)]);
      await Promise.all([clientA.replicate.from(shared), clientB.replicate.from(shared)]);
      const currentDraftA = await clientA.get<{ items: ServiceItem[] }>(outlineId);
      const merged = await persistServiceListItems(clientA as unknown as Parameters<typeof persistServiceListItems>[0],
        outlineId, currentDraftA.items, baseline, undefined, [intentA]);
      expect(merged.items.map(item => item.listId)).toEqual(["b", "a", "c", "e", "d"]);

      await clientA.replicate.to(shared);
      await clientB.replicate.from(shared);
      expect((await clientA.get<{ items: ServiceItem[] }>(outlineId)).items.map(item => item.listId))
        .toEqual(["b", "a", "c", "e", "d"]);
      expect((await clientB.get<{ items: ServiceItem[] }>(outlineId)).items.map(item => item.listId))
        .toEqual(["b", "a", "c", "e", "d"]);
      expect((await clientA.get(outlineId, { conflicts: true }) as { _conflicts?: string[] })._conflicts?.length)
        .toBeGreaterThan(0);

      const nextBaseline = (await clientB.get<{ items: ServiceItem[] }>(outlineId)).items;
      const continued = await persistServiceListItems(clientB as unknown as Parameters<typeof persistServiceListItems>[0],
        outlineId, [...nextBaseline, row("f", "F")], nextBaseline);
      await clientB.replicate.to(shared);
      await clientA.replicate.from(shared);
      expect(continued.items.map(item => item.listId)).toEqual(["b", "a", "c", "e", "d", "f"]);
      expect((await clientA.get<{ items: ServiceItem[] }>(outlineId)).items.map(item => item.listId))
        .toEqual(["b", "a", "c", "e", "d", "f"]);
    } finally {
      await Promise.all([shared.destroy(), clientA.destroy(), clientB.destroy()]);
    }
  });

  it("keeps two incompatible moves of one row for a focused decision", async () => {
    const suffix = Date.now();
    const shared = new PouchDB(`outline-same-move-shared-${suffix}`);
    const clientA = new PouchDB(`outline-same-move-a-${suffix}`);
    const clientB = new PouchDB(`outline-same-move-b-${suffix}`);
    const baseline = ["a", "b", "c", "d"].map(id => row(id, id.toUpperCase()));
    const outlineId = "outline-same-move";
    const local = [baseline[1], baseline[0], baseline[2], baseline[3]];
    const remote = [baseline[0], baseline[2], baseline[3], baseline[1]];
    const intent = createOutlineMoveIntent({ outlineId, ownerKey: "controller-a",
      resultingItems: local, movedIds: ["b"] })!;
    try {
      await shared.put({ _id: outlineId, docType: "itemListDetails", name: "Moves", items: baseline, overlays: [] });
      await Promise.all([clientA.replicate.from(shared), clientB.replicate.from(shared)]);
      await Promise.all([
        persistServiceListItems(clientA as unknown as Parameters<typeof persistServiceListItems>[0], outlineId, local, baseline),
        persistServiceListItems(clientB as unknown as Parameters<typeof persistServiceListItems>[0], outlineId, remote, baseline),
      ]);
      await Promise.all([clientA.replicate.to(shared), clientB.replicate.to(shared)]);
      await Promise.all([clientA.replicate.from(shared), clientB.replicate.from(shared)]);

      const current = await clientA.get<{ items: ServiceItem[] }>(outlineId);
      await expect(persistServiceListItems(clientA as unknown as Parameters<typeof persistServiceListItems>[0],
        outlineId, local, baseline, undefined, [intent])).rejects.toMatchObject({
        name: "ServiceListConflictError",
        revisionConflict: expect.objectContaining({ itemReview: expect.any(Object) }),
      });
      expect(current.items.map(item => item.listId)).not.toHaveLength(0);
      expect((await clientA.get(outlineId, { conflicts: true }) as { _conflicts?: string[] })._conflicts?.length)
        .toBeGreaterThan(0);
    } finally {
      await Promise.all([shared.destroy(), clientA.destroy(), clientB.destroy()]);
    }
  });

  it("treats two Controllers' equivalent destination as an already-satisfied move", async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const shared = new PouchDB(`outline-same-destination-shared-${suffix}`);
    const clientA = new PouchDB(`outline-same-destination-a-${suffix}`);
    const clientB = new PouchDB(`outline-same-destination-b-${suffix}`);
    const baseline = ["a", "b", "c", "d"].map(id => row(id, id.toUpperCase()));
    const outlineId = "outline-same-destination";
    const moved = [baseline[1], baseline[0], baseline[2], baseline[3]];
    const intent = createOutlineMoveIntent({ outlineId, ownerKey: "controller-a",
      resultingItems: moved, movedIds: ["b"] })!;
    try {
      await shared.put({ _id: outlineId, docType: "itemListDetails", name: "Moves", items: baseline, overlays: [] });
      await Promise.all([clientA.replicate.from(shared), clientB.replicate.from(shared)]);
      await Promise.all([
        persistServiceListItems(clientA as unknown as Parameters<typeof persistServiceListItems>[0], outlineId, moved, baseline),
        persistServiceListItems(clientB as unknown as Parameters<typeof persistServiceListItems>[0], outlineId, moved, baseline),
      ]);
      await Promise.all([clientA.replicate.to(shared), clientB.replicate.to(shared)]);
      await Promise.all([clientA.replicate.from(shared), clientB.replicate.from(shared)]);

      const saved = await persistServiceListItems(clientA as unknown as Parameters<typeof persistServiceListItems>[0],
        outlineId, moved, baseline, undefined, [intent]);
      expect(saved.items.map(item => item.listId)).toEqual(["b", "a", "c", "d"]);
      expect((await clientA.get<{ items: ServiceItem[] }>(outlineId)).items.map(item => item.listId))
        .toEqual(["b", "a", "c", "d"]);
    } finally {
      await Promise.all([shared.destroy(), clientA.destroy(), clientB.destroy()]);
    }
  });

  it("combines a move with a saved insertion and deletion", async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const shared = new PouchDB(`outline-move-rows-shared-${suffix}`);
    const clientA = new PouchDB(`outline-move-rows-a-${suffix}`);
    const clientB = new PouchDB(`outline-move-rows-b-${suffix}`);
    const baseline = ["a", "b", "c", "d"].map(id => row(id, id.toUpperCase()));
    const outlineId = "outline-move-rows";
    const local = [baseline[1], baseline[0], baseline[2], baseline[3]];
    const remote = [baseline[0], baseline[1], baseline[2], row("e", "E")];
    const intent = createOutlineMoveIntent({ outlineId, ownerKey: "controller-a",
      resultingItems: local, movedIds: ["b"] })!;
    try {
      await shared.put({ _id: outlineId, docType: "itemListDetails", name: "Moves", items: baseline, overlays: [] });
      await Promise.all([clientA.replicate.from(shared), clientB.replicate.from(shared)]);
      await Promise.all([
        persistServiceListItems(clientA as unknown as Parameters<typeof persistServiceListItems>[0], outlineId, local, baseline),
        persistServiceListItems(clientB as unknown as Parameters<typeof persistServiceListItems>[0], outlineId, remote, baseline),
      ]);
      await Promise.all([clientA.replicate.to(shared), clientB.replicate.to(shared)]);
      await Promise.all([clientA.replicate.from(shared), clientB.replicate.from(shared)]);
      const head = await clientA.get<{ items: ServiceItem[]; _conflicts?: string[] }>(outlineId, { conflicts: true });
      const physicalBranches = await Promise.all([head, ...(head._conflicts ?? []).map(revision =>
        clientA.get<{ items: ServiceItem[] }>(outlineId, { rev: revision }))]);
      expect(physicalBranches.some(branch => branch.items.some(item => item.listId === "e"))).toBe(true);
      const saved = await persistServiceListItems(clientA as unknown as Parameters<typeof persistServiceListItems>[0],
        outlineId, local, baseline, undefined, [intent]);
      expect(saved.items.map(item => item.listId)).toEqual(["b", "a", "c", "e"]);
    } finally {
      await Promise.all([shared.destroy(), clientA.destroy(), clientB.destroy()]);
    }
  });

  it("retains a move-versus-delete decision across real replica branches", async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const shared = new PouchDB(`outline-move-delete-shared-${suffix}`);
    const clientA = new PouchDB(`outline-move-delete-a-${suffix}`);
    const clientB = new PouchDB(`outline-move-delete-b-${suffix}`);
    const baseline = ["a", "b", "c", "d"].map(id => row(id, id.toUpperCase()));
    const outlineId = "outline-move-delete";
    const local = [baseline[1], baseline[0], baseline[2], baseline[3]];
    const remote = [baseline[0], baseline[2], baseline[3]];
    const intent = createOutlineMoveIntent({ outlineId, ownerKey: "controller-a",
      resultingItems: local, movedIds: ["b"] })!;
    try {
      await shared.put({ _id: outlineId, docType: "itemListDetails", name: "Moves", items: baseline, overlays: [] });
      await Promise.all([clientA.replicate.from(shared), clientB.replicate.from(shared)]);
      await Promise.all([
        persistServiceListItems(clientA as unknown as Parameters<typeof persistServiceListItems>[0], outlineId, local, baseline),
        persistServiceListItems(clientB as unknown as Parameters<typeof persistServiceListItems>[0], outlineId, remote, baseline),
      ]);
      await clientA.replicate.to(shared);
      await clientB.replicate.to(shared);
      await clientA.replicate.from(shared);

      const error = await persistServiceListItems(clientA as unknown as Parameters<typeof persistServiceListItems>[0],
        outlineId, local, baseline, undefined, [intent]).then(() => undefined, caught => caught as ServiceListConflictError);
      expect(error).toBeInstanceOf(ServiceListConflictError);
      expect(getOutlineItemConflicts(baseline, local, error!.remoteItems, [intent])).toEqual([
        expect.objectContaining({ reason: "delete-edit", listId: "b", localDestination: intent }),
      ]);
      expect((await clientA.get(outlineId, { conflicts: true }) as { _conflicts?: string[] })._conflicts?.length)
        .toBeGreaterThan(0);
    } finally {
      await Promise.all([shared.destroy(), clientA.destroy(), clientB.destroy()]);
    }
  });

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
          },
          after: {
            currentLists: registryB.itemLists.map((list) =>
              list._id === "outline-b" ? { ...list, name: "B renamed by B" } : list,
            ),
            activeList: registryB.activeList,
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
        },
        after: {
          currentLists: [
            { _id: "outline-a", name: "A renamed by A" },
            ...registryA.itemLists.filter((item) => item._id !== "outline-a"),
            { _id: "outline-c", name: "Added by A", controllerScope: "aux" },
          ],
          activeList: registryA.activeList,
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
        { _id: "outline-b", name: "B renamed by B" },
        { _id: "outline-c", name: "Added by A", controllerScope: "aux" },
      ]);
      expect(mergedRegistry.selectedIdByScope).toEqual(initialRegistry.selectedIdByScope);

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

  it.each([false, true])("protects active edits against the winner while preserving historical leaves (overlap: %s)", async (overlap) => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const a = new PouchDB(`active-a-${suffix}`); const b = new PouchDB(`active-b-${suffix}`);
    const historical = new PouchDB(`active-history-${suffix}`);
    const baseline = [row("a", "A"), row("b", "B")];
    try {
      await a.put({ _id: "outline", name: "Sunday", items: baseline, overlays: [] });
      await historical.replicate.from(a);
      const old = await historical.get<DBItemListDetails>("outline");
      await historical.put({ ...old, items: [row("old", "Historical work")] });
      const current = await a.get<DBItemListDetails>("outline");
      const r = await a.put({ ...current, items: baseline });
      await a.put({ ...current, _rev: r.rev, items: baseline });
      await a.replicate.from(historical);
      await b.replicate.from(a);
      const leaves = (await a.get("outline", { conflicts: true }))._conflicts;
      const draftA = [{ ...baseline[0], name: "A unsaved" }, baseline[1]];
      const draftB = overlap ? [{ ...baseline[0], name: "B saved" }, baseline[1]] : [baseline[0], { ...baseline[1], name: "B saved" }];
      const savedB = await persistServiceListItems(b, "outline", draftB, baseline);
      await a.replicate.from(b);
      const put = jest.spyOn(a, "put"); const remove = jest.spyOn(a, "remove");
      const outcome = await persistServiceListItems(a, "outline", draftA, baseline).then(
        (saved) => ({ kind: "saved", items: saved.items }),
        (error: ServiceListConflictError) => ({ kind: "conflict", items: error.remoteItems, revisionConflict: error.revisionConflict }),
      );
      const merged = [draftA[0], draftB[1]];
      expect(outcome).toEqual(overlap ? { kind: "conflict", items: draftB, revisionConflict: undefined } : { kind: "saved", items: merged });
      expect(put).toHaveBeenCalledTimes(overlap ? 0 : 1);
      await b.replicate.from(a);
      expect((await b.get<DBItemListDetails>("outline")).items).toEqual(overlap ? draftB : merged);
      const overlaySave = await persistServiceListOverlays(a, "outline", ["current-overlay"]);
      expect(overlaySave.items).toEqual(overlap ? draftB : merged);
      expect(overlaySave.overlays).toEqual(["current-overlay"]);
      expect(savedB.items).toEqual(draftB);
      expect(draftA[0].name).toBe("A unsaved");
      expect(remove).not.toHaveBeenCalled();
      expect((await a.get("outline", { conflicts: true }))._conflicts).toEqual(leaves);
      expect((await a.get<DBItemListDetails>("outline", { rev: leaves![0] })).items).toEqual([row("old", "Historical work")]);
    } finally { await Promise.all([a.destroy(), b.destroy(), historical.destroy()]); }
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
      // This loser predates the latest baseline and stays historical. Ordinary
      // writes must not turn it into an active concurrent-edit review.
      const inspected = await inspectServiceListRevisions(clientA, "outline-review", await clientA.get<DBItemListDetails>("outline-review", { conflicts: true }));
      const conflict = inspected.conflict;
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

  it("writes a safe edit on the winner while preserving unresolved ItemLists branches", async () => {
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
      const winner = await clientA.get<DBItemLists & { _conflicts?: string[] }>("ItemLists", { conflicts: true });
      expect(winner._conflicts).toHaveLength(1);
      const losingRev = winner._conflicts![0];
      const losing = await clientA.get<DBItemLists>("ItemLists", { rev: losingRev });
      const intentBefore = registrySnapshot(winner);
      const put = jest.spyOn(clientA, "put");
      const saved = await persistItemListsRegistry(
        clientA as unknown as Parameters<typeof persistItemListsRegistry>[0],
        [{
          before: intentBefore,
          after: {
            ...intentBefore,
            currentLists: intentBefore.currentLists.map((item) =>
              item._id === "outline-b" ? { ...item, name: "B saved on winner" } : item,
            ),
          },
        }],
      );
      expect(put).toHaveBeenCalledTimes(1);
      expect(saved.itemLists[1].name).toBe("B saved on winner");
      expect(saved.itemLists[0].name).toBe(winner.itemLists[0].name);
      const branchesAfterSave = await clientA.get<DBItemLists & { _conflicts?: string[] }>("ItemLists", { conflicts: true });
      expect(branchesAfterSave._conflicts).toContain(losingRev);
      expect(await clientA.get("ItemLists", { rev: losingRev })).toMatchObject({ itemLists: losing.itemLists });
    } finally {
      await Promise.all([shared.destroy(), clientA.destroy(), clientB.destroy()]);
    }
  });
});
