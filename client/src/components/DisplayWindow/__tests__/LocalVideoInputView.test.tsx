import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import LocalVideoInputView from "../LocalVideoInputView";
import { getOrCreateDeviceId } from "../../../utils/authStorage";
import { resolveLocalVideoInputBinding } from "../../../utils/localVideoInput";
import {
  acquireWarmLocalVideoCapture,
  releaseWarmLocalVideoCapture,
} from "../../../utils/localVideoCapturePool";
import { subscribeLocalVideoMedia } from "../../../utils/localVideoMediaRelay";
import { subscribeLocalVideoPreview } from "../../../utils/localVideoPreviewRelay";
import {
  subscribeLocalVideoRealtime,
  supportsLocalVideoRealtimeRelay,
} from "../../../utils/localVideoRealtimeRelay";
import { subscribeLocalVideoCaptureQuality } from "../../../utils/localVideoCaptureQualityRelay";
import { supportsDirectElectronDesktopCapture } from "../../../utils/desktopCapture";
import { applyLocalVideoCaptureProfile } from "../../../utils/localVideoQuality";
import {
  __getLocalVideoDiagnosticsForTests,
  __resetLocalVideoDiagnosticsForTests,
  recordLocalVideoDecoder,
} from "../../../utils/localVideoDiagnostics";

jest.mock("../../../utils/authStorage", () => ({
  getOrCreateDeviceId: jest.fn(() => "local-device"),
}));
jest.mock("../../../utils/localVideoInput", () => ({
  getAudioInputErrorMessage: jest.requireActual(
    "../../../utils/localVideoInput",
  ).getAudioInputErrorMessage,
  getLocalVideoSourceErrorMessage: jest.requireActual(
    "../../../utils/localVideoInput",
  ).getLocalVideoSourceErrorMessage,
  isDesktopCaptureKind: jest.requireActual("../../../utils/localVideoInput")
    .isDesktopCaptureKind,
  isLocalVideoDeviceBusyError: jest.requireActual(
    "../../../utils/localVideoInput",
  ).isLocalVideoDeviceBusyError,
  resolveLocalVideoInputBinding: jest.fn(),
}));
jest.mock("../../../utils/localVideoCapturePool", () => ({
  acquireWarmLocalVideoCapture: jest.fn(),
  releaseWarmLocalVideoCapture: jest.fn(),
  LocalVideoCaptureOwnedError: jest.requireActual(
    "../../../utils/localVideoCapturePool",
  ).LocalVideoCaptureOwnedError,
}));
jest.mock("../../../utils/localVideoMediaRelay", () => ({
  subscribeLocalVideoMedia: jest.fn(() => jest.fn()),
}));
jest.mock("../../../utils/localVideoPreviewRelay", () => ({
  subscribeLocalVideoPreview: jest.fn(() => jest.fn()),
}));
jest.mock("../../../utils/localVideoRealtimeRelay", () => ({
  supportsLocalVideoRealtimeRelay: jest.fn(() => false),
  subscribeLocalVideoRealtime: jest.fn(() => ({
    stop: jest.fn(),
    setVolume: jest.fn(),
    setAudioEnabled: jest.fn(),
  })),
}));
jest.mock("../../../utils/localVideoCaptureQualityRelay", () => ({
  subscribeLocalVideoCaptureQuality: jest.fn(() => ({
    stop: jest.fn(),
    updateTargetSize: jest.fn(),
  })),
}));
jest.mock("../../../utils/desktopCapture", () => ({
  subscribeBrowserDesktopShares: jest.fn(() => jest.fn()),
  supportsDirectElectronDesktopCapture: jest.fn(() => false),
}));
jest.mock("../../../utils/localVideoQuality", () => ({
  applyLocalVideoCaptureProfile: jest.fn(() => Promise.resolve()),
}));

const mockGetOrCreateDeviceId = jest.mocked(getOrCreateDeviceId);
const mockResolveBinding = jest.mocked(resolveLocalVideoInputBinding);
const mockAcquireWarmCapture = jest.mocked(acquireWarmLocalVideoCapture);
const mockReleaseWarmCapture = jest.mocked(releaseWarmLocalVideoCapture);
const mockSubscribeMedia = jest.mocked(subscribeLocalVideoMedia);
const mockSubscribePreview = jest.mocked(subscribeLocalVideoPreview);
const mockSupportsRealtime = jest.mocked(supportsLocalVideoRealtimeRelay);
const mockSubscribeRealtime = jest.mocked(subscribeLocalVideoRealtime);
const mockSubscribeCaptureQuality = jest.mocked(
  subscribeLocalVideoCaptureQuality,
);
const mockSupportsDirectElectronDesktop = jest.mocked(
  supportsDirectElectronDesktopCapture,
);
const mockApplyLocalVideoCaptureProfile = jest.mocked(
  applyLocalVideoCaptureProfile,
);
const stop = jest.fn();
let endedHandler: (() => void) | undefined;
const track = {
  stop,
  addEventListener: jest.fn((event: string, listener: () => void) => {
    if (event === "ended") endedHandler = listener;
  }),
  removeEventListener: jest.fn(),
};
const stream = {
  getTracks: () => [track],
  getVideoTracks: () => [track],
  getAudioTracks: () => [],
} as unknown as MediaStream;

const input = {
  sourceId: "source-1",
  deviceLabel: "USB Capture",
  ownerDeviceId: "local-device",
  ownerLabel: "Electron on Windows",
};

describe("LocalVideoInputView", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    endedHandler = undefined;
    mockGetOrCreateDeviceId.mockReturnValue("local-device");
    mockResolveBinding.mockReturnValue({
      sourceId: "source-1",
      deviceId: "capture-card-1",
      deviceLabel: "USB Capture",
    });
    mockAcquireWarmCapture.mockResolvedValue({ stream });
    mockReleaseWarmCapture.mockResolvedValue();
    mockSupportsRealtime.mockReturnValue(false);
    mockSupportsDirectElectronDesktop.mockReturnValue(false);
    mockApplyLocalVideoCaptureProfile.mockResolvedValue(undefined);
    Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
      configurable: true,
      writable: true,
      value: null,
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: jest.fn(() => "blob:local-preview-frame"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: jest.fn(),
    });
  });

  afterEach(() => {
    __resetLocalVideoDiagnosticsForTests();
    localStorage.removeItem("worshipsync_local_video_debug");
  });

  it("attaches the warm capture and releases its view lease on unmount", async () => {
    const view = render(<LocalVideoInputView input={input} publishPreview />);
    const video = screen.getByLabelText("USB Capture") as HTMLVideoElement;

    await waitFor(() => expect(video.srcObject).toBe(stream));
    expect(mockAcquireWarmCapture).toHaveBeenCalledWith(
      "source-1",
      expect.objectContaining({ deviceId: "capture-card-1" }),
      true,
      expect.any(String),
    );

    view.unmount();
    expect(mockReleaseWarmCapture).toHaveBeenCalledWith(
      "source-1",
      expect.any(String),
    );
    expect(stop).not.toHaveBeenCalled();
  });

  it("starts direct capture playback without reopening the USB input", async () => {
    const play = jest
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);
    const view = render(<LocalVideoInputView input={input} />);
    const video = screen.getByLabelText("USB Capture") as HTMLVideoElement;

    await waitFor(() => expect(video.srcObject).toBe(stream));
    expect(play).toHaveBeenCalledTimes(1);
    expect(mockAcquireWarmCapture).toHaveBeenCalledTimes(1);

    view.unmount();
    play.mockRestore();
  });

  it("uses hardware recovery copy when the video element reports an error", async () => {
    render(<LocalVideoInputView input={input} />);
    const video = screen.getByLabelText("USB Capture") as HTMLVideoElement;

    await waitFor(() => expect(video.srcObject).toBe(stream));
    fireEvent.error(video);

    expect(
      screen.getByText(
        "Check the input connection and camera permission, then try again.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Choose the screen again on this computer, then try again.",
      ),
    ).not.toBeInTheDocument();
  });

  it("shows no connecting chrome while the warm stream attaches", () => {
    mockAcquireWarmCapture.mockReturnValue(new Promise(() => undefined));
    render(<LocalVideoInputView input={input} />);

    expect(screen.queryByText(/Connecting/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Starting local preview/i),
    ).not.toBeInTheDocument();
  });

  it("falls back to the local relay when the device is busy", async () => {
    mockAcquireWarmCapture.mockRejectedValue(
      new DOMException("busy", "NotReadableError"),
    );
    render(<LocalVideoInputView input={input} />);

    await waitFor(() =>
      expect(mockSubscribeMedia).toHaveBeenCalledWith(
        "source-1",
        expect.any(HTMLVideoElement),
        expect.any(Object),
      ),
    );
    expect(
      screen.queryByText("Close other apps using this input, then try again."),
    ).not.toBeInTheDocument();
  });

  it("plays linked sound only when requested", async () => {
    mockResolveBinding.mockReturnValue({
      sourceId: "source-1",
      deviceId: "capture-card-1",
      deviceLabel: "USB Capture",
      audioDeviceId: "capture-audio-1",
      audioDeviceLabel: "USB Capture Audio",
    });
    render(<LocalVideoInputView input={input} playAudio />);

    await waitFor(() => expect(mockAcquireWarmCapture).toHaveBeenCalled());
    expect(screen.getByLabelText("USB Capture")).toHaveProperty("muted", false);
  });

  it("applies the configured screen volume", () => {
    render(
      <LocalVideoInputView
        input={input}
        captureEnabled={false}
        receiveHighQuality
        playAudio
        volume={0.35}
      />,
    );

    const video = screen.getByLabelText("USB Capture") as HTMLVideoElement;
    fireEvent.loadedData(video);
    expect(video.volume).toBe(0.35);
  });

  it("keeps video live when linked sound is unavailable", async () => {
    mockResolveBinding.mockReturnValue({
      sourceId: "source-1",
      deviceId: "capture-card-1",
      deviceLabel: "USB Capture",
      audioDeviceId: "capture-audio-1",
      audioDeviceLabel: "USB Capture Audio",
    });
    mockAcquireWarmCapture.mockResolvedValue({
      stream,
      audioError: new DOMException("busy", "NotReadableError"),
    });
    render(<LocalVideoInputView input={input} playAudio />);

    expect(
      await screen.findByText(/Video will continue without sound/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Video input unavailable"),
    ).not.toBeInTheDocument();
  });

  it("uses the local relay as a silent fallback without opening capture", () => {
    render(<LocalVideoInputView input={input} captureEnabled={false} />);

    expect(mockSubscribePreview).toHaveBeenCalledWith(
      "source-1",
      expect.any(Function),
    );
    expect(mockAcquireWarmCapture).not.toHaveBeenCalled();
    expect(
      screen.queryByText(/Starting local preview/i),
    ).not.toBeInTheDocument();
  });

  it("uses the high-quality broker feed on an audience output", () => {
    render(
      <LocalVideoInputView
        input={input}
        captureEnabled={false}
        receiveHighQuality
        playAudio
      />,
    );

    const video = screen.getByLabelText("USB Capture") as HTMLVideoElement;
    expect(mockSubscribeMedia).toHaveBeenCalledWith(
      "source-1",
      video,
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    expect(mockAcquireWarmCapture).not.toHaveBeenCalled();
    expect(video.muted).toBe(false);
  });

  it("opens an Electron screen share directly on audience outputs", async () => {
    mockSupportsDirectElectronDesktop.mockReturnValue(true);
    mockSupportsRealtime.mockReturnValue(true);
    mockResolveBinding.mockReturnValue({
      sourceId: "source-1",
      deviceId: "screen:0:0",
      deviceLabel: "Lyrics screen",
      captureKind: "screen",
      displaySourceName: "Lyrics screen",
    });
    const play = jest
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);

    render(
      <LocalVideoInputView
        input={{
          ...input,
          captureKind: "screen",
          deviceLabel: "Lyrics screen",
        }}
        captureEnabled={false}
        receiveHighQuality
        playAudio
      />,
    );

    const video = screen.getByLabelText("Lyrics screen") as HTMLVideoElement;
    await waitFor(() => expect(video.srcObject).toBe(stream));
    expect(mockAcquireWarmCapture).toHaveBeenCalledWith(
      "source-1",
      expect.objectContaining({ captureKind: "screen" }),
      false,
      expect.any(String),
    );
    expect(mockSubscribeRealtime).not.toHaveBeenCalled();
    expect(mockSubscribeMedia).not.toHaveBeenCalled();
    expect(mockApplyLocalVideoCaptureProfile).toHaveBeenCalledWith(
      stream,
      expect.any(Number),
      expect.any(Number),
      "source-1",
    );
    expect(video.muted).toBe(false);
    play.mockRestore();
  });

  it("keeps cameras on the realtime relay when Electron screen direct-capture is available", () => {
    mockSupportsDirectElectronDesktop.mockReturnValue(true);
    mockSupportsRealtime.mockReturnValue(true);

    render(
      <LocalVideoInputView
        input={input}
        captureEnabled={false}
        receiveHighQuality
      />,
    );

    expect(mockSubscribeRealtime).toHaveBeenCalled();
    expect(mockAcquireWarmCapture).not.toHaveBeenCalled();
  });

  it("prefers a direct capture attach over the realtime relay in the owning window", async () => {
    mockSupportsRealtime.mockReturnValue(true);
    const play = jest
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);

    render(
      <LocalVideoInputView
        input={input}
        captureEnabled
        receiveHighQuality
        publishPreview
      />,
    );

    const video = screen.getByLabelText("USB Capture") as HTMLVideoElement;
    await waitFor(() => expect(video.srcObject).toBe(stream));
    expect(mockAcquireWarmCapture).toHaveBeenCalled();
    expect(mockSubscribeRealtime).not.toHaveBeenCalled();
    expect(mockSubscribeMedia).not.toHaveBeenCalled();
    play.mockRestore();
  });

  it("falls back to the realtime relay when another window owns the camera", async () => {
    mockSupportsRealtime.mockReturnValue(true);
    const { LocalVideoCaptureOwnedError } = jest.requireActual(
      "../../../utils/localVideoCapturePool",
    ) as typeof import("../../../utils/localVideoCapturePool");
    mockAcquireWarmCapture.mockRejectedValue(new LocalVideoCaptureOwnedError());

    render(
      <LocalVideoInputView
        input={input}
        captureEnabled
        receiveHighQuality
      />,
    );

    await waitFor(() => expect(mockSubscribeRealtime).toHaveBeenCalled());
    expect(mockSubscribeMedia).not.toHaveBeenCalled();
  });

  it("uses Electron's realtime relay instead of the buffered relay", () => {
    mockSupportsRealtime.mockReturnValue(true);
    let onStarted: (() => void) | undefined;
    mockSubscribeRealtime.mockImplementation((_sourceId, _canvas, options) => {
      onStarted = options?.onStarted;
      return {
        stop: jest.fn(),
        setVolume: jest.fn(),
        setAudioEnabled: jest.fn(),
      };
    });

    render(
      <LocalVideoInputView
        input={input}
        captureEnabled={false}
        receiveHighQuality
        playAudio
        volume={0.4}
      />,
    );

    expect(mockSubscribeRealtime).toHaveBeenCalledWith(
      "source-1",
      screen.getByLabelText("USB Capture realtime video"),
      expect.objectContaining({ includeAudio: true, volume: 0.4 }),
    );
    expect(mockSubscribeMedia).not.toHaveBeenCalled();
    expect(mockSubscribeCaptureQuality).toHaveBeenCalledWith(
      "source-1",
      expect.any(Number),
      expect.any(Number),
    );

    act(() => onStarted?.());
    expect(screen.getByLabelText("USB Capture realtime video")).toHaveClass(
      "opacity-100",
    );
  });

  it("mutes realtime audio without rebuilding the video subscription", () => {
    mockSupportsRealtime.mockReturnValue(true);
    const setAudioEnabled = jest.fn();
    mockSubscribeRealtime.mockReturnValue({
      stop: jest.fn(),
      setVolume: jest.fn(),
      setAudioEnabled,
    });
    const view = render(
      <LocalVideoInputView
        input={input}
        captureEnabled={false}
        receiveHighQuality
        playAudio
      />,
    );

    expect(mockSubscribeRealtime).toHaveBeenCalledTimes(1);
    view.rerender(
      <LocalVideoInputView
        input={input}
        captureEnabled={false}
        receiveHighQuality
        playAudio={false}
      />,
    );

    expect(mockSubscribeRealtime).toHaveBeenCalledTimes(1);
    expect(setAudioEnabled).toHaveBeenCalledWith(false);
  });

  it("falls back to the buffered relay if realtime setup fails", () => {
    mockSupportsRealtime.mockReturnValue(true);
    let onFallback: (() => void) | undefined;
    mockSubscribeRealtime.mockImplementation((_sourceId, _canvas, options) => {
      onFallback = options?.onFallback;
      return {
        stop: jest.fn(),
        setVolume: jest.fn(),
        setAudioEnabled: jest.fn(),
      };
    });

    render(
      <LocalVideoInputView
        input={input}
        captureEnabled={false}
        receiveHighQuality
      />,
    );

    act(() => onFallback?.());
    expect(mockSubscribeMedia).toHaveBeenCalledWith(
      "source-1",
      screen.getByLabelText("USB Capture"),
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it("preserves realtime diagnostics when switching to the buffered relay", () => {
    localStorage.setItem("worshipsync_local_video_debug", "true");
    mockSupportsRealtime.mockReturnValue(true);
    let onFallback: (() => void) | undefined;
    mockSubscribeRealtime.mockImplementation((_sourceId, _canvas, options) => {
      onFallback = options?.onFallback;
      return {
        stop: jest.fn(),
        setVolume: jest.fn(),
        setAudioEnabled: jest.fn(),
      };
    });

    render(
      <LocalVideoInputView
        input={input}
        captureEnabled={false}
        receiveHighQuality
      />,
    );
    const source = __getLocalVideoDiagnosticsForTests().get("source-1");
    const viewId = [...(source?.views.keys() ?? [])][0];
    const view = source?.views.get(viewId);
    expect(viewId).toBeDefined();
    recordLocalVideoDecoder("source-1", viewId ?? "", {
      frames: 7,
    });

    act(() => onFallback?.());

    const fallbackView = [
      ...(__getLocalVideoDiagnosticsForTests().get("source-1")?.views.values() ?? []),
    ][0];
    expect(fallbackView).toBe(view);
    expect(fallbackView).toEqual(
      expect.objectContaining({
        path: "BUFFERED_MSE",
        fallbackFrom: "REALTIME_WEBCODECS",
        fallbackReason: "REALTIME_UNHEALTHY",
      }),
    );
    expect(fallbackView?.decoder.frames).toBe(7);
  });

  it("keeps audience errors off the projector surface", () => {
    let onError: ((detail: string) => void) | undefined;
    mockSubscribeMedia.mockImplementation((_sourceId, _video, options) => {
      onError = options?.onError;
      return jest.fn();
    });
    render(
      <LocalVideoInputView
        input={input}
        captureEnabled={false}
        receiveHighQuality
        showErrors={false}
      />,
    );

    const video = screen.getByLabelText("USB Capture");
    fireEvent.loadedData(video);
    expect(video).toHaveClass("opacity-100");

    act(() => onError?.("Open the controller on this computer."));
    expect(
      screen.queryByText("Video input unavailable"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("local-video-input")).toHaveClass("bg-black");
    expect(video).toHaveClass("opacity-0");
  });

  it("shows relayed frames until a direct output is ready", async () => {
    let onFrame: ((value: Blob | undefined) => void) | undefined;
    mockSubscribePreview.mockImplementation((_sourceId, callback) => {
      onFrame = callback;
      return jest.fn();
    });
    render(<LocalVideoInputView input={input} />);

    act(() => onFrame?.(new Blob(["frame"], { type: "image/webp" })));
    const preview = screen.getByRole("img", {
      name: "USB Capture local preview",
    });
    fireEvent.load(preview);
    expect(preview).toHaveAttribute("src", "blob:local-preview-frame");
    expect(mockAcquireWarmCapture).toHaveBeenCalled();
  });

  it("revokes a relayed frame URL when the image cannot load", () => {
    let onFrame: ((value: Blob | undefined) => void) | undefined;
    mockSubscribePreview.mockImplementation((_sourceId, callback) => {
      onFrame = callback;
      return jest.fn();
    });
    render(<LocalVideoInputView input={input} />);

    act(() => onFrame?.(new Blob(["frame"], { type: "image/webp" })));
    fireEvent.error(
      screen.getByRole("img", { name: "USB Capture local preview" }),
    );

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(
      "blob:local-preview-frame",
    );
    expect(
      screen.queryByRole("img", { name: "USB Capture local preview" }),
    ).not.toBeInTheDocument();
  });

  it("shows a remote-unavailable status without requesting local capture", () => {
    mockGetOrCreateDeviceId.mockReturnValue("remote-device");
    render(<LocalVideoInputView input={input} />);

    expect(screen.getByText("Video input unavailable")).toBeInTheDocument();
    expect(
      screen.getByText(/available only on Electron on Windows/i),
    ).toBeInTheDocument();
    expect(mockAcquireWarmCapture).not.toHaveBeenCalled();
  });

  it("names a screen share in its remote-unavailable status", () => {
    mockGetOrCreateDeviceId.mockReturnValue("remote-device");
    render(
      <LocalVideoInputView
        input={{ ...input, captureKind: "screen", deviceLabel: "Lyrics screen" }}
      />,
    );

    expect(screen.getByText("Screen share unavailable")).toBeInTheDocument();
    expect(
      screen.getByText(/This share is available only on Electron on Windows/i),
    ).toBeInTheDocument();
  });

  it("asks for a stopped browser share to be restarted while nothing is on screen", async () => {
    mockResolveBinding.mockReturnValue({
      sourceId: "source-1",
      deviceId: "display:source-1",
      deviceLabel: "Lyrics screen",
      captureKind: "screen",
    });
    mockAcquireWarmCapture.mockRejectedValue(
      Object.assign(new Error("stopped"), {
        name: "DesktopCaptureShareEndedError",
      }),
    );

    render(
      <LocalVideoInputView
        input={{ ...input, captureKind: "screen", deviceLabel: "Lyrics screen" }}
      />,
    );

    expect(
      await screen.findByText(
        "Sharing stopped. Open Media on this computer and share the screen again.",
      ),
    ).toBeInTheDocument();
    // The share may still arrive from another app window, so keep relays open.
    await waitFor(() => expect(mockSubscribeMedia).toHaveBeenCalled());
    expect(mockAcquireWarmCapture).toHaveBeenCalledTimes(1);
  });

  it("reattaches automatically when the persistent capture track ends", async () => {
    render(<LocalVideoInputView input={input} />);
    await waitFor(() => expect(endedHandler).toBeDefined());

    act(() => endedHandler?.());

    await waitFor(() =>
      expect(mockAcquireWarmCapture).toHaveBeenCalledTimes(2),
    );
    expect(
      screen.queryByText("Video input unavailable"),
    ).not.toBeInTheDocument();
  });
});
