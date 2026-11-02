import {
  persistItemListServiceOutline,
  persistItemListServicePlanBinding,
} from "./itemListImports";

describe("persistItemListServiceOutline", () => {
  it("writes the current import onto the selected item list doc", async () => {
    const existing = {
      _id: "outline-1",
      _rev: "1-abc",
      name: "Sunday AM",
      items: [],
      overlays: [],
      updatedAt: "2026-05-03T12:00:00.000Z",
    };
    const put = jest.fn();
    const db = {
      get: jest.fn().mockResolvedValue(existing),
      put,
    } as any;

    const serviceOutline = {
      source: "servicePlanning" as const,
      loadedAt: "2026-05-03T15:30:00.000Z",
      sourceUrl: "https://example.com/plan",
      planLabel: "May 2, 2026 - 10 AM",
      preview: {
        overlayCandidates: [],
        overlayPlan: [],
        outlineCandidates: [],
        lineItems: [],
        teamAssignments: [],
      },
    };

    await persistItemListServiceOutline(db, "outline-1", serviceOutline);

    expect(db.get).toHaveBeenCalledWith("outline-1");
    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: "outline-1",
        _rev: "1-abc",
        serviceOutline,
      }),
    );
  });
});

describe("persistItemListServicePlanBinding", () => {
  type TestBinding = { planKey: string; planName: string; linkedAt: string };
  type TestOutline = {
    _id: string;
    _rev: string;
    name: string;
    items: Array<{ _id: string }>;
    description?: string;
    servicePlanBinding?: TestBinding;
  };

  it("links the selected outline to the plan without replacing its contents", async () => {
    const existing = {
      _id: "outline-1",
      _rev: "1-abc",
      name: "Sunday AM",
      items: [{ _id: "song-1", listId: "row-1", name: "Song", type: "song" }],
      overlays: ["overlay-1"],
    };
    const put = jest.fn();
    const db = {
      get: jest.fn().mockResolvedValue(existing),
      put,
    } as any;
    const binding = {
      planKey: "service-1@2026-08-09",
      planName: "Sunday Worship",
      linkedAt: "2026-08-08T15:30:00.000Z",
    };

    await persistItemListServicePlanBinding(db, "outline-1", binding);

    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({
        ...existing,
        servicePlanBinding: binding,
      }),
    );
  });

  it("serializes selections for one outline so the latest binding is persisted", async () => {
    let stored: TestOutline = {
      _id: "outline-race",
      _rev: "1-abc",
      name: "Sunday AM",
      items: [{ _id: "song-1" }],
    };
    let finishFirstPut!: () => void;
    let markFirstPutStarted!: () => void;
    const firstPutStarted = new Promise<void>((resolve) => { markFirstPutStarted = resolve; });
    const db = {
      get: jest.fn(async () => ({ ...stored })),
      put: jest.fn(async (next: TestOutline) => {
        if (next.servicePlanBinding === firstBinding) {
          markFirstPutStarted();
          await new Promise<void>((resolve) => { finishFirstPut = resolve; });
        }
        stored = { ...next, _rev: `${Number(stored._rev?.split("-")[0] || 0) + 1}-next` };
        return { ok: true };
      }),
    } as unknown as PouchDB.Database;
    const firstBinding = {
      planKey: "plan-a",
      planName: "Plan A",
      linkedAt: "2026-10-22T12:00:00.000Z",
    };
    const secondBinding = {
      planKey: "plan-b",
      planName: "Plan B",
      linkedAt: "2026-10-22T12:00:01.000Z",
    };

    const firstWrite = persistItemListServicePlanBinding(db, "outline-race", firstBinding);
    await firstPutStarted;
    const secondWrite = persistItemListServicePlanBinding(db, "outline-race", secondBinding);
    expect(db.get).toHaveBeenCalledTimes(1);

    finishFirstPut();
    await Promise.all([firstWrite, secondWrite]);

    expect(stored.servicePlanBinding).toEqual(secondBinding);
    expect(stored.name).toBe("Sunday AM");
    expect(stored.items).toEqual([{ _id: "song-1" }]);
    expect(db.get).toHaveBeenCalledTimes(2);
  });

  it("re-reads the latest document after a revision conflict", async () => {
    let stored: TestOutline = {
      _id: "outline-conflict",
      _rev: "1-abc",
      name: "Sunday AM",
      items: [] as Array<{ _id: string }>,
    };
    const db = {
      get: jest.fn(async () => ({ ...stored })),
      put: jest.fn(async (next: TestOutline) => {
        if (db.put.mock.calls.length === 1) {
          stored = { ...stored, _rev: "2-remote", description: "Concurrent edit" };
          throw Object.assign(new Error("Document update conflict"), { status: 409, name: "conflict" });
        }
        stored = { ...next, _rev: "3-local" };
        return { ok: true };
      }),
    } as unknown as PouchDB.Database & { get: jest.Mock; put: jest.Mock };
    const binding = {
      planKey: "plan-current",
      planName: "Current Plan",
      linkedAt: "2026-10-22T12:00:00.000Z",
    };

    await persistItemListServicePlanBinding(db, "outline-conflict", binding);

    expect(db.get).toHaveBeenCalledTimes(2);
    expect(stored.description).toBe("Concurrent edit");
    expect(stored.servicePlanBinding).toEqual(binding);
  });
});
