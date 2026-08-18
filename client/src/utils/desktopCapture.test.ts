import {
  DesktopCaptureShareEndedError,
  hasBrowserDesktopShare,
  keepBrowserDesktopShare,
  listDesktopCaptureSources,
  openDesktopCapture,
  releaseDesktopCapture,
  requestBrowserDesktopCapture,
  stopAllBrowserDesktopShares,
  supportsDesktopSourceList,
} from "./desktopCapture";
import { resolveLocalVideoInputBinding } from "./localVideoInput";

const createStream = (overrides?: {
  videoReadyState?: MediaStreamTrack["readyState"];
  audioTracks?: number;
}) => {
  const stop = jest.fn();
  const videoTrack = {
    stop,
    readyState: overrides?.videoReadyState ?? "live",
    addEventListener: jest.fn(),
    getSettings: () => ({ displaySurface: "monitor" }),
    label: "Screen 1",
  } as unknown as MediaStreamTrack;
  const audioTracks = Array.from(
    { length: overrides?.audioTracks ?? 0 },
    () => ({ stop, readyState: "live" }) as unknown as MediaStreamTrack,
  );
  return {
    stop,
    stream: {
      getTracks: () => [videoTrack, ...audioTracks],
      getVideoTracks: () => [videoTrack],
      getAudioTracks: () => audioTracks,
    } as unknown as MediaStream,
  };
};

const getUserMedia = jest.fn();
const getDisplayMedia = jest.fn();
const getDesktopCaptureSources = jest.fn();

const screenBinding = {
  sourceId: "source-1",
  deviceId: "screen:0:0",
  deviceLabel: "Screen 1",
  captureKind: "screen" as const,
  displaySourceName: "Screen 1",
};

describe("desktopCapture", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stopAllBrowserDesktopShares();
    localStorage.clear();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia, getDisplayMedia },
    });
    delete (window as { electronAPI?: unknown }).electronAPI;
  });

  const useElectron = () => {
    (
      window as unknown as { electronAPI: { getDesktopCaptureSources: unknown } }
    ).electronAPI = { getDesktopCaptureSources };
  };

  describe("in the desktop app", () => {
    it("reopens a saved screen silently with its capture source id", async () => {
      useElectron();
      getDesktopCaptureSources.mockResolvedValue([
        { id: "screen:0:0", name: "Screen 1" },
      ]);
      const { stream } = createStream();
      getUserMedia.mockResolvedValue(stream);

      await expect(openDesktopCapture(screenBinding)).resolves.toEqual({
        stream,
      });
      expect(supportsDesktopSourceList()).toBe(true);
      expect(getUserMedia).toHaveBeenCalledWith({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: "screen:0:0",
            maxWidth: 1920,
            maxHeight: 1080,
            maxFrameRate: 30,
          },
        },
      });
    });

    it("finds a reopened window by name and saves its new capture id", async () => {
      useElectron();
      const windowBinding = {
        ...screenBinding,
        deviceId: "window:11:0",
        deviceLabel: "Lyrics - Notepad",
        captureKind: "window" as const,
        displaySourceName: "Lyrics - Notepad",
      };
      localStorage.setItem(
        "worshipsync_local_video_inputs",
        JSON.stringify([windowBinding]),
      );
      getDesktopCaptureSources.mockResolvedValue([
        { id: "window:99:0", name: "Lyrics - Notepad" },
      ]);
      const { stream } = createStream();
      getUserMedia.mockResolvedValue(stream);

      await openDesktopCapture(windowBinding);

      expect(getUserMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          video: {
            mandatory: expect.objectContaining({
              chromeMediaSourceId: "window:99:0",
            }),
          },
        }),
      );
      expect(resolveLocalVideoInputBinding("source-1")).toEqual(
        expect.objectContaining({
          deviceId: "window:99:0",
          captureKind: "window",
          displaySourceName: "Lyrics - Notepad",
        }),
      );
    });

    it("reports a closed window instead of capturing something else", async () => {
      useElectron();
      getDesktopCaptureSources.mockResolvedValue([
        { id: "window:12:0", name: "Another app" },
      ]);

      await expect(
        openDesktopCapture({
          ...screenBinding,
          deviceId: "window:11:0",
          captureKind: "window",
          displaySourceName: "Lyrics - Notepad",
        }),
      ).rejects.toMatchObject({ name: "DesktopCaptureSourceMissingError" });
      expect(getUserMedia).not.toHaveBeenCalled();
    });

    it("keeps the picture when this computer's sound cannot be captured", async () => {
      useElectron();
      getDesktopCaptureSources.mockResolvedValue([
        { id: "screen:0:0", name: "Screen 1" },
      ]);
      const { stream } = createStream();
      const audioFailure = new Error("no loopback audio");
      getUserMedia
        .mockRejectedValueOnce(audioFailure)
        .mockResolvedValueOnce(stream);

      await expect(
        openDesktopCapture({ ...screenBinding, systemAudio: true }),
      ).resolves.toEqual({ stream, systemAudioError: audioFailure });
      expect(getUserMedia).toHaveBeenCalledTimes(2);
    });

    it("closes a desktop capture on release rather than parking it", async () => {
      useElectron();
      const { stream, stop } = createStream();

      releaseDesktopCapture(screenBinding, stream);

      expect(stop).toHaveBeenCalled();
      expect(hasBrowserDesktopShare("source-1")).toBe(false);
    });
  });

  describe("in a browser", () => {
    it("reuses the share captured when the operator chose it", async () => {
      const { stream } = createStream();
      getDisplayMedia.mockResolvedValue(stream);

      const share = await requestBrowserDesktopCapture();
      expect(share).toEqual({
        stream,
        captureKind: "screen",
        name: "Screen 1",
      });
      keepBrowserDesktopShare("source-1", stream);

      await expect(openDesktopCapture(screenBinding)).resolves.toEqual({
        stream,
      });
      expect(getUserMedia).not.toHaveBeenCalled();
    });

    it("parks a live share on release so the next slide needs no click", async () => {
      const { stream, stop } = createStream();
      keepBrowserDesktopShare("source-1", stream);

      const opened = await openDesktopCapture(screenBinding);
      releaseDesktopCapture(screenBinding, opened.stream);

      expect(stop).not.toHaveBeenCalled();
      await expect(openDesktopCapture(screenBinding)).resolves.toEqual({
        stream,
      });
    });

    it("asks for a new share once the operator stops sharing", async () => {
      const { stream } = createStream({ videoReadyState: "ended" });
      keepBrowserDesktopShare("source-1", stream);

      await expect(openDesktopCapture(screenBinding)).rejects.toBeInstanceOf(
        DesktopCaptureShareEndedError,
      );
      expect(hasBrowserDesktopShare("source-1")).toBe(false);
    });

    it("stops the previous share when the same source is shared again", () => {
      const first = createStream();
      const second = createStream();
      keepBrowserDesktopShare("source-1", first.stream);

      keepBrowserDesktopShare("source-1", second.stream);

      expect(first.stop).toHaveBeenCalled();
      expect(second.stop).not.toHaveBeenCalled();
    });

    it("has no in-app source list to offer", async () => {
      await expect(listDesktopCaptureSources()).resolves.toEqual([]);
      expect(supportsDesktopSourceList()).toBe(false);
    });
  });
});
