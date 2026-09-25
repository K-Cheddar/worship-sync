import {
  buildMediaPreparationManifest,
  getMediaPreparationManifestStructure,
  isTransportSafeMediaUrl,
  isMediaPreparationManifest,
  isMediaPreparationReadinessReport,
  buildMediaPreparationReadinessCounts,
  mediaPreparationManifestToCandidates,
} from "./mediaPreparationManifest";
import type { ElectronMediaDiscovery } from "./electronMediaSurfaceDiagnostics";

const discovery = (overrides: Partial<ElectronMediaDiscovery> = {}) =>
  ({
    renderer: "projector",
    outputId: "projector",
    controllerProfileId: "presentation",
    outlineScope: "presentation",
    outlineId: "outline-1",
    outlineName: "Sunday",
    outlineLoadState: "loaded",
    itemCount: 1,
    uniqueFiniteVideoCount: 2,
    items: [
      {
        itemId: "item-1",
        itemIndex: 0,
        itemName: "Opening",
        videos: [
          {
            mediaKey: "remote:one",
            source: "media-cache://one.mp4",
            originalSource: "https://cdn.example.com/one.mp4",
            resolvedSource: "media-cache://one.mp4",
            sourceKind: "cache",
            status: "eligible",
            cacheStatus: "cached",
          },
          {
            mediaKey: "local:two",
            source: "worshipsync-media://two.mp4",
            transportSource: "https://cdn.example.com/two.mp4",
            sourceKind: "local",
            status: "eligible",
            cacheStatus: "cached",
          },
          {
            mediaKey: "local:three",
            source: "local-video-file://three.mp4",
            sourceKind: "local",
            status: "eligible",
            cacheStatus: "cached",
          },
        ],
      },
    ],
    ...overrides,
  }) as ElectronMediaDiscovery;

describe("media preparation manifest", () => {
  it("validates bounded per-device readiness reports and distinct readiness counts", () => {
    const report = {
      contract: "worshipsync.media-preparation-readiness",
      version: 1,
      outputId: "projector",
      deviceId: "device-1",
      sessionId: "session-1",
      reportedAt: 100,
      manifestRevision: 2,
      manifestReceivedAt: 90,
      source: "remote-manifest",
      candidateCount: 5,
      finiteCandidateCount: 4,
      pendingCacheCount: 1,
      readyCount: 1,
      preparingCount: 1,
      failedCount: 1,
      errors: ["one preparation failed"],
    };
    expect(isMediaPreparationReadinessReport(report)).toBe(true);
    expect(isMediaPreparationReadinessReport({ ...report, source: "cached-manifest", manifestReceivedAt: null })).toBe(true);
    expect(isMediaPreparationReadinessReport({ ...report, readyCount: 5 })).toBe(false);
    expect(isMediaPreparationReadinessReport({ ...report, excludedCount: 2 })).toBe(false);
    expect(isMediaPreparationReadinessReport({ ...report, candidateCount: 50_001 })).toBe(false);
    expect(isMediaPreparationReadinessReport({ ...report, sessionId: "x".repeat(129) })).toBe(false);
    expect(isMediaPreparationReadinessReport({ ...report, errors: Array(9).fill("error") })).toBe(false);
  });

  it("keeps pending HLS failures reportable when no finite candidate exists", () => {
    const counts = buildMediaPreparationReadinessCounts(
      [{ mediaKey: "mux:hls", status: "pending-cache" }],
      [{ mediaKey: "mux:hls", phase: "error" }],
    );
    expect(counts).toEqual({
      candidateCount: 1,
      finiteCandidateCount: 0,
      pendingCacheCount: 1,
      excludedCount: 0,
      readyCount: 0,
      preparingCount: 0,
      failedCount: 0,
      pendingCacheFailedCount: 1,
      excludedFailedCount: 0,
    });
    expect(isMediaPreparationReadinessReport({
      contract: "worshipsync.media-preparation-readiness",
      version: 1,
      outputId: "projector",
      deviceId: "device-1",
      sessionId: "window-1",
      reportedAt: 100,
      manifestRevision: 2,
      manifestReceivedAt: 90,
      source: "remote-manifest",
      ...counts,
      errors: ["Mux finite rendition failed"],
    })).toBe(true);
  });

  it("partitions finite, pending and excluded candidate failures without invalidating mixed reports", () => {
    const counts = buildMediaPreparationReadinessCounts(
      [
        { mediaKey: "finite:ready", status: "eligible" },
        { mediaKey: "finite:failed", status: "eligible" },
        { mediaKey: "mux:pending", status: "pending-cache" },
        { mediaKey: "invalid", status: "excluded" },
      ],
      [
        { mediaKey: "finite:ready", phase: "active-playing" },
        { mediaKey: "finite:failed", phase: "error" },
        { mediaKey: "mux:pending", phase: "error" },
        { mediaKey: "invalid", phase: "error" },
      ],
    );
    expect(counts).toMatchObject({
      candidateCount: 4,
      finiteCandidateCount: 2,
      pendingCacheCount: 1,
      excludedCount: 1,
      readyCount: 1,
      preparingCount: 0,
      failedCount: 1,
      pendingCacheFailedCount: 1,
      excludedFailedCount: 1,
    });
    expect(counts.readyCount + counts.preparingCount + counts.failedCount).toBe(counts.finiteCandidateCount);
  });

  it("counts a playing identity once and keeps ready, preparing and failed finite states disjoint", () => {
    const counts = buildMediaPreparationReadinessCounts(
      ["playing", "ready", "preparing", "failed"].map((mediaKey) => ({ mediaKey, status: "eligible" as const })),
      [
        { mediaKey: "playing", phase: "active-playing" },
        { mediaKey: "playing", phase: "ready-paused" },
        { mediaKey: "playing", phase: "error" },
        { mediaKey: "ready", phase: "ready-paused" },
        { mediaKey: "preparing", phase: "preparing" },
        { mediaKey: "failed", phase: "error" },
      ],
    );
    expect(counts).toMatchObject({ readyCount: 2, preparingCount: 1, failedCount: 1, finiteCandidateCount: 4 });
  });

  it("accepts portable HTTP URLs without treating renderer checks as SSRF validation", () => {
    expect(isTransportSafeMediaUrl("media-cache://one.mp4")).toBe(false);
    expect(isTransportSafeMediaUrl("worshipsync-media://one.mp4")).toBe(false);
    expect(isTransportSafeMediaUrl("http://127.0.0.1:3000/one.mp4")).toBe(false);
    expect(isTransportSafeMediaUrl("http://localhost/one.mp4")).toBe(false);
    expect(isTransportSafeMediaUrl("http://[::1]/one.mp4")).toBe(false);
    expect(isTransportSafeMediaUrl("http://user:secret@cdn.example.com/one.mp4")).toBe(false);
    expect(isTransportSafeMediaUrl("https://cdn.example.com/one.mp4")).toBe(true);
  });

  it("keeps the portable source while omitting a local cache URL", () => {
    const manifest = buildMediaPreparationManifest({
      discovery: discovery(),
      outputId: "projector",
      publishedAt: 100,
    });

    expect(manifest.items).toEqual([
      {
        itemId: "item-1",
        itemIndex: 0,
        itemName: "Opening",
        media: [
          {
            mediaKey: "local:two",
            source: {
              kind: "remote-url",
              url: "https://cdn.example.com/two.mp4",
            },
          },
          {
            mediaKey: "remote:one",
            source: {
              kind: "remote-url",
              url: "https://cdn.example.com/one.mp4",
            },
          },
        ],
      },
    ]);
    expect(JSON.stringify(manifest)).not.toContain("media-cache://");
    expect(JSON.stringify(manifest)).not.toContain("worshipsync-media://");
  });

  it("omits unavailable optional metadata instead of serializing undefined values", () => {
    const manifest = buildMediaPreparationManifest({
      discovery: discovery({
        controllerProfileId: undefined,
        controllerProfileName: undefined,
        outlineScope: undefined,
        outlineName: undefined,
      }),
      outputId: "projector",
      publishedAt: 100,
    });

    expect(manifest).not.toHaveProperty("controllerProfileId");
    expect(manifest).not.toHaveProperty("controllerProfileName");
    expect(manifest).not.toHaveProperty("outlineScope");
    expect(manifest).not.toHaveProperty("outlineName");
    expect(JSON.stringify(manifest)).not.toContain("undefined");
  });

  it("increments revision only when the structural preparation changes", () => {
    const first = buildMediaPreparationManifest({
      discovery: discovery(),
      outputId: "projector",
      publishedAt: 100,
    });
    const same = buildMediaPreparationManifest({
      discovery: discovery(),
      outputId: "projector",
      previous: first,
      publishedAt: 200,
    });
    const changed = buildMediaPreparationManifest({
      discovery: discovery({ outlineId: "outline-2" }),
      outputId: "projector",
      previous: same,
      publishedAt: 300,
    });

    expect(same.revision).toBe(first.revision);
    expect(changed.revision).toBe(first.revision + 1);
    expect(getMediaPreparationManifestStructure(same)).toBe(
      getMediaPreparationManifestStructure(first),
    );
  });

  it("adapts only manifest URLs to the existing Electron candidate contract", () => {
    const manifest = buildMediaPreparationManifest({
      discovery: discovery(),
      outputId: "projector",
    });
    expect(mediaPreparationManifestToCandidates(manifest)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
        mediaKey: "remote:one",
        source: "https://cdn.example.com/one.mp4",
        originalSource: "https://cdn.example.com/one.mp4",
        itemId: "item-1",
        }),
      ]),
    );
  });

  it("rejects unsupported versions and malformed structural payloads", () => {
    const valid = buildMediaPreparationManifest({
      discovery: discovery(),
      outputId: "projector",
    });
    expect(isMediaPreparationManifest({ ...valid, version: 2 })).toBe(false);
    expect(
      isMediaPreparationManifest({
        ...valid,
        items: [
          {
            ...valid.items[0],
            media: [
              {
                mediaKey: "",
                source: valid.items[0].media[0].source,
              },
            ],
          },
        ],
      }),
    ).toBe(false);
  });
});
