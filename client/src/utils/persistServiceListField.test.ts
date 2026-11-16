import {
  persistServiceListItems,
  persistServiceListOverlays,
  reconcileConcurrentOutlineMoves,
  ServiceListConflictError,
} from "./persistServiceListField";
import type { DBItemListDetails } from "../types";
import { beginContentDatabaseSession, getContentDatabaseSessionToken } from "./contentReplicationActivity";

describe("persistServiceListField", () => {
  it("fails closed when a persisted outline move marker contains a malformed move", async () => {
    const outlineId = "outline";
    const head = {
      _id: outlineId,
      _rev: "2-winner",
      _conflicts: ["2-loser"],
      items: [],
      outlineMoveIntent: {
        baseRevision: "1-base",
        baselineOrder: ["row-a"],
        moves: [null],
      },
    } as unknown as DBItemListDetails & { _conflicts: string[] };
    const db = {
      get: jest.fn(),
      put: jest.fn(),
    };

    await expect(reconcileConcurrentOutlineMoves(db as never, outlineId, () => true, () => true, head))
      .resolves.toBeUndefined();
    expect(db.get).not.toHaveBeenCalled();
    expect(db.put).not.toHaveBeenCalled();
  });

  it("abandons a pending reconciliation when its content database session changes", async () => {
    const outlineId = "outline";
    const databaseName = `outline-session-${Math.random()}`;
    const session = beginContentDatabaseSession(databaseName);
    let replacement: ReturnType<typeof beginContentDatabaseSession> | undefined;
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const baselineOrder = ["a", "b", "c"];
    const winner = {
      _id: outlineId,
      _rev: "2-winner",
      _revisions: { start: 2, ids: ["winner", "base"] },
      _conflicts: ["2-loser"],
      items: [
        { _id: "song-b", listId: "b", name: "B", type: "song" },
        { _id: "song-a", listId: "a", name: "A", type: "song" },
        { _id: "song-c", listId: "c", name: "C", type: "song" },
      ],
      outlineMoveIntent: {
        baseRevision: "1-base", baselineOrder,
        moves: [{ outlineId, movedIds: ["b"], beforeId: "a" }],
      },
    };
    const loser = {
      ...winner,
      _rev: "2-loser",
      _revisions: { start: 2, ids: ["loser", "base"] },
      _conflicts: undefined,
      items: [
        { _id: "song-a", listId: "a", name: "A", type: "song" },
        { _id: "song-b", listId: "b", name: "B", type: "song" },
        { _id: "song-c", listId: "c", name: "C", type: "song" },
      ],
      outlineMoveIntent: {
        baseRevision: "1-base", baselineOrder,
        moves: [{ outlineId, movedIds: ["c"], beforeId: "b" }],
      },
    };
    const db = {
      get: jest.fn(async (_id: string, options?: { rev?: string }) => {
        if (options?.rev === "2-loser") {
          entered();
          await gate;
          return loser;
        }
        return winner;
      }),
      put: jest.fn(),
    };
    try {
      const sessionToken = getContentDatabaseSessionToken(databaseName);
      const pending = reconcileConcurrentOutlineMoves(
        db as never,
        outlineId,
        () => getContentDatabaseSessionToken(databaseName) === sessionToken,
        () => true,
        winner as unknown as DBItemListDetails & { _conflicts: string[] },
      );
      await started;
      replacement = beginContentDatabaseSession(databaseName);
      release();

      await expect(pending).resolves.toBeUndefined();
      expect(db.put).not.toHaveBeenCalled();
    } finally {
      release();
      replacement?.release();
      session.release();
    }
  });

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
