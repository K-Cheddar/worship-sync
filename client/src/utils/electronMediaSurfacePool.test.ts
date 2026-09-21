import {
  DEFAULT_ELECTRON_MEDIA_SURFACE_BUDGET,
  getEvictedElectronMediaSurfaceKeys,
  selectElectronMediaSurfaceCandidates,
} from "./electronMediaSurfacePool";

const candidate = (
  mediaKey: string,
  itemId?: string,
  itemIndex?: number,
) => ({
  mediaKey,
  source: `https://cdn.example.com/${mediaKey}.mp4`,
  itemId,
  itemIndex,
});

describe("electronMediaSurfacePool", () => {
  it("uses the provisional ten-surface default budget", () => {
    const selected = selectElectronMediaSurfaceCandidates({
      candidates: Array.from({ length: 11 }, (_, index) =>
        candidate(`media-${index}`),
      ),
    });

    expect(DEFAULT_ELECTRON_MEDIA_SURFACE_BUDGET).toBe(10);
    expect(selected).toHaveLength(10);
  });

  it("prioritizes the current media, current item, then nearby service items", () => {
    const selected = selectElectronMediaSurfaceCandidates({
      candidates: [
        candidate("far", "item-1", 0),
        candidate("current-item", "item-2", 5),
        candidate("near-after", "item-3", 6),
        candidate("current-media", "item-3", 6),
        candidate("near-before", "item-4", 4),
      ],
      currentMediaKey: "current-media",
      currentItemId: "item-2",
      maxSurfaces: 4,
    });

    expect(selected.map(({ mediaKey }) => mediaKey)).toEqual([
      "current-media",
      "current-item",
      "near-before",
      "near-after",
    ]);
  });

  it("keeps the whole service set while current-item changes only reorder priority", () => {
    const candidates = [
      candidate("item-1-video", "item-1", 0),
      candidate("item-2-video", "item-2", 1),
      candidate("item-3-video", "item-3", 2),
    ];
    const fromFirstItem = selectElectronMediaSurfaceCandidates({
      candidates,
      currentItemId: "item-1",
      maxSurfaces: 3,
    });
    const fromSecondItem = selectElectronMediaSurfaceCandidates({
      candidates,
      currentItemId: "item-2",
      maxSurfaces: 3,
    });

    expect(new Set(fromFirstItem.map(({ mediaKey }) => mediaKey))).toEqual(
      new Set(candidates.map(({ mediaKey }) => mediaKey)),
    );
    expect(new Set(fromSecondItem.map(({ mediaKey }) => mediaKey))).toEqual(
      new Set(candidates.map(({ mediaKey }) => mediaKey)),
    );
    expect(fromFirstItem[0].mediaKey).toBe("item-1-video");
    expect(fromSecondItem[0].mediaKey).toBe("item-2-video");
  });

  it("retains protected lane identities even when they exceed the normal budget", () => {
    const selected = selectElectronMediaSurfaceCandidates({
      candidates: [
        candidate("current"),
        candidate("next"),
        candidate("protected"),
      ],
      currentMediaKey: "current",
      protectedMediaKeys: ["protected"],
      maxSurfaces: 2,
    });

    expect(selected.map(({ mediaKey }) => mediaKey)).toEqual([
      "current",
      "next",
      "protected",
    ]);
  });

  it("reports only unprotected identities removed from the candidate set", () => {
    expect(
      getEvictedElectronMediaSurfaceKeys(
        ["a", "b", "protected"],
        [candidate("a")],
      ),
    ).toEqual(["b", "protected"]);
    expect(
      getEvictedElectronMediaSurfaceKeys(
        ["a", "b", "protected"],
        [candidate("a")],
        ["protected"],
      ),
    ).toEqual(["b"]);
  });
});
