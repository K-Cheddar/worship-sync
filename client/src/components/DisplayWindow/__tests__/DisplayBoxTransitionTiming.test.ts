import { getDisplayTransitionTiming } from "../DisplayBoxTransitionStage";

describe("DisplayBoxTransitionStage timing", () => {
  it("keeps the content stagger inside the requested total", () => {
    expect(getDisplayTransitionTiming(500)).toEqual({
      durationMs: 500,
      durationSeconds: 0.5,
      incomingContentOffsetSeconds: 0.1,
      incomingContentDurationSeconds: 0.4,
    });
  });

  it("scales the stagger for short transitions", () => {
    expect(getDisplayTransitionTiming(50)).toEqual({
      durationMs: 50,
      durationSeconds: 0.05,
      incomingContentOffsetSeconds: 0.01,
      incomingContentDurationSeconds: 0.04,
    });
  });

  it("uses a configured duration while keeping the offset bounded", () => {
    expect(getDisplayTransitionTiming(1200)).toEqual({
      durationMs: 1200,
      durationSeconds: 1.2,
      incomingContentOffsetSeconds: 0.1,
      incomingContentDurationSeconds: 1.1,
    });
  });

  it("settles immediately at zero duration", () => {
    expect(getDisplayTransitionTiming(0)).toEqual({
      durationMs: 0,
      durationSeconds: 0,
      incomingContentOffsetSeconds: 0,
      incomingContentDurationSeconds: 0,
    });
  });
});
