import {
  isAdvancingMediaFrame,
  isCurrentMediaSurfaceStatus,
  isMediaSurfaceVisible,
  type MediaSurfaceStatus,
} from "./mediaSurfaceLifecycle";

const status = (overrides: Partial<MediaSurfaceStatus> = {}): MediaSurfaceStatus => ({
  mediaKey: "media:a",
  sourceIdentity: "media-cache://a.mp4",
  route: "projector",
  role: "projector-output",
  outlineId: "outline-a",
  generation: 4,
  phase: "active-playing",
  geometryReady: true,
  advancingFrame: true,
  timestamp: 10,
  ...overrides,
});

describe("media surface lifecycle", () => {
  it("does not treat ready-paused as visible playback", () => {
    expect(
      isMediaSurfaceVisible(
        status({ phase: "ready-paused", advancingFrame: false }),
      ),
    ).toBe(false);
    expect(isMediaSurfaceVisible(status())).toBe(true);
  });

  it("requires monotonic frame metadata rather than a callback alone", () => {
    const retained = { mediaTime: 0, presentedFrames: 7 };
    expect(isAdvancingMediaFrame(retained, retained)).toBe(false);
    expect(
      isAdvancingMediaFrame(retained, { mediaTime: 0.04, presentedFrames: 8 }),
    ).toBe(true);
  });

  it("rejects stale source, route, outline, and generation identities", () => {
    const current = status();
    expect(
      isCurrentMediaSurfaceStatus(current, {
        route: "projector",
        role: "projector-output",
        mediaKey: "media:a",
        sourceIdentity: "media-cache://a.mp4",
        outlineId: "outline-a",
        generation: 4,
      }),
    ).toBe(true);
    expect(
      isCurrentMediaSurfaceStatus(current, {
        route: "projector",
        role: "projector-output",
        sourceIdentity: "media-cache://replacement.mp4",
      }),
    ).toBe(false);
    expect(
      isCurrentMediaSurfaceStatus(current, {
        route: "editor",
        role: "editor-preview",
      }),
    ).toBe(false);
  });
});

