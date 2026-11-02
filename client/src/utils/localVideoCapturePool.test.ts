import {
  acquireWarmLocalVideoCapture,
  acquireWarmLocalVideoCaptureWithBusyRetry,
  LocalVideoCaptureOwnedError,
  releaseWarmLocalVideoCapture,
  resetAllWarmLocalVideoCaptures,
  resetWarmLocalVideoCapture,
} from "./localVideoCapturePool";
import {
  keepBrowserDesktopShare,
  stopAllBrowserDesktopShares,
} from "./desktopCapture";
import {
  __getLocalVideoDiagnosticsForTests,
  __resetLocalVideoDiagnosticsForTests,
} from "./localVideoDiagnostics";
import * as captureQuality from "./localVideoCaptureQualityRelay";

const videoStop = jest.fn();
const audioStop = jest.fn();
const videoTrack = {
  stop: videoStop,
  addEventListener: jest.fn(),
  getSettings: jest.fn(() => ({ width: 1_280, height: 720, frameRate: 59.94 })),
};
const audioTrack = {
  stop: audioStop,
  addEventListener: jest.fn(),
};
const videoStream = {
  getTracks: jest.fn(() => [videoTrack]),
  getVideoTracks: jest.fn(() => [videoTrack]),
  getAudioTracks: jest.fn(() => []),
  addTrack: jest.fn(),
} as unknown as MediaStream;
const audioStream = {
  getTracks: jest.fn(() => [audioTrack]),
  getAudioTracks: jest.fn(() => [audioTrack]),
} as unknown as MediaStream;
const getUserMedia = jest.fn();

const binding = {
  sourceId: "source-1",
  deviceId: "capture-1",
  deviceLabel: "USB Capture",
  audioDeviceId: "audio-1",
  audioDeviceLabel: "USB Audio",
};

describe("localVideoCapturePool", () => {
  beforeEach(async () => {
    await resetAllWarmLocalVideoCaptures();
    jest.clearAllMocks();
    getUserMedia
      .mockResolvedValueOnce(videoStream)
      .mockResolvedValueOnce(audioStream);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    });
  });

  afterEach(async () => {
    await resetAllWarmLocalVideoCaptures();
    stopAllBrowserDesktopShares();
    localStorage.removeItem("worshipsync_local_video_debug");
    __resetLocalVideoDiagnosticsForTests();
    delete window.__ELECTRON__;
    window.location.hash = "";
    jest.restoreAllMocks();
  });

  it("waits for the host then pools shared Electron consumers without taking its lock", async () => {
    window.__ELECTRON__ = true;
    let hostReady!: () => void;
    jest.spyOn(captureQuality, "waitForLocalVideoCaptureHost").mockReturnValue(
      new Promise<void>((resolve) => { hostReady = resolve; }),
    );
    const request = jest.fn();
    Object.defineProperty(navigator, "locks", { configurable: true, value: { request } });
    const projector = acquireWarmLocalVideoCapture("source-1", binding, false, "projector", { shared: true });
    const controller = acquireWarmLocalVideoCapture("source-1", binding, false, "controller", { shared: true });
    const aux = acquireWarmLocalVideoCapture("source-1", binding, false, "aux", { shared: true });
    expect(getUserMedia).not.toHaveBeenCalled();
    hostReady();
    await Promise.all([projector, controller, aux]);
    expect(request).not.toHaveBeenCalled();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia).toHaveBeenNthCalledWith(1, expect.objectContaining({
      video: expect.objectContaining({ resizeMode: { exact: "none" } }),
    }));
    await releaseWarmLocalVideoCapture("source-1", "controller");
    await releaseWarmLocalVideoCapture("source-1", "aux");
    expect(videoStop).not.toHaveBeenCalled();
    await releaseWarmLocalVideoCapture("source-1", "projector");
    expect(videoStop).toHaveBeenCalledTimes(1);
  });

  it("does not open capture after a waiting shared consumer retires", async () => {
    window.__ELECTRON__ = true;
    let hostReady!: () => void;
    jest.spyOn(captureQuality, "waitForLocalVideoCaptureHost").mockReturnValue(
      new Promise<void>((resolve) => { hostReady = resolve; }),
    );
    const pending = acquireWarmLocalVideoCapture("source-1", binding, false, "preview", { shared: true });
    const rejected = pending.catch((error: unknown) => error);
    const release = releaseWarmLocalVideoCapture("source-1", "preview");
    hostReady();
    expect(await rejected).toEqual(new Error("Local capture consumer was released."));
    await release;
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("keeps the host exclusive even when shared capture is requested for a publisher", async () => {
    window.__ELECTRON__ = true;
    window.location.hash = "#/local-video-capture-host";
    const discover = jest.spyOn(captureQuality, "waitForLocalVideoCaptureHost");
    const request = jest.fn(async (_name, _options, callback) => callback(null));
    Object.defineProperty(navigator, "locks", { configurable: true, value: { request } });
    await expect(acquireWarmLocalVideoCapture("source-1", binding, true, "host", { shared: true }))
      .rejects.toBeInstanceOf(LocalVideoCaptureOwnedError);
    expect(discover).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("delegates Electron picker/transmit warming to the host without opening the device", async () => {
    window.__ELECTRON__ = true;
    const ready = jest.spyOn(captureQuality, "waitForLocalVideoCaptureHost").mockResolvedValue();
    await expect(acquireWarmLocalVideoCaptureWithBusyRetry("source-1", binding, true, "transmit"))
      .rejects.toBeInstanceOf(LocalVideoCaptureOwnedError);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("reuses one persistent capture for repeated consumers", async () => {
    const first = acquireWarmLocalVideoCapture("source-1", binding);
    const second = acquireWarmLocalVideoCapture("source-1", binding);

    await expect(first).resolves.toEqual({
      stream: videoStream,
      audioError: undefined,
    });
    await expect(second).resolves.toEqual({
      stream: videoStream,
      audioError: undefined,
    });
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia).toHaveBeenNthCalledWith(1, {
      audio: false,
      video: {
        deviceId: { exact: "capture-1" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 60 },
      },
    });
    expect(videoStream.addTrack).toHaveBeenCalledWith(audioTrack);
  });

  it("records the negotiated capture settings from the video track", async () => {
    localStorage.setItem("worshipsync_local_video_debug", "true");

    await acquireWarmLocalVideoCapture("source-1", binding);

    expect(
      __getLocalVideoDiagnosticsForTests().get("source-1")?.capture?.settings,
    ).toEqual({ width: 1_280, height: 720, frameRate: 59.94 });
  });

  it("deduplicates logical sources linked to the same physical input", async () => {
    await Promise.all([
      acquireWarmLocalVideoCapture("source-1", binding),
      acquireWarmLocalVideoCapture("source-2", {
        ...binding,
        sourceId: "source-2",
      }),
    ]);

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    await resetWarmLocalVideoCapture("source-1");
    expect(videoStop).not.toHaveBeenCalled();
    await resetWarmLocalVideoCapture("source-2");
    expect(videoStop).toHaveBeenCalledTimes(1);
  });

  it("stops the retained stream only when the source is reset", async () => {
    await acquireWarmLocalVideoCapture("source-1", binding);
    await resetWarmLocalVideoCapture("source-1");

    expect(videoStop).toHaveBeenCalledTimes(1);
  });

  it("keeps a shared source alive until its final consumer releases it", async () => {
    await acquireWarmLocalVideoCapture(
      "source-1",
      binding,
      true,
      "editor-view",
    );
    await acquireWarmLocalVideoCapture(
      "source-1",
      binding,
      true,
      "output-manager",
    );

    await releaseWarmLocalVideoCapture("source-1", "output-manager");
    expect(videoStop).not.toHaveBeenCalled();

    await releaseWarmLocalVideoCapture("source-1", "editor-view");
    expect(videoStop).toHaveBeenCalledTimes(1);
  });

  it("keeps video available when optional audio capture fails", async () => {
    const error = new DOMException("busy", "NotReadableError");
    getUserMedia.mockReset();
    getUserMedia
      .mockResolvedValueOnce(videoStream)
      .mockRejectedValueOnce(error);

    await expect(
      acquireWarmLocalVideoCapture("source-1", binding),
    ).resolves.toEqual({ stream: videoStream, audioError: error });
  });

  it("captures a screen share instead of opening a video device", async () => {
    const screenStop = jest.fn();
    const screenTrack = {
      stop: screenStop,
      readyState: "live",
      addEventListener: jest.fn(),
    };
    const screenStream = {
      getTracks: () => [screenTrack],
      getVideoTracks: () => [screenTrack],
      getAudioTracks: () => [],
    } as unknown as MediaStream;
    keepBrowserDesktopShare("screen-source", screenStream);
    const screenBinding = {
      sourceId: "screen-source",
      deviceId: "display:screen-source",
      deviceLabel: "Lyrics screen",
      captureKind: "screen" as const,
    };

    await expect(
      acquireWarmLocalVideoCapture("screen-source", screenBinding),
    ).resolves.toEqual({ stream: screenStream, audioError: undefined });
    expect(getUserMedia).not.toHaveBeenCalled();

    // Releasing a browser share parks it; a click would be needed to restart it.
    await releaseWarmLocalVideoCapture("screen-source", "legacy");
    expect(screenStop).not.toHaveBeenCalled();
    await expect(
      acquireWarmLocalVideoCapture("screen-source", screenBinding),
    ).resolves.toEqual({ stream: screenStream, audioError: undefined });
  });

  it("does not reopen hardware owned by another app window", async () => {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: jest.fn(
          async (
            _name: string,
            _options: unknown,
            callback: (lock: unknown | null) => Promise<void>,
          ) => callback(null),
        ),
      },
    });

    await expect(
      acquireWarmLocalVideoCapture("source-1", binding),
    ).rejects.toBeInstanceOf(LocalVideoCaptureOwnedError);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("reopens an Electron screen share even when another window holds the lock", async () => {
    (
      window as unknown as {
        electronAPI: { getDesktopCaptureSources: jest.Mock };
      }
    ).electronAPI = {
      getDesktopCaptureSources: jest
        .fn()
        .mockResolvedValue([{ id: "screen:0:0", name: "Screen 1" }]),
    };
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: jest.fn(
          async (
            _name: string,
            _options: unknown,
            callback: (lock: unknown | null) => Promise<void>,
          ) => callback(null),
        ),
      },
    });
    getUserMedia.mockReset();
    getUserMedia.mockResolvedValue(videoStream);
    const screenBinding = {
      sourceId: "screen-source",
      deviceId: "screen:0:0",
      deviceLabel: "Screen 1",
      captureKind: "screen" as const,
      displaySourceName: "Screen 1",
    };

    await expect(
      acquireWarmLocalVideoCapture("screen-source", screenBinding),
    ).resolves.toEqual({ stream: videoStream, audioError: undefined });
    expect(getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        video: {
          mandatory: expect.objectContaining({
            chromeMediaSource: "desktop",
            chromeMediaSourceId: "screen:0:0",
          }),
        },
      }),
    );

    delete (window as { electronAPI?: unknown }).electronAPI;
  });

  it("retries briefly when the OS reports the device busy", async () => {
    jest.useFakeTimers();
    getUserMedia.mockReset();
    getUserMedia
      .mockRejectedValueOnce(new DOMException("busy", "NotReadableError"))
      .mockResolvedValueOnce(videoStream)
      .mockResolvedValueOnce(audioStream);

    const pending = acquireWarmLocalVideoCaptureWithBusyRetry(
      "source-1",
      binding,
      false,
      "retry-consumer",
    );
    await jest.advanceTimersByTimeAsync(250);
    await expect(pending).resolves.toEqual({
      stream: videoStream,
      audioError: undefined,
    });
    expect(getUserMedia).toHaveBeenCalledTimes(3);
    jest.useRealTimers();
  });
});
