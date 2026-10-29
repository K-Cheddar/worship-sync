import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import Modal from "../../components/Modal/Modal";
import { GlobalInfoContext } from "../../context/globalInfo";
import { useTransferActions } from "../../context/transferContext";
import type { DesktopVideoDownloadEvent, DesktopVideoInspection } from "../../types/electron";
import type { MediaType } from "../../types";
import { deleteLocalVideoFile } from "../../utils/localVideoFileAssets";
import { createLocalMediaFromDownloadedVideo } from "./localMediaImport";
import { buildLocalVideoCloudSharePatch } from "./localMediaCloudShare";
import { uploadDownloadedVideoToMux, type MuxUploadCallbacks } from "./utils/muxUpload";
import type { Transfer } from "../../context/transferModel";

type DownloadVideoDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  isGuestSession: boolean;
  onMediaAdded: (media: MediaType) => void;
  onMediaPatched: (id: string, patch: Partial<MediaType>) => void;
  onUploadComplete: () => void;
};

type DownloadRuntime = {
  jobId: string;
  transferId: string;
  inspectionId: string;
  originalUrl: string;
  title: string;
  displayName: string;
  quality: number | "best";
  destination: "computer" | "cloud";
  churchId: string;
  route: string;
  cancelled: boolean;
  downloadFinished: boolean;
  media?: MediaType;
  cloudUploaded: boolean;
  running: boolean;
  cancelMux?: () => Promise<void>;
  cleanupRetry?: () => Promise<void>;
  lastBytes?: { downloadedBytes?: number; totalBytes?: number };
  mediaInfo?: { width: number; height: number; duration: number; size: number };
};

const byteLabel = (bytes?: number) => {
  if (bytes === undefined || !Number.isFinite(bytes)) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const formatDuration = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${minutes}:${String(remainder).padStart(2, "0")}`;
};

const toProgressPercent = (value: number | null) =>
  value === null ? null : Math.max(0, Math.min(100, Math.round(value)));

const DownloadVideoDialog = ({
  open,
  onOpenChange,
  disabled = false,
  isGuestSession,
  onMediaAdded,
  onMediaPatched,
  onUploadComplete,
}: DownloadVideoDialogProps) => {
  const { churchId = "" } = useContext(GlobalInfoContext) || {};
  const { pathname } = useLocation();
  const { updateTransfer, removeTransfer, registerTransferAction } = useTransferActions();
  const [url, setUrl] = useState("");
  const [inspection, setInspection] = useState<DesktopVideoInspection | null>(null);
  const [inspectedUrl, setInspectedUrl] = useState("");
  const [mediaName, setMediaName] = useState("");
  const [quality, setQuality] = useState<number | "best">("best");
  const [destination, setDestination] = useState<"computer" | "cloud">("computer");
  const [isInspecting, setIsInspecting] = useState(false);
  const [error, setError] = useState("");
  const [, setJobRevision] = useState(0);
  const jobs = useRef(new Map<string, DownloadRuntime>());

  const publish = useCallback((
    runtime: DownloadRuntime,
    status: Transfer["status"],
    stage: string,
    progress: number | null,
    detail?: string,
    failure?: string,
    actions?: Transfer["actions"],
  ) => {
    const currentBytes = runtime.lastBytes?.downloadedBytes;
    const totalBytes = runtime.lastBytes?.totalBytes;
    const byteDetail = currentBytes !== undefined
      ? `${stage === "Uploading" ? "Uploaded" : "Downloaded"} ${byteLabel(currentBytes)}${totalBytes !== undefined ? ` of ${byteLabel(totalBytes)}` : ""}`
      : undefined;
    const result = runtime.media
      ? { label: "View in Media Library", to: runtime.route }
      : undefined;
    updateTransfer({
      id: runtime.transferId,
      type: "Media upload",
      name: runtime.displayName,
      status,
      progress: toProgressPercent(progress),
      phase: { key: stage.toLowerCase().replaceAll(" ", "-"), label: stage },
      ...(detail || byteDetail ? { detail: [detail, byteDetail].filter(Boolean).join(" · ") } : {}),
      ...(result ? { result } : {}),
      ...(failure ? { error: { message: failure } } : {}),
      canCancel: status === "active" || status === "queued",
      blocksUnload: false,
      actions: actions ?? (status === "active" || status === "queued"
        ? [{ key: "cancel", label: "Cancel download" }]
        : status === "failed"
          ? [{ key: "retry", label: "Retry" }, { key: "dismiss", label: "Dismiss" }]
          : [{ key: "dismiss", label: "Dismiss" }]),
    });
  }, [updateTransfer]);

  const cleanupTemporaryDownload = useCallback(async (runtime: DownloadRuntime) => {
    await window.electronAPI?.cleanupVideoDownload(runtime.jobId);
  }, []);

  const runCloudUpload = useCallback(async (runtime: DownloadRuntime) => {
    if (!runtime.media || !runtime.churchId) throw new Error("Cloud upload is unavailable for this account.");
    runtime.running = true;
    runtime.cancelled = false;
    runtime.cleanupRetry = undefined;
    publish(runtime, "active", "Uploading", 0, "Sending video to WorshipSync");
    const callbacks: MuxUploadCallbacks = {
      isCancelled: () => runtime.cancelled,
      setCancelUpload: (cancel) => { runtime.cancelMux = cancel; },
      onProgress: (progress) => publish(runtime, "active", "Uploading", progress),
      onStatusUpdate: (message) => publish(runtime, "active", "Uploading", null, message),
    };
    try {
      const uploaded = await uploadDownloadedVideoToMux(
        runtime.jobId,
        `${runtime.displayName}.mp4`,
        { churchId: runtime.churchId, mediaId: runtime.media.id, title: runtime.displayName },
        callbacks,
      );
      if (runtime.cancelled) throw new Error("Upload cancelled.");
      onMediaPatched(runtime.media.id, buildLocalVideoCloudSharePatch(runtime.media, uploaded, runtime.churchId));
      runtime.cloudUploaded = true;
      onUploadComplete();
      runtime.running = false;
      try {
        await cleanupTemporaryDownload(runtime);
      } catch {
        runtime.cleanupRetry = () => cleanupTemporaryDownload(runtime);
        publish(runtime, "complete", "Complete", 100, "Video added. Temporary download cleanup is pending.", undefined, [
          { key: "retry-cleanup", label: "Retry cleanup" },
          { key: "dismiss", label: "Dismiss" },
        ]);
        return;
      }
      publish(runtime, "complete", "Complete", 100, "Uploaded and added to Media Library");
    } catch (uploadError) {
      runtime.running = false;
      const cleanup = uploadError && typeof uploadError === "object"
        ? (uploadError as { retryCleanup?: () => Promise<void> }).retryCleanup
        : undefined;
      runtime.cleanupRetry = cleanup;
      if (runtime.cancelled) {
        try { await cleanupTemporaryDownload(runtime); } catch { /* Local Media remains available. */ }
        publish(runtime, "cancelled", "Cancelled", null, "Local video remains in Media Library");
      } else {
        const message = uploadError instanceof Error ? uploadError.message : "Cloud upload failed. Try again.";
        publish(runtime, "failed", "Upload failed", null, "The local video is already available in Media Library", message, [
          ...(cleanup ? [{ key: "retry-cleanup", label: "Retry cleanup" }] : []),
          { key: "retry", label: "Retry upload" },
          { key: "dismiss", label: "Dismiss" },
        ]);
      }
    } finally {
      runtime.cancelMux = undefined;
    }
  }, [cleanupTemporaryDownload, onMediaPatched, onUploadComplete, publish]);

  const importCompletedDownload = useCallback(async (runtime: DownloadRuntime) => {
    if (runtime.running) return;
    runtime.running = true;
    runtime.cancelled = false;
    publish(runtime, "active", "Importing", null, "Saving video to this computer");
    try {
      const result = await window.electronAPI?.importDownloadedVideo({
        jobId: runtime.jobId,
        workspaceId: runtime.churchId,
        width: runtime.mediaInfo?.width ?? 0,
        height: runtime.mediaInfo?.height ?? 0,
      });
      if (!result) throw new Error("The downloaded video could not be imported.");
      if (runtime.cancelled) {
        await window.electronAPI?.deleteLocalAsset(result.assetId);
        publish(runtime, "cancelled", "Cancelled", null, "Download cancelled before it was added to Media");
        return;
      }
      const mediaInfo = runtime.mediaInfo;
      if (!mediaInfo) throw new Error("The downloaded video details are missing.");
      const media = await createLocalMediaFromDownloadedVideo({
        asset: result,
        workspaceId: runtime.churchId,
        displayName: runtime.displayName,
        duration: mediaInfo.duration,
        storagePolicy: runtime.destination === "cloud" ? "local-and-cloud" : "local-only",
      });
      if (runtime.cancelled) {
        if (media.localVideoFile) await deleteLocalVideoFile(media.localVideoFile.id);
        publish(runtime, "cancelled", "Cancelled", null, "Download cancelled before it was added to Media");
        return;
      }
      runtime.media = media;
      onMediaAdded(media);
      runtime.running = false;
      if (runtime.destination === "cloud") {
        await runCloudUpload(runtime);
        return;
      }
      try {
        await cleanupTemporaryDownload(runtime);
        publish(runtime, "complete", "Complete", 100, "Added to Media Library");
      } catch {
        runtime.cleanupRetry = () => cleanupTemporaryDownload(runtime);
        publish(runtime, "complete", "Complete", 100, "Added to Media Library. Temporary download cleanup is pending.", undefined, [
          { key: "retry-cleanup", label: "Retry cleanup" },
          { key: "dismiss", label: "Dismiss" },
        ]);
      }
    } catch (importError) {
      runtime.running = false;
      if (runtime.cancelled) publish(runtime, "cancelled", "Cancelled", null, "The video was not added to Media");
      else publish(runtime, "failed", "Import failed", null, "The finished video remains on this computer. Retry to import it.", importError instanceof Error ? importError.message : "The video could not be imported.");
    }
  }, [cleanupTemporaryDownload, onMediaAdded, publish, runCloudUpload]);

  const onDownloadEvent = useCallback((event: DesktopVideoDownloadEvent) => {
    const runtime = jobs.current.get(event.jobId);
    if (!runtime) return;
    if (event.downloadedBytes !== undefined || event.totalBytes !== undefined) {
      runtime.lastBytes = { downloadedBytes: event.downloadedBytes, totalBytes: event.totalBytes };
    }
    if (event.stage === "preparing") publish(runtime, "active", "Preparing", event.progress);
    if (event.stage === "downloading") publish(runtime, "active", "Downloading", event.progress);
    if (event.stage === "processing") publish(runtime, "active", "Processing", null, "Merging video and audio");
    if (event.stage === "uploading") publish(runtime, "active", "Uploading", event.progress);
    if (event.stage === "complete" && event.result) {
      runtime.downloadFinished = true;
      runtime.running = false;
      runtime.mediaInfo = event.result;
      void importCompletedDownload(runtime);
    }
    if (event.stage === "failed") {
      runtime.running = false;
      publish(runtime, "failed", "Download failed", null, undefined, event.error ?? "The video could not be downloaded.");
    }
    if (event.stage === "cancelled") {
      runtime.cancelled = true;
      runtime.running = false;
      publish(runtime, "cancelled", "Cancelled", null, event.error ?? "Download cancelled.");
      if (!runtime.media) void cleanupTemporaryDownload(runtime).catch(() => undefined);
    }
  }, [cleanupTemporaryDownload, importCompletedDownload, publish]);

  const retryJob = useCallback(async (runtime: DownloadRuntime) => {
    if (runtime.running) return;
    runtime.cancelled = false;
    runtime.running = true;
    if (runtime.cleanupRetry) {
      try {
        await runtime.cleanupRetry();
        runtime.cleanupRetry = undefined;
        runtime.running = false;
        if (runtime.media && runtime.destination === "cloud" && !runtime.cloudUploaded) {
          await runCloudUpload(runtime);
        } else publish(runtime, "complete", "Complete", 100, "Added to Media Library");
      } catch (cleanupError) {
        runtime.running = false;
        publish(runtime, "failed", "Cleanup failed", null, undefined, cleanupError instanceof Error ? cleanupError.message : "Temporary files still need cleanup.");
      }
      return;
    }
    runtime.running = false;
    if (runtime.media) {
      if (runtime.destination === "cloud" && !runtime.cloudUploaded) await runCloudUpload(runtime);
      return;
    }
    if (runtime.downloadFinished) {
      await importCompletedDownload(runtime);
      return;
    }
    const api = window.electronAPI;
    if (!api) return;
    runtime.running = true;
    publish(runtime, "active", "Preparing", 0, "Retrying video download");
    try {
      if (!runtime.inspectionId) {
        const refreshed = await api.inspectVideoUrl(runtime.originalUrl);
        runtime.inspectionId = refreshed.inspectionId;
      }
      await api.startVideoDownload({ jobId: runtime.jobId, inspectionId: runtime.inspectionId, quality: runtime.quality });
    } catch (retryError) {
      runtime.running = false;
      publish(runtime, "failed", "Download failed", null, undefined, retryError instanceof Error ? retryError.message : "Retry failed.");
    }
  }, [importCompletedDownload, publish, runCloudUpload]);

  const cancelJob = useCallback(async (runtime: DownloadRuntime) => {
    if (runtime.cancelled || runtime.cloudUploaded) return;
    runtime.cancelled = true;
    const api = window.electronAPI;
    const nativeCancellationPending = await api?.cancelVideoDownload(runtime.jobId).catch(() => false);
    if (nativeCancellationPending && !runtime.downloadFinished && !runtime.media) {
      publish(runtime, "active", "Downloading", null, "Cancelling download");
      return;
    }
    await runtime.cancelMux?.().catch(() => undefined);
    await cleanupTemporaryDownload(runtime).catch(() => undefined);
    runtime.running = false;
    publish(runtime, "cancelled", "Cancelled", null, runtime.media ? "Local video remains in Media Library" : "Download cancelled");
  }, [cleanupTemporaryDownload, publish]);

  const dismissJob = useCallback((runtime: DownloadRuntime) => {
    if (runtime.running) return;
    jobs.current.delete(runtime.jobId);
    setJobRevision((revision) => revision + 1);
    removeTransfer(runtime.transferId);
  }, [removeTransfer]);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onVideoDownloadProgress(onDownloadEvent);
    return () => unsubscribe?.();
  }, [onDownloadEvent]);

  useEffect(() => {
    const registerJobActions = (runtime: DownloadRuntime) => {
      return [
        registerTransferAction(runtime.transferId, "cancel", () => cancelJob(runtime)),
        registerTransferAction(runtime.transferId, "retry", () => retryJob(runtime)),
        registerTransferAction(runtime.transferId, "retry-cleanup", () => retryJob(runtime)),
        registerTransferAction(runtime.transferId, "dismiss", () => dismissJob(runtime)),
      ];
    };
    const unregister = [...jobs.current.values()].flatMap(registerJobActions);
    return () => unregister.forEach((stop) => stop());
  }, [cancelJob, dismissJob, registerTransferAction, retryJob, setJobRevision]);

  useEffect(() => () => {
    for (const runtime of jobs.current.values()) {
      if (runtime.running) void window.electronAPI?.cancelVideoDownload(runtime.jobId);
    }
  }, []);

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
    const api = window.electronAPI;
    if (!api || !inspection || inspectedUrl !== url.trim() || disabled) return;
    const title = mediaName.trim();
    if (!title) {
      setError("Enter a name for this video.");
      return;
    }
    if (destination === "cloud" && (isGuestSession || !churchId)) {
      setError("Cloud storage is unavailable for this account.");
      return;
    }
    setError("");
    const jobId = globalThis.crypto.randomUUID();
    const runtime: DownloadRuntime = {
      jobId,
      transferId: `video-download-${jobId}`,
      inspectionId: inspection.inspectionId,
      originalUrl: inspectedUrl,
      title: inspection.title,
      displayName: title,
      quality,
      destination,
      churchId,
      route: pathname,
      cancelled: false,
      downloadFinished: false,
      cloudUploaded: false,
      running: true,
    };
    jobs.current.set(jobId, runtime);
    setJobRevision((revision) => revision + 1);
    publish(runtime, "active", "Preparing", 0, "Preparing local video download");
    onOpenChange(false);
    try {
      await api.startVideoDownload({ jobId, inspectionId: inspection.inspectionId, quality });
    } catch (startError) {
      runtime.running = false;
      publish(runtime, "failed", "Download failed", null, undefined, startError instanceof Error ? startError.message : "The download could not be started.");
    }
  };

  const selectedQualityExists = inspection?.heights.includes(Number(quality)) ?? false;
  const canDownload = Boolean(
    inspection && inspectedUrl === url.trim() && !isInspecting &&
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
          disabled={disabled}
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
          disabled={!inspection || disabled}
        />
        <div>
          <label htmlFor="video-download-quality" className="mb-1 block text-sm font-medium">Video quality</label>
          <select
            id="video-download-quality"
            value={quality}
            onChange={(event) => setQuality(event.target.value === "best" ? "best" : Number(event.target.value))}
            disabled={!inspection || disabled}
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
