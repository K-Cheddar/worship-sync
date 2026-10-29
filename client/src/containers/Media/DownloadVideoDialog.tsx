import { useContext, useEffect, useState } from "react";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import Modal from "../../components/Modal/Modal";
import { GlobalInfoContext } from "../../context/globalInfo";
import { useDesktopVideoDownload } from "../../components/DesktopVideoDownloadManager/DesktopVideoDownloadManager";
import type { DesktopVideoInspection } from "../../types/electron";

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
  const [inspectedUrl, setInspectedUrl] = useState("");
  const [mediaName, setMediaName] = useState("");
  const [quality, setQuality] = useState<number | "best">("best");
  const [destination, setDestination] = useState<"computer" | "cloud">("computer");
  const [isInspecting, setIsInspecting] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !url.trim()) {
      if (!url.trim()) {
        setInspection(null);
        setInspectedUrl("");
        setIsInspecting(false);
      }
      return;
    }
    let active = true;
    const targetUrl = url.trim();
    const timer = window.setTimeout(() => {
      const api = window.electronAPI;
      if (!api?.inspectVideoUrl) {
        setError("Video downloads are available in the Windows desktop app.");
        return;
      }
      setIsInspecting(true);
      setError("");
      setInspection(null);
      setInspectedUrl("");
      void api.inspectVideoUrl(targetUrl).then((result) => {
        if (!active) return;
        setInspection(result);
        setInspectedUrl(targetUrl);
        setMediaName(result.title);
        setQuality(result.defaultQuality);
      }).catch((inspectionError: unknown) => {
        if (!active) return;
        setInspection(null);
        setInspectedUrl("");
        setError(inspectionError instanceof Error ? inspectionError.message : "Could not inspect this video link.");
      }).finally(() => {
        if (active) setIsInspecting(false);
      });
    }, 450);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [open, url]);

  const handleDownload = async () => {
    if (!inspection || inspectedUrl !== url.trim() || disabled || isStarting) return;
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
        inspectedUrl,
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
      setError(startError instanceof Error ? startError.message : "The download could not be started.");
    } finally {
      setIsStarting(false);
    }
  };

  const selectedQualityExists = inspection?.heights.includes(Number(quality)) ?? false;
  const canDownload = Boolean(
    inspection && inspectedUrl === url.trim() && !isInspecting && !isStarting &&
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
            setError("");
          }}
          placeholder="Paste a YouTube video link"
          disabled={disabled || isStarting}
        />
        {isInspecting ? <p role="status" className="text-sm text-gray-300">Checking video details…</p> : null}
        {inspection && inspectedUrl === url.trim() ? (
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
          <label htmlFor="video-download-quality" className="mb-1 block text-sm font-medium">Video quality</label>
          <select
            id="video-download-quality"
            value={quality}
            onChange={(event) => setQuality(event.target.value === "best" ? "best" : Number(event.target.value))}
            disabled={!inspection || disabled || isStarting}
            className="w-full rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            <option value="best">Best available</option>
            {(inspection?.heights ?? []).map((height) => <option key={height} value={height}>{height}p</option>)}
          </select>
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
        {error ? <p role="alert" className="text-sm text-red-200">{error}</p> : null}
        <div className="flex justify-end gap-2 border-t border-gray-700 pt-3">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void handleDownload()} disabled={!canDownload}>Download</Button>
        </div>
      </div>
    </Modal>
  );
};

export default DownloadVideoDialog;
