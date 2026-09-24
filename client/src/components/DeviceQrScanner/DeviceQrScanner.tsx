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
const BARCODE_DETECTOR_MISS_FALLBACK_THRESHOLD = 8;
const BARCODE_DETECTOR_TIMEOUT_MS = 1_500;

type BarcodeDetectorResult = { rawValue?: string };
type BarcodeDetectorLike = {
  detect: (source: HTMLVideoElement) => Promise<BarcodeDetectorResult[]>;
};
type BarcodeDetectorConstructor = {
  new (options: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
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
  decoder: DecoderName;
  decoded: boolean;
  parseResult: ParseResult | null;
  decodedLength: number | null;
  invalidConfirmationCount: number;
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
        video: { facingMode: { ideal: "environment" } },
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
      let lastScanAt = 0;
      let detectionInProgress = false;
      let barcodeDetectorMissCount = 0;
      let detectorAttemptSequence = 0;
      let activeDetectorAttemptId: number | null = null;
      let usingJsQr = barcodeDetector === null;
      const noDecodeLogged = new Set<DecoderName>();
      const logNoDecodeOnce = (decoder: DecoderName) => {
        if (noDecodeLogged.has(decoder)) return;
        noDecodeLogged.add(decoder);
        logScanDiagnostic({ decoder, decoded: false, parseResult: null, decodedLength: null, invalidConfirmationCount: invalidConfirmationRef.current.count });
      };

      const readJsQr = (activeVideo: HTMLVideoElement, canvas: HTMLCanvasElement) => {
        const sourceWidth = activeVideo.videoWidth;
        const sourceHeight = activeVideo.videoHeight;
        const scale = Math.min(1, MAX_SCAN_DIMENSION / sourceWidth, MAX_SCAN_DIMENSION / sourceHeight);
        canvas.width = Math.max(1, Math.round(sourceWidth * scale));
        canvas.height = Math.max(1, Math.round(sourceHeight * scale));
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return null;
        context.drawImage(activeVideo, 0, 0, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        return jsQR(image.data, canvas.width, canvas.height)?.data ?? null;
      };

      const handleDecodedValue = (value: string, decoder: DecoderName, now: number): boolean => {
        const parsed = parseDevicePairingApprovalUrl(value);
        if (parsed) {
          invalidConfirmationRef.current = { value: "", count: 0, lastSeenAt: 0 };
          if (invalidWarningTimerRef.current !== null) window.clearTimeout(invalidWarningTimerRef.current);
          invalidWarningTimerRef.current = null;
          invalidWarningVisibleRef.current = false;
          setInvalid(false);
          logScanDiagnostic({ decoder, decoded: true, parseResult: "valid", decodedLength: value.length, invalidConfirmationCount: 0 });
          scanHealthRef.current.decodedResult = true;
          accept(parsed.requestId);
          return true;
        }

        const parseResult = getDevicePairingApprovalUrlParseError(value) || "invalid_url";
        const previous = invalidConfirmationRef.current;
        const isSameRecentValue = previous.value === value && now - previous.lastSeenAt <= INVALID_CONFIRMATION_WINDOW_MS;
        const confirmationCount = isSameRecentValue ? previous.count + 1 : 1;
        invalidConfirmationRef.current = { value, count: confirmationCount, lastSeenAt: now };
        scanHealthRef.current.decodedResult = true;
        logScanDiagnostic({ decoder, decoded: true, parseResult, decodedLength: value.length, invalidConfirmationCount: confirmationCount });

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
        if (now - lastScanAt >= SCAN_INTERVAL_MS && activeVideo.videoWidth && activeVideo.videoHeight && !detectionInProgress) {
          lastScanAt = now;
          const scanHealth = scanHealthRef.current;
          scanHealth.attempts += 1;
          scanHealth.lastFrameAt = now;
          if (!scanHealth.firstFrameAt) scanHealth.firstFrameAt = now;
          const canvas = canvasRef.current || document.createElement("canvas");
          canvasRef.current = canvas;
          const processJsQr = (scanAt = now) => {
            try {
              const value = readJsQr(activeVideo, canvas);
              scanHealth.consecutiveErrors = 0;
              if (value) handleDecodedValue(value, "jsqr", scanAt);
              else logNoDecodeOnce("jsqr");
              if (scanStateRef.current === "recovered-error") setScannerStatus("scanning");
            } catch {
              scanHealth.errors += 1;
              scanHealth.consecutiveErrors += 1;
              if (scanHealth.consecutiveErrors >= REPEATED_ERROR_THRESHOLD) setScannerStatus("recovered-error");
            }
          };

          if (barcodeDetector && !usingJsQr) {
            detectionInProgress = true;
            const attemptId = ++detectorAttemptSequence;
            activeDetectorAttemptId = attemptId;
            const finishDetectorAttempt = () => {
              if (startVersion !== startVersionRef.current || activeDetectorAttemptId !== attemptId) return false;
              activeDetectorAttemptId = null;
              detectionInProgress = false;
              if (barcodeDetectorTimeoutRef.current !== null) window.clearTimeout(barcodeDetectorTimeoutRef.current);
              barcodeDetectorTimeoutRef.current = null;
              return true;
            };
            const handleBarcodeDetectorError = () => {
              if (startVersion !== startVersionRef.current || acceptedRef.current || !finishDetectorAttempt()) return;
              scanHealth.errors += 1;
              scanHealth.consecutiveErrors += 1;
              usingJsQr = true;
              processJsQr(performance.now());
            };
            barcodeDetectorTimeoutRef.current = window.setTimeout(() => {
              if (startVersion !== startVersionRef.current || acceptedRef.current || !finishDetectorAttempt()) return;
              usingJsQr = true;
              scanHealth.lastFrameAt = performance.now();
              processJsQr(scanHealth.lastFrameAt);
            }, BARCODE_DETECTOR_TIMEOUT_MS);
            try {
              void Promise.resolve(barcodeDetector.detect(activeVideo)).then((results) => {
                if (startVersion !== startVersionRef.current || acceptedRef.current || !finishDetectorAttempt()) return;
                scanHealth.consecutiveErrors = 0;
                const decodedValues = results
                  .map((result) => result.rawValue)
                  .filter((value): value is string => typeof value === "string");
                if (decodedValues.length > 0) {
                  let foundValidValue = false;
                  decodedValues.forEach((value) => {
                    if (acceptedRef.current) return;
                    if (handleDecodedValue(value, "barcode-detector", now)) {
                      foundValidValue = true;
                      barcodeDetectorMissCount = 0;
                    } else {
                      barcodeDetectorMissCount += 1;
                    }
                  });
                  if (!foundValidValue && !acceptedRef.current && barcodeDetectorMissCount >= BARCODE_DETECTOR_MISS_FALLBACK_THRESHOLD) {
                    usingJsQr = true;
                    processJsQr();
                  }
                } else {
                  barcodeDetectorMissCount += 1;
                  logNoDecodeOnce("barcode-detector");
                  if (barcodeDetectorMissCount >= BARCODE_DETECTOR_MISS_FALLBACK_THRESHOLD) {
                    usingJsQr = true;
                    processJsQr();
                  }
                }
                if (scanStateRef.current === "recovered-error") setScannerStatus("scanning");
              }).catch(handleBarcodeDetectorError).finally(finishDetectorAttempt);
            } catch {
              handleBarcodeDetectorError();
            }
          } else {
            processJsQr();
          }
        }
        if (!acceptedRef.current && startVersion === startVersionRef.current) {
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
