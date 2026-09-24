import { summarizeElectronMediaSurfaceDiagnostics } from "./electronMediaSurfaceDiagnostics";

describe("electronMediaSurfaceDiagnostics", () => {
  it("counts mounted surfaces by their actual lifecycle phase", () => {
    const result = summarizeElectronMediaSurfaceDiagnostics({
      outputId: "projector",
      windowRole: "projector",
      transitionDurationMs: 750,
      preparationSource: "server-manifest",
      manifestRevision: 3,
      manifestOutlineId: "outline-1",
      candidateCount: 8,
      candidateDetails: [],
      evictions: [],
      surfaces: [
        { mediaKey: "ready", source: "a.mp4", phase: "ready", sourceKind: "cache" },
        { mediaKey: "playing", source: "b.mp4", phase: "playing", sourceKind: "local" },
        { mediaKey: "preparing", source: "c.mp4", phase: "preparing", sourceKind: "remote" },
        { mediaKey: "error", source: "d.mp4", phase: "error", sourceKind: "remote" },
      ],
    });

    expect(result).toMatchObject({
      candidateCount: 8,
      surfaceCount: 4,
      readyCount: 1,
      preparingCount: 1,
      playingCount: 1,
      resettingCount: 0,
      errorCount: 1,
      transitionDurationMs: 750,
      preparationSource: "server-manifest",
      manifestRevision: 3,
      manifestOutlineId: "outline-1",
    });
  });
});
