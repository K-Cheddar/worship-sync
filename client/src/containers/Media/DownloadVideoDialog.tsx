import { useContext, useEffect, useState } from "react";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import Modal from "../../components/Modal/Modal";
import Select from "../../components/Select/Select";
import { GlobalInfoContext } from "../../context/globalInfo";
import { useDesktopVideoDownload } from "../../components/DesktopVideoDownloadManager/DesktopVideoDownloadManager";
import type { DesktopVideoInspection } from "../../types/electron";
import { videoDownloadErrorMessage } from "../../utils/videoDownloadError";

type DownloadVideoDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  isGuestSession: boolean;
  controllerProfileId: string;
  folderId: string | null;
  routePath: string;
};

const formatDuration = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
};

const DownloadVideoDialog = ({
  open,
  onOpenChange,
  disabled = false,
  isGuestSession,
  controllerProfileId,
  folderId,
  routePath,
}: DownloadVideoDialogProps) => {
  const { churchId = "" } = useContext(GlobalInfoContext) || {};
  const { start } = useDesktopVideoDownload();
  const [url, setUrl] = useState("");
  const [inspection, setInspection] = useState<DesktopVideoInspection | null>(null);
  const [inspectedInputUrl, setInspectedInputUrl] = useState("");
  const [mediaName, setMediaName] = useState("");
  const [quality, setQuality] = useState<number | "best">("best");
  const [destination, setDestination] = useState<"computer" | "cloud">("computer");
  const [isInspecting, setIsInspecting] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState("");
  const [inspectionAttempt, setInspectionAttempt] = useState(0);

  useEffect(() => {
    if (!open) {
      setUrl("");
      setInspection(null);
      setInspectedInputUrl("");
      setMediaName("");
      setQuality("best");
      setIsInspecting(false);
      setError("");
      return;
    }
    if (!url.trim()) {
      setInspection(null);
      setInspectedInputUrl("");
      setMediaName("");
      setIsInspecting(false);
      return;
    }
    let active = true;
    const targetUrl = url.trim();
    const timer = window.setTimeout(() => {
      const api = window.electronAPI;
      if (!api?.inspectVideoUrl) {
        setError("Video downloads are available in the Windows desktop app.");
        setIsInspecting(false);
        return;
      }
      setIsInspecting(true);
      setError("");
      setInspection(null);
      setInspectedInputUrl("");
      void api.inspectVideoUrl(targetUrl).then((result) => {
        if (!active) return;
        setInspection(result);
        setInspectedInputUrl(targetUrl);
        setMediaName(result.title);
        setQuality(result.defaultQuality);
      }).catch((inspectionError: unknown) => {
        if (!active) return;
        setInspection(null);
        setInspectedInputUrl("");
        setMediaName("");
        setQuality("best");
        setError(videoDownloadErrorMessage(inspectionError, "Could not inspect this video link."));
      }).finally(() => {
        if (active) setIsInspecting(false);
      });
    }, 450);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [open, url, inspectionAttempt]);

  const handleDownload = async () => {
    if (!inspection || inspectedInputUrl !== url.trim() || disabled || isStarting) return;
    const displayName = mediaName.trim();
    if (!displayName) {
      setError("Enter a name for this video.");
      return;
    }
    if (destination === "cloud" && (isGuestSession || !churchId)) {
      setError("Cloud storage is unavailable for this account.");
      return;
    }
    setError("");
    setIsStarting(true);
    try {
      start({
        inspection,
        inspectedUrl: inspection.videoUrl,
        displayName,
        quality,
        destination,
        owner: {
          churchId,
          workspaceId: churchId,
          controllerProfileId,
          folderId,
          routePath,
        },
      });
      onOpenChange(false);
    } catch (startError) {
      setError(videoDownloadErrorMessage(startError, "The download could not be started."));
    } finally {
      setIsStarting(false);
    }
  };

  const selectedQualityExists = inspection?.heights.includes(Number(quality)) ?? false;
  const canDownload = Boolean(
    inspection && inspectedInputUrl === url.trim() && !isInspecting && !isStarting &&
    mediaName.trim() && (quality === "best" || selectedQualityExists) && !disabled,
  );

  return (
    <Modal
      isOpen={open}
      onClose={() => onOpenChange(false)}
      title="Download Video"
      description="Inspect and add a YouTube video to the Media Library."
      size="md"
      contentPadding="p-4"
    >
      <div className="space-y-4 text-white">
        <Input
          label="Video URL"
          type="url"
          value={url}
          onChange={(value) => {
            setUrl(String(value));
            setInspection(null);
            setInspectedInputUrl("");
            setMediaName("");
            setQuality("best");
            setIsInspecting(false);
            setError("");
          }}
          placeholder="Paste a YouTube video link"
          disabled={disabled || isStarting}
        />
        {isInspecting ? <p role="status" className="text-sm text-gray-300">Checking video details…</p> : null}
        {inspection && inspectedInputUrl === url.trim() ? (
          <div className="flex min-w-0 gap-3 rounded-md border border-gray-600 bg-gray-900 p-3">
            {inspection.thumbnail ? <img src={inspection.thumbnail} alt="" className="h-20 w-36 shrink-0 rounded object-cover" /> : null}
            <div className="min-w-0">
              <p className="line-clamp-2 text-sm font-semibold">{inspection.title}</p>
              <p className="mt-1 text-xs text-gray-300">{formatDuration(inspection.duration)}</p>
            </div>
          </div>
        ) : null}
        <Input
          label="Media name"
          type="text"
          value={mediaName}
          onChange={(value) => setMediaName(String(value))}
          disabled={!inspection || disabled || isStarting}
        />
        <div>
          <label id="video-download-quality-label" htmlFor="video-download-quality" className="mb-1 block text-sm font-medium">Video quality</label>
          <Select
            id="video-download-quality"
            aria-labelledby="video-download-quality-label"
            value={String(quality)}
            onChange={(value) => setQuality(value === "best" ? "best" : Number(value))}
            options={[
              { label: "Best available", value: "best" },
              ...(inspection?.heights ?? []).map((height) => ({ label: `${height}p`, value: String(height) })),
            ]}
            disabled={!inspection || disabled || isStarting}
            className="w-full"
            selectClassName="w-full border-gray-600 bg-gray-900 text-white"
            contentClassName="border-gray-600"
            contentBackgroundColor="bg-gray-900"
            contentTextColor="text-white"
          />
          <p className="mt-1 text-xs text-gray-400">Resolution · H.264 video and AAC audio in MP4</p>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Destination</legend>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="radio" name="video-download-destination" value="computer" checked={destination === "computer"} onChange={() => setDestination("computer")} />
            This computer
          </label>
          {!isGuestSession ? (
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm">
              <input type="radio" name="video-download-destination" value="cloud" checked={destination === "cloud"} onChange={() => setDestination("cloud")} />
              Upload to WorshipSync for other controllers
            </label>
          ) : null}
        </fieldset>
        {error ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-red-200">{error}</p>
            {url.trim() && !inspection ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setError("");
                  setIsInspecting(true);
                  setInspectionAttempt((attempt) => attempt + 1);
                }}
                disabled={isInspecting || disabled || isStarting}
              >
                Retry inspection
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="flex justify-end gap-2 border-t border-gray-700 pt-3">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void handleDownload()} disabled={!canDownload}>Download</Button>
        </div>
      </div>
    </Modal>
  );
};

export default DownloadVideoDialog;
