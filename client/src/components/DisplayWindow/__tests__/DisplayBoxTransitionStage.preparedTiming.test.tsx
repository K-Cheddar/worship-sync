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
  const originalRequestVideoFrameCallback =
    (HTMLVideoElement.prototype as HTMLVideoElement & {
      requestVideoFrameCallback?: unknown;
    }).requestVideoFrameCallback;

  beforeEach(() => {
    jest.clearAllMocks();
    mockHoldInitialPreparedFrames = false;
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
    Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", {
      configurable: true,
      value: (callback: () => void) => {
        if (preparationFrames < mockPoolCandidates.length) {
          preparationFrames += 1;
          mockPreparedFrameCallbacks.push(callback);
          if (!mockHoldInitialPreparedFrames) callback();
        } else {
          mockFirstAdvancingFrameCallback = callback;
          window.setTimeout(() => callback(), 250);
        }
        return preparationFrames;
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      value: jest.fn(),
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

  it("starts the fade while play and the first advancing frame are delayed", async () => {
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
        "ready",
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

    await waitFor(() =>
      expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
        "data-transition-phase",
        "animating",
      ),
    );
    expect(play).toHaveBeenCalledTimes(3);
    expect(mockFirstAdvancingFrameCallback).toBeUndefined();

    await waitFor(() => expect(mockFirstAdvancingFrameCallback).toBeDefined());
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
    expect(preparedB?.sendToTransitionStartMs).toBeLessThan(50);
    expect(preparedB?.sendToPlayResolvedMs).toBeGreaterThanOrEqual(180);
    expect(preparedB?.sendToPlayResolvedMs).toBeLessThan(300);
    expect(preparedB?.sendToFirstAdvancingFrameMs).toBeGreaterThanOrEqual(400);
  });

  it("keeps the outgoing visual until a cold incoming surface is frame-ready", async () => {
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
  });
});
