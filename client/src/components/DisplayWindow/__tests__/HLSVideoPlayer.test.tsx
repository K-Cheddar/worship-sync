import { act, fireEvent, render, screen } from "@testing-library/react";
import HLSPlayer from "../HLSVideoPlayer";
import { serverNow } from "../../../utils/serverTime";
import {
  getVideoPreviewSnapshot,
  resetVideoBackgroundPlaybackForTests,
} from "../../../utils/videoBackgroundPlayback";

jest.mock("../../../utils/serverTime", () => ({
  serverNow: jest.fn(() => 1_000_000),
  serverDate: jest.fn(() => new Date(1_000_000)),
  setServerTimeOffset: jest.fn(),
}));

const mockServerNow = serverNow as jest.Mock;

const mockIsSupported = jest.fn(() => false);
const mockInstances: any[] = [];

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

describe("HLSVideoPlayer", () => {
  const originalPlay = HTMLMediaElement.prototype.play;
  const originalLoad = HTMLMediaElement.prototype.load;
  const originalCanPlayType = HTMLMediaElement.prototype.canPlayType;
  const originalPausedDescriptor = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    "paused",
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
    jest.spyOn(console, "error").mockImplementation(() => { });
    jest.spyOn(console, "warn").mockImplementation(() => { });
    jest.spyOn(console, "log").mockImplementation(() => { });

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
  });

  it("uses native playback for non-HLS src and falls back from cached media URL on error", () => {
    render(
      <HLSPlayer
        src="media-cache://video.mp4"
        originalSrc="https://cdn.example.com/video.mp4"
      />,
    );

    const video = screen.getByTestId("hls-video-player");
    fireEvent.error(video);

    expect(console.log).toHaveBeenCalledWith(
      "[HLSPlayer] Falling back to original URL: https://cdn.example.com/video.mp4",
    );
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(2);
  });

  it("starts native mp4 playback on metadata load and restarts when the video ends", () => {
    render(<HLSPlayer src="https://cdn.example.com/video.mp4" />);

    const video = screen.getByTestId("hls-video-player");
    fireEvent.loadedMetadata(video);
    fireEvent.ended(video);

    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
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
    (HTMLMediaElement.prototype.canPlayType as jest.Mock).mockReturnValue("probably");

    render(<HLSPlayer src="https://stream.example.com/live.m3u8" />);
    const video = screen.getByTestId("hls-video-player");

    fireEvent.loadedMetadata(video);
    fireEvent.ended(video);

    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
  });

  it("sets preload to auto for media-cache sources", () => {
    render(<HLSPlayer src="media-cache://clip.mp4" />);
    const video = screen.getByTestId("hls-video-player");
    expect(video.getAttribute("preload")).toBe("auto");
  });

  it("forwards loaded-data and error callbacks to the video element", () => {
    const onLoadedData = jest.fn();
    const onError = jest.fn();

    render(
      <HLSPlayer
        src="https://cdn.example.com/video.mp4"
        onLoadedData={onLoadedData}
        onError={onError}
      />,
    );

    const video = screen.getByTestId("hls-video-player");
    fireEvent.loadedData(video);
    fireEvent.error(video);

    expect(onLoadedData).toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
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

  /**
   * The cached-URL swap and the media-cache fallback both reload the element
   * mid-flight. A resume cue carries applySeek: false so lyric advances do not
   * restart the clip, but a freshly loaded element sits at 0 and has to catch
   * up or the video silently rewinds to the beginning.
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

  it("re-seeks a surface that has drifted away from the cue clock", () => {
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

      // The element stalls two seconds behind the shared timeline.
      video.currentTime = 5;
      mockServerNow.mockReturnValue(1_002_000);
      act(() => {
        jest.advanceTimersByTime(2000);
      });

      expect(video.currentTime).toBeCloseTo(7, 3);
    } finally {
      jest.useRealTimers();
      restorePaused();
    }
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
    expect(getVideoPreviewSnapshot()).toMatchObject({
      mediaKey: "remote:video-1",
      duration: 40,
    });
  });
});
