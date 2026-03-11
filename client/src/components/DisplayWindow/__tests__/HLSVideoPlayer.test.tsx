import { fireEvent, render, screen } from "@testing-library/react";
import HLSPlayer from "../HLSVideoPlayer";

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

  beforeEach(() => {
    jest.clearAllMocks();
    mockInstances.length = 0;
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});

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
});
