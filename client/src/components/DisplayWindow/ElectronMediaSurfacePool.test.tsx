import { act, render, screen, waitFor } from "@testing-library/react";
import type { Box } from "../../types";
import type {
  ElectronMediaSurfaceCandidate,
  ElectronMediaSurfaceView,
} from "../../utils/electronMediaSurfacePool";
import ElectronMediaSurfacePool from "./ElectronMediaSurfacePool";

const candidate: ElectronMediaSurfaceCandidate = {
  mediaKey: "remote:clip",
  source: "https://cdn.example.com/clip.mp4",
};
const videoBox = {
  id: "box",
  words: "",
  width: 100,
  height: 100,
} as unknown as Box;

const view = (shouldPlay: boolean): ElectronMediaSurfaceView => ({
  mediaKey: candidate.mediaKey,
  source: candidate.source,
  videoBox,
  opacity: 1,
  zIndex: 0,
  shouldPlay,
  muted: true,
  volume: 1,
});

describe("ElectronMediaSurfacePool", () => {
  const originalLoad = HTMLMediaElement.prototype.load;
  const originalPlay = HTMLMediaElement.prototype.play;
  const originalPause = HTMLMediaElement.prototype.pause;
  const originalCurrentTime = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    "currentTime",
  );

  beforeEach(() => {
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        getLocalMediaPath: jest
          .fn()
          .mockResolvedValue("media-cache://clip.mp4"),
        isDev: jest.fn().mockResolvedValue(false),
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "load", {
      configurable: true,
      value: jest.fn(function load(this: HTMLMediaElement) {
        window.setTimeout(() => {
          this.dispatchEvent(new Event("loadedmetadata"));
        }, 0);
      }),
    });
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: jest.fn().mockResolvedValue(undefined),
    });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      value: jest.fn(),
    });
    Object.defineProperty(
      HTMLVideoElement.prototype,
      "requestVideoFrameCallback",
      {
        configurable: true,
        value: (callback: () => void) => {
          callback();
          return 1;
        },
      },
    );
  });

  afterEach(() => {
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
    if (originalCurrentTime) {
      Object.defineProperty(
        HTMLMediaElement.prototype,
        "currentTime",
        originalCurrentTime,
      );
    } else {
      Reflect.deleteProperty(HTMLMediaElement.prototype, "currentTime");
    }
    delete (window as { electronAPI?: unknown }).electronAPI;
  });

  it("prepares, reports a presented frame, plays, and releases by identity", async () => {
    const readyChanges: boolean[] = [];
    const liveChanges: boolean[] = [];
    const onReadyChange = (_: string, ready: boolean) =>
      readyChanges.push(ready);
    const onFirstAdvancingFrameChange = (_: string, ready: boolean) =>
      liveChanges.push(ready);
    const onSurfaceElement = jest.fn();
    const { rerender, unmount } = render(
      <ElectronMediaSurfacePool
        enabled
        outputId="projector"
        windowRole="projector"
        candidates={[candidate]}
        views={[view(false)]}
        onReadyChange={onReadyChange}
        onFirstAdvancingFrameChange={onFirstAdvancingFrameChange}
        onSurfaceElement={onSurfaceElement}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("electron-media-surface-remote:clip"),
      ).toHaveAttribute("data-prepared-state", "ready"),
    );
    expect(
      screen.getByTestId("electron-media-surface-remote:clip"),
    ).toHaveAttribute("data-prepared-state", "ready");
    expect(
      screen.getByTestId("electron-media-surface-video-remote:clip"),
    ).not.toHaveStyle({ visibility: "hidden" });
    await waitFor(() => {
      expect(
        (
          window as Window & {
            __wsMediaSurfacePoolDiagnostics?: {
              surfaceCount: number;
              readyCount: number;
            };
          }
        ).__wsMediaSurfacePoolDiagnostics,
      ).toMatchObject({ surfaceCount: 1, readyCount: 1 });
    });
    rerender(
      <ElectronMediaSurfacePool
        enabled
        outputId="projector"
        windowRole="projector"
        candidates={[{ ...candidate }]}
        views={[view(false)]}
        onReadyChange={onReadyChange}
        onFirstAdvancingFrameChange={onFirstAdvancingFrameChange}
        onSurfaceElement={onSurfaceElement}
      />,
    );
    expect(
      (
        window as Window & {
          __wsMediaSurfacePoolDiagnostics?: { evictions: string[] };
        }
      ).__wsMediaSurfacePoolDiagnostics?.evictions,
    ).toEqual([]);

    rerender(
      <ElectronMediaSurfacePool
        enabled
        outputId="projector"
        windowRole="projector"
        candidates={[candidate]}
        views={[view(true)]}
        onReadyChange={onReadyChange}
        onFirstAdvancingFrameChange={onFirstAdvancingFrameChange}
        onSurfaceElement={onSurfaceElement}
      />,
    );

    await waitFor(() => expect(liveChanges).toContain(true));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();

    act(() => unmount());
    expect(readyChanges.at(-1)).toBe(false);
    expect(liveChanges.at(-1)).toBe(false);
  });

  it("does not claim HLS manifests as finite prepared surfaces", async () => {
    const getLocalMediaPath = window.electronAPI
      ?.getLocalMediaPath as jest.Mock;
    getLocalMediaPath.mockResolvedValue("media-cache://clip.m3u8");
    const hlsCandidate = {
      ...candidate,
      mediaKey: "remote:hls",
      source: "https://cdn.example.com/clip.m3u8",
    };

    render(
      <ElectronMediaSurfacePool
        enabled
        candidates={[hlsCandidate]}
        views={[]}
        onReadyChange={jest.fn()}
        onFirstAdvancingFrameChange={jest.fn()}
        onSurfaceElement={jest.fn()}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("electron-media-surface-remote:hls"),
      ).toHaveAttribute("data-prepared-state", "error"),
    );
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it("reports READY only after the final starting frame is presented and retained", async () => {
    let currentTime = 0;
    let framePresented = false;
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        if (framePresented) {
          throw new Error("final presented frame was invalidated");
        }
        currentTime = value;
      },
    });
    Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", {
      configurable: true,
      value: (callback: () => void) => {
        currentTime = 0.25;
        framePresented = true;
        callback();
        return 1;
      },
    });

    render(
      <ElectronMediaSurfacePool
        enabled
        candidates={[candidate]}
        views={[]}
        onReadyChange={jest.fn()}
        onFirstAdvancingFrameChange={jest.fn()}
        onSurfaceElement={jest.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("electron-media-surface-remote:clip")).toHaveAttribute(
        "data-prepared-state",
        "ready",
      ),
    );
    expect(framePresented).toBe(true);
  });

  it("keeps the same video element when candidate priority and item context change", async () => {
    const { rerender } = render(
      <ElectronMediaSurfacePool
        enabled
        candidates={[{ ...candidate, itemId: "item-a", priority: 4 }]}
        views={[]}
        onReadyChange={jest.fn()}
        onFirstAdvancingFrameChange={jest.fn()}
        onSurfaceElement={jest.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("electron-media-surface-remote:clip")).toHaveAttribute(
        "data-prepared-state",
        "ready",
      ),
    );
    const video = screen.getByTestId("electron-media-surface-video-remote:clip");

    rerender(
      <ElectronMediaSurfacePool
        enabled
        candidates={[{ ...candidate, itemId: "item-b", priority: 0 }]}
        views={[]}
        onReadyChange={jest.fn()}
        onFirstAdvancingFrameChange={jest.fn()}
        onSurfaceElement={jest.fn()}
      />,
    );

    expect(screen.getByTestId("electron-media-surface-video-remote:clip")).toBe(video);
  });

  it("invalidates a READY surface before re-preparing a changed source", async () => {
    const onReadyChange = jest.fn();
    const { rerender } = render(
      <ElectronMediaSurfacePool
        enabled
        candidates={[candidate]}
        views={[view(false)]}
        onReadyChange={onReadyChange}
        onFirstAdvancingFrameChange={jest.fn()}
        onSurfaceElement={jest.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("electron-media-surface-remote:clip")).toHaveAttribute(
        "data-prepared-state",
        "ready",
      ),
    );
    const falseCountBeforeChange = onReadyChange.mock.calls.filter(
      ([, ready]) => ready === false,
    ).length;

    rerender(
      <ElectronMediaSurfacePool
        enabled
        candidates={[{ ...candidate, source: "https://cdn.example.com/next.mp4" }]}
        views={[view(false)]}
        onReadyChange={onReadyChange}
        onFirstAdvancingFrameChange={jest.fn()}
        onSurfaceElement={jest.fn()}
      />,
    );

    expect(
      onReadyChange.mock.calls.filter(([, ready]) => ready === false).length,
    ).toBeGreaterThan(falseCountBeforeChange);
    await waitFor(() =>
      expect(screen.getByTestId("electron-media-surface-remote:clip")).toHaveAttribute(
        "data-prepared-state",
        "ready",
      ),
    );
  });

  it("uses the original finite URL when no local cache entry exists", async () => {
    (window.electronAPI?.getLocalMediaPath as jest.Mock).mockResolvedValue(
      null,
    );
    render(
      <ElectronMediaSurfacePool
        enabled
        candidates={[candidate]}
        views={[]}
        onReadyChange={jest.fn()}
        onFirstAdvancingFrameChange={jest.fn()}
        onSurfaceElement={jest.fn()}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("electron-media-surface-remote:clip"),
      ).toHaveAttribute("data-prepared-state", "ready"),
    );
  });

  it("does not reset preparation when playback intent is still false", async () => {
    let resolvePlay: (() => void) | undefined;
    const play = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePlay = resolve;
        }),
    );
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: play,
    });
    const frameCallbacks: Array<() => void> = [];
    Object.defineProperty(
      HTMLVideoElement.prototype,
      "requestVideoFrameCallback",
      {
        configurable: true,
        value: (callback: () => void) => {
          frameCallbacks.push(callback);
          return frameCallbacks.length;
        },
      },
    );
    const pause = HTMLMediaElement.prototype.pause as jest.Mock;
    const onReadyChange = jest.fn();
    const onFirstAdvancingFrameChange = jest.fn();
    const onSurfaceElement = jest.fn();
    const { rerender } = render(
      <ElectronMediaSurfacePool
        enabled
        candidates={[candidate]}
        views={[view(false)]}
        onReadyChange={onReadyChange}
        onFirstAdvancingFrameChange={onFirstAdvancingFrameChange}
        onSurfaceElement={onSurfaceElement}
      />,
    );

    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(pause).toHaveBeenCalledTimes(1);
    rerender(
      <ElectronMediaSurfacePool
        enabled
        candidates={[candidate]}
        views={[view(false)]}
        onReadyChange={onReadyChange}
        onFirstAdvancingFrameChange={onFirstAdvancingFrameChange}
        onSurfaceElement={onSurfaceElement}
      />,
    );
    expect(pause).toHaveBeenCalledTimes(1);

    resolvePlay?.();
    await waitFor(() => expect(frameCallbacks).toHaveLength(1));
    act(() => frameCallbacks[0]?.());
    await waitFor(() =>
      expect(
        screen.getByTestId("electron-media-surface-remote:clip"),
      ).toHaveAttribute("data-prepared-state", "ready"),
    );
  });
});
