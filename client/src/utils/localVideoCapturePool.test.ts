import {
  acquireWarmLocalVideoCapture,
  LocalVideoCaptureOwnedError,
  releaseWarmLocalVideoCapture,
  resetAllWarmLocalVideoCaptures,
  resetWarmLocalVideoCapture,
} from "./localVideoCapturePool";
import {
  keepBrowserDesktopShare,
  stopAllBrowserDesktopShares,
} from "./desktopCapture";

const videoStop = jest.fn();
const audioStop = jest.fn();
const videoTrack = {
  stop: videoStop,
  addEventListener: jest.fn(),
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
});
