import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { RefreshCw, ScanLine, X } from "lucide-react";
import Button from "../Button/Button";
import { parseDevicePairingApprovalUrl } from "../../utils/devicePairingQr";

type ScannerStatus = "loading" | "ready" | "unavailable" | "denied";

type DeviceQrScannerProps = {
  onAccepted: (requestId: string) => void;
  onClose: () => void;
};

export const DeviceQrScanner = ({ onAccepted, onClose }: DeviceQrScannerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const startVersionRef = useRef(0);
  const acceptedRef = useRef(false);
  const [status, setStatus] = useState<ScannerStatus>("loading");
  const [invalid, setInvalid] = useState(false);

  const stop = useCallback(() => {
    startVersionRef.current += 1;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
  }, []);

  const accept = useCallback(
    (value: string) => {
      const parsed = parseDevicePairingApprovalUrl(value);
      if (!parsed) {
        setInvalid(true);
        return;
      }
      if (acceptedRef.current) return;
      acceptedRef.current = true;
      stop();
      onAccepted(parsed.requestId);
    },
    [onAccepted, stop],
  );

  const start = useCallback(async () => {
    stop();
    const startVersion = startVersionRef.current;
    acceptedRef.current = false;
    setInvalid(false);

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unavailable");
      return;
    }

    setStatus("loading");
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

      setStatus("ready");
      let lastScanAt = 0;
      const scan = (now: number) => {
        const activeVideo = videoRef.current;
        if (acceptedRef.current || startVersion !== startVersionRef.current || !activeVideo) return;
        if (now - lastScanAt >= 200 && activeVideo.videoWidth && activeVideo.videoHeight) {
          lastScanAt = now;
          const canvas = canvasRef.current || document.createElement("canvas");
          canvasRef.current = canvas;
          canvas.width = activeVideo.videoWidth;
          canvas.height = activeVideo.videoHeight;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (context) {
            context.drawImage(activeVideo, 0, 0, canvas.width, canvas.height);
            const image = context.getImageData(0, 0, canvas.width, canvas.height);
            const result = jsQR(image.data, canvas.width, canvas.height);
            if (result) accept(result.data);
          }
        }
        if (!acceptedRef.current && startVersion === startVersionRef.current) {
          frameRef.current = requestAnimationFrame(scan);
        }
      };
      frameRef.current = requestAnimationFrame(scan);
    } catch (error) {
      if (startVersion !== startVersionRef.current) return;
      setStatus(error instanceof DOMException && error.name === "NotAllowedError" ? "denied" : "unavailable");
      stop();
    }
  }, [accept, stop]);

  useEffect(() => {
    void start();
    return stop;
  }, [start, stop]);

  return (
    <div>
      <p className="text-sm text-gray-200">
        Scan the QR code shown on the device you want to link.
      </p>
      <video
        ref={videoRef}
        muted
        playsInline
        className={`mt-4 aspect-square w-full rounded-xl bg-black object-cover ${status === "ready" ? "" : "hidden"}`}
        aria-label="Device QR scanner camera"
      />
      {status === "ready" ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-gray-300" role="status">
          <ScanLine className="size-4 shrink-0" aria-hidden="true" />
          Scanning for a WorshipSync QR code…
        </p>
      ) : (
        <div className="mt-4 rounded-xl bg-gray-900 p-4 text-sm text-gray-200" role="status">
          {status === "loading" && "Opening camera…"}
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
        {(status === "denied" || status === "unavailable") && (
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
