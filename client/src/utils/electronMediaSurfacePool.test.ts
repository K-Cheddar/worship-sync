import {
  DEFAULT_ELECTRON_MEDIA_SURFACE_BUDGET,
  ELECTRON_MEDIA_SURFACE_POLICY,
  getEvictedElectronMediaSurfaceKeys,
  resolveElectronMediaSurfaceBudget,
  selectElectronMediaSurfaceCandidates,
  selectElectronMediaCandidatesForResourcePolicy,
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
  it("uses a conservative normal-class ceiling without evicting a typical service", () => {
    const selected = selectElectronMediaSurfaceCandidates({
      candidates: Array.from({ length: 11 }, (_, index) =>
        candidate(`media-${index}`),
      ),
    });

    expect(DEFAULT_ELECTRON_MEDIA_SURFACE_BUDGET).toBe(14);
    expect(selected).toHaveLength(11);
  });

  it("resolves budgets for each performance class and accepts a governor override", () => {
    const candidates = Array.from({ length: 25 }, (_, index) =>
      candidate(`media-${index}`),
    );
    expect(ELECTRON_MEDIA_SURFACE_POLICY).toEqual({
      constrained: 8,
      normal: 14,
      "high-performance": 24,
    });
    expect(resolveElectronMediaSurfaceBudget("constrained").budget).toBe(8);
    expect(resolveElectronMediaSurfaceBudget("normal").budget).toBe(14);
    expect(resolveElectronMediaSurfaceBudget("high-performance").budget).toBe(24);
    expect(resolveElectronMediaSurfaceBudget("normal", 5.8)).toEqual({
      performanceClass: "normal",
      budget: 5,
    });
    expect(
      selectElectronMediaSurfaceCandidates({
        candidates,
        performanceClass: "constrained",
      }),
    ).toHaveLength(8);
    expect(
      selectElectronMediaSurfaceCandidates({
        candidates,
        performanceClass: "normal",
      }),
    ).toHaveLength(14);
    expect(
      selectElectronMediaSurfaceCandidates({
        candidates,
        performanceClass: "high-performance",
      }),
    ).toHaveLength(24);
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

  it("reduces distant preparation while protecting active, current, and next-likely media", () => {
    const candidates = Array.from({ length: 12 }, (_, index) =>
      candidate(`media-${index}`, `item-${index}`, index),
    );
    const selected = selectElectronMediaCandidatesForResourcePolicy({
      candidates,
      currentMediaKey: "media-5",
      currentItemId: "item-5",
      protectedMediaKeys: ["media-10"], // outgoing transition owner
      baseBudget: 10,
      aggressiveness: "reduced",
    });
    const selectedKeys = new Set(selected.map(({ mediaKey }) => mediaKey));

    expect(selectedKeys.has("media-5")).toBe(true);
    expect(selectedKeys.has("media-4")).toBe(true);
    expect(selectedKeys.has("media-6")).toBe(true);
    expect(selectedKeys.has("media-10")).toBe(true);
    expect(selectedKeys.has("media-11")).toBe(false);
    expect(selected.length).toBeLessThan(candidates.length);
  });

  it("prioritizes nearby items without making the whole neighborhood budget-exempt", () => {
    const candidates = [
      ...Array.from({ length: 8 }, (_, index) => candidate(`previous-${index}`, "previous", 4)),
      ...Array.from({ length: 8 }, (_, index) => candidate(`current-${index}`, "current", 5)),
      ...Array.from({ length: 8 }, (_, index) => candidate(`next-${index}`, "next", 6)),
      ...Array.from({ length: 8 }, (_, index) => candidate(`distant-${index}`, "distant", 9)),
      candidate("outgoing", "outgoing", 12),
    ];
    const select = (aggressiveness: "normal" | "reduced" | "minimal" | "paused") =>
      selectElectronMediaCandidatesForResourcePolicy({
        candidates,
        currentMediaKey: "current-0",
        currentItemId: "current",
        protectedMediaKeys: ["previous-0", "outgoing"],
        baseBudget: 14,
        aggressiveness,
      });
    const normal = select("normal");
    const reduced = select("reduced");
    const minimal = select("minimal");
    const paused = select("paused");

    expect(normal).toHaveLength(15); // budget plus only the active/current/outgoing keys
    expect(reduced.length).toBeLessThan(normal.length);
    expect(reduced.some(({ mediaKey }) => mediaKey === "next-0")).toBe(true);
    expect(minimal.length).toBeLessThanOrEqual(6); // four optional, active + outgoing protected
    expect(paused.map(({ mediaKey }) => mediaKey).sort()).toEqual(["current-0", "outgoing", "previous-0"]);
    expect(minimal.some(({ mediaKey }) => mediaKey.startsWith("next-"))).toBe(true);
    expect(minimal.some(({ mediaKey }) => mediaKey.startsWith("distant-"))).toBe(false);
    expect(paused.every(({ protected: isProtected }) => isProtected)).toBe(true);
  });

  it("keeps every protected key even when distant preparation is paused", () => {
    const selected = selectElectronMediaCandidatesForResourcePolicy({
      candidates: [candidate("current"), candidate("active")],
      currentMediaKey: "current",
      protectedMediaKeys: ["active"],
      baseBudget: 14,
      aggressiveness: "paused",
    });
    expect(selected.map(({ mediaKey }) => mediaKey).sort()).toEqual(["active", "current"]);
  });

  it("orders equally ranked candidates deterministically regardless of input order", () => {
    const forward = selectElectronMediaSurfaceCandidates({
      candidates: [candidate("zeta", "item", 3), candidate("alpha", "item", 3)],
      currentItemId: "item",
      maxSurfaces: 2,
    });
    const reversed = selectElectronMediaSurfaceCandidates({
      candidates: [candidate("alpha", "item", 3), candidate("zeta", "item", 3)],
      currentItemId: "item",
      maxSurfaces: 2,
    });

    expect(forward.map(({ mediaKey }) => mediaKey)).toEqual(["alpha", "zeta"]);
    expect(reversed.map(({ mediaKey }) => mediaKey)).toEqual(["alpha", "zeta"]);
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

  it("protects current media even when protected transitions exceed the soft budget", () => {
    const selected = selectElectronMediaSurfaceCandidates({
      candidates: [candidate("distant"), candidate("current"), candidate("outgoing")],
      currentMediaKey: "current",
      protectedMediaKeys: ["outgoing"],
      maxSurfaces: 0,
    });

    expect(selected.map(({ mediaKey }) => mediaKey)).toEqual([
      "current",
      "outgoing",
    ]);
    expect(selected.every(({ protected: isProtected }) => isProtected)).toBe(true);
  });

  it("evicts distant media first and updates the retained set when the budget changes", () => {
    const candidates = [
      candidate("far", "item-far", 9),
      candidate("current-item", "item-current", 5),
      candidate("near", "item-near", 6),
      candidate("current", "item-near", 6),
    ];
    const initial = selectElectronMediaSurfaceCandidates({
      candidates,
      currentMediaKey: "current",
      currentItemId: "item-current",
      maxSurfaces: 4,
    });
    const reduced = selectElectronMediaSurfaceCandidates({
      candidates,
      currentMediaKey: "current",
      currentItemId: "item-current",
      maxSurfaces: 3,
    });

    expect(initial.map(({ mediaKey }) => mediaKey)).toEqual([
      "current",
      "current-item",
      "near",
      "far",
    ]);
    expect(reduced.map(({ mediaKey }) => mediaKey)).toEqual([
      "current",
      "current-item",
      "near",
    ]);
    expect(
      getEvictedElectronMediaSurfaceKeys(
        initial.map(({ mediaKey }) => mediaKey),
        reduced,
      ),
    ).toEqual(["far"]);
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
