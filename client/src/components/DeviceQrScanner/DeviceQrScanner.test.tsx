import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DeviceQrScanner } from "./DeviceQrScanner";

const createGeneratedQrPixels = (value: string) => {
  // qr.js is the encoder used by react-qr-code; this keeps the invalid-payload
  // regression test on the same QR format as the pairing screen.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const QRCode = require("qr.js/lib/QRCode");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ErrorCorrectLevel = require("qr.js/lib/ErrorCorrectLevel");
  const qrCode = new QRCode(-1, ErrorCorrectLevel.L);
  qrCode.addData(value);
  qrCode.make();
  const quietZone = 4;
  const scale = 4;
  const size = (qrCode.getModuleCount() + quietZone * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const moduleX = Math.floor(x / scale) - quietZone;
      const moduleY = Math.floor(y / scale) - quietZone;
      const dark = qrCode.modules[moduleY]?.[moduleX] === true;
      const index = (y * size + x) * 4;
      data[index] = dark ? 0 : 255;
      data[index + 1] = dark ? 0 : 255;
      data[index + 2] = dark ? 0 : 255;
      data[index + 3] = 255;
    }
  }
  return { data, size };
};

const setupActiveScanner = async (getImageData: () => ImageData | { data: Uint8ClampedArray; width: number; height: number }) => {
  const track = { stop: jest.fn(), getSettings: jest.fn(() => ({ width: 320, height: 240, facingMode: "environment", frameRate: 30 })) };
  const frameCallbacks: FrameRequestCallback[] = [];
  const drawImage = jest.fn();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: jest.fn().mockResolvedValue({ getTracks: () => [track], getVideoTracks: () => [track] }) },
  });
  jest.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frameCallbacks.push(callback);
    return frameCallbacks.length;
  });
  jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage,
    getImageData,
  } as unknown as CanvasRenderingContext2D);
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, value: 320 });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, value: 240 });

  render(<DeviceQrScanner onAccepted={jest.fn()} onClose={jest.fn()} />);
  expect(await screen.findByText(/Scanning for a WorshipSync QR code/)).toBeInTheDocument();
  return { frameCallbacks, drawImage };
};

describe("DeviceQrScanner", () => {
  beforeEach(() => {
    jest.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("shows the active scanning status without a restart action when healthy", async () => {
    const track = { stop: jest.fn() };
    const onClose = jest.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: jest.fn().mockResolvedValue({ getTracks: () => [track] }) },
    });
    jest.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    render(<DeviceQrScanner onAccepted={jest.fn()} onClose={onClose} />);

    expect(await screen.findByText(/Scanning for a WorshipSync QR code/)).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "Restart camera" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it("shows longer-scan guidance after active processing finds no QR", async () => {
    jest.useFakeTimers();
    try {
      const emptyFrame = () => ({ data: new Uint8ClampedArray(320 * 240 * 4), width: 320, height: 240 });
      const { frameCallbacks } = await setupActiveScanner(emptyFrame);
      const base = performance.now();
      for (let index = 0; index < 9; index += 1) {
        await act(async () => frameCallbacks.shift()?.(base + index * 500));
      }
      await act(async () => jest.advanceTimersByTime(4_500));

      expect(screen.getByText("QR code not recognized yet.")).toBeInTheDocument();
      expect(screen.getByText("Move closer, hold steady, and reduce glare.")).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not show stalled while scan attempts are still being processed", async () => {
    jest.useFakeTimers();
    try {
      const emptyFrame = () => ({ data: new Uint8ClampedArray(320 * 240 * 4), width: 320, height: 240 });
      const { frameCallbacks } = await setupActiveScanner(emptyFrame);
      const base = performance.now();
      await act(async () => frameCallbacks.shift()?.(base + 200));
      await act(async () => jest.advanceTimersByTime(2_500));

      expect(screen.queryByText("Scanner paused.")).not.toBeInTheDocument();
      expect(screen.getByText(/Scanning for a WorshipSync QR code/)).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it("shows restart guidance when no scan frame is processed", async () => {
    jest.useFakeTimers();
    try {
      await setupActiveScanner(() => ({ data: new Uint8ClampedArray(320 * 240 * 4), width: 320, height: 240 }));
      await act(async () => jest.advanceTimersByTime(3_000));

      expect(screen.getByText("Scanner paused.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Restart camera" })).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it("recovers from a frame error and continues scanning", async () => {
    const emptyFrame = { data: new Uint8ClampedArray(320 * 240 * 4), width: 320, height: 240 };
    const getImageData = jest.fn().mockImplementationOnce(() => { throw new Error("test frame error"); }).mockReturnValue(emptyFrame);
    const { frameCallbacks } = await setupActiveScanner(getImageData);
    const base = performance.now();
    await act(async () => frameCallbacks.shift()?.(base + 200));
    await act(async () => frameCallbacks.shift()?.(base + 400));

    expect(screen.queryByText("Having trouble reading the camera image.")).not.toBeInTheDocument();
    expect(getImageData).toHaveBeenCalledTimes(2);
  });

  it("surfaces repeated frame errors without stopping the scanner", async () => {
    const getImageData = jest.fn().mockImplementation(() => { throw new Error("test frame error"); });
    const { frameCallbacks } = await setupActiveScanner(getImageData);
    const base = performance.now();
    await act(async () => frameCallbacks.shift()?.(base + 200));
    await act(async () => frameCallbacks.shift()?.(base + 400));
    await act(async () => frameCallbacks.shift()?.(base + 600));

    expect(screen.getByText("Having trouble reading the camera image.")).toBeInTheDocument();
    expect(screen.getByText("Try moving closer or restart the camera.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restart camera" })).toBeInTheDocument();
    expect(frameCallbacks.length).toBeGreaterThan(0);
  });

  it("does not update the visible scanning message for every processed frame", async () => {
    const emptyFrame = () => ({ data: new Uint8ClampedArray(320 * 240 * 4), width: 320, height: 240 });
    const { frameCallbacks } = await setupActiveScanner(emptyFrame);
    const status = screen.getByRole("status");
    const base = performance.now();
    for (let index = 0; index < 10; index += 1) {
      await act(async () => frameCallbacks.shift()?.(base + (index + 1) * 200));
    }

    expect(screen.getByRole("status")).toBe(status);
    expect(status).toHaveTextContent("Scanning for a WorshipSync QR code");
  });

  it("decodes a valid device-pairing QR and accepts its request ID", async () => {
    const track = { stop: jest.fn(), getSettings: jest.fn(() => ({ width: 656, height: 656, facingMode: "environment", frameRate: 30 })) };
    const onAccepted = jest.fn();
    const frameCallbacks: FrameRequestCallback[] = [];
    const pixels = createGeneratedQrPixels("https://www.worshipsync.net/#/device-pairing/approve/devicePairing_test_123");
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: jest.fn().mockResolvedValue({ getTracks: () => [track], getVideoTracks: () => [track] }) },
    });
    jest.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: jest.fn(),
      getImageData: jest.fn(() => ({ data: pixels.data, width: pixels.size, height: pixels.size })),
    } as unknown as CanvasRenderingContext2D);
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, value: pixels.size });
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, value: pixels.size });

    render(<DeviceQrScanner onAccepted={onAccepted} onClose={jest.fn()} />);
    expect(await screen.findByText(/Scanning for a WorshipSync QR code/)).toBeInTheDocument();
    await act(async () => frameCallbacks.shift()?.(200));

    expect(onAccepted).toHaveBeenCalledWith("devicePairing_test_123");
  });

  it("shows the invalid-code state when a decoded QR is not a device link", async () => {
    const track = { stop: jest.fn(), getVideoTracks: jest.fn(), getSettings: jest.fn(() => ({})) };
    const frameCallbacks: FrameRequestCallback[] = [];
    const pixels = createGeneratedQrPixels("https://www.worshipsync.net/#/not-a-device-link");
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: jest.fn().mockResolvedValue({ getTracks: () => [track], getVideoTracks: () => [track] }) },
    });
    jest.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: jest.fn(),
      getImageData: jest.fn(() => ({ data: pixels.data, width: pixels.size, height: pixels.size })),
    } as unknown as CanvasRenderingContext2D);
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, value: pixels.size });
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, value: pixels.size });

    render(<DeviceQrScanner onAccepted={jest.fn()} onClose={jest.fn()} />);
    expect(await screen.findByText(/Scanning for a WorshipSync QR code/)).toBeInTheDocument();
    await act(async () => frameCallbacks.shift()?.(200));

    expect(screen.getByRole("alert")).toHaveTextContent("That isn");
  });

  it("mounts the video element before the camera becomes ready", () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: jest.fn(() => new Promise(() => undefined)) },
    });
    render(<DeviceQrScanner onAccepted={jest.fn()} onClose={jest.fn()} />);

    expect(screen.getByLabelText("Device QR scanner camera")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Opening camera");
  });

  it("shows recovery controls when camera access is denied and retries", async () => {
    const getUserMedia = jest
      .fn()
      .mockRejectedValueOnce(new DOMException("Permission denied", "NotAllowedError"))
      .mockRejectedValueOnce(new DOMException("Permission denied", "NotAllowedError"));
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    render(<DeviceQrScanner onAccepted={jest.fn()} onClose={jest.fn()} />);

    const restartButton = await screen.findByRole("button", { name: "Restart camera" });
    fireEvent.click(restartButton);

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("does not render paste-link controls and Cancel closes the scanner", () => {
    const onClose = jest.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });
    render(<DeviceQrScanner onAccepted={jest.fn()} onClose={onClose} />);

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open link" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
