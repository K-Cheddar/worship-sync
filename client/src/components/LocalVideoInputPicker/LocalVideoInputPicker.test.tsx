import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { isElectron } from "../../utils/environment";
import * as localVideoCapturePool from "../../utils/localVideoCapturePool";
import { bindLocalVideoInput } from "../../utils/localVideoInput";
import LocalVideoInputPicker from "./LocalVideoInputPicker";

const mockIsElectron = jest.mocked(isElectron);

const createDevice = (
  kind: MediaDeviceKind,
  deviceId: string,
  label: string,
): MediaDeviceInfo => ({
  deviceId,
  groupId: "group-1",
  kind,
  label,
  toJSON: () => ({}),
});

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe("LocalVideoInputPicker", () => {
  const enumerateDevices = jest.fn<Promise<MediaDeviceInfo[]>, []>();
  const getUserMedia = jest.fn<
    Promise<MediaStream>,
    [MediaStreamConstraints]
  >();
  const play = jest.fn<Promise<void>, []>();
  let deviceChangeListener: EventListener | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    play.mockReset();
    play.mockResolvedValue(undefined);
    mockIsElectron.mockReturnValue(false);
    deviceChangeListener = undefined;
    localStorage.clear();
    delete window.__ELECTRON__;
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: play,
    });
    getUserMedia.mockResolvedValue({
      getTracks: () => [{ stop: jest.fn() }],
    } as unknown as MediaStream);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices,
        getUserMedia,
        addEventListener: jest.fn((type: string, listener: EventListener) => {
          if (type === "devicechange") deviceChangeListener = listener;
        }),
        removeEventListener: jest.fn(
          (type: string, listener: EventListener) => {
            if (type === "devicechange" && deviceChangeListener === listener) {
              deviceChangeListener = undefined;
            }
          },
        ),
      },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete window.__ELECTRON__;
  });

  const markPreviewFrame = (video = screen.getByLabelText("Input preview")) => {
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 1280 },
      videoHeight: { configurable: true, value: 720 },
    });
    fireEvent.loadedData(video);
  };

  const openPicker = () => {
    render(<LocalVideoInputPicker onLinked={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add video input" }));
  };

  it("does not show browser permission or refresh controls in Electron", async () => {
    mockIsElectron.mockReturnValue(true);
    enumerateDevices.mockResolvedValue([
      createDevice("videoinput", "camera-1", "OBS Camera"),
    ]);

    openPicker();

    await waitFor(() => expect(enumerateDevices).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole("button", { name: "Allow input access" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Refresh" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
  });

  it("shows input access only for a browser whose device labels are hidden", async () => {
    enumerateDevices.mockResolvedValue([
      createDevice("videoinput", "camera-1", ""),
    ]);

    openPicker();

    expect(
      await screen.findByRole("button", { name: "Allow input access" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Refresh" }),
    ).not.toBeInTheDocument();
  });

  it("hides input access after the browser exposes labeled devices", async () => {
    enumerateDevices.mockResolvedValue([
      createDevice("videoinput", "camera-1", "USB Capture"),
    ]);

    openPicker();

    await waitFor(() => expect(enumerateDevices).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole("button", { name: "Allow input access" }),
    ).not.toBeInTheDocument();
  });

  it("configures a Media input with sound and frame fit", async () => {
    enumerateDevices.mockResolvedValue([
      createDevice("videoinput", "camera-1", "USB Capture"),
      createDevice("audioinput", "audio-1", "USB Audio"),
    ]);
    getUserMedia.mockResolvedValue({
      getTracks: () => [{ stop: jest.fn() }],
    } as unknown as MediaStream);

    openPicker();

    expect(
      await screen.findByRole("button", { name: "Add to Media" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("combobox")).toHaveLength(3);
    expect(await screen.findByLabelText("Input preview")).toBeInTheDocument();
  });

  it("previews the selected video input and stops it when the sheet closes", async () => {
    const stopTrack = jest.fn();
    enumerateDevices.mockResolvedValue([
      createDevice("videoinput", "camera-1", "USB Capture"),
    ]);
    getUserMedia.mockResolvedValue({
      getTracks: () => [{ stop: stopTrack }],
    } as unknown as MediaStream);

    openPicker();

    await screen.findByLabelText("Input preview");
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: {
        deviceId: { exact: "camera-1" },
        width: { ideal: 640 },
        height: { ideal: 360 },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(stopTrack).toHaveBeenCalled());
  });

  it("waits for a usable frame and restarts the same camera on refresh", async () => {
    const first = createDeferred<MediaStream>();
    const firstStop = jest.fn();
    const secondStop = jest.fn();
    enumerateDevices.mockResolvedValue([
      createDevice("videoinput", "camera-1", "USB Capture"),
    ]);
    getUserMedia.mockReturnValueOnce(first.promise).mockResolvedValueOnce({
      getTracks: () => [{ stop: secondStop }],
    } as unknown as MediaStream);

    openPicker();

    const video = await screen.findByLabelText("Input preview");
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 1280 },
      videoHeight: { configurable: true, value: 720 },
    });
    first.resolve({
      getTracks: () => [{ stop: firstStop }],
    } as unknown as MediaStream);
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/Starting preview/)).toBeInTheDocument();
    expect(video).toHaveClass("opacity-0");

    fireEvent.loadedData(video);
    await waitFor(() =>
      expect(screen.queryByText(/Starting preview/)).not.toBeInTheDocument(),
    );
    expect(video).toHaveClass("opacity-100");

    Object.defineProperty(video, "videoWidth", {
      configurable: true,
      value: 0,
    });
    Object.defineProperty(video, "videoHeight", {
      configurable: true,
      value: 0,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh video inputs" }),
    );

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    expect(firstStop).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Starting preview/)).toBeInTheDocument();
    markPreviewFrame(video);
    await waitFor(() =>
      expect(screen.queryByText(/Starting preview/)).not.toBeInTheDocument(),
    );
  });

  it("shows playback errors and recovers after refresh", async () => {
    const firstStop = jest.fn();
    enumerateDevices.mockResolvedValue([
      createDevice("videoinput", "camera-1", "USB Capture"),
    ]);
    getUserMedia.mockResolvedValue({
      getTracks: () => [{ stop: firstStop }],
    } as unknown as MediaStream);
    play.mockRejectedValueOnce(new Error("autoplay failed"));

    openPicker();

    expect(
      await screen.findByText(
        "Camera preview could not start. Refresh the preview to try again.",
      ),
    ).toBeInTheDocument();
    expect(firstStop).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole("button", { name: "Refresh video inputs" }),
    );
    const video = await screen.findByLabelText("Input preview");
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    markPreviewFrame(video);
    await waitFor(() =>
      expect(screen.queryByText(/Starting preview/)).not.toBeInTheDocument(),
    );
    expect(video).toHaveClass("opacity-100");
  });

  it("joins a camera already owned by the WorshipSync capture host", async () => {
    mockIsElectron.mockReturnValue(true);
    window.__ELECTRON__ = true;
    enumerateDevices.mockResolvedValue([
      createDevice("videoinput", "camera-1", "USB Capture"),
    ]);
    bindLocalVideoInput(
      "live-source",
      "camera-1",
      "USB Capture",
      "audio-1",
      "USB Audio",
    );
    const stopTrack = jest.fn();
    const stream = {
      getTracks: () => [{ stop: stopTrack }],
      getVideoTracks: () => [{ stop: stopTrack }],
      getAudioTracks: () => [],
    } as unknown as MediaStream;
    const acquire = jest
      .spyOn(localVideoCapturePool, "acquireWarmLocalVideoCapture")
      .mockResolvedValue({ stream, audioError: undefined });
    const release = jest
      .spyOn(localVideoCapturePool, "releaseWarmLocalVideoCapture")
      .mockResolvedValue(undefined);
    const reset = jest.spyOn(
      localVideoCapturePool,
      "resetWarmLocalVideoCapture",
    );

    openPicker();

    const video = await screen.findByLabelText("Input preview");
    await waitFor(() => expect(acquire).toHaveBeenCalledTimes(1));
    const [previewSourceId, binding, publish, consumerId, options] =
      acquire.mock.calls[0];
    expect(previewSourceId).toMatch(/^picker-preview:/);
    expect(binding).toEqual(
      expect.objectContaining({
        sourceId: "live-source",
        deviceId: "camera-1",
      }),
    );
    expect(binding).not.toHaveProperty("audioDeviceId");
    expect(publish).toBe(false);
    expect(consumerId).toMatch(/^input-picker:/);
    expect(options).toEqual({ shared: true });
    expect(getUserMedia).not.toHaveBeenCalled();

    markPreviewFrame(video);
    await waitFor(() =>
      expect(screen.queryByText(/Starting preview/)).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    expect(release).toHaveBeenCalledWith(previewSourceId, consumerId);
    expect(reset).not.toHaveBeenCalled();
    expect(stopTrack).not.toHaveBeenCalled();
  });

  it("previews a newly selected Electron camera before it has a saved binding", async () => {
    mockIsElectron.mockReturnValue(true);
    window.__ELECTRON__ = true;
    enumerateDevices.mockResolvedValue([
      createDevice("videoinput", "new-camera", "New USB Camera"),
    ]);
    const acquire = jest.spyOn(
      localVideoCapturePool,
      "acquireWarmLocalVideoCapture",
    );

    openPicker();

    const video = await screen.findByLabelText("Input preview");
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: {
        deviceId: { exact: "new-camera" },
        width: { ideal: 640 },
        height: { ideal: 360 },
      },
    });
    expect(acquire).not.toHaveBeenCalled();
    markPreviewFrame(video);
    await waitFor(() =>
      expect(screen.queryByText(/Starting preview/)).not.toBeInTheDocument(),
    );
  });

  it("restores the camera preview when adding the input fails", async () => {
    const firstStop = jest.fn();
    enumerateDevices.mockResolvedValue([
      createDevice("videoinput", "camera-1", "USB Capture"),
    ]);
    getUserMedia
      .mockResolvedValueOnce({
        getTracks: () => [{ stop: firstStop }],
      } as unknown as MediaStream)
      .mockResolvedValue({
        getTracks: () => [{ stop: jest.fn() }],
      } as unknown as MediaStream);
    jest
      .spyOn(localVideoCapturePool, "acquireWarmLocalVideoCapture")
      .mockRejectedValue(new Error("capture setup failed"));

    openPicker();
    await screen.findByLabelText("Input preview");
    fireEvent.click(
      await screen.findByRole("button", { name: "Add to Media" }),
    );

    expect(
      await screen.findByRole("alert", {}, { timeout: 5_000 }),
    ).toHaveTextContent("Check the input connection and camera permission");
    expect(firstStop).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    const video = screen.getByLabelText("Input preview");
    markPreviewFrame(video);
    await waitFor(() =>
      expect(screen.queryByText(/Starting preview/)).not.toBeInTheDocument(),
    );
    expect(video).toHaveClass("opacity-100");
  });

  it("waits for an older device request before starting the newly selected camera", async () => {
    const first = createDeferred<MediaStream>();
    const second = createDeferred<MediaStream>();
    const firstStop = jest.fn();
    const secondStop = jest.fn();
    enumerateDevices
      .mockResolvedValueOnce([
        createDevice("videoinput", "camera-1", "First Camera"),
      ])
      .mockResolvedValueOnce([
        createDevice("videoinput", "camera-2", "Second Camera"),
      ]);
    getUserMedia
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    openPicker();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    await act(async () => {
      deviceChangeListener?.(new Event("devicechange"));
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Video input:" }),
      ).toHaveTextContent("Second Camera"),
    );
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    first.resolve({
      getTracks: () => [{ stop: firstStop }],
    } as unknown as MediaStream);
    await waitFor(() => expect(firstStop).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    expect(getUserMedia).toHaveBeenLastCalledWith({
      audio: false,
      video: {
        deviceId: { exact: "camera-2" },
        width: { ideal: 640 },
        height: { ideal: 360 },
      },
    });

    second.resolve({
      getTracks: () => [{ stop: secondStop }],
    } as unknown as MediaStream);
    const video = await screen.findByLabelText("Input preview");
    await waitFor(() => expect(play).toHaveBeenCalled());
    markPreviewFrame(video);
    await waitFor(() =>
      expect(screen.queryByText(/Starting preview/)).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(secondStop).toHaveBeenCalledTimes(1));
  });

  it("stops a late camera result when the picker closes during capture", async () => {
    const pending = createDeferred<MediaStream>();
    const stopTrack = jest.fn();
    enumerateDevices.mockResolvedValue([
      createDevice("videoinput", "camera-1", "USB Capture"),
    ]);
    getUserMedia.mockReturnValue(pending.promise);

    openPicker();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    pending.resolve({
      getTracks: () => [{ stop: stopTrack }],
    } as unknown as MediaStream);
    await waitFor(() => expect(stopTrack).toHaveBeenCalledTimes(1));
    expect(screen.queryByLabelText("Input preview")).not.toBeInTheDocument();
  });

  it("requests browser permission once and then refreshes the labeled devices", async () => {
    const stopPreview = jest.fn();
    const stopVideo = jest.fn();
    const stopAudio = jest.fn();
    enumerateDevices
      .mockResolvedValueOnce([createDevice("videoinput", "camera-1", "")])
      .mockResolvedValueOnce([
        createDevice("videoinput", "camera-1", "USB Capture"),
      ]);
    getUserMedia
      // Picker preview opens the selected device as soon as the sheet loads.
      .mockResolvedValueOnce({
        getTracks: () => [{ stop: stopPreview }],
      } as unknown as MediaStream)
      .mockResolvedValueOnce({
        getTracks: () => [{ stop: stopVideo }],
      } as unknown as MediaStream)
      .mockResolvedValueOnce({
        getTracks: () => [{ stop: stopAudio }],
      } as unknown as MediaStream)
      // Labeled refresh restarts the preview against the same device.
      .mockResolvedValue({
        getTracks: () => [{ stop: jest.fn() }],
      } as unknown as MediaStream);

    openPicker();
    await waitFor(() =>
      expect(getUserMedia).toHaveBeenCalledWith({
        audio: false,
        video: {
          deviceId: { exact: "camera-1" },
          width: { ideal: 640 },
          height: { ideal: 360 },
        },
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Allow input access" }),
    );

    await waitFor(() => expect(enumerateDevices).toHaveBeenCalledTimes(2));
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: true,
    });
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: true,
      video: false,
    });
    expect(stopVideo).toHaveBeenCalledTimes(1);
    expect(stopAudio).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "Allow input access" }),
    ).not.toBeInTheDocument();
  });

  it("automatically re-enumerates inputs when USB devices change", async () => {
    mockIsElectron.mockReturnValue(true);
    enumerateDevices
      .mockResolvedValueOnce([
        createDevice("videoinput", "camera-1", "First Camera"),
      ])
      .mockResolvedValueOnce([
        createDevice("videoinput", "camera-2", "Replacement Camera"),
      ]);

    openPicker();
    await waitFor(() => expect(enumerateDevices).toHaveBeenCalledTimes(1));

    await act(async () => {
      deviceChangeListener?.(new Event("devicechange"));
      await Promise.resolve();
    });

    await waitFor(() => expect(enumerateDevices).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole("button", { name: "Refresh" }),
    ).not.toBeInTheDocument();
  });

  it("refreshes hardware inputs when requested", async () => {
    enumerateDevices
      .mockResolvedValueOnce([
        createDevice("videoinput", "camera-1", "First Camera"),
      ])
      .mockResolvedValueOnce([
        createDevice("videoinput", "camera-2", "Replacement Camera"),
      ]);

    openPicker();
    await waitFor(() => expect(enumerateDevices).toHaveBeenCalledTimes(1));

    fireEvent.click(
      screen.getByRole("button", { name: "Refresh video inputs" }),
    );

    await waitFor(() => expect(enumerateDevices).toHaveBeenCalledTimes(2));
    expect(
      screen.getByRole("combobox", { name: "Video input:" }),
    ).toHaveTextContent("Replacement Camera");
  });

  describe("screen and window shares", () => {
    const getDesktopCaptureSources = jest.fn();
    const getDisplayMedia = jest.fn();

    const openDesktopPicker = (onLinked = jest.fn()) => {
      render(
        <LocalVideoInputPicker captureMode="desktop" onLinked={onLinked} />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Add screen or window" }),
      );
      return onLinked;
    };

    beforeEach(() => {
      localStorage.clear();
      enumerateDevices.mockResolvedValue([]);
      getDesktopCaptureSources.mockReset();
      getDisplayMedia.mockReset();
      delete (window as { electronAPI?: unknown }).electronAPI;
    });

    it("saves the chosen screen against its capture source on this computer", async () => {
      mockIsElectron.mockReturnValue(true);
      (
        window as unknown as {
          electronAPI: { getDesktopCaptureSources: unknown };
        }
      ).electronAPI = { getDesktopCaptureSources };
      getDesktopCaptureSources.mockResolvedValue([
        {
          id: "screen:0:0",
          name: "Screen 1",
          kind: "screen",
          thumbnailDataUrl: "data:image/png;base64,preview",
        },
      ]);
      getUserMedia.mockResolvedValue({
        getTracks: () => [],
        getVideoTracks: () => [
          { addEventListener: jest.fn(), stop: jest.fn() },
        ],
        getAudioTracks: () => [],
      } as unknown as MediaStream);
      const onLinked = openDesktopPicker();

      expect(
        await screen.findByRole("img", { name: "Preview of Screen 1" }),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Add to Media" }),
        ).toBeEnabled(),
      );
      fireEvent.click(screen.getByRole("button", { name: "Add to Media" }));

      await waitFor(() => expect(onLinked).toHaveBeenCalledTimes(1));
      expect(onLinked).toHaveBeenCalledWith(
        expect.objectContaining({ captureKind: "screen", label: "Screen 1" }),
      );
      expect(
        JSON.parse(
          localStorage.getItem("worshipsync_local_video_inputs") ?? "[]",
        ),
      ).toEqual([
        expect.objectContaining({
          deviceId: "screen:0:0",
          captureKind: "screen",
          displaySourceName: "Screen 1",
        }),
      ]);
    });

    it("cannot save before the browser share window returns a choice", async () => {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { enumerateDevices, getUserMedia, getDisplayMedia },
      });
      openDesktopPicker();

      expect(
        await screen.findByRole("button", { name: "Choose what to share" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Add to Media" }),
      ).toBeDisabled();
    });

    it("keeps a browser share running for the outputs after saving", async () => {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { enumerateDevices, getUserMedia, getDisplayMedia },
      });
      const stop = jest.fn();
      getDisplayMedia.mockResolvedValue({
        getTracks: () => [{ stop }],
        getVideoTracks: () => [
          {
            stop,
            readyState: "live",
            addEventListener: jest.fn(),
            label: "Lyrics - Notepad",
            getSettings: () => ({ displaySurface: "window" }),
          },
        ],
        getAudioTracks: () => [],
      } as unknown as MediaStream);
      const onLinked = openDesktopPicker();

      fireEvent.click(
        await screen.findByRole("button", { name: "Choose what to share" }),
      );
      await screen.findByRole("button", { name: "Choose a different share" });
      expect(screen.getByLabelText("Input preview")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Add to Media" }));

      await waitFor(() => expect(onLinked).toHaveBeenCalledTimes(1));
      expect(onLinked).toHaveBeenCalledWith(
        expect.objectContaining({
          captureKind: "window",
          label: "Lyrics - Notepad",
          audioEnabled: false,
        }),
      );
      expect(stop).not.toHaveBeenCalled();
    });
  });

  it("offers a retry when Electron cannot find a video input", async () => {
    mockIsElectron.mockReturnValue(true);
    enumerateDevices.mockResolvedValue([]);

    openPicker();

    const retry = await screen.findByRole("button", { name: "Try again" });
    fireEvent.click(retry);

    await waitFor(() => expect(enumerateDevices).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole("button", { name: "Allow input access" }),
    ).not.toBeInTheDocument();
  });
});
