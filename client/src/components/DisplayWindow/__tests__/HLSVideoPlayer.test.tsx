import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import HLSPlayer from "../HLSVideoPlayer";
import { serverNow } from "../../../utils/serverTime";
import {
  acquireLocalVideoFileUrl,
  peekLocalVideoFileUrl,
} from "../../../utils/localVideoFileUrlCache";
import {
  getVideoPreviewSnapshot,
  restartVideoPreview,
  resetVideoBackgroundPlaybackForTests,
  seekVideoPreview,
  VIDEO_CUE_RATE_CORRECTION_MAX_DURATION_MS,
} from "../../../utils/videoBackgroundPlayback";

jest.mock("../../../utils/serverTime", () => ({
  serverNow: jest.fn(() => 1_000_000),
  serverDate: jest.fn(() => new Date(1_000_000)),
  setServerTimeOffset: jest.fn(),
}));

const mockServerNow = serverNow as jest.Mock;
const mockAcquireLocalVideoFileUrl = jest.mocked(acquireLocalVideoFileUrl);
const mockPeekLocalVideoFileUrl = jest.mocked(peekLocalVideoFileUrl);

const mockIsSupported = jest.fn(() => false);
const mockInstances: any[] = [];
let frameCallbacks: Array<() => void> = [];

jest.mock("hls.js", () => {
  class MockHls {
    static isSupported = () => mockIsSupported();
    static Events = {
      ERROR: "hlsError",
      MANIFEST_PARSED: "manifestParsed",
    };
    static ErrorTypes = {
      NETWORK_ERROR: "networkError",
      MEDIA_ERROR: "mediaError",
    };

    listeners: Record<string, Function[]> = {};
    loadSource = jest.fn();
    attachMedia = jest.fn();
    startLoad = jest.fn();
    recoverMediaError = jest.fn();
    destroy = jest.fn();
    on = jest.fn((event: string, cb: Function) => {
      this.listeners[event] = this.listeners[event] || [];
      this.listeners[event].push(cb);
    });

    emit(event: string, ...args: any[]) {
      (this.listeners[event] || []).forEach((cb) => cb(...args));
    }

    constructor() {
      mockInstances.push(this);
    }
  }

  return {
    __esModule: true,
    default: MockHls,
  };
});

jest.mock("../../../utils/localVideoFileUrlCache", () => ({
  acquireLocalVideoFileUrl: jest.fn(),
  peekLocalVideoFileUrl: jest.fn(),
}));

describe("HLSVideoPlayer", () => {
  const originalPlay = HTMLMediaElement.prototype.play;
  const originalLoad = HTMLMediaElement.prototype.load;
  const originalCanPlayType = HTMLMediaElement.prototype.canPlayType;
  const originalPausedDescriptor = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    "paused",
  );
  const originalCurrentTimeDescriptor = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    "currentTime",
  );
  const originalRequestVideoFrameCallbackDescriptor = Object.getOwnPropertyDescriptor(
    HTMLVideoElement.prototype,
    "requestVideoFrameCallback",
  );

  /** Overrides `paused`, returning a restore fn — jsdom keeps it read-only. */
  const stubPaused = (value: boolean) => {
    Object.defineProperty(HTMLMediaElement.prototype, "paused", {
      configurable: true,
      get: () => value,
    });
    return () => {
      if (originalPausedDescriptor) {
        Object.defineProperty(
          HTMLMediaElement.prototype,
          "paused",
          originalPausedDescriptor,
        );
      }
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    resetVideoBackgroundPlaybackForTests();
    mockServerNow.mockReturnValue(1_000_000);
    mockInstances.length = 0;
    frameCallbacks = [];
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
    mockPeekLocalVideoFileUrl.mockReturnValue(undefined);
    mockAcquireLocalVideoFileUrl.mockReturnValue({
      url: Promise.resolve("worshipsync-media://asset/local-video"),
      release: jest.fn(),
    });

    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      writable: true,
      value: jest.fn().mockResolvedValue(undefined),
    });
    Object.defineProperty(HTMLMediaElement.prototype, "load", {
      configurable: true,
      writable: true,
      value: jest.fn(),
    });
    Object.defineProperty(HTMLMediaElement.prototype, "canPlayType", {
      configurable: true,
      writable: true,
      value: jest.fn(() => ""),
    });
    Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", {
      configurable: true,
      writable: true,
      value: jest.fn((callback: () => void) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      }),
    });
  });

  afterAll(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      writable: true,
      value: originalPlay,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "load", {
      configurable: true,
      writable: true,
      value: originalLoad,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "canPlayType", {
      configurable: true,
      writable: true,
      value: originalCanPlayType,
    });
    if (originalRequestVideoFrameCallbackDescriptor) {
      Object.defineProperty(
        HTMLVideoElement.prototype,
        "requestVideoFrameCallback",
        originalRequestVideoFrameCallbackDescriptor,
      );
    } else {
      Reflect.deleteProperty(
        HTMLVideoElement.prototype,
        "requestVideoFrameCallback",
      );
    }
  });

  afterEach(() => {
    if (originalCurrentTimeDescriptor) {
      Object.defineProperty(
        HTMLMediaElement.prototype,
        "currentTime",
        originalCurrentTimeDescriptor,
      );
    }
  });

  it("uses native playback for non-HLS src and falls back from cached media URL on error", () => {
    render(
      <HLSPlayer
        src="media-cache://video.mp4"
        originalSrc="https://cdn.example.com/video.mp4"
      />,
    );

    const video = screen.getByTestId("hls-video-player");
    (video as HTMLVideoElement).playbackRate = 1.02;
    fireEvent.error(video);

    expect(console.log).toHaveBeenCalledWith(
      "[HLSPlayer] Falling back to original URL: https://cdn.example.com/video.mp4",
    );
    expect((video as HTMLVideoElement).playbackRate).toBe(1);
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(2);
  });

  it("starts native mp4 playback on metadata load and restarts when the video ends", () => {
    render(<HLSPlayer src="https://cdn.example.com/video.mp4" />);

    const video = screen.getByTestId("hls-video-player");
    fireEvent.loadedMetadata(video);
    fireEvent.ended(video);

    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
  });

  it("resolves legacy local video references before assigning media src", async () => {
    render(<HLSPlayer src="local-video-file://local_video_1k08lk4nbr5oma60651s" />);

    const video = screen.getByTestId("hls-video-player") as HTMLVideoElement;
    expect(video.src).not.toContain("local-video-file://");

    await waitFor(() => {
      expect(video.src).toBe("worshipsync-media://asset/local-video");
    });
    expect(mockAcquireLocalVideoFileUrl).toHaveBeenCalledWith(
      "local_video_1k08lk4nbr5oma60651s",
    );
  });

  it("does not warn when play is rejected after the source is replaced", async () => {
    let rejectPlay: (error: Error) => void = () => undefined;
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      writable: true,
      value: jest.fn(
        () => new Promise<void>((_resolve, reject) => (rejectPlay = reject)),
      ),
    });

    const { rerender } = render(<HLSPlayer src="media-cache://old.mp4" />);
    fireEvent.loadedMetadata(screen.getByTestId("hls-video-player"));
    rerender(<HLSPlayer src="media-cache://new.mp4" />);

    await act(async () => {
      rejectPlay(new DOMException("superseded", "AbortError"));
    });

    expect(console.warn).not.toHaveBeenCalledWith(
      "Error playing video",
      expect.anything(),
    );
  });

  it("does not warn when play is rejected after the player is unmounted", async () => {
    let rejectPlay: (error: Error) => void = () => undefined;
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      writable: true,
      value: jest.fn(
        () => new Promise<void>((_resolve, reject) => (rejectPlay = reject)),
      ),
    });

    const { unmount } = render(<HLSPlayer src="media-cache://removed.mp4" />);
    fireEvent.loadedMetadata(screen.getByTestId("hls-video-player"));
    unmount();

    await act(async () => {
      rejectPlay(new DOMException("media removed", "AbortError"));
    });

    expect(console.warn).not.toHaveBeenCalledWith(
      "Error playing video",
      expect.anything(),
    );
  });

  it("does not fall back to an opaque local reference", () => {
    render(
      <HLSPlayer
        src="media-cache://video.mp4"
        originalSrc="local-video-file://local-video"
      />,
    );

    const video = screen.getByTestId("hls-video-player") as HTMLVideoElement;
    fireEvent.error(video);

    expect(video.src).not.toContain("local-video-file://");
  });

  it("still warns for an active-source playback failure", async () => {
    let rejectPlay: (error: Error) => void = () => undefined;
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      writable: true,
      value: jest.fn(
        () => new Promise<void>((_resolve, reject) => (rejectPlay = reject)),
      ),
    });

    render(<HLSPlayer src="media-cache://active.mp4" />);
    fireEvent.loadedMetadata(screen.getByTestId("hls-video-player"));

    const error = new DOMException("blocked", "NotAllowedError");
    await act(async () => {
      rejectPlay(error);
    });

    expect(console.warn).toHaveBeenCalledWith("Error playing video", error);
  });

  it("uses hls.js for m3u8 when supported and handles network/media fatal errors", () => {
    mockIsSupported.mockReturnValue(true);
    render(<HLSPlayer src="https://stream.example.com/live.m3u8" />);

    const instance = mockInstances[0];
    expect(instance).toBeDefined();
    expect(instance.loadSource).toHaveBeenCalledWith(
      "https://stream.example.com/live.m3u8",
    );

    instance.emit("hlsError", {}, { fatal: true, type: "networkError" });
    expect(instance.startLoad).toHaveBeenCalled();

    instance.emit("hlsError", {}, { fatal: true, type: "mediaError" });
    expect(instance.recoverMediaError).toHaveBeenCalled();
  });

  it("destroys hls.js instance on unrecoverable fatal errors", () => {
    mockIsSupported.mockReturnValue(true);
    render(<HLSPlayer src="https://stream.example.com/live.m3u8" />);

    const instance = mockInstances[0];
    instance.emit("hlsError", {}, { fatal: true, type: "otherFatalError" });

    expect(instance.destroy).toHaveBeenCalled();
  });

  it("uses native HLS fallback when hls.js is unsupported but canPlayType supports it", () => {
    mockIsSupported.mockReturnValue(false);
    (HTMLMediaElement.prototype.canPlayType as jest.Mock).mockReturnValue(
      "probably",
    );

    render(<HLSPlayer src="https://stream.example.com/live.m3u8" />);
    const video = screen.getByTestId("hls-video-player");

    fireEvent.loadedMetadata(video);
    fireEvent.ended(video);

    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
  });

  it("buffers cached media and finite output files, but not remote preview tiles", () => {
    render(<HLSPlayer src="media-cache://clip.mp4" />);
    const video = screen.getByTestId("hls-video-player");
    expect(video.getAttribute("preload")).toBe("auto");

    render(
      <HLSPlayer
        src="https://cdn.example.com/clip.mp4"
        playbackRole="output"
      />,
    );
    expect(screen.getAllByTestId("hls-video-player")[1]).toHaveAttribute(
      "preload",
      "auto",
    );

    render(
      <HLSPlayer
        src="https://cdn.example.com/preview.mp4"
        playbackRole="output"
        preloadRole="preview"
      />,
    );
    expect(screen.getAllByTestId("hls-video-player")[2]).toHaveAttribute(
      "preload",
      "metadata",
    );
  });

  it("keeps HLS preload conservative for segmented streams", () => {
    render(<HLSPlayer src="https://stream.example.com/live.m3u8" />);
    expect(screen.getByTestId("hls-video-player")).toHaveAttribute(
      "preload",
      "metadata",
    );
  });

  it("notifies paint-ready after metadata and a current frame are available", () => {
    const onLoadedData = jest.fn();
    const onError = jest.fn();

    render(
      <HLSPlayer
        src="https://cdn.example.com/video.mp4"
        onLoadedData={onLoadedData}
        onError={onError}
      />,
    );

    const video = screen.getByTestId("hls-video-player") as HTMLVideoElement;
    // Native loadeddata alone is not enough; outputs wait until the player has
    // synced (and finished any cue seek) so the poster is not dropped early.
    fireEvent.loadedData(video);
    expect(onLoadedData).not.toHaveBeenCalled();

    Object.defineProperty(video, "readyState", {
      configurable: true,
      get: () => 2,
    });
    fireEvent.loadedMetadata(video);

    expect(onLoadedData).not.toHaveBeenCalled();
    const presentedFrame = frameCallbacks.shift();
    act(() => presentedFrame?.());
    expect(onLoadedData).toHaveBeenCalledTimes(1);
    fireEvent.error(video);
    expect(onError).toHaveBeenCalled();
  });

  it("waits for seeked before paint-ready when a cue seek is in flight", () => {
    const onLoadedData = jest.fn();
    Object.defineProperty(HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get: () => 40,
    });

    render(
      <HLSPlayer
        src="media-cache://clip.mp4"
        onLoadedData={onLoadedData}
        playback={{
          mediaKey: "remote:video-1",
          positionSeconds: 12,
          paused: false,
          atServerMs: 1_000_000,
          generation: 1,
          applySeek: true,
        }}
      />,
    );

    const video = screen.getByTestId("hls-video-player") as HTMLVideoElement;
    let seeking = true;
    Object.defineProperty(video, "seeking", {
      configurable: true,
      get: () => seeking,
    });
    Object.defineProperty(video, "readyState", {
      configurable: true,
      get: () => 2,
    });

    fireEvent.loadedMetadata(video);
    expect(onLoadedData).not.toHaveBeenCalled();

    seeking = false;
    fireEvent.seeked(video);
    const presentedFrame = frameCallbacks.shift();
    act(() => presentedFrame?.());
    expect(onLoadedData).toHaveBeenCalledTimes(1);
  });

  it("ignores stale paint-ready listeners after a rapid A→B→A source swap", () => {
    const onLoadedData = jest.fn();
    const { rerender } = render(
      <HLSPlayer
        src="https://cdn.example.com/a.mp4"
        onLoadedData={onLoadedData}
      />,
    );

    const video = screen.getByTestId("hls-video-player") as HTMLVideoElement;
    let seeking = true;
    Object.defineProperty(video, "seeking", {
      configurable: true,
      get: () => seeking,
    });
    Object.defineProperty(video, "readyState", {
      configurable: true,
      get: () => 2,
    });

    fireEvent.loadedMetadata(video);
    expect(onLoadedData).not.toHaveBeenCalled();

    rerender(
      <HLSPlayer
        src="https://cdn.example.com/b.mp4"
        onLoadedData={onLoadedData}
      />,
    );
    rerender(
      <HLSPlayer
        src="https://cdn.example.com/a.mp4"
        onLoadedData={onLoadedData}
      />,
    );

    // First A's pending seeked must not declare paint-ready for the second A.
    seeking = false;
    fireEvent.seeked(video);
    expect(onLoadedData).not.toHaveBeenCalled();

    fireEvent.loadedMetadata(video);
    const staleFrame = frameCallbacks.shift();
    act(() => staleFrame?.());
    const currentFrame = frameCallbacks.shift();
    act(() => currentFrame?.());
    expect(onLoadedData).toHaveBeenCalledTimes(1);
  });

  it("keeps the video hidden until the presented-frame callback", () => {
    const { rerender } = render(
      <HLSPlayer src="https://cdn.example.com/video.mp4" paintReady={false} />,
    );
    const video = screen.getByTestId("hls-video-player");

    expect(video).toHaveStyle({ visibility: "hidden" });
    rerender(
      <HLSPlayer src="https://cdn.example.com/video.mp4" paintReady />,
    );
    expect(video).toHaveStyle({ visibility: "visible" });
  });

  it("seeks and pauses when a playback cue is present on metadata load", () => {
    const pause = jest.fn();
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      writable: true,
      value: pause,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get: () => 40,
    });

    render(
      <HLSPlayer
        src="https://cdn.example.com/video.mp4"
        playback={{
          mediaKey: "remote:video-1",
          positionSeconds: 12,
          paused: true,
          atServerMs: 1_000_000,
          generation: 1,
          applySeek: true,
        }}
      />,
    );

    const video = screen.getByTestId("hls-video-player") as HTMLVideoElement;
    fireEvent.loadedMetadata(video);

    expect(video.currentTime).toBe(12);
    expect(pause).toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it("applies a playback cue on metadata load in editor preview mode", () => {
    const pause = jest.fn();
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      writable: true,
      value: pause,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get: () => 40,
    });

    render(
      <HLSPlayer
        src="https://cdn.example.com/video.mp4"
        playbackRole="preview"
        transportRole="editor"
        mediaKey="remote:video-1"
        playback={{
          mediaKey: "remote:video-1",
          positionSeconds: 8,
          paused: true,
          atServerMs: 1_000_000,
          generation: 2,
          applySeek: true,
        }}
      />,
    );

    const video = screen.getByTestId("hls-video-player") as HTMLVideoElement;
    fireEvent.loadedMetadata(video);

    expect(video.currentTime).toBe(8);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(pause).toHaveBeenCalled();
  });

  it("waits for the new src to load before applying a playback cue", () => {
    const play = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      writable: true,
      value: play,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get: () => 40,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", {
      configurable: true,
      get: () => 4,
    });

    const playback = {
      mediaKey: "remote:video-2",
      positionSeconds: 0,
      paused: false,
      atServerMs: 1_000_000,
      generation: 2,
      applySeek: true,
    };

    const { rerender } = render(
      <HLSPlayer
        src="https://cdn.example.com/video-a.mp4"
        playback={playback}
      />,
    );

    const video = screen.getByTestId("hls-video-player") as HTMLVideoElement;
    fireEvent.loadedMetadata(video);
    play.mockClear();

    rerender(
      <HLSPlayer
        src="https://cdn.example.com/video-b.mp4"
        playback={{
          ...playback,
          generation: 3,
        }}
      />,
    );

    expect(play).not.toHaveBeenCalled();

    fireEvent.loadedMetadata(video);
    expect(play).toHaveBeenCalled();
  });

  it("ignores a cue for another media identity without seeking or reloading", () => {
    Object.defineProperty(HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get: () => 40,
    });
    const currentTimeSetter = jest.fn();
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      configurable: true,
      get: () => 14.2,
      set: currentTimeSetter,
    });

    const cueA = {
      mediaKey: "remote:video-a",
      positionSeconds: 14.2,
      paused: false,
      atServerMs: 1_000_000,
      generation: 1,
      applySeek: false,
    };
    const { rerender } = render(
      <HLSPlayer
        src="https://cdn.example.com/video-a.mp4"
        mediaKey="remote:video-a"
        playback={cueA}
      />,
    );
    const video = screen.getByTestId("hls-video-player");
    fireEvent.loadedMetadata(video);
    currentTimeSetter.mockClear();
    (HTMLMediaElement.prototype.load as jest.Mock).mockClear();

    rerender(
      <HLSPlayer
        src="https://cdn.example.com/video-a.mp4"
        mediaKey="remote:video-a"
        playback={{ ...cueA, mediaKey: "remote:video-b", generation: 2 }}
      />,
    );

    expect(currentTimeSetter).not.toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
    expect(video).toHaveAttribute("src", "https://cdn.example.com/video-a.mp4");

    rerender(
      <HLSPlayer
        src="https://cdn.example.com/video-a.mp4"
        mediaKey="remote:video-a"
        playback={{
          ...cueA,
          generation: 3,
          positionSeconds: 16,
          applySeek: true,
        }}
      />,
    );
    expect(currentTimeSetter).toHaveBeenCalled();
  });

  /**
   * The cached-URL swap and the media-cache fallback both reload the element
   * mid-flight. A resume cue carries applySeek: false so lyric advances do not
   * restart the clip, but a freshly loaded element sits at 0 and has to catch
   * up when the cue is meaningfully away from 0.
   */
  it("seeks a freshly loaded source to the cue position even when the cue says keep the playhead", () => {
    const play = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      writable: true,
      value: play,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get: () => 40,
    });

    render(
      <HLSPlayer
        src="media-cache://loop.mp4"
        playback={{
          mediaKey: "remote:video-1",
          positionSeconds: 15,
          paused: false,
          atServerMs: 1_000_000,
          generation: 4,
          applySeek: false,
        }}
      />,
    );

    const video = screen.getByTestId("hls-video-player") as HTMLVideoElement;
    mockServerNow.mockReturnValue(1_003_000);
    fireEvent.loadedMetadata(video);

    expect(video.currentTime).toBeCloseTo(18, 3);
    expect(play).toHaveBeenCalled();
  });

  it("does not seek a fresh element when the cue is already within epsilon of currentTime", () => {
    const play = jest.fn().mockResolvedValue(undefined);
    const currentTimeSetter = jest.fn();
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      writable: true,
      value: play,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get: () => 40,
    });

    render(
      <HLSPlayer
        src="media-cache://start.mp4"
        playback={{
          mediaKey: "remote:video-start",
          positionSeconds: 0,
          paused: false,
          atServerMs: 1_000_000,
          generation: 1,
          applySeek: false,
        }}
      />,
    );

    const video = screen.getByTestId("hls-video-player") as HTMLVideoElement;
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => 0,
      set: currentTimeSetter,
    });
    mockServerNow.mockReturnValue(1_000_000);
    fireEvent.loadedMetadata(video);

    expect(currentTimeSetter).not.toHaveBeenCalled();
    expect(play).toHaveBeenCalled();
  });

  it("does not seek a fresh element when the resolved cue is within epsilon", () => {
    const play = jest.fn().mockResolvedValue(undefined);
    const currentTimeSetter = jest.fn();
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      writable: true,
      value: play,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get: () => 40,
    });

    render(
      <HLSPlayer
        src="media-cache://near-zero.mp4"
        playback={{
          mediaKey: "remote:video-near",
          positionSeconds: 0.02,
          paused: false,
          atServerMs: 1_000_000,
          generation: 1,
          applySeek: true,
        }}
      />,
    );

    const video = screen.getByTestId("hls-video-player") as HTMLVideoElement;
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => 0,
      set: currentTimeSetter,
    });
    mockServerNow.mockReturnValue(1_000_000);
    fireEvent.loadedMetadata(video);

    expect(currentTimeSetter).not.toHaveBeenCalled();
    expect(play).toHaveBeenCalled();
  });

  it("ignores small cue drift without seeking or changing playback rate", () => {
    jest.useFakeTimers();
    const play = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      writable: true,
      value: play,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get: () => 40,
    });
    const restorePaused = stubPaused(false);

    try {
      render(
        <HLSPlayer
          src="https://cdn.example.com/loop.mp4"
          playback={{
            mediaKey: "remote:video-1",
            positionSeconds: 5,
            paused: false,
            atServerMs: 1_000_000,
            generation: 1,
            applySeek: true,
          }}
        />,
      );

      const video = screen.getByTestId("hls-video-player") as HTMLVideoElement;
      fireEvent.loadedMetadata(video);
      expect(video.currentTime).toBeCloseTo(5, 3);

      video.currentTime = 5.3;
      mockServerNow.mockReturnValue(1_000_500);
      act(() => {
        jest.advanceTimersByTime(2000);
      });

      expect(video.currentTime).toBeCloseTo(5.3, 3);
      expect(video.playbackRate).toBe(1);
    } finally {
      jest.useRealTimers();
      restorePaused();
    }
  });

  it("speeds up a moderately behind surface without seeking", () => {
    jest.useFakeTimers();
    const play = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      writable: true,
      value: play,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get: () => 40,
    });
    const restorePaused = stubPaused(false);
    (window as { __wsVideoDebug?: boolean }).__wsVideoDebug = true;

    try {
      render(
        <HLSPlayer
          src="https://cdn.example.com/loop.mp4"
          playback={{
            mediaKey: "remote:video-1",
            positionSeconds: 5,
            paused: false,
            atServerMs: 1_000_000,
            generation: 1,
            applySeek: true,
          }}
        />,
      );

      const video = screen.getByTestId("hls-video-player") as HTMLVideoElement;
      fireEvent.loadedMetadata(video);
      video.currentTime = 4.8;
      mockServerNow.mockReturnValue(1_000_500);
      act(() => {
        jest.advanceTimersByTime(2000);
      });

      expect(video.currentTime).toBeCloseTo(4.8, 3);
      expect(video.playbackRate).toBeCloseTo(1.014, 3);
      expect(console.log).toHaveBeenCalledWith(
        "[video-cue] player.drift",
        expect.objectContaining({
          expectedPosition: 5.5,
          actualPosition: 4.8,
          signedDrift: expect.closeTo(0.7, 3),
          currentPlaybackRate: 1,
          correction: "speed up",
          targetPlaybackRate: expect.closeTo(1.014, 3),
          sourceKind: "network",
        }),
      );
    } finally {
      jest.useRealTimers();
      restorePaused();
      delete (window as { __wsVideoDebug?: boolean }).__wsVideoDebug;
    }
  });

  it("slows down a moderately ahead surface without seeking", () => {
    jest.useFakeTimers();
    const play = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      writable: true,
      value: play,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get: () => 40,
    });
    const restorePaused = stubPaused(false);

    try {
      render(
        <HLSPlayer
          src="https://cdn.example.com/loop.mp4"
          playback={{
            mediaKey: "remote:video-1",
            positionSeconds: 5,
            paused: false,
            atServerMs: 1_000_000,
            generation: 1,
            applySeek: true,
          }}
        />,
      );

      const video = screen.getByTestId("hls-video-player") as HTMLVideoElement;
      fireEvent.loadedMetadata(video);
      video.currentTime = 6.2;
      mockServerNow.mockReturnValue(1_000_500);
      act(() => {
        jest.advanceTimersByTime(2000);
      });

      expect(video.currentTime).toBeCloseTo(6.2, 3);
      expect(video.playbackRate).toBeCloseTo(0.986, 3);
    } finally {
      jest.useRealTimers();
      restorePaused();
    }
  });

  it("returns playback rate to 1x when moderate drift is corrected", () => {
    jest.useFakeTimers();
    const play = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      writable: true,
      value: play,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get: () => 40,
    });
    const restorePaused = stubPaused(false);

    try {
      render(
        <HLSPlayer
          src="https://cdn.example.com/loop.mp4"
          playback={{
            mediaKey: "remote:video-1",
            positionSeconds: 5,
            paused: false,
            atServerMs: 1_000_000,
            generation: 1,
            applySeek: true,
          }}
        />,
      );

      const video = screen.getByTestId("hls-video-player") as HTMLVideoElement;
      fireEvent.loadedMetadata(video);
      video.currentTime = 4.8;
      mockServerNow.mockReturnValue(1_000_500);
      act(() => {
        jest.advanceTimersByTime(2000);
      });
      expect(video.playbackRate).toBeCloseTo(1.014, 3);

      video.currentTime = 5.45;
      mockServerNow.mockReturnValue(1_000_500);
      act(() => {
        jest.advanceTimersByTime(2000);
      });

      expect(video.playbackRate).toBe(1);
    } finally {
      jest.useRealTimers();
      restorePaused();
    }
  });

  it("hard seeks if moderate drift does not recover before its deadline", () => {
    jest.useFakeTimers();
    const play = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      writable: true,
      value: play,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get: () => 40,
    });
    const restorePaused = stubPaused(false);

    try {
      render(
        <HLSPlayer
          src="https://cdn.example.com/loop.mp4"
          playback={{
            mediaKey: "remote:video-1",
            positionSeconds: 5,
            paused: false,
            atServerMs: 1_000_000,
            generation: 1,
            applySeek: true,
          }}
        />,
      );

      const video = screen.getByTestId("hls-video-player") as HTMLVideoElement;
      fireEvent.loadedMetadata(video);
      video.currentTime = 4.8;
      mockServerNow.mockReturnValue(1_000_500);
      act(() => {
        jest.advanceTimersByTime(2000);
      });
      expect(video.playbackRate).toBeCloseTo(1.014, 3);

      act(() => {
        jest.advanceTimersByTime(VIDEO_CUE_RATE_CORRECTION_MAX_DURATION_MS);
      });

      expect(video.currentTime).toBeCloseTo(5.5, 3);
      expect(video.playbackRate).toBe(1);
    } finally {
      jest.useRealTimers();
      restorePaused();
    }
  });

  it("hard seeks a surface with a genuinely large cue error", () => {
    jest.useFakeTimers();
    const play = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      writable: true,
      value: play,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get: () => 40,
    });
    const restorePaused = stubPaused(false);

    try {
      render(
        <HLSPlayer
          src="https://cdn.example.com/loop.mp4"
          playback={{
            mediaKey: "remote:video-1",
            positionSeconds: 5,
            paused: false,
            atServerMs: 1_000_000,
            generation: 1,
            applySeek: true,
          }}
        />,
      );

      const video = screen.getByTestId("hls-video-player") as HTMLVideoElement;
      fireEvent.loadedMetadata(video);
      video.playbackRate = 1.02;
      video.currentTime = 3;
      mockServerNow.mockReturnValue(1_000_500);
      act(() => {
        jest.advanceTimersByTime(2000);
      });

      expect(video.currentTime).toBeCloseTo(5.5, 3);
      expect(video.playbackRate).toBe(1);
    } finally {
      jest.useRealTimers();
      restorePaused();
    }
  });

  it("does not rate-correct paused cues", () => {
    jest.useFakeTimers();
    const pause = jest.fn();
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      writable: true,
      value: pause,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get: () => 40,
    });

    try {
      render(
        <HLSPlayer
          src="https://cdn.example.com/loop.mp4"
          playback={{
            mediaKey: "remote:video-1",
            positionSeconds: 5,
            paused: true,
            atServerMs: 1_000_000,
            generation: 1,
            applySeek: false,
          }}
        />,
      );

      const video = screen.getByTestId("hls-video-player") as HTMLVideoElement;
      fireEvent.loadedMetadata(video);
      expect(video.currentTime).toBe(5);
      video.currentTime = 2;
      act(() => {
        jest.advanceTimersByTime(2000);
      });

      expect(video.currentTime).toBe(2);
      expect(video.playbackRate).toBe(1);
      expect(pause).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("resets playback rate when the cue or source is replaced", () => {
    const { rerender, unmount } = render(
      <HLSPlayer
        src="https://cdn.example.com/video-a.mp4"
        playback={{
          mediaKey: "remote:video-1",
          positionSeconds: 5,
          paused: false,
          atServerMs: 1_000_000,
          generation: 1,
          applySeek: true,
        }}
      />,
    );
    const video = screen.getByTestId("hls-video-player") as HTMLVideoElement;
    fireEvent.loadedMetadata(video);

    video.playbackRate = 1.02;
    rerender(
      <HLSPlayer
        src="https://cdn.example.com/video-a.mp4"
        playback={undefined}
      />,
    );
    expect(video.playbackRate).toBe(1);

    video.playbackRate = 1.02;
    rerender(
      <HLSPlayer
        src="https://cdn.example.com/video-b.mp4"
        playback={undefined}
      />,
    );
    expect(video.playbackRate).toBe(1);

    video.playbackRate = 1.02;
    unmount();
    expect(video.playbackRate).toBe(1);
  });

  it("resets playback rate when a new playing cue generation is applied", () => {
    const { rerender } = render(
      <HLSPlayer
        src="https://cdn.example.com/video.mp4"
        playback={{
          mediaKey: "remote:video-1",
          positionSeconds: 5,
          paused: false,
          atServerMs: 1_000_000,
          generation: 1,
          applySeek: true,
        }}
      />,
    );
    const video = screen.getByTestId("hls-video-player") as HTMLVideoElement;
    fireEvent.loadedMetadata(video);

    video.playbackRate = 1.014;
    rerender(
      <HLSPlayer
        src="https://cdn.example.com/video.mp4"
        playback={{
          mediaKey: "remote:video-1",
          positionSeconds: 5,
          paused: false,
          atServerMs: 1_000_000,
          generation: 2,
          applySeek: false,
        }}
      />,
    );

    expect(video.playbackRate).toBe(1);
  });

  it("keeps a hidden preview element mounted and resumes its position", () => {
    const play = jest.fn().mockResolvedValue(undefined);
    const pause = jest.fn();
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      writable: true,
      value: play,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      writable: true,
      value: pause,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get: () => 40,
    });

    const { rerender } = render(
      <HLSPlayer src="https://cdn.example.com/video.mp4" suspendPlayback />,
    );
    const video = screen.getByTestId("hls-video-player") as HTMLVideoElement;
    fireEvent.loadedMetadata(video);
    video.currentTime = 17;

    rerender(
      <HLSPlayer
        src="https://cdn.example.com/video.mp4"
        suspendPlayback={false}
      />,
    );

    expect(screen.getByTestId("hls-video-player")).toBe(video);
    expect(video.currentTime).toBe(17);
    expect(pause).toHaveBeenCalled();
    expect(play).toHaveBeenCalled();
  });

  it("keeps explicit preview seek and restart exact and at 1x", () => {
    render(
      <HLSPlayer
        src="https://cdn.example.com/video.mp4"
        playbackRole="preview"
        transportRole="editor"
        mediaKey="remote:video-1"
      />,
    );
    const video = screen.getByTestId("hls-video-player") as HTMLVideoElement;
    video.playbackRate = 1.02;

    seekVideoPreview("remote:video-1", 17);
    expect(video.currentTime).toBe(17);
    expect(video.playbackRate).toBe(1);

    video.playbackRate = 1.02;
    restartVideoPreview("remote:video-1");
    expect(video.currentTime).toBe(0);
    expect(video.playbackRate).toBe(1);
  });

  it("keeps preview buffering/playback separate from editor transport commands", () => {
    render(
      <HLSPlayer
        src="https://cdn.example.com/output-preview.mp4"
        playbackRole="preview"
        mediaKey="remote:output-preview"
      />,
    );
    const video = screen.getByTestId("hls-video-player") as HTMLVideoElement;

    seekVideoPreview("remote:editor-selected", 17);

    expect(video.currentTime).toBe(0);
    expect(getVideoPreviewSnapshot("remote:output-preview").duration).toBe(0);
  });

  it("retries playback when the element stays paused under a playing cue", () => {
    jest.useFakeTimers();
    const play = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      writable: true,
      value: play,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get: () => 40,
    });
    // Stands in for a resume whose play() promise was rejected or stalled.
    const restorePaused = stubPaused(true);

    try {
      render(
        <HLSPlayer
          src="https://cdn.example.com/loop.mp4"
          playback={{
            mediaKey: "remote:video-1",
            positionSeconds: 5,
            paused: false,
            atServerMs: 1_000_000,
            generation: 1,
            applySeek: true,
          }}
        />,
      );

      fireEvent.loadedMetadata(screen.getByTestId("hls-video-player"));
      play.mockClear();

      act(() => {
        jest.advanceTimersByTime(2000);
      });

      expect(play).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
      restorePaused();
    }
  });

  it("keeps reporting the preview duration while a cue drives the surface", () => {
    Object.defineProperty(HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get: () => 40,
    });

    render(
      <HLSPlayer
        src="https://cdn.example.com/loop.mp4"
        playbackRole="preview"
        transportRole="editor"
        mediaKey="remote:video-1"
        playback={{
          mediaKey: "remote:video-1",
          positionSeconds: 12,
          paused: true,
          atServerMs: 1_000_000,
          generation: 2,
          applySeek: true,
        }}
      />,
    );

    fireEvent.loadedMetadata(screen.getByTestId("hls-video-player"));

    // Without this the transport scrubber loses its duration - and therefore
    // the ability to seek - the moment a slide goes live.
    expect(getVideoPreviewSnapshot("remote:video-1")).toMatchObject({
      mediaKey: "remote:video-1",
      duration: 40,
    });
  });
});
