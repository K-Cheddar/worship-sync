import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { RefreshCw, ScanLine, X } from "lucide-react";
import Button from "../Button/Button";
import {
  getDevicePairingApprovalUrlParseError,
  parseDevicePairingApprovalUrl,
} from "../../utils/devicePairingQr";

type ScannerStatus =
  | "starting"
  | "scanning"
  | "scanning-long"
  | "recovered-error"
  | "stalled"
  | "unavailable"
  | "denied";

const SCAN_INTERVAL_MS = 200;
const MAX_SCAN_DIMENSION = 1_280;
const LONG_SCAN_THRESHOLD_MS = 4_000;
const STALL_THRESHOLD_MS = 3_000;
const HEALTH_CHECK_INTERVAL_MS = 500;
const REPEATED_ERROR_THRESHOLD = 3;
const INVALID_CONFIRMATION_THRESHOLD = 3;
const INVALID_CONFIRMATION_WINDOW_MS = 1_500;
const INVALID_WARNING_TIMEOUT_MS = 1_800;
const BARCODE_DETECTOR_TIMEOUT_MS = 1_500;
const BARCODE_DETECTOR_FAILURE_THRESHOLD = 3;
const JSQR_FALLBACK_EVERY_NATIVE_CYCLES = 3;
const JSQR_MIN_INTERVAL_MS = 400;

type BarcodeDetectorResult = { rawValue?: string };
type BarcodeDetectorLike = {
  detect: (source: HTMLVideoElement) => Promise<BarcodeDetectorResult[]>;
};
type BarcodeDetectorConstructor = {
  new (options: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};

type ScannerDiagnostics = {
  videoWidth: number;
  videoHeight: number;
  trackSettings: {
    width?: number;
    height?: number;
    frameRate?: number;
    facingMode?: string;
    focusMode?: string;
  };
  barcodeDetectorAvailable: boolean;
  nativeAttempts: number;
  nativeMisses: number;
  nativeExceptions: number;
  nativeTimeouts: number;
  jsqrAttempts: number;
  jsqrFullFrameMisses: number;
  jsqrCenterCropMisses: number;
  decoded: boolean;
  parserResult: ParseResult | null;
  successfulDecoder: DecoderName | null;
};

const getBarcodeDetector = async (): Promise<BarcodeDetectorLike | null> => {
  try {
    const BarcodeDetector = (globalThis as typeof globalThis & {
      BarcodeDetector?: BarcodeDetectorConstructor;
    }).BarcodeDetector;
    if (!BarcodeDetector || typeof BarcodeDetector.getSupportedFormats !== "function") return null;
    const formats = await BarcodeDetector.getSupportedFormats();
    if (!formats.includes("qr_code")) return null;
    return new BarcodeDetector({ formats: ["qr_code"] });
  } catch {
    return null;
  }
};

type DecoderName = "barcode-detector" | "jsqr";
type ParseResult = "valid" | "invalid_url" | "invalid_origin" | "invalid_path" | "invalid_request_id";

const logScanDiagnostic = (diagnostic: {
  event: string;
  diagnostics: ScannerDiagnostics;
  decoder?: DecoderName;
  parseResult?: ParseResult | null;
  invalidConfirmationCount?: number;
}) => {
  if (import.meta.env.DEV) console.debug("[DeviceQrScanner]", diagnostic);
};

type DeviceQrScannerProps = {
  onAccepted: (requestId: string) => void;
  onClose: () => void;
};

export const DeviceQrScanner = ({ onAccepted, onClose }: DeviceQrScannerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const healthTimerRef = useRef<number | null>(null);
  const invalidWarningTimerRef = useRef<number | null>(null);
  const barcodeDetectorTimeoutRef = useRef<number | null>(null);
  const startVersionRef = useRef(0);
  const acceptedRef = useRef(false);
  const invalidConfirmationRef = useRef({ value: "", count: 0, lastSeenAt: 0 });
  const invalidWarningVisibleRef = useRef(false);
  const scanStateRef = useRef<ScannerStatus>("starting");
  const scanHealthRef = useRef({
    startedAt: 0,
    firstFrameAt: 0,
    lastFrameAt: 0,
    attempts: 0,
    errors: 0,
    consecutiveErrors: 0,
    decodedResult: false,
  });
  const [status, setStatus] = useState<ScannerStatus>("starting");
  const [invalid, setInvalid] = useState(false);

  const setScannerStatus = useCallback((nextStatus: ScannerStatus) => {
    if (scanStateRef.current === nextStatus) return;
    scanStateRef.current = nextStatus;
    setStatus(nextStatus);
  }, []);

  const stop = useCallback(() => {
    startVersionRef.current += 1;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    if (healthTimerRef.current !== null) window.clearInterval(healthTimerRef.current);
    healthTimerRef.current = null;
    if (invalidWarningTimerRef.current !== null) window.clearTimeout(invalidWarningTimerRef.current);
    invalidWarningTimerRef.current = null;
    if (barcodeDetectorTimeoutRef.current !== null) window.clearTimeout(barcodeDetectorTimeoutRef.current);
    barcodeDetectorTimeoutRef.current = null;
    invalidConfirmationRef.current = { value: "", count: 0, lastSeenAt: 0 };
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
  }, []);

  const accept = useCallback(
    (requestId: string) => {
      if (acceptedRef.current) return;
      acceptedRef.current = true;
      invalidWarningVisibleRef.current = false;
      setInvalid(false);
      stop();
      onAccepted(requestId);
    },
    [onAccepted, stop],
  );

  const start = useCallback(async () => {
    stop();
    const startVersion = startVersionRef.current;
    acceptedRef.current = false;
    setInvalid(false);
    invalidWarningVisibleRef.current = false;
    invalidConfirmationRef.current = { value: "", count: 0, lastSeenAt: 0 };
    scanHealthRef.current = {
      startedAt: 0,
      firstFrameAt: 0,
      lastFrameAt: 0,
      attempts: 0,
      errors: 0,
      consecutiveErrors: 0,
      decodedResult: false,
    };
    setScannerStatus("starting");

    if (!navigator.mediaDevices?.getUserMedia) {
      setScannerStatus("unavailable");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1_920 },
          height: { ideal: 1_080 },
        },
        audio: false,
      });
      if (startVersion !== startVersionRef.current || acceptedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      const videoTrack = stream.getVideoTracks()[0];
      let trackCapabilities: MediaTrackCapabilities | undefined;
      try {
        trackCapabilities = videoTrack?.getCapabilities?.();
      } catch {
        trackCapabilities = undefined;
      }
      const focusModes = (trackCapabilities as (MediaTrackCapabilities & { focusMode?: string[] }) | undefined)?.focusMode;
      if (focusModes?.includes("continuous") && videoTrack?.applyConstraints) {
        try {
          void Promise.resolve(
            videoTrack.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }),
          ).catch(() => undefined);
        } catch {
          // Autofocus is optional; keep the camera's existing focus behavior.
        }
      }
      if (startVersion !== startVersionRef.current || acceptedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      video.srcObject = stream;
      await video.play();
      if (startVersion !== startVersionRef.current || acceptedRef.current) {
        stop();
        return;
      }

      const barcodeDetector = await getBarcodeDetector();
      if (startVersion !== startVersionRef.current || acceptedRef.current) return;
      setScannerStatus("scanning");
      scanHealthRef.current.startedAt = performance.now();
      let initialTrackSettings: MediaTrackSettings | undefined;
      try {
        initialTrackSettings = videoTrack?.getSettings?.();
      } catch {
        initialTrackSettings = undefined;
      }
      const diagnostics: ScannerDiagnostics = {
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        trackSettings: {
          width: initialTrackSettings?.width,
          height: initialTrackSettings?.height,
          frameRate: initialTrackSettings?.frameRate,
          facingMode: initialTrackSettings?.facingMode,
          focusMode: (initialTrackSettings as (MediaTrackSettings & { focusMode?: string }) | undefined)?.focusMode,
        },
        barcodeDetectorAvailable: barcodeDetector !== null,
        nativeAttempts: 0,
        nativeMisses: 0,
        nativeExceptions: 0,
        nativeTimeouts: 0,
        jsqrAttempts: 0,
        jsqrFullFrameMisses: 0,
        jsqrCenterCropMisses: 0,
        decoded: false,
        parserResult: null,
        successfulDecoder: null,
      };
      let lastScanAt = 0;
      let nativeCallPending = false;
      let nativeAttemptTimedOut = false;
      let nativeFailureCount = 0;
      let nativeCycleCount = 0;
      let timeoutFallbackCycleCount = 0;
      let lastDiagnosticAt = performance.now();
      let lastJsQrAt = Number.NEGATIVE_INFINITY;
      let detectorAttemptSequence = 0;
      let activeDetectorAttemptId: number | null = null;
      let nativeDisabled = barcodeDetector === null;
      const noDecodeLogged = new Set<DecoderName>();
      const logNoDecodeOnce = (decoder: DecoderName) => {
        if (noDecodeLogged.has(decoder)) return;
        noDecodeLogged.add(decoder);
        logScanDiagnostic({ event: "no-decode", diagnostics: { ...diagnostics }, decoder, invalidConfirmationCount: invalidConfirmationRef.current.count });
      };

      const readJsQr = (activeVideo: HTMLVideoElement, canvas: HTMLCanvasElement, cropCanvas: HTMLCanvasElement) => {
        const sourceWidth = activeVideo.videoWidth;
        const sourceHeight = activeVideo.videoHeight;
        if (!sourceWidth || !sourceHeight) return null;
        const scale = Math.min(1, MAX_SCAN_DIMENSION / sourceWidth, MAX_SCAN_DIMENSION / sourceHeight);
        const scanWidth = Math.max(1, Math.round(sourceWidth * scale));
        const scanHeight = Math.max(1, Math.round(sourceHeight * scale));
        if (canvas.width !== scanWidth) canvas.width = scanWidth;
        if (canvas.height !== scanHeight) canvas.height = scanHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return null;
        context.drawImage(activeVideo, 0, 0, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        diagnostics.jsqrAttempts += 1;
        let result = jsQR(image.data, canvas.width, canvas.height, { inversionAttempts: "attemptBoth" });
        if (result) return { value: result.data };
        diagnostics.jsqrFullFrameMisses += 1;

        const cropContext = cropCanvas.getContext("2d", { willReadFrequently: true });
        if (!cropContext) return null;
        for (const fraction of [0.76, 0.58]) {
          const cropWidth = Math.max(1, Math.round(canvas.width * fraction));
          const cropHeight = Math.max(1, Math.round(canvas.height * fraction));
          const left = Math.floor((canvas.width - cropWidth) / 2);
          const top = Math.floor((canvas.height - cropHeight) / 2);
          if (cropCanvas.width !== canvas.width) cropCanvas.width = canvas.width;
          if (cropCanvas.height !== canvas.height) cropCanvas.height = canvas.height;
          cropContext.drawImage(canvas, left, top, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
          const cropImage = cropContext.getImageData(0, 0, canvas.width, canvas.height);
          diagnostics.jsqrAttempts += 1;
          result = jsQR(cropImage.data, canvas.width, canvas.height, { inversionAttempts: "attemptBoth" });
          if (result) return { value: result.data };
          diagnostics.jsqrCenterCropMisses += 1;
        }
        return null;
      };

      const handleDecodedValue = (value: string, decoder: DecoderName, now: number): boolean => {
        const parsed = parseDevicePairingApprovalUrl(value);
        if (parsed) {
          invalidConfirmationRef.current = { value: "", count: 0, lastSeenAt: 0 };
          if (invalidWarningTimerRef.current !== null) window.clearTimeout(invalidWarningTimerRef.current);
          invalidWarningTimerRef.current = null;
          invalidWarningVisibleRef.current = false;
          setInvalid(false);
          diagnostics.decoded = true;
          diagnostics.parserResult = "valid";
          diagnostics.successfulDecoder = decoder;
          logScanDiagnostic({ event: "decoded", diagnostics: { ...diagnostics }, decoder, parseResult: "valid", invalidConfirmationCount: 0 });
          scanHealthRef.current.decodedResult = true;
          accept(parsed.requestId);
          return true;
        }

        const parseResult = getDevicePairingApprovalUrlParseError(value) || "invalid_url";
        diagnostics.decoded = true;
        diagnostics.parserResult = parseResult;
        const previous = invalidConfirmationRef.current;
        const isSameRecentValue = previous.value === value && now - previous.lastSeenAt <= INVALID_CONFIRMATION_WINDOW_MS;
        const confirmationCount = isSameRecentValue ? previous.count + 1 : 1;
        invalidConfirmationRef.current = { value, count: confirmationCount, lastSeenAt: now };
        scanHealthRef.current.decodedResult = true;
        logScanDiagnostic({ event: "decoded", diagnostics: { ...diagnostics }, decoder, parseResult, invalidConfirmationCount: confirmationCount });

        if (confirmationCount >= INVALID_CONFIRMATION_THRESHOLD) {
          if (!invalidWarningVisibleRef.current) {
            invalidWarningVisibleRef.current = true;
            setInvalid(true);
          }
          if (invalidWarningTimerRef.current !== null) window.clearTimeout(invalidWarningTimerRef.current);
          invalidWarningTimerRef.current = window.setTimeout(() => {
            invalidWarningVisibleRef.current = false;
            setInvalid(false);
            invalidWarningTimerRef.current = null;
            invalidConfirmationRef.current = { value: "", count: 0, lastSeenAt: 0 };
          }, INVALID_WARNING_TIMEOUT_MS);
        }
        return false;
      };

      const scan = (now: number) => {
        const activeVideo = videoRef.current;
        if (acceptedRef.current || startVersion !== startVersionRef.current || !activeVideo) return;
        if (now - lastScanAt >= SCAN_INTERVAL_MS && activeVideo.videoWidth && activeVideo.videoHeight && (!nativeCallPending || nativeAttemptTimedOut || nativeDisabled)) {
          lastScanAt = now;
          const scanHealth = scanHealthRef.current;
          scanHealth.attempts += 1;
          scanHealth.lastFrameAt = now;
          if (!scanHealth.firstFrameAt) scanHealth.firstFrameAt = now;
          const canvas = canvasRef.current || document.createElement("canvas");
          canvasRef.current = canvas;
          const cropCanvas = cropCanvasRef.current || document.createElement("canvas");
          cropCanvasRef.current = cropCanvas;
          const processJsQr = (scanAt = now) => {
            if (scanAt - lastJsQrAt < JSQR_MIN_INTERVAL_MS) return;
            lastJsQrAt = scanAt;
            try {
              diagnostics.videoWidth = activeVideo.videoWidth;
              diagnostics.videoHeight = activeVideo.videoHeight;
              const result = readJsQr(activeVideo, canvas, cropCanvas);
              scanHealth.consecutiveErrors = 0;
              if (result) handleDecodedValue(result.value, "jsqr", scanAt);
              else logNoDecodeOnce("jsqr");
              if (scanStateRef.current === "recovered-error") setScannerStatus("scanning");
            } catch {
              scanHealth.errors += 1;
              scanHealth.consecutiveErrors += 1;
              if (scanHealth.consecutiveErrors >= REPEATED_ERROR_THRESHOLD) setScannerStatus("recovered-error");
            }
          };

          if (barcodeDetector && !nativeDisabled && !nativeCallPending) {
            nativeCallPending = true;
            diagnostics.nativeAttempts += 1;
            nativeAttemptTimedOut = false;
            const attemptId = ++detectorAttemptSequence;
            activeDetectorAttemptId = attemptId;
            const finishDetectorAttempt = () => {
              if (startVersion !== startVersionRef.current || activeDetectorAttemptId !== attemptId) return false;
              activeDetectorAttemptId = null;
              nativeCallPending = false;
              nativeAttemptTimedOut = false;
              if (barcodeDetectorTimeoutRef.current !== null) window.clearTimeout(barcodeDetectorTimeoutRef.current);
              barcodeDetectorTimeoutRef.current = null;
              return true;
            };
            const handleBarcodeDetectorError = () => {
              if (startVersion !== startVersionRef.current || acceptedRef.current || activeDetectorAttemptId !== attemptId) return;
              diagnostics.nativeExceptions += 1;
              nativeFailureCount += 1;
              scanHealth.errors += 1;
              scanHealth.consecutiveErrors += 1;
              if (!finishDetectorAttempt()) return;
              nativeDisabled = nativeFailureCount >= BARCODE_DETECTOR_FAILURE_THRESHOLD;
              processJsQr(now);
            };
            barcodeDetectorTimeoutRef.current = window.setTimeout(() => {
              if (startVersion !== startVersionRef.current || acceptedRef.current || activeDetectorAttemptId !== attemptId) return;
              nativeAttemptTimedOut = true;
              nativeFailureCount += 1;
              diagnostics.nativeTimeouts += 1;
              nativeDisabled = nativeFailureCount >= BARCODE_DETECTOR_FAILURE_THRESHOLD;
              scanHealth.lastFrameAt = performance.now();
              processJsQr(scanHealth.lastFrameAt);
            }, BARCODE_DETECTOR_TIMEOUT_MS);
            try {
              void Promise.resolve(barcodeDetector.detect(activeVideo)).then((results) => {
                if (startVersion !== startVersionRef.current || acceptedRef.current || nativeAttemptTimedOut || activeDetectorAttemptId !== attemptId) return;
                if (!finishDetectorAttempt()) return;
                nativeFailureCount = 0;
                scanHealth.consecutiveErrors = 0;
                const decodedValues = results
                  .map((result) => result.rawValue)
                  .filter((value): value is string => typeof value === "string");
                if (decodedValues.length > 0) {
                  decodedValues.forEach((value) => {
                    if (acceptedRef.current) return;
                    handleDecodedValue(value, "barcode-detector", now);
                  });
                } else {
                  diagnostics.nativeMisses += 1;
                  logNoDecodeOnce("barcode-detector");
                }
                nativeCycleCount += 1;
                if (!acceptedRef.current && nativeCycleCount % JSQR_FALLBACK_EVERY_NATIVE_CYCLES === 0) processJsQr();
                if (scanStateRef.current === "recovered-error") setScannerStatus("scanning");
              }).catch(handleBarcodeDetectorError).finally(() => {
                if (activeDetectorAttemptId === attemptId) finishDetectorAttempt();
              });
            } catch {
              handleBarcodeDetectorError();
            }
          } else {
            if (nativeCallPending && nativeAttemptTimedOut && !nativeDisabled) {
              timeoutFallbackCycleCount += 1;
              if (timeoutFallbackCycleCount % JSQR_FALLBACK_EVERY_NATIVE_CYCLES === 0) processJsQr();
            } else {
              processJsQr();
            }
          }
        }
        if (!acceptedRef.current && startVersion === startVersionRef.current) {
          if (import.meta.env.DEV && now - lastDiagnosticAt >= 5_000) {
            logScanDiagnostic({ event: "scan-health", diagnostics: { ...diagnostics } });
            lastDiagnosticAt = now;
          }
          frameRef.current = requestAnimationFrame(scan);
        }
      };
      frameRef.current = requestAnimationFrame(scan);
      healthTimerRef.current = window.setInterval(() => {
        const health = scanHealthRef.current;
        const now = performance.now();
        if (scanStateRef.current === "recovered-error" && health.consecutiveErrors >= REPEATED_ERROR_THRESHOLD) return;
        if (!health.lastFrameAt) {
          if (now - health.startedAt >= STALL_THRESHOLD_MS) setScannerStatus("stalled");
          return;
        }
        if (now - health.lastFrameAt >= STALL_THRESHOLD_MS) {
          setScannerStatus("stalled");
        } else if (!health.decodedResult && now - health.firstFrameAt >= LONG_SCAN_THRESHOLD_MS) {
          setScannerStatus("scanning-long");
        } else if (scanStateRef.current === "stalled" || scanStateRef.current === "scanning-long") {
          setScannerStatus("scanning");
        }
      }, HEALTH_CHECK_INTERVAL_MS);
    } catch (error) {
      if (startVersion !== startVersionRef.current) return;
      setScannerStatus(error instanceof DOMException && error.name === "NotAllowedError" ? "denied" : "unavailable");
      stop();
    }
  }, [accept, setScannerStatus, stop]);

  useEffect(() => {
    void start();
    return stop;
  }, [start, stop]);

  const cameraLive = !["starting", "denied", "unavailable"].includes(status);
  const statusMessages: Partial<Record<ScannerStatus, string>> = {
    "scanning-long": "QR code not recognized yet.",
    "recovered-error": "Having trouble reading the camera image.",
    stalled: "Scanner paused.",
  };
  const statusSecondaryMessages: Partial<Record<ScannerStatus, string>> = {
    "scanning-long": "Move closer, hold steady, and reduce glare.",
    "recovered-error": "Try moving closer or restart the camera.",
    stalled: "Restart the camera to resume scanning.",
  };
  const statusMessage = statusMessages[status] || "Scanning for a WorshipSync QR code…";
  const statusSecondary = statusSecondaryMessages[status] || "Point the camera at the QR code.";
  const canRestart = status === "denied"
    || status === "unavailable"
    || status === "recovered-error"
    || status === "stalled";

  return (
    <div>
      <p className="text-sm text-gray-200">
        Scan the QR code shown on the device you want to link.
      </p>
      <div className={`relative mt-4 overflow-hidden rounded-xl bg-black ${cameraLive ? "" : "hidden"}`}>
        <video
          ref={videoRef}
          muted
          playsInline
          className="aspect-square w-full object-cover"
          aria-label="Device QR scanner camera"
        />
      </div>
      {cameraLive ? (
        <div className="mt-2 text-sm text-gray-300" role="status">
          <p className="flex items-center gap-2">
            <ScanLine className="size-4 shrink-0" aria-hidden="true" />
            {statusMessage}
          </p>
          <p className="mt-1 pl-6 text-gray-400">{statusSecondary}</p>
        </div>
      ) : (
        <div className="mt-4 rounded-xl bg-gray-900 p-4 text-sm text-gray-200" role="status">
          {status === "starting" && "Opening camera…"}
          {status === "denied" && (
            <>
              <p>Camera access was blocked. Allow camera access for WorshipSync, then try again.</p>
              <p className="mt-2 text-gray-300">You can also scan the QR code with your phone’s normal camera.</p>
            </>
          )}
          {status === "unavailable" && (
            <>
              <p>Camera access is unavailable on this device.</p>
              <p className="mt-2 text-gray-300">You can also scan the QR code with your phone’s normal camera.</p>
            </>
          )}
        </div>
      )}
      {invalid && <p className="mt-2 text-sm text-yellow-300" role="alert">That isn’t a WorshipSync device-link QR code.</p>}
      <div className="mt-4 flex gap-2">
        {canRestart && (
          <Button className="flex-1 justify-center" svg={RefreshCw} onClick={() => void start()}>
            Restart camera
          </Button>
        )}
        <Button className="flex-1 justify-center" variant="secondary" svg={X} onClick={() => { stop(); onClose(); }}>
          Cancel
        </Button>
      </div>
    </div>
  );
};
