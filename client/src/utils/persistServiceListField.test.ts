import {
  persistServiceListItems,
  persistServiceListOverlays,
} from "./persistServiceListField";
import type { DBItemListDetails } from "../types";

describe("persistServiceListField", () => {
  it.each(["read", "put", "conflict"])("keeps the latest same-field intent when the older %s is delayed", async (boundary) => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    let current = { _id: "outline", _rev: "1-base", items: [], overlays: [] as string[] };
    let firstRead = true;
    const db = {
      get: jest.fn(async () => {
        const snapshot = { ...current };
        if (firstRead && boundary === "read") {
          firstRead = false;
          entered();
          await gate;
        }
        return snapshot;
      }),
      put: jest.fn(async (raw: unknown) => {
        const doc = raw as typeof current;
        if (doc.overlays[0] === "A" && boundary !== "read") {
          entered();
          await gate;
          if (boundary === "conflict") throw Object.assign(new Error("conflict"), { status: 409 });
        }
        if (doc._rev !== current._rev) throw Object.assign(new Error("conflict"), { status: 409 });
        current = { ...doc, _rev: `${Number(current._rev[0]) + 1}-saved` };
        return { rev: current._rev };
      }),
    };
    const older = persistServiceListOverlays(db, "outline", ["A"]);
    await started;
    const newer = persistServiceListOverlays(db, "outline", ["B"]);
    // A serialized writer must keep B behind an already entered A put.
    // Let independent microtasks finish before releasing the blocked operation.
    await Promise.resolve();
    await Promise.resolve();
    release();
    await Promise.all([older, newer]);
    expect(current.overlays).toEqual(["B"]);
    expect(db.put.mock.calls.filter(([doc]) => (doc as typeof current).overlays[0] === "A")).toHaveLength(boundary === "read" ? 0 : 1);
  });

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
});
