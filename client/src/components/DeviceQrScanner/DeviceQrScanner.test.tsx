import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DeviceQrScanner } from "./DeviceQrScanner";

const createGeneratedQrPixels = (value: string, options: { scale?: number; padding?: number; inverted?: boolean } = {}) => {
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
  const scale = options.scale ?? 4;
  const padding = options.padding ?? 0;
  const qrSize = (qrCode.getModuleCount() + quietZone * 2) * scale;
  const size = qrSize + padding * 2;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const qrX = x - padding;
      const qrY = y - padding;
      const moduleX = Math.floor(qrX / scale) - quietZone;
      const moduleY = Math.floor(qrY / scale) - quietZone;
      const dark = qrCode.modules[moduleY]?.[moduleX] === true;
      const index = (y * size + x) * 4;
      const luminance = dark !== (options.inverted ?? false) ? 0 : 255;
      data[index] = luminance;
      data[index + 1] = luminance;
      data[index + 2] = luminance;
      data[index + 3] = 255;
    }
  }
  return { data, size };
};

const createCameraFramePixels = (value: string, options: { inverted?: boolean } = {}) => {
  const qr = createGeneratedQrPixels(value, { scale: 4, inverted: options.inverted });
  const width = 320;
  const height = 240;
  const background = options.inverted ? 0 : 255;
  const data = new Uint8ClampedArray(width * height * 4).fill(background);
  if (options.inverted) {
    for (let index = 3; index < data.length; index += 4) data[index] = 255;
  }
  const offsetX = Math.floor((width - qr.size) / 2);
  const offsetY = Math.floor((height - qr.size) / 2);
  for (let y = 0; y < qr.size; y += 1) {
    for (let x = 0; x < qr.size; x += 1) {
      const sourceIndex = (y * qr.size + x) * 4;
      const targetIndex = ((y + offsetY) * width + x + offsetX) * 4;
      data.set(qr.data.subarray(sourceIndex, sourceIndex + 4), targetIndex);
    }
  }
  return { data, width, height };
};

const installBarcodeDetector = (detector: { detect: jest.Mock }) => {
  const constructor = Object.assign(jest.fn(() => detector), {
    getSupportedFormats: jest.fn().mockResolvedValue(["qr_code"]),
  });
  Object.defineProperty(globalThis, "BarcodeDetector", { configurable: true, value: constructor });
  return constructor;
};

const setupActiveScanner = async (
  getImageData: () => ImageData | { data: Uint8ClampedArray; width: number; height: number },
  onAccepted = jest.fn(),
  onClose = jest.fn(),
) => {
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

  render(<DeviceQrScanner onAccepted={onAccepted} onClose={onClose} />);
  expect(await screen.findByText(/Scanning for a WorshipSync QR code/)).toBeInTheDocument();
  return { frameCallbacks, drawImage, onAccepted, onClose, track };
};

describe("DeviceQrScanner", () => {
  beforeEach(() => {
    jest.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "BarcodeDetector");
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("shows the active scanning status without a restart action when healthy", async () => {
    const track = { stop: jest.fn() };
    const onClose = jest.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: jest.fn().mockResolvedValue({ getTracks: () => [track], getVideoTracks: () => [track] }) },
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
    await act(async () => frameCallbacks.shift()?.(base + 700));

    expect(screen.queryByText("Having trouble reading the camera image.")).not.toBeInTheDocument();
    expect(getImageData).toHaveBeenCalledTimes(4);
  });

  it("surfaces repeated frame errors without stopping the scanner", async () => {
    const getImageData = jest.fn().mockImplementation(() => { throw new Error("test frame error"); });
    const { frameCallbacks } = await setupActiveScanner(getImageData);
    const base = performance.now();
    await act(async () => frameCallbacks.shift()?.(base + 200));
    await act(async () => frameCallbacks.shift()?.(base + 700));
    await act(async () => frameCallbacks.shift()?.(base + 1_200));

    expect(await screen.findByText("Having trouble reading the camera image.")).toBeInTheDocument();
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

  it("falls back to jsQR when BarcodeDetector is unavailable and accepts a scaled, padded valid QR", async () => {
    const track = { stop: jest.fn(), getSettings: jest.fn(() => ({ width: 656, height: 656, facingMode: "environment", frameRate: 30 })) };
    const onAccepted = jest.fn();
    const frameCallbacks: FrameRequestCallback[] = [];
    const pixels = createGeneratedQrPixels("https://www.worshipsync.net/#/device-pairing/approve/devicePairing_test_123", { scale: 3, padding: 24 });
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

    expect(onAccepted).toHaveBeenCalledTimes(1);
    expect(onAccepted).toHaveBeenCalledWith("devicePairing_test_123");
  });

  it("accepts a native BarcodeDetector result without needing jsQR", async () => {
    const onAccepted = jest.fn();
    const detector = { detect: jest.fn().mockResolvedValue([{ rawValue: "https://www.worshipsync.net/#/device-pairing/approve/devicePairing_test_123" }]) };
    const constructor = installBarcodeDetector(detector);
    const { frameCallbacks, drawImage } = await setupActiveScanner(() => ({
      data: new Uint8ClampedArray(320 * 240 * 4), width: 320, height: 240,
    }), onAccepted);
    expect(constructor).toHaveBeenCalledWith({ formats: ["qr_code"] });
    await act(async () => {
      frameCallbacks.shift()?.(200);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(detector.detect).toHaveBeenCalledTimes(1);
    expect(drawImage).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onAccepted).toHaveBeenCalledTimes(1);
    expect(onAccepted).toHaveBeenCalledWith("devicePairing_test_123");
  });

  it("falls back to jsQR when BarcodeDetector throws", async () => {
    const onAccepted = jest.fn();
    const detector = { detect: jest.fn().mockRejectedValue(new Error("detector failed")) };
    installBarcodeDetector(detector);
    const pixels = createCameraFramePixels("https://www.worshipsync.net/#/device-pairing/approve/devicePairing_test_123");
    const { frameCallbacks } = await setupActiveScanner(() => pixels, onAccepted);

    await act(async () => {
      frameCallbacks.shift()?.(200);
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(detector.detect).toHaveBeenCalledTimes(1));
    expect(onAccepted).toHaveBeenCalledTimes(1);
    expect(onAccepted).toHaveBeenCalledWith("devicePairing_test_123");
    expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalled();
  });

  it("falls back to jsQR when native detection remains pending", async () => {
    jest.useFakeTimers();
    try {
      const detector = {
        detect: jest.fn(() => new Promise<{ rawValue: string }[]>(() => undefined)),
      };
      installBarcodeDetector(detector);
      const pixels = createCameraFramePixels("https://www.worshipsync.net/#/device-pairing/approve/devicePairing_test_123");
      const onAccepted = jest.fn();
      const { frameCallbacks } = await setupActiveScanner(() => pixels, onAccepted);

      await act(async () => frameCallbacks.shift()?.(200));
      expect(detector.detect).toHaveBeenCalledTimes(1);
      expect(onAccepted).not.toHaveBeenCalled();

      await act(async () => jest.advanceTimersByTime(1_500));

      expect(onAccepted).toHaveBeenCalledTimes(1);
      expect(onAccepted).toHaveBeenCalledWith("devicePairing_test_123");
    } finally {
      jest.useRealTimers();
    }
  });

  it("ignores a native result that arrives after the pending detection timed out", async () => {
    jest.useFakeTimers();
    try {
      let resolveDetection: ((results: { rawValue: string }[]) => void) | undefined;
      let detectCount = 0;
      const detector = {
        detect: jest.fn(() => {
          detectCount += 1;
          return detectCount === 1
            ? new Promise<{ rawValue: string }[]>((resolve) => { resolveDetection = resolve; })
            : Promise.resolve([]);
        }),
      };
      installBarcodeDetector(detector);
      const emptyFrame = { data: new Uint8ClampedArray(320 * 240 * 4), width: 320, height: 240 };
      const pixels = createCameraFramePixels("https://www.worshipsync.net/#/device-pairing/approve/devicePairing_test_123");
      const getImageData = jest.fn()
        .mockReturnValueOnce(emptyFrame)
        .mockReturnValueOnce(emptyFrame)
        .mockReturnValueOnce(emptyFrame)
        .mockReturnValue(pixels);
      const onAccepted = jest.fn();
      const { frameCallbacks } = await setupActiveScanner(getImageData, onAccepted);

      await act(async () => frameCallbacks.shift()?.(200));
      await act(async () => jest.advanceTimersByTime(1_500));
      expect(getImageData).toHaveBeenCalledTimes(3);
      expect(onAccepted).not.toHaveBeenCalled();

      await act(async () => {
        resolveDetection?.([{ rawValue: "https://www.worshipsync.net/#/device-pairing/approve/devicePairing_test_123" }]);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(onAccepted).not.toHaveBeenCalled();

      for (const time of [1_800, 2_000, 2_200]) {
        await act(async () => {
          frameCallbacks.shift()?.(time);
          await Promise.resolve();
          await Promise.resolve();
        });
      }
      expect(detector.detect).toHaveBeenCalledTimes(4);
      expect(onAccepted).toHaveBeenCalledTimes(1);
      expect(onAccepted).toHaveBeenCalledWith("devicePairing_test_123");
    } finally {
      jest.useRealTimers();
    }
  });

  it("falls back to jsQR after repeated native values fail pairing validation", async () => {
    const detector = {
      detect: jest.fn().mockResolvedValue([{ rawValue: "https://www.worshipsync.net/#/not-a-device-link" }]),
    };
    installBarcodeDetector(detector);
    const pixels = createCameraFramePixels("https://www.worshipsync.net/#/device-pairing/approve/devicePairing_test_123");
    const onAccepted = jest.fn();
    const { frameCallbacks } = await setupActiveScanner(() => pixels, onAccepted);

    for (let time = 200; time <= 1_600; time += 200) {
      await act(async () => {
        frameCallbacks.shift()?.(time);
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    expect(detector.detect).toHaveBeenCalledTimes(3);
    expect(onAccepted).toHaveBeenCalledTimes(1);
    expect(onAccepted).toHaveBeenCalledWith("devicePairing_test_123");
  });

  it("keeps native detection running after more than eight empty results", async () => {
    const detector = { detect: jest.fn().mockResolvedValue([]) };
    installBarcodeDetector(detector);
    const { frameCallbacks } = await setupActiveScanner(() => ({
      data: new Uint8ClampedArray(320 * 240 * 4), width: 320, height: 240,
    }));

    for (let index = 1; index <= 11; index += 1) {
      await act(async () => {
        frameCallbacks.shift()?.(index * 200);
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    expect(detector.detect).toHaveBeenCalledTimes(11);
  });

  it("continues accepting a native result after many empty results", async () => {
    const url = "https://www.worshipsync.net/#/device-pairing/approve/devicePairing_test_123";
    let detectCount = 0;
    const detector = { detect: jest.fn(() => { detectCount += 1; return detectCount <= 10 ? Promise.resolve([]) : Promise.resolve([{ rawValue: url }]); }) };
    installBarcodeDetector(detector);
    const onAccepted = jest.fn();
    const { frameCallbacks } = await setupActiveScanner(() => ({
      data: new Uint8ClampedArray(320 * 240 * 4), width: 320, height: 240,
    }), onAccepted);

    for (let index = 1; index <= 11; index += 1) {
      await act(async () => {
        frameCallbacks.shift()?.(index * 200);
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    expect(detector.detect).toHaveBeenCalledTimes(11);
    expect(onAccepted).toHaveBeenCalledWith("devicePairing_test_123");
  });

  it("disables native decoding after repeated exceptions and keeps scanning with jsQR", async () => {
    let showQr = false;
    const detector = { detect: jest.fn().mockRejectedValue(new Error("detector failed")) };
    installBarcodeDetector(detector);
    const qr = createCameraFramePixels("https://www.worshipsync.net/#/device-pairing/approve/devicePairing_test_123");
    const getImageData = jest.fn(() => showQr ? qr : { data: new Uint8ClampedArray(320 * 240 * 4), width: 320, height: 240 });
    const onAccepted = jest.fn();
    const { frameCallbacks } = await setupActiveScanner(getImageData, onAccepted);

    for (let index = 1; index <= 3; index += 1) {
      await act(async () => {
        frameCallbacks.shift()?.(index * 200);
        await Promise.resolve();
        await Promise.resolve();
      });
    }
    expect(detector.detect).toHaveBeenCalledTimes(3);
    showQr = true;
    await act(async () => frameCallbacks.shift()?.(1_000));

    expect(onAccepted).toHaveBeenCalledWith("devicePairing_test_123");
    expect(detector.detect).toHaveBeenCalledTimes(3);
  });

  it("runs jsQR periodically while native detection is healthy but missing", async () => {
    const detector = { detect: jest.fn().mockResolvedValue([]) };
    installBarcodeDetector(detector);
    const qr = createCameraFramePixels("https://www.worshipsync.net/#/device-pairing/approve/devicePairing_test_123");
    const onAccepted = jest.fn();
    const { frameCallbacks } = await setupActiveScanner(() => qr, onAccepted);

    for (let index = 1; index <= 3; index += 1) {
      await act(async () => {
        frameCallbacks.shift()?.(index * 200);
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    expect(detector.detect).toHaveBeenCalledTimes(3);
    expect(onAccepted).toHaveBeenCalledWith("devicePairing_test_123");
  });

  it("requests an environment camera with ideal HD resolution and tolerates unsupported focus constraints", async () => {
    const track = {
      stop: jest.fn(),
      getCapabilities: jest.fn(() => ({})),
      getSettings: jest.fn(() => ({ width: 1280, height: 720 })),
      applyConstraints: jest.fn(),
    };
    const getUserMedia = jest.fn().mockResolvedValue({ getTracks: () => [track], getVideoTracks: () => [track] });
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    jest.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

    render(<DeviceQrScanner onAccepted={jest.fn()} onClose={jest.fn()} />);

    expect(await screen.findByText(/Scanning for a WorshipSync QR code/)).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    expect(track.applyConstraints).not.toHaveBeenCalled();
  });

  it("requests continuous focus once when supported and ignores an optional constraint failure", async () => {
    const track = {
      stop: jest.fn(),
      getCapabilities: jest.fn(() => ({ focusMode: ["manual", "continuous"] })),
      getSettings: jest.fn(() => ({ width: 1280, height: 720, focusMode: "continuous" })),
      applyConstraints: jest.fn().mockRejectedValue(new Error("fixed focus mode")),
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: jest.fn().mockResolvedValue({ getTracks: () => [track], getVideoTracks: () => [track] }) },
    });
    jest.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

    render(<DeviceQrScanner onAccepted={jest.fn()} onClose={jest.fn()} />);

    expect(await screen.findByText(/Scanning for a WorshipSync QR code/)).toBeInTheDocument();
    expect(track.applyConstraints).toHaveBeenCalledTimes(1);
    expect(track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ focusMode: "continuous" }] });
  });

  it("uses a centered crop when the jsQR full-frame attempt misses", async () => {
    const qr = createCameraFramePixels("https://www.worshipsync.net/#/device-pairing/approve/devicePairing_test_123");
    const fullFrameContext = {
      drawImage: jest.fn(),
      getImageData: jest.fn(() => ({ data: new Uint8ClampedArray(320 * 240 * 4), width: 320, height: 240 })),
    };
    const cropContext = { drawImage: jest.fn(), getImageData: jest.fn(() => qr) };
    const onAccepted = jest.fn();
    const { frameCallbacks } = await setupActiveScanner(() => ({
      data: new Uint8ClampedArray(320 * 240 * 4), width: 320, height: 240,
    }), onAccepted);
    jest.spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementationOnce(() => fullFrameContext as unknown as CanvasRenderingContext2D)
      .mockImplementationOnce(() => cropContext as unknown as CanvasRenderingContext2D);

    await act(async () => frameCallbacks.shift()?.(200));

    expect(fullFrameContext.getImageData).toHaveBeenCalledTimes(1);
    expect(cropContext.drawImage).toHaveBeenCalled();
    expect(onAccepted).toHaveBeenCalledWith("devicePairing_test_123");
  });

  it("decodes a light-on-dark QR using jsQR inversion attempts", async () => {
    const inverted = createCameraFramePixels(
      "https://www.worshipsync.net/#/device-pairing/approve/devicePairing_test_123",
      { inverted: true },
    );
    const { frameCallbacks, onAccepted } = await setupActiveScanner(() => inverted);

    await act(async () => frameCallbacks.shift()?.(200));

    expect(onAccepted).toHaveBeenCalledWith("devicePairing_test_123");
  });

  it("ignores a native detector result that arrives after scanning stops", async () => {
    let resolveDetection: ((results: { rawValue: string }[]) => void) | undefined;
    const detector = {
      detect: jest.fn(() => new Promise<{ rawValue: string }[]>((resolve) => { resolveDetection = resolve; })),
    };
    installBarcodeDetector(detector);
    const onAccepted = jest.fn();
    const onClose = jest.fn();
    const { frameCallbacks, track } = await setupActiveScanner(() => ({
      data: new Uint8ClampedArray(320 * 240 * 4), width: 320, height: 240,
    }), onAccepted, onClose);

    await act(async () => frameCallbacks.shift()?.(200));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => {
      resolveDetection?.([{ rawValue: "https://www.worshipsync.net/#/device-pairing/approve/devicePairing_test_123" }]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onAccepted).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps scanning after one invalid decode and warns after repeated matching decodes", async () => {
    const track = { stop: jest.fn(), getVideoTracks: jest.fn(), getSettings: jest.fn(() => ({})) };
    const frameCallbacks: FrameRequestCallback[] = [];
    const invalidPayload = "https://www.worshipsync.net/#/not-a-device-link?requestSecret=test_secret";
    const pixels = createGeneratedQrPixels(invalidPayload);
    const diagnosticSpy = jest.spyOn(console, "debug").mockImplementation(() => undefined);
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
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(frameCallbacks.length).toBeGreaterThan(0);
    await act(async () => frameCallbacks.shift()?.(700));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => frameCallbacks.shift()?.(1_200));
    expect(screen.getByRole("alert")).toHaveTextContent("That isn");
    expect(frameCallbacks.length).toBeGreaterThan(0);
    const diagnostics = JSON.stringify(diagnosticSpy.mock.calls);
    expect(diagnostics).toContain("invalid_path");
    expect(diagnostics).toContain('"invalidConfirmationCount":3');
    expect(diagnostics).not.toContain(invalidPayload);
    expect(diagnostics).not.toContain("test_secret");
  });

  it("does not combine different invalid payloads into one warning", async () => {
    const payloads = [
      "https://www.worshipsync.net/#/not-a-device-link-one",
      "https://www.worshipsync.net/#/not-a-device-link-two",
      "https://www.worshipsync.net/#/not-a-device-link-three",
    ].map((value) => createCameraFramePixels(value));
    const getImageData = jest.fn()
      .mockReturnValueOnce(payloads[0])
      .mockReturnValueOnce(payloads[1])
      .mockReturnValueOnce(payloads[2]);
    const { frameCallbacks } = await setupActiveScanner(getImageData);

    for (const time of [200, 700, 1_200]) {
      await act(async () => frameCallbacks.shift()?.(time));
    }

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(frameCallbacks.length).toBeGreaterThan(0);
  });

  it("accepts a valid QR immediately after repeated invalid decodes and clears the warning", async () => {
    const onAccepted = jest.fn();
    const invalidPixels = createCameraFramePixels("https://www.worshipsync.net/#/not-a-device-link");
    const validPixels = createCameraFramePixels("https://www.worshipsync.net/#/device-pairing/approve/devicePairing_test_123");
    const imageData = (pixels: typeof invalidPixels) => pixels;
    const getImageData = jest.fn()
      .mockReturnValueOnce(imageData(invalidPixels))
      .mockReturnValueOnce(imageData(invalidPixels))
      .mockReturnValueOnce(imageData(invalidPixels))
      .mockReturnValueOnce(imageData(validPixels));
    const { frameCallbacks } = await setupActiveScanner(getImageData, onAccepted);

    for (const time of [200, 700, 1_200]) {
      await act(async () => frameCallbacks.shift()?.(time));
    }
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await act(async () => frameCallbacks.shift()?.(1_700));

    expect(onAccepted).toHaveBeenCalledTimes(1);
    expect(onAccepted).toHaveBeenCalledWith("devicePairing_test_123");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clears a confirmed invalid warning when that payload stops appearing", async () => {
    jest.useFakeTimers();
    try {
      const pixels = createCameraFramePixels("https://www.worshipsync.net/#/not-a-device-link");
      const { frameCallbacks } = await setupActiveScanner(() => pixels);
      for (const time of [200, 700, 1_200]) {
        await act(async () => frameCallbacks.shift()?.(time));
      }
      expect(screen.getByRole("alert")).toBeInTheDocument();

      await act(async () => jest.advanceTimersByTime(1_800));

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(frameCallbacks.length).toBeGreaterThan(0);
    } finally {
      jest.useRealTimers();
    }
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
