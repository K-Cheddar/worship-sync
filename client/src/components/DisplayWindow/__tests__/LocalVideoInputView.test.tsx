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

jest.mock("../../../utils/authStorage", () => ({
  getOrCreateDeviceId: jest.fn(() => "local-device"),
}));
jest.mock("../../../utils/localVideoInput", () => ({
  getAudioInputErrorMessage: jest.requireActual(
    "../../../utils/localVideoInput",
  ).getAudioInputErrorMessage,
  getVideoInputErrorMessage: jest.requireActual(
    "../../../utils/localVideoInput",
  ).getVideoInputErrorMessage,
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

  it("shows no connecting chrome while the warm stream attaches", () => {
    mockAcquireWarmCapture.mockReturnValue(new Promise(() => undefined));
    render(<LocalVideoInputView input={input} />);

    expect(screen.queryByText(/Connecting/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Starting local preview/i),
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
