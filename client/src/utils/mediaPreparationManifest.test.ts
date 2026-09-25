import {
  buildMediaPreparationManifest,
  getMediaPreparationManifestStructure,
  isTransportSafeMediaUrl,
  isMediaPreparationManifest,
  isMediaPreparationReadinessReport,
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
    expect(isMediaPreparationReadinessReport({ ...report, sessionId: "x".repeat(129) })).toBe(false);
    expect(isMediaPreparationReadinessReport({ ...report, errors: Array(9).fill("error") })).toBe(false);
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
