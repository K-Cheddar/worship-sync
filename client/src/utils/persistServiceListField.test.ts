import {
  persistServiceListItems,
  persistServiceListOverlays,
  ServiceListConflictError,
} from "./persistServiceListField";
import type { DBItemListDetails } from "../types";

describe("persistServiceListField", () => {
  it("preserves independent outline and overlay-order writes across a revision conflict", async () => {
    let current: DBItemListDetails = {
      _id: "outline-1",
      _rev: "1-base",
      name: "Sunday",
      items: [{ _id: "song-1", name: "Before", type: "song" } as any],
      overlays: ["overlay-1"],
    };
    const get = jest.fn(async () => ({ ...current }));
    const put = jest.fn(async (raw: unknown) => {
      const next = raw as DBItemListDetails;
      if (next._rev !== current._rev) {
        throw Object.assign(new Error("conflict"), { status: 409 });
      }
      current = { ...next, _rev: `${Number(current._rev[0]) + 1}-saved` };
      return { ok: true, rev: current._rev };
    });
    const db = { get, put };

    await Promise.all([
      persistServiceListItems(db, "outline-1", [
        { _id: "song-1", name: "Before", type: "song" } as any,
        { _id: "song-2", name: "Added", type: "song" } as any,
      ]),
      persistServiceListOverlays(db, "outline-1", ["overlay-2", "overlay-1"]),
    ]);

    expect(get).toHaveBeenCalledTimes(3);
    expect(put).toHaveBeenCalledTimes(3);
    expect(current.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ _id: "song-2" })]),
    );
    expect(current.overlays).toEqual(["overlay-2", "overlay-1"]);
  });

  it("retries only a bounded number of times and leaves errors visible", async () => {
    const conflict = Object.assign(new Error("conflict"), { status: 409 });
    const get = jest.fn().mockResolvedValue({
      _id: "outline-1",
      _rev: "1-base",
      name: "Sunday",
      items: [],
      overlays: [],
    });
    const put = jest.fn().mockRejectedValue(conflict);

    await expect(
      persistServiceListOverlays({ get, put }, "outline-1", ["overlay-1"]),
    ).rejects.toBe(conflict);
    expect(get).toHaveBeenCalledTimes(4);
    expect(put).toHaveBeenCalledTimes(4);
  });

  it("merges a remote edit on one row with a local edit on another row", async () => {
    const baseline = [
      { _id: "song-a", listId: "row-a", name: "A", type: "song" },
      { _id: "song-b", listId: "row-b", name: "B", type: "song" },
    ] as any[];
    const current: DBItemListDetails = {
      _id: "outline-1",
      _rev: "2-remote",
      name: "Sunday",
      items: [baseline[0], { ...baseline[1], name: "B remote" }],
      overlays: [],
    };
    const db = {
      get: jest.fn().mockResolvedValue(current),
      put: jest.fn(async (doc: DBItemListDetails) => ({
        ok: true,
        rev: "3-saved",
      })),
    };

    const saved = await persistServiceListItems(
      db,
      "outline-1",
      [{ ...baseline[0], name: "A local" }, baseline[1]] as any,
      baseline as any,
    );

    expect(db.get).toHaveBeenCalledTimes(1);
    expect(db.put).toHaveBeenCalledTimes(1);
    expect(saved.items).toEqual([
      { ...baseline[0], name: "A local" },
      { ...baseline[1], name: "B remote" },
    ]);
  });

  it("retains conflicting outline versions and does not write a concurrent reorder", async () => {
    const baseline = [
      { _id: "song-a", listId: "row-a", name: "A", type: "song" },
      { _id: "song-b", listId: "row-b", name: "B", type: "song" },
      { _id: "song-c", listId: "row-c", name: "C", type: "song" },
    ] as any[];
    const remoteItems = [baseline[0], baseline[2], baseline[1]];
    const db = {
      get: jest.fn().mockResolvedValue({
        _id: "outline-1",
        _rev: "2-remote",
        name: "Sunday",
        items: remoteItems,
        overlays: [],
      }),
      put: jest.fn(),
    };

    await expect(
      persistServiceListItems(
        db,
        "outline-1",
        [baseline[1], baseline[0], baseline[2]],
        baseline as any,
      ),
    ).rejects.toEqual(expect.objectContaining({
      name: "ServiceListConflictError",
      remoteItems,
    } satisfies Partial<ServiceListConflictError>));
    expect(db.put).not.toHaveBeenCalled();
  });
});
