import { createOfflineGuestSeedDocs } from "./offlineGuestSeed";

describe("offlineGuestSeed", () => {
  it("creates the required controller docs for a local guest database", () => {
    const docs = createOfflineGuestSeedDocs("2026-01-01T00:00:00.000Z");
    const byId = new Map(docs.map((doc) => [doc._id, doc]));

    expect(byId.has("allItems")).toBe(true);
    expect(byId.has("ItemLists")).toBe(true);
    expect(byId.has("offline-demo-outline")).toBe(true);
    expect(byId.has("preferences")).toBe(true);
    expect(byId.has("media")).toBe(true);
    expect(byId.has("overlay-templates")).toBe(true);
    expect(byId.has("credits")).toBe(true);
  });

  it("keeps the seeded outline, library, and item docs in sync", () => {
    const docs = createOfflineGuestSeedDocs("2026-01-01T00:00:00.000Z");
    const byId = new Map(docs.map((doc) => [doc._id, doc]));
    const allItems = byId.get("allItems") as {
      items: { _id: string; listId: string }[];
    };
    const outline = byId.get("offline-demo-outline") as {
      items: { _id: string; listId: string }[];
      overlays: string[];
    };

    expect(outline.items).toEqual(allItems.items);
    expect(outline.overlays).toEqual(["offline-service-note"]);

    for (const item of allItems.items) {
      expect(item.listId).toBeTruthy();
      expect(byId.has(item._id)).toBe(true);
    }
    expect(byId.has("overlay-offline-service-note")).toBe(true);
  });

  it("does not depend on remote media for seeded slide backgrounds", () => {
    const docs = createOfflineGuestSeedDocs("2026-01-01T00:00:00.000Z");
    const itemDocs = docs.filter((doc) =>
      ["song", "free", "timer"].includes(String(doc.type)),
    ) as Array<{
      background?: string;
      slides?: { boxes: { background?: string }[] }[];
      arrangements?: { slides: { boxes: { background?: string }[] }[] }[];
    }>;

    const backgrounds = itemDocs.flatMap((doc) => [
      doc.background,
      ...(doc.slides ?? []).flatMap((slide) =>
        slide.boxes.map((box) => box.background),
      ),
      ...(doc.arrangements ?? []).flatMap((arrangement) =>
        arrangement.slides.flatMap((slide) =>
          slide.boxes.map((box) => box.background),
        ),
      ),
    ]);

    expect(backgrounds.filter(Boolean)).toEqual([]);
  });
});
