import {
  getCreditsDocId,
  MEDIA_ROUTE_FOLDERS_POUCH_ID,
  MONITOR_SETTINGS_POUCH_ID,
  PREFERENCES_POUCH_ID,
  QUICK_LINKS_POUCH_ID,
} from "../types";
import { createOfflineGuestSeedDocs } from "./offlineGuestSeed";

describe("offlineGuestSeed", () => {
  it("creates the required controller docs for a local guest database", () => {
    const docs = createOfflineGuestSeedDocs("2026-01-01T00:00:00.000Z");
    const byId = new Map(docs.map((doc) => [doc._id, doc]));

    expect(byId.has("allItems")).toBe(true);
    expect(byId.has("ItemLists")).toBe(true);
    expect(byId.has("offline-demo-outline")).toBe(true);
    expect(byId.has(PREFERENCES_POUCH_ID)).toBe(true);
    expect(byId.has(QUICK_LINKS_POUCH_ID)).toBe(true);
    expect(byId.has(MONITOR_SETTINGS_POUCH_ID)).toBe(true);
    expect(byId.has(MEDIA_ROUTE_FOLDERS_POUCH_ID)).toBe(true);
    expect(byId.has("media")).toBe(true);
    expect(byId.has("overlay-templates")).toBe(true);
    expect(byId.has(getCreditsDocId("offline-demo-outline"))).toBe(true);
  });

  it("keeps the seeded outline, library, and item docs in sync", () => {
    const docs = createOfflineGuestSeedDocs("2026-01-01T00:00:00.000Z");
    const byId = new Map(docs.map((doc) => [doc._id, doc]));
    const allItems = byId.get("allItems") as unknown as {
      items: { _id: string; listId: string }[];
    };
    const outline = byId.get("offline-demo-outline") as unknown as {
      items: { _id: string; listId: string }[];
      overlays: string[];
    };

    expect(outline.items).toEqual(allItems.items);
    expect(outline.overlays).toEqual([
      "offline-service-note",
      "offline-welcome-strap",
      "offline-speaker-card",
      "offline-connect-qr",
      "offline-title-card",
    ]);

    for (const item of allItems.items) {
      expect(item.listId).toBeTruthy();
      expect(byId.has(item._id)).toBe(true);
    }
    expect(byId.has("overlay-offline-service-note")).toBe(true);
    expect(byId.has("overlay-offline-welcome-strap")).toBe(true);
    expect(byId.has("overlay-offline-speaker-card")).toBe(true);
    expect(byId.has("overlay-offline-connect-qr")).toBe(true);
    expect(byId.has("overlay-offline-title-card")).toBe(true);
  });

  it("seeds sample media without provider source (guest-safe deletes)", () => {
    const docs = createOfflineGuestSeedDocs("2026-01-01T00:00:00.000Z");
    const media = docs.find((d) => d._id === "media") as unknown as {
      list: { source?: string }[];
    };
    expect(media?.list?.length).toBeGreaterThanOrEqual(8);
    expect(media.list.every((m) => m.source === undefined)).toBe(true);
  });

  it("seeds item and slide backdrops for guest items (delivery URLs)", () => {
    const docs = createOfflineGuestSeedDocs("2026-01-01T00:00:00.000Z");
    const itemDocs = docs.filter((doc) =>
      ["song", "free", "timer"].includes(String(doc.type)),
    ) as Array<{
      background?: string;
      slides?: { boxes: { background?: string }[] }[];
      arrangements?: { slides: { boxes: { background?: string }[] }[] }[];
    }>;

    expect(itemDocs.length).toBeGreaterThan(0);
    for (const doc of itemDocs) {
      if (String(doc.type) === "timer") {
        expect(doc.background).toBe("");
      } else {
        expect(doc.background).toMatch(/^https:\/\//);
      }
    }

    const slideBoxBackgrounds = itemDocs.flatMap((doc) => [
      ...(doc.slides ?? []).flatMap((slide) =>
        slide.boxes.map((box) => box.background),
      ),
      ...(doc.arrangements ?? []).flatMap((arrangement) =>
        arrangement.slides.flatMap((slide) =>
          slide.boxes.map((box) => box.background),
        ),
      ),
    ]);
    expect(slideBoxBackgrounds.filter(Boolean).length).toBeGreaterThan(0);
    expect(
      slideBoxBackgrounds.filter(Boolean).every((b) => /^https:\/\//.test(b)),
    ).toBe(true);
  });

  it("seeds quick links for projector, monitor, and stream", () => {
    const docs = createOfflineGuestSeedDocs("2026-01-01T00:00:00.000Z");
    const qlDoc = docs.find(
      (d) => d._id === QUICK_LINKS_POUCH_ID,
    ) as unknown as {
      quickLinks: {
        id: string;
        displayType?: string;
        linkType?: string;
        presentationInfo?: {
          type?: string;
          timerId?: string;
          itemId?: string;
          slide?: { type?: string; boxes?: { background?: string }[] };
        };
      }[];
    };
    const links = qlDoc.quickLinks;
    expect(links).toHaveLength(6);
    const projectorLinks = links.filter((l) => l.displayType === "projector");
    expect(projectorLinks).toHaveLength(2);
    expect(projectorLinks.every((l) => l.linkType === "media")).toBe(true);
    expect(
      projectorLinks.every((l) => l.presentationInfo?.type === "media"),
    ).toBe(true);
    expect(
      projectorLinks.every((l) =>
        Boolean(l.presentationInfo?.slide?.boxes?.[0]?.background),
      ),
    ).toBe(true);
    expect(links.filter((l) => l.displayType === "monitor")).toHaveLength(1);
    expect(links.filter((l) => l.displayType === "stream")).toHaveLength(3);

    const monitor = links.find((l) => l.displayType === "monitor");
    expect(monitor?.presentationInfo?.type).toBe("timer");
    expect(monitor?.presentationInfo?.timerId).toBe(
      "offline-timer-five-minutes",
    );
    expect(monitor?.presentationInfo?.itemId).toBe(
      "offline-timer-five-minutes",
    );

    for (const stream of links.filter((l) => l.displayType === "stream")) {
      expect(stream.linkType).toBe("overlay");
      expect(stream.presentationInfo?.type).toBe("overlay");
    }
  });

  it("uses image-only welcome slide text in guest seed", () => {
    const docs = createOfflineGuestSeedDocs("2026-01-01T00:00:00.000Z");
    const welcome = docs.find(
      (d) => d._id === "offline-free-welcome",
    ) as unknown as {
      slides?: { boxes: { words?: string }[] }[];
      background?: string;
    };
    const textWords = welcome.slides?.[0]?.boxes?.map(
      (b) => b.words?.trim() ?? "",
    );
    expect(textWords?.every((w) => w === "" || w === " ")).toBe(true);
    expect(welcome.background).toContain("welcome-to-our-church-wide-t_nnxdv9");
  });

  it("places the blank slide last in guest demo songs", () => {
    const docs = createOfflineGuestSeedDocs("2026-01-01T00:00:00.000Z");
    const songs = docs.filter((d) => d.type === "song") as Array<{
      arrangements: { slides: { type: string }[] }[];
    }>;
    expect(songs.length).toBeGreaterThan(0);
    for (const song of songs) {
      const slides = song.arrangements[0]?.slides ?? [];
      expect(slides.length).toBeGreaterThan(1);
      expect(slides[slides.length - 1]?.type).toBe("Blank");
      expect(slides[1]?.type).not.toBe("Blank");
    }
  });
});
