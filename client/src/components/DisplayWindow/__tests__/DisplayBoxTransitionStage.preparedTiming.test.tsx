import { render, screen, waitFor } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import DisplayBoxTransitionStage, {
  type DisplayBoxTransitionSnapshot,
  type LaneRenderMediaOptions,
} from "../DisplayBoxTransitionStage";

const mockPoolCandidates = [
  {
    mediaKey: "remote:prepared-a",
    source: "https://cdn.example.com/prepared-a.mp4",
    itemId: "item-a",
  },
  {
    mediaKey: "remote:prepared-b",
    source: "https://cdn.example.com/prepared-b.mp4",
    itemId: "item-b",
  },
];

jest.mock("../../../hooks/useServiceVideoCandidates", () => ({
  useServiceVideoCandidates: () => ({
    candidates: mockPoolCandidates,
    diagnostics: [],
  }),
}));

const mockTimeline = {
  addLabel: jest.fn(),
  fromTo: jest.fn(),
  kill: jest.fn(),
};

let mockHoldInitialPreparedFrames = false;
let mockAutoPresentFirstAdvancingFrame = true;
let mockPreparedFrameCallbacks: Array<() => void> = [];

jest.mock("gsap", () => ({
    __esModule: true,
    default: {
      set: jest.fn(),
      timeline: jest.fn((options?: { onComplete?: () => void }) => {
      return mockTimeline;
    }),
  },
}));

jest.mock("../LaneFullFrameMedia", () => ({
  __esModule: true,
  default: () => null,
}));

const media = (mediaKey: string) => ({
  kind: "fileVideo" as const,
  mediaKey,
  originalSrc: `https://cdn.example.com/${mediaKey}.mp4`,
  videoBox: { id: "video", words: "", width: 100, height: 100 },
});

const snapshot = (
  key: string,
  words: string,
  mediaKey: string,
): DisplayBoxTransitionSnapshot => ({
  key,
  boxes: [{ id: "box", words, width: 100, height: 100 }],
  backgroundMedia: media(mediaKey),
});

const ReadyLane = ({
  reportPaintReady,
}: {
  reportPaintReady: (index: number, ready: boolean) => void;
}) => {
  useEffect(() => reportPaintReady(0, true), [reportPaintReady]);
  return null;
};

const renderLane = (
  _snapshot: DisplayBoxTransitionSnapshot,
  _isPrevious: boolean,
  reportPaintReady: (index: number, ready: boolean) => void,
  _laneMedia: LaneRenderMediaOptions,
): ReactNode => <ReadyLane reportPaintReady={reportPaintReady} />;

describe("DisplayBoxTransitionStage prepared timing", () => {
  const originalLoad = HTMLMediaElement.prototype.load;
  const originalPlay = HTMLMediaElement.prototype.play;
  const originalPause = HTMLMediaElement.prototype.pause;
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
  const originalCurrentSrc = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    "currentSrc",
  );
  const originalRequestVideoFrameCallback =
    (HTMLVideoElement.prototype as HTMLVideoElement & {
      requestVideoFrameCallback?: unknown;
    }).requestVideoFrameCallback;

  beforeEach(() => {
    jest.clearAllMocks();
    mockHoldInitialPreparedFrames = false;
    mockAutoPresentFirstAdvancingFrame = true;
    mockPreparedFrameCallbacks = [];
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        getLocalMediaPath: jest.fn().mockResolvedValue(null),
        isDev: jest.fn().mockResolvedValue(false),
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "load", {
      configurable: true,
      value: jest.fn(function load(this: HTMLMediaElement) {
        window.setTimeout(
          () => this.dispatchEvent(new Event("loadedmetadata")),
          0,
        );
      }),
    });
    let preparationFrames = 0;
    let presentedFrames = 0;
    Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", {
      configurable: true,
      value: (
        callback: (
          now: number,
          metadata: VideoFrameCallbackMetadata,
        ) => void,
      ) => {
        const emitFrame = () => {
          presentedFrames += 1;
          callback(performance.now(), {
            width: 100,
            height: 100,
            presentationTime: performance.now(),
            mediaTime: presentedFrames / 30,
            presentedFrames,
            expectedDisplayTime: performance.now(),
          });
        };
        if (preparationFrames < mockPoolCandidates.length) {
          preparationFrames += 1;
          mockPreparedFrameCallbacks.push(emitFrame);
          if (!mockHoldInitialPreparedFrames) emitFrame();
        } else {
          mockFirstAdvancingFrameCallback = emitFrame;
          if (mockAutoPresentFirstAdvancingFrame) {
            window.setTimeout(emitFrame, 250);
          }
        }
        return preparationFrames;
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      value: jest.fn(),
    });
    Object.defineProperty(Element.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 860,
        bottom: 483,
        width: 860,
        height: 483,
        toJSON: () => undefined,
      }),
    });
    Object.defineProperty(HTMLMediaElement.prototype, "currentSrc", {
      configurable: true,
      get() {
        const source = this.src;
        return source ? `${source}/` : "";
      },
    });
  });

  let mockFirstAdvancingFrameCallback: (() => void) | undefined;

  afterEach(() => {
    delete (window as { electronAPI?: unknown }).electronAPI;
    Object.defineProperty(HTMLMediaElement.prototype, "load", {
      configurable: true,
      value: originalLoad,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: originalPlay,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      value: originalPause,
    });
    Object.defineProperty(Element.prototype, "getBoundingClientRect", {
      configurable: true,
      value: originalGetBoundingClientRect,
    });
    if (originalCurrentSrc) {
      Object.defineProperty(HTMLMediaElement.prototype, "currentSrc", originalCurrentSrc);
    }
    if (originalRequestVideoFrameCallback) {
      Object.defineProperty(
        HTMLVideoElement.prototype,
        "requestVideoFrameCallback",
        { configurable: true, value: originalRequestVideoFrameCallback },
      );
    } else {
      Reflect.deleteProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback");
    }
    mockFirstAdvancingFrameCallback = undefined;
  });

  it("adopts the prepared surface immediately and fades after playback resumes", async () => {
    const play = jest.fn(() => {
      if (play.mock.calls.length <= mockPoolCandidates.length) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        window.setTimeout(resolve, 200);
      });
    });
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: play,
    });
    mockAutoPresentFirstAdvancingFrame = false;

    const first = snapshot("prepared-a", "A", "remote:prepared-a");
    const second = snapshot("prepared-b", "B", "remote:prepared-b");
    const { rerender } = render(
      <DisplayBoxTransitionStage
        snapshot={first}
        shouldAnimate
        mediaPlayback={{
          outputId: "projector",
          windowRole: "projector",
          currentItemId: "item-a",
          playbackRole: "output",
          showBackground: true,
        }}
        renderLane={renderLane}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("electron-media-surface-remote:prepared-a")).toHaveAttribute(
        "data-prepared-state",
        "playing",
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId("electron-media-surface-remote:prepared-b")).toHaveAttribute(
        "data-prepared-state",
        "ready",
      ),
    );

    rerender(
      <DisplayBoxTransitionStage
        snapshot={second}
        shouldAnimate
        mediaPlayback={{
          outputId: "projector",
          windowRole: "projector",
          currentItemId: "item-b",
          playbackRole: "output",
          showBackground: true,
        }}
        renderLane={renderLane}
      />,
    );

    await waitFor(() => expect(play).toHaveBeenCalledTimes(4));
    expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
      "data-transition-phase",
      "animating",
    );
    expect(
      screen.queryByTestId("display-box-transition-media-b"),
    ).not.toBeInTheDocument();
    const mediaFadeBeforeAdvancing = mockTimeline.fromTo.mock.calls.find(
      (call) =>
        call[0]?.getAttribute?.("data-testid") ===
        "electron-media-surface-remote:prepared-b",
    );
    expect(mediaFadeBeforeAdvancing?.[1]).toEqual({ opacity: 0 });
    expect(mediaFadeBeforeAdvancing?.[2]).toMatchObject({
      opacity: 1,
      duration: 0.5,
    });
    await waitFor(() => expect(mockFirstAdvancingFrameCallback).toBeDefined());

    mockFirstAdvancingFrameCallback?.();
    const mediaFadeCall = mockTimeline.fromTo.mock.calls.find(
      (call) =>
        call[0]?.getAttribute?.("data-testid") ===
        "electron-media-surface-remote:prepared-b",
    );
    expect(mediaFadeCall?.[1]).toEqual({ opacity: 0 });
    expect(mediaFadeCall?.[2]).toMatchObject({
      opacity: 1,
      duration: 0.5,
    });
    expect(
      mockTimeline.fromTo.mock.calls.some(
        (call) =>
          call[0]?.getAttribute?.("data-testid") ===
          "electron-media-surface-remote:prepared-a",
      ),
    ).toBe(false);
    const incomingContentFade = mockTimeline.fromTo.mock.calls.find(
      (call) =>
        call[0]?.getAttribute?.("data-testid") ===
        "display-box-transition-content-b",
    );
    expect(incomingContentFade?.[3]).toBe("crossfade+=0.1");
    expect(play).toHaveBeenCalledTimes(4);
    let preparedB: {
      sendToTransitionStartMs?: number;
      sendToPlayResolvedMs?: number;
      sendToFirstAdvancingFrameMs?: number;
    } | undefined;
    await waitFor(() => {
      const diagnostics = (
        window as Window & {
          __wsMediaSurfacePoolDiagnostics?: {
            surfaces: Array<{
          mediaKey: string;
          sendToTransitionStartMs?: number;
          sendToPlayResolvedMs?: number;
          sendToFirstAdvancingFrameMs?: number;
            }>;
          };
        }
      ).__wsMediaSurfacePoolDiagnostics;
      preparedB = diagnostics?.surfaces.find(
        (entry) => entry.mediaKey === "remote:prepared-b",
      );
      expect(preparedB).toEqual(
        expect.objectContaining({
          sendToTransitionStartMs: expect.any(Number),
          sendToPlayResolvedMs: expect.any(Number),
          sendToFirstAdvancingFrameMs: expect.any(Number),
        }),
      );
    });
    expect(preparedB?.sendToPlayResolvedMs).toBeGreaterThanOrEqual(180);
    expect(preparedB?.sendToPlayResolvedMs).toBeLessThan(300);
    expect(preparedB?.sendToFirstAdvancingFrameMs).toBeGreaterThanOrEqual(180);
    expect(preparedB?.sendToTransitionStartMs).toBeLessThan(
      preparedB?.sendToFirstAdvancingFrameMs ?? Number.POSITIVE_INFINITY,
    );
  });

  it("keeps the outgoing visual until a cold incoming surface retains a frame", async () => {
    mockHoldInitialPreparedFrames = true;
    const first = snapshot("prepared-a", "A", "remote:prepared-a");
    const second = snapshot("prepared-b", "B", "remote:prepared-b");
    const { rerender } = render(
      <DisplayBoxTransitionStage
        snapshot={first}
        shouldAnimate
        mediaPlayback={{
          outputId: "projector",
          windowRole: "projector",
          currentItemId: "item-a",
          playbackRole: "output",
          showBackground: true,
        }}
        renderLane={renderLane}
      />,
    );

    await waitFor(() => expect(mockPreparedFrameCallbacks).toHaveLength(2));
    mockPreparedFrameCallbacks[0]();
    await waitFor(() =>
      expect(screen.getByTestId("electron-media-surface-remote:prepared-a")).toHaveAttribute(
        "data-prepared-state",
        "playing",
      ),
    );

    rerender(
      <DisplayBoxTransitionStage
        snapshot={second}
        shouldAnimate
        mediaPlayback={{
          outputId: "projector",
          windowRole: "projector",
          currentItemId: "item-b",
          playbackRole: "output",
          showBackground: true,
        }}
        renderLane={renderLane}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
        "data-transition-phase",
        "preparing",
      ),
    );
    expect(mockTimeline.fromTo).not.toHaveBeenCalled();

    mockPreparedFrameCallbacks[1]();
    await waitFor(() =>
      expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
        "data-transition-phase",
        "animating",
      ),
    );
    expect(screen.queryByTestId("display-box-transition-media-b")).not.toBeInTheDocument();
  });
});
