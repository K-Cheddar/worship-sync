import {
  persistServiceListItems,
  persistServiceListOverlays,
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
});
