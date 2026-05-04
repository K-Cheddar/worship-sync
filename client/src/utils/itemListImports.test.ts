import { persistItemListServiceOutline } from "./itemListImports";

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
