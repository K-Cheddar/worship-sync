import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Cable, MonitorUp, RefreshCw, Video } from "lucide-react";
import type {
  LocalVideoCaptureKind,
  LocalVideoInputMediaSource,
  Option,
} from "../../types";
import {
  bindLocalVideoInput,
  createLocalVideoInputMediaSource,
  getDefaultLocalVideoInputLabel,
  getLocalVideoSourceErrorMessage,
  getVideoInputErrorMessage,
  resolveLocalVideoInputBinding,
  resolveLocalVideoInputBindingForDevice,
} from "../../utils/localVideoInput";
import {
  acquireWarmLocalVideoCapture,
  LocalVideoCaptureOwnedError,
  releaseWarmLocalVideoCapture,
} from "../../utils/localVideoCapturePool";
import {
  type DesktopCaptureSource,
  keepBrowserDesktopShare,
  listDesktopCaptureSources,
  requestBrowserDesktopCapture,
  supportsDesktopCapture,
  supportsDesktopSourceList,
} from "../../utils/desktopCapture";
import { isElectron } from "../../utils/environment";

import Button from "../Button/Button";
import Input from "../Input/Input";
import Select from "../Select/Select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";

const PICKER_CAPTURE_CONSUMER_ID = "input-picker";
const SYSTEM_AUDIO_VALUE = "__system_audio__";
const PREVIEW_WIDTH = 640;
const PREVIEW_HEIGHT = 360;
const PREVIEW_FRAME_TIMEOUT_MS = 5_000;

type DevicePreviewCapture = {
  stream: MediaStream;
  poolSourceId?: string;
  consumerId: string;
};

type DevicePreviewSession = {
  cancelled: boolean;
  abortController: AbortController;
  consumerId: string;
  capture?: DevicePreviewCapture;
  pendingCapture?: Promise<DevicePreviewCapture>;
  releasePromise?: Promise<void>;
};

class PreviewPlaybackError extends Error {}
class PreviewFrameTimeoutError extends Error {}

const waitForUsablePreviewFrame = (
  video: HTMLVideoElement,
  signal: AbortSignal,
) =>
  new Promise<void>((resolve, reject) => {
    let settled = false;
    let timeoutId: number | undefined;
    let frameCallbackId: number | undefined;
    const frameVideo = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: () => void) => number;
      cancelVideoFrameCallback?: (callbackId: number) => void;
    };

    const cleanup = () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      if (frameCallbackId !== undefined) {
        frameVideo.cancelVideoFrameCallback?.(frameCallbackId);
      }
      video.removeEventListener("loadeddata", checkFrame);
      video.removeEventListener("canplay", checkFrame);
      video.removeEventListener("playing", checkFrame);
      signal.removeEventListener("abort", abort);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const checkFrame = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) finish();
    };
    const scheduleFrameCheck = () => {
      frameCallbackId = frameVideo.requestVideoFrameCallback?.(() => {
        checkFrame();
        if (!settled) scheduleFrameCheck();
      });
    };
    const abort = () =>
      finish(new DOMException("Camera preview was cancelled.", "AbortError"));

    if (signal.aborted) {
      abort();
      return;
    }
    video.addEventListener("loadeddata", checkFrame);
    video.addEventListener("canplay", checkFrame);
    video.addEventListener("playing", checkFrame);
    signal.addEventListener("abort", abort, { once: true });
    timeoutId = window.setTimeout(
      () =>
        finish(
          new PreviewFrameTimeoutError(
            "The camera did not produce a video frame in time.",
          ),
        ),
      PREVIEW_FRAME_TIMEOUT_MS,
    );
    scheduleFrameCheck();
    try {
      void Promise.resolve(video.play()).catch(() =>
        finish(new PreviewPlaybackError("Camera preview playback failed.")),
      );
    } catch {
      finish(new PreviewPlaybackError("Camera preview playback failed."));
    }
  });

const getDevicePreviewErrorMessage = (
  error: unknown,
  joinedCaptureHost: boolean,
) => {
  if (error instanceof PreviewPlaybackError) {
    return "Camera preview could not start. Refresh the preview to try again.";
  }
  if (error instanceof PreviewFrameTimeoutError) {
    return "The camera connected, but no video frame arrived. Refresh the preview to try again.";
  }
  if (joinedCaptureHost) {
    return "WorshipSync could not connect to this camera preview. Check the camera connection, then refresh the preview.";
  }
  return getVideoInputErrorMessage(error);
};

const createPreviewInstanceId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `picker-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export type LocalVideoCaptureMode = "device" | "desktop";

type LocalVideoInputPickerProps = {
  source?: LocalVideoInputMediaSource;
  /** Hardware inputs and desktop shares are added from separate Media actions. */
  captureMode?: LocalVideoCaptureMode;
  onLinked: (source: LocalVideoInputMediaSource) => void;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
};

type BrowserShare = {
  stream: MediaStream;
  captureKind: "screen" | "window";
  name: string;
};

type PreviewStatus = "idle" | "loading" | "ready" | "error";

const enumerateInputs = async () => {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  return (await navigator.mediaDevices.enumerateDevices()).filter(
    (device) => device.kind === "videoinput" || device.kind === "audioinput",
  );
};

const stopShare = (share: BrowserShare | undefined) =>
  share?.stream.getTracks().forEach((track) => track.stop());

const stopMediaStream = (stream: MediaStream | undefined) =>
  stream?.getTracks().forEach((track) => track.stop());

const attachPreviewStream = (
  video: HTMLVideoElement | null,
  stream: MediaStream | undefined,
) => {
  if (!video) return;
  video.srcObject = stream ?? null;
  if (!stream) return;
  try {
    const playPromise = video.play();
    void playPromise?.catch(() => undefined);
  } catch {
    // jsdom and locked-autoplay browsers can reject play synchronously.
  }
};

const LocalVideoInputPicker = ({
  source,
  captureMode,
  onLinked,
  className,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: LocalVideoInputPickerProps) => {
  const mode: LocalVideoCaptureMode =
    captureMode ??
    (source?.captureKind === "screen" || source?.captureKind === "window"
      ? "desktop"
      : "device");
  const isDesktopMode = mode === "desktop";
  const canListDesktopSources = supportsDesktopSourceList();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (nextOpen: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDeviceId, setVideoDeviceId] = useState("");
  const [audioDeviceId, setAudioDeviceId] = useState("");
  const [desktopSources, setDesktopSources] = useState<DesktopCaptureSource[]>(
    [],
  );
  const [desktopSourceId, setDesktopSourceId] = useState("");
  const [browserShare, setBrowserShare] = useState<BrowserShare>();
  const [label, setLabel] = useState(
    source?.label ?? getDefaultLocalVideoInputLabel(source?.captureKind),
  );
  const [isLabelEdited, setIsLabelEdited] = useState(false);
  const [fit, setFit] = useState<"contain" | "cover">(source?.fit ?? "contain");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [deviceEnumerationFailed, setDeviceEnumerationFailed] = useState(false);
  const [hasEnumeratedDevices, setHasEnumeratedDevices] = useState(false);
  const [hasListedDesktopSources, setHasListedDesktopSources] = useState(false);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>("idle");
  const [previewError, setPreviewError] = useState("");
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const [previewPaused, setPreviewPaused] = useState(false);
  const previewPausedRef = useRef(false);
  const refreshRequestRef = useRef(0);
  const desktopRequestRef = useRef(0);
  const linkedShareRef = useRef<MediaStream | undefined>(undefined);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewStreamRef = useRef<MediaStream | undefined>(undefined);
  const previewSessionRef = useRef<DevicePreviewSession | undefined>(undefined);
  const previewReleaseRef = useRef<Promise<void>>(Promise.resolve());
  const previewRequestRef = useRef(0);
  const previewInstanceIdRef = useRef<string | undefined>(undefined);
  if (!previewInstanceIdRef.current) {
    previewInstanceIdRef.current = createPreviewInstanceId();
  }
  const previewInstanceId = previewInstanceIdRef.current;
  const pickerCaptureConsumerId = `${PICKER_CAPTURE_CONSUMER_ID}:${previewInstanceId}`;
  const pickerSourceId = source?.sourceId;
  const runningInElectron = isElectron();

  const retireDevicePreview = useCallback(
    (session = previewSessionRef.current) => {
      if (!session) return Promise.resolve();
      session.cancelled = true;
      session.abortController.abort();
      if (previewSessionRef.current === session) {
        previewSessionRef.current = undefined;
      }
      if (previewStreamRef.current === session.capture?.stream) {
        previewStreamRef.current = undefined;
        const video = previewVideoRef.current;
        if (video && video.srcObject === session.capture?.stream) {
          video.srcObject = null;
        }
      }
      session.releasePromise ??= (async () => {
        let capture = session.capture;
        if (!capture && session.pendingCapture) {
          capture = await session.pendingCapture.catch(() => undefined);
        }
        if (!capture) return;
        if (capture.poolSourceId) {
          await releaseWarmLocalVideoCapture(
            capture.poolSourceId,
            capture.consumerId,
          ).catch((releaseError) => {
            console.error(
              "Camera preview lease could not be released:",
              releaseError,
            );
            stopMediaStream(capture?.stream);
          });
          return;
        }
        stopMediaStream(capture.stream);
      })();
      return session.releasePromise;
    },
    [],
  );

  const clearDevicePreview = useCallback(async () => {
    previewPausedRef.current = true;
    setPreviewPaused(true);
    const release = previewReleaseRef.current
      .catch(() => undefined)
      .then(() => retireDevicePreview());
    previewReleaseRef.current = release;
    await release;
    setPreviewStatus("idle");
    setPreviewError("");
  }, [retireDevicePreview]);

  const refresh = useCallback(
    async (restartPreview = true) => {
      const requestId = ++refreshRequestRef.current;
      setError("");
      setDeviceEnumerationFailed(false);
      try {
        const next = await enumerateInputs();
        if (requestId !== refreshRequestRef.current) return;
        setHasEnumeratedDevices(true);
        setDevices(next);
        const binding = source
          ? resolveLocalVideoInputBinding(source.sourceId)
          : undefined;
        const videoInputs = next.filter(
          (device) => device.kind === "videoinput",
        );
        const audioInputs = next.filter(
          (device) => device.kind === "audioinput",
        );
        setVideoDeviceId((current) =>
          videoInputs.some(
            (device) => device.deviceId === (current || binding?.deviceId),
          )
            ? current || binding?.deviceId || ""
            : videoInputs[0]?.deviceId || "",
        );
        setAudioDeviceId((current) => {
          if (current === SYSTEM_AUDIO_VALUE) return current;
          if (!current && binding?.systemAudio) return SYSTEM_AUDIO_VALUE;
          return audioInputs.some(
            (device) => device.deviceId === (current || binding?.audioDeviceId),
          )
            ? current || binding?.audioDeviceId || ""
            : "";
        });
        if (restartPreview) {
          setPreviewRefreshKey((current) => current + 1);
        }
      } catch (nextError) {
        if (requestId !== refreshRequestRef.current) return;
        setHasEnumeratedDevices(true);
        setDeviceEnumerationFailed(true);
        setDevices([]);
        setVideoDeviceId("");
        setAudioDeviceId("");
        // A desktop share only reads this list for optional sound; its own
        // source list drives the sheet, so do not raise a hardware error there.
        if (!isDesktopMode) setError(getVideoInputErrorMessage(nextError));
      }
    },
    [isDesktopMode, source],
  );

  const refreshDesktopSources = useCallback(async () => {
    if (!canListDesktopSources) return;
    const requestId = ++desktopRequestRef.current;
    setError("");
    try {
      const next = await listDesktopCaptureSources({ withThumbnails: true });
      if (requestId !== desktopRequestRef.current) return;
      setHasListedDesktopSources(true);
      setDesktopSources(next);
      const binding = source
        ? resolveLocalVideoInputBinding(source.sourceId)
        : undefined;
      setDesktopSourceId((current) => {
        const preferred = current || binding?.deviceId || "";
        if (next.some((entry) => entry.id === preferred)) return preferred;
        const byName = next.find(
          (entry) => entry.name === binding?.displaySourceName,
        );
        return byName?.id ?? next[0]?.id ?? "";
      });
    } catch (nextError) {
      if (requestId !== desktopRequestRef.current) return;
      setHasListedDesktopSources(true);
      setDesktopSources([]);
      setDesktopSourceId("");
      setError(getLocalVideoSourceErrorMessage(nextError, "screen"));
    }
  }, [canListDesktopSources, source]);

  useEffect(() => {
    if (!open) return;
    previewPausedRef.current = false;
    setPreviewPaused(false);
    setLabel(
      source?.label ??
        getDefaultLocalVideoInputLabel(isDesktopMode ? "screen" : "device"),
    );
    setIsLabelEdited(Boolean(source?.label));
    setFit(source?.fit ?? "contain");
    void refresh(false);
    void refreshDesktopSources();
  }, [
    isDesktopMode,
    open,
    refresh,
    refreshDesktopSources,
    source?.fit,
    source?.label,
  ]);

  useEffect(() => {
    if (!open) return;
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;
    const handleDeviceChange = () => void refresh();
    mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () =>
      mediaDevices.removeEventListener("devicechange", handleDeviceChange);
  }, [open, refresh]);

  // A share chosen but never saved must not keep capturing after the sheet closes.
  useEffect(() => {
    if (open) return;
    setBrowserShare((current) => {
      if (current && current.stream !== linkedShareRef.current) {
        stopShare(current);
      }
      return undefined;
    });
  }, [open]);

  // Live muted preview of the selected camera. A shared Electron join and a
  // browser-owned stream each retain a picker-specific cleanup path.
  useEffect(() => {
    if (!open || isDesktopMode || !videoDeviceId || previewPaused) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setPreviewStatus("error");
      setPreviewError("Video inputs are not supported in this browser.");
      return;
    }

    let cancelled = false;
    const previewRequest = ++previewRequestRef.current;
    const previewVideo = previewVideoRef.current;
    const sourceBinding = pickerSourceId
      ? resolveLocalVideoInputBinding(pickerSourceId)
      : undefined;
    const sharedBinding = runningInElectron
      ? sourceBinding?.deviceId === videoDeviceId
        ? sourceBinding
        : resolveLocalVideoInputBindingForDevice(videoDeviceId)
      : undefined;
    const sharedPreviewBinding = sharedBinding
      ? {
          sourceId: sharedBinding.sourceId,
          deviceId: sharedBinding.deviceId,
          deviceLabel: sharedBinding.deviceLabel,
          ...(sharedBinding.captureKind
            ? { captureKind: sharedBinding.captureKind }
            : {}),
        }
      : undefined;
    const joinedCaptureHost = Boolean(sharedPreviewBinding);
    const previewPoolSourceId = `picker-preview:${previewInstanceId}:${previewRequest}`;
    const session: DevicePreviewSession = {
      cancelled: false,
      abortController: new AbortController(),
      consumerId: `${pickerCaptureConsumerId}:${previewRequest}`,
    };
    setPreviewStatus("loading");
    setPreviewError("");
    const previousRelease = previewReleaseRef.current;
    void (async () => {
      await previousRelease.catch(() => undefined);
      if (cancelled || previewPausedRef.current) return;
      previewSessionRef.current = session;
      const video = previewVideo;
      if (!video) throw new Error("Camera preview is unavailable.");
      video.srcObject = null;

      const pendingCapture = sharedPreviewBinding
        ? acquireWarmLocalVideoCapture(
            previewPoolSourceId,
            sharedPreviewBinding,
            false,
            session.consumerId,
            { shared: true },
          ).then(({ stream }) => ({
            stream,
            poolSourceId: previewPoolSourceId,
            consumerId: session.consumerId,
          }))
        : navigator.mediaDevices
            .getUserMedia({
              audio: false,
              video: {
                deviceId: { exact: videoDeviceId },
                width: { ideal: PREVIEW_WIDTH },
                height: { ideal: PREVIEW_HEIGHT },
              },
            })
            .then((stream) => ({ stream, consumerId: session.consumerId }));
      session.pendingCapture = pendingCapture;
      const capture = await pendingCapture;
      session.capture = capture;
      session.pendingCapture = undefined;
      if (session.cancelled) {
        await retireDevicePreview(session);
        return;
      }
      previewStreamRef.current = capture.stream;
      video.srcObject = capture.stream;
      await waitForUsablePreviewFrame(video, session.abortController.signal);
      if (cancelled || session.cancelled) return;
      setPreviewStatus("ready");
    })().catch((nextError: unknown) => {
      if (cancelled || session.cancelled) return;
      const release = retireDevicePreview(session);
      previewReleaseRef.current = release;
      if (previewVideo && previewVideo.srcObject === session.capture?.stream) {
        previewVideo.srcObject = null;
      }
      setPreviewStatus("error");
      setPreviewError(
        getDevicePreviewErrorMessage(nextError, joinedCaptureHost),
      );
    });

    return () => {
      cancelled = true;
      previewReleaseRef.current = retireDevicePreview(session);
    };
  }, [
    isDesktopMode,
    open,
    previewPaused,
    previewRefreshKey,
    retireDevicePreview,
    runningInElectron,
    pickerCaptureConsumerId,
    pickerSourceId,
    previewInstanceId,
    videoDeviceId,
  ]);

  // Browser shares keep their stream until save or dismiss; mirror it in the
  // preview so operators see the chosen screen or window.
  useEffect(() => {
    if (!open || !isDesktopMode || canListDesktopSources) return;
    if (!browserShare) {
      attachPreviewStream(previewVideoRef.current, undefined);
      setPreviewStatus("idle");
      setPreviewError("");
      return;
    }
    attachPreviewStream(previewVideoRef.current, browserShare.stream);
    setPreviewStatus("ready");
    setPreviewError("");
  }, [browserShare, canListDesktopSources, isDesktopMode, open]);

  const videoInputs = useMemo(
    () => devices.filter((device) => device.kind === "videoinput"),
    [devices],
  );
  const audioInputs = useMemo(
    () => devices.filter((device) => device.kind === "audioinput"),
    [devices],
  );
  const selectedVideoInput = videoInputs.find(
    (device) => device.deviceId === videoDeviceId,
  );
  const selectedDesktopSource = desktopSources.find(
    (entry) => entry.id === desktopSourceId,
  );
  const captureKind: LocalVideoCaptureKind = isDesktopMode
    ? (selectedDesktopSource?.kind ??
      browserShare?.captureKind ??
      (source?.captureKind === "window" ? "window" : "screen"))
    : "device";
  const shareTarget = captureKind === "window" ? "window" : "screen";

  useEffect(() => {
    if (isLabelEdited) return;
    const suggested = isDesktopMode
      ? (selectedDesktopSource?.name ?? browserShare?.name)
      : selectedVideoInput?.label;
    if (suggested) setLabel(suggested);
  }, [
    browserShare?.name,
    isDesktopMode,
    isLabelEdited,
    selectedDesktopSource?.name,
    selectedVideoInput?.label,
  ]);

  let videoPlaceholderLabel = "Finding video inputs…";
  if (hasEnumeratedDevices) {
    videoPlaceholderLabel =
      videoInputs.length === 0
        ? "No video inputs found"
        : "Select a video input";
  }
  const videoOptions = [
    {
      value: "",
      label: videoPlaceholderLabel,
    },
    ...videoInputs.map((device, index) => ({
      value: device.deviceId,
      label: device.label || `Video input ${index + 1}`,
    })),
  ];
  const desktopOptions = useMemo<Option[]>(() => {
    const screens = desktopSources.filter((entry) => entry.kind === "screen");
    const windows = desktopSources.filter((entry) => entry.kind === "window");
    return [
      ...screens.map((entry, index) => ({
        value: entry.id,
        label: entry.name || `Screen ${index + 1}`,
        group: "Screens",
      })),
      ...windows.map((entry, index) => ({
        value: entry.id,
        label: entry.name || `Window ${index + 1}`,
        group: "Windows",
      })),
    ];
  }, [desktopSources]);
  const audioOptions = [
    { value: "", label: "No sound" },
    ...(isDesktopMode && runningInElectron
      ? [{ value: SYSTEM_AUDIO_VALUE, label: "This computer's sound" }]
      : []),
    ...audioInputs.map((device, index) => ({
      value: device.deviceId,
      label: device.label || `Audio input ${index + 1}`,
    })),
  ];
  const hasLabeledVideoInput = videoInputs.some((device) =>
    Boolean(device.label.trim()),
  );
  const showAllowAccess =
    !isDesktopMode &&
    !runningInElectron &&
    hasEnumeratedDevices &&
    !hasLabeledVideoInput;
  const showRetryDeviceScan =
    !isDesktopMode &&
    (deviceEnumerationFailed ||
      (runningInElectron &&
        hasEnumeratedDevices &&
        !isLoading &&
        videoInputs.length === 0));
  const useSystemAudio = isDesktopMode && audioDeviceId === SYSTEM_AUDIO_VALUE;
  const selectedAudioInput = audioInputs.find(
    (device) => device.deviceId === audioDeviceId,
  );

  const allowAccess = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Video inputs are not supported in this browser.");
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: true,
      });
      videoStream.getTracks().forEach((track) => track.stop());
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        audioStream.getTracks().forEach((track) => track.stop());
      } catch {
        // Sound is optional. Device video remains usable if microphone access fails.
      }
      await refresh();
    } catch (nextError) {
      setError(getVideoInputErrorMessage(nextError));
    } finally {
      setIsLoading(false);
    }
  };

  /** Browsers only start a share from a click, so this cannot move into linking. */
  const chooseBrowserShare = async () => {
    setIsLoading(true);
    setError("");
    try {
      const share = await requestBrowserDesktopCapture();
      setBrowserShare((current) => {
        if (current && current.stream !== linkedShareRef.current) {
          stopShare(current);
        }
        return share;
      });
    } catch (nextError) {
      setError(getLocalVideoSourceErrorMessage(nextError, shareTarget));
    } finally {
      setIsLoading(false);
    }
  };

  const finishLink = (
    nextSource: LocalVideoInputMediaSource,
    nextCaptureKind: LocalVideoCaptureKind,
    audioEnabled: boolean,
  ) => {
    const suggestedLabel = isDesktopMode
      ? (selectedDesktopSource?.name ?? browserShare?.name)
      : selectedVideoInput?.label;
    onLinked({
      ...nextSource,
      label:
        (isLabelEdited ? label.trim() : (suggestedLabel ?? label.trim())) ||
        suggestedLabel ||
        nextSource.label,
      captureKind: nextCaptureKind,
      fit,
      audioEnabled,
    });
    setOpen(false);
  };

  const linkDesktopShare = async (nextSource: LocalVideoInputMediaSource) => {
    if (!canListDesktopSources) {
      const share = browserShare;
      if (!share) return false;
      const linked = bindLocalVideoInput(
        nextSource.sourceId,
        // Browser shares have no reusable handle; keep one binding per source.
        `display:${nextSource.sourceId}`,
        share.name,
        undefined,
        undefined,
        { captureKind: share.captureKind, displaySourceName: share.name },
      );
      if (!linked) {
        setError(
          "This share could not be saved locally. Check browser storage, then try again.",
        );
        return false;
      }
      linkedShareRef.current = share.stream;
      keepBrowserDesktopShare(nextSource.sourceId, share.stream);
      finishLink(
        nextSource,
        share.captureKind,
        share.stream.getAudioTracks().length > 0,
      );
      return true;
    }

    const desktopSource = selectedDesktopSource;
    if (!desktopSource) return false;
    const linked = bindLocalVideoInput(
      nextSource.sourceId,
      desktopSource.id,
      desktopSource.name,
      selectedAudioInput?.deviceId,
      selectedAudioInput?.label,
      {
        captureKind: desktopSource.kind,
        displaySourceName: desktopSource.name,
        systemAudio: useSystemAudio,
      },
    );
    if (!linked) {
      setError(
        "This share could not be saved locally. Check app storage, then try again.",
      );
      return false;
    }
    await acquireWarmLocalVideoCapture(
      nextSource.sourceId,
      linked,
      true,
      pickerCaptureConsumerId,
    );
    finishLink(
      nextSource,
      desktopSource.kind,
      useSystemAudio || Boolean(selectedAudioInput),
    );
    return true;
  };

  const linkVideoInput = async (nextSource: LocalVideoInputMediaSource) => {
    const video = videoInputs.find(
      (device) => device.deviceId === videoDeviceId,
    );
    if (!video) return false;
    const linked = bindLocalVideoInput(
      nextSource.sourceId,
      video.deviceId,
      video.label || label || "Video input",
      selectedAudioInput?.deviceId,
      selectedAudioInput?.label,
    );
    if (!linked) {
      setError(
        "This input could not be saved locally. Check browser storage, then try again.",
      );
      return false;
    }
    await acquireWarmLocalVideoCapture(
      nextSource.sourceId,
      linked,
      true,
      pickerCaptureConsumerId,
    );
    finishLink(nextSource, "device", Boolean(selectedAudioInput));
    return true;
  };

  const link = async () => {
    const nextSource =
      source ??
      createLocalVideoInputMediaSource(
        label,
        isDesktopMode ? captureKind : "device",
      );
    setIsLoading(true);
    setError("");
    let linked = false;
    try {
      // Release only this picker's preview before the save preflight begins.
      await clearDevicePreview();
      if (isDesktopMode) {
        linked = await linkDesktopShare(nextSource);
        return;
      }
      linked = await linkVideoInput(nextSource);
    } catch (nextError) {
      if (nextError instanceof LocalVideoCaptureOwnedError) {
        finishLink(
          nextSource,
          isDesktopMode ? captureKind : "device",
          useSystemAudio || Boolean(selectedAudioInput),
        );
        linked = true;
        return;
      }
      setError(
        getLocalVideoSourceErrorMessage(
          nextError,
          isDesktopMode ? captureKind : "device",
        ),
      );
    } finally {
      await releaseWarmLocalVideoCapture(
        nextSource.sourceId,
        pickerCaptureConsumerId,
      ).catch((releaseError) =>
        console.error(
          "Video input setup could not release capture:",
          releaseError,
        ),
      );
      setIsLoading(false);
      if (!linked && !isDesktopMode && open) {
        previewPausedRef.current = false;
        setPreviewPaused(false);
        setPreviewRefreshKey((current) => current + 1);
      }
    }
  };

  let triggerLabel = source ? "Relink input" : "Add video input";
  if (isDesktopMode) {
    triggerLabel = source ? "Relink share" : "Add screen or window";
  }
  let sheetTitle = source ? "Relink video input" : "Add video input";
  if (isDesktopMode) {
    sheetTitle = source
      ? `Relink ${shareTarget} share`
      : "Add a screen or window";
  }
  let sheetDescription =
    "Media saves a logical input name. This computer keeps the USB hardware mapping locally.";
  if (isDesktopMode) {
    sheetDescription = canListDesktopSources
      ? "Share a screen or Canva Present window. Media saves the name; only this computer can push it to your chosen WorshipSync display."
      : "Share a screen or Canva Present window in this browser. Only this computer can show the live share; sharing ends when this tab closes.";
  }
  const desktopPlaceholder = hasListedDesktopSources
    ? "No screens or windows found"
    : "Finding screens and windows…";
  let hasSelectedSource = Boolean(videoDeviceId);
  if (isDesktopMode) {
    hasSelectedSource = canListDesktopSources
      ? Boolean(desktopSourceId)
      : Boolean(browserShare);
  }
  const canSave = !isLoading && hasSelectedSource;
  const saveLabel = source ? "Save local link" : "Add to Media";
  let triggerIcon = source ? Cable : Video;
  if (isDesktopMode) triggerIcon = MonitorUp;
  const showDeviceOrBrowserPreview =
    (!isDesktopMode && Boolean(videoDeviceId)) ||
    (isDesktopMode && !canListDesktopSources && Boolean(browserShare));
  const previewObjectFit = fit === "cover" ? "object-cover" : "object-contain";
  let livePreviewStatusLabel = "Starting preview…";
  if (previewStatus === "error") {
    livePreviewStatusLabel = previewError || "Preview unavailable";
  } else if (previewStatus === "ready") {
    livePreviewStatusLabel = "";
  }

  let desktopSourcePreview: ReactNode = null;
  if (selectedDesktopSource?.thumbnailDataUrl) {
    desktopSourcePreview = (
      <img
        src={selectedDesktopSource.thumbnailDataUrl}
        alt={`Preview of ${selectedDesktopSource.name}`}
        className={`aspect-video w-full rounded border border-white/10 bg-black ${previewObjectFit}`}
      />
    );
  } else if (selectedDesktopSource) {
    desktopSourcePreview = (
      <div
        className="flex aspect-video w-full items-center justify-center rounded border border-white/10 bg-black px-4 text-center text-sm text-neutral-400"
        role="status"
      >
        No preview for this screen or window
      </div>
    );
  }

  // The preview <video> mounts only after a source is selected; re-attach if
  // getUserMedia finished while the element was still unmounted.
  useEffect(() => {
    if (!showDeviceOrBrowserPreview || previewStatus !== "ready") return;
    if (!isDesktopMode || canListDesktopSources) return;
    const stream = browserShare?.stream;
    attachPreviewStream(previewVideoRef.current, stream);
  }, [
    browserShare?.stream,
    canListDesktopSources,
    isDesktopMode,
    previewStatus,
    showDeviceOrBrowserPreview,
  ]);

  return (
    <>
      {!hideTrigger ? (
        <Button
          variant="tertiary"
          svg={triggerIcon}
          className={className}
          onClick={() => setOpen(true)}
        >
          {triggerLabel}
        </Button>
      ) : null}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="max-w-lg">
          <SheetHeader>
            <SheetTitle>{sheetTitle}</SheetTitle>
            <SheetDescription>{sheetDescription}</SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
            <Input
              label={isDesktopMode ? "Share name" : "Input name"}
              value={label}
              onChange={(value) => {
                setIsLabelEdited(true);
                setLabel(String(value));
              }}
            />
            {isDesktopMode && canListDesktopSources ? (
              <>
                <div className="flex items-end gap-2">
                  <Select
                    label="Screen or window"
                    options={
                      desktopOptions.length > 0
                        ? desktopOptions
                        : [{ value: "", label: desktopPlaceholder }]
                    }
                    value={desktopSourceId}
                    onChange={(value) => {
                      setDesktopSourceId(value);
                      setError("");
                    }}
                    selectClassName="w-full"
                    className="flex-1"
                    disabled={desktopOptions.length === 0}
                  />
                  <Button
                    variant="tertiary"
                    svg={RefreshCw}
                    aria-label="Refresh screens and windows"
                    disabled={isLoading}
                    onClick={() => void refreshDesktopSources()}
                  />
                </div>
                {desktopSourcePreview}
              </>
            ) : null}
            {isDesktopMode && !canListDesktopSources ? (
              <div className="flex flex-col gap-2">
                <Button
                  variant="secondary"
                  svg={MonitorUp}
                  isLoading={isLoading}
                  disabled={isLoading || !supportsDesktopCapture()}
                  onClick={() => void chooseBrowserShare()}
                >
                  {browserShare
                    ? "Choose a different share"
                    : "Choose what to share"}
                </Button>
                <p className="text-sm text-neutral-300">
                  {browserShare
                    ? `Sharing ${browserShare.name}. Sound follows what you allowed in the share window.`
                    : "Pick a screen, window, or tab in the browser share window."}
                </p>
              </div>
            ) : null}
            {!isDesktopMode ? (
              <div className="flex items-end gap-2">
                <Select
                  label="Video input"
                  options={videoOptions}
                  value={videoDeviceId}
                  onChange={setVideoDeviceId}
                  selectClassName="w-full"
                  className="flex-1"
                  disabled={!hasEnumeratedDevices || videoInputs.length === 0}
                />
                <Button
                  variant="tertiary"
                  svg={RefreshCw}
                  aria-label="Refresh video inputs"
                  disabled={isLoading}
                  onClick={() => void refresh()}
                />
              </div>
            ) : null}
            {!isDesktopMode || canListDesktopSources ? (
              <Select
                label="Sound"
                options={audioOptions}
                value={audioDeviceId}
                onChange={setAudioDeviceId}
                selectClassName="w-full"
              />
            ) : null}
            <Select
              label="Fit"
              options={[
                { value: "contain", label: "Fit entire frame" },
                { value: "cover", label: "Fill and crop" },
              ]}
              value={fit}
              onChange={(value) =>
                setFit(value === "cover" ? "cover" : "contain")
              }
              selectClassName="w-full"
            />
            {showDeviceOrBrowserPreview ? (
              <div className="relative aspect-video w-full overflow-hidden rounded border border-white/10 bg-black">
                <video
                  ref={previewVideoRef}
                  muted
                  playsInline
                  autoPlay
                  aria-label="Input preview"
                  className={`h-full w-full ${previewObjectFit} ${
                    previewStatus === "ready" ? "opacity-100" : "opacity-0"
                  }`}
                />
                {livePreviewStatusLabel ? (
                  <div
                    className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-neutral-300"
                    role="status"
                  >
                    {livePreviewStatusLabel}
                  </div>
                ) : null}
              </div>
            ) : null}
            {showAllowAccess || showRetryDeviceScan ? (
              <div className="flex flex-wrap gap-2">
                {showAllowAccess ? (
                  <Button
                    variant="secondary"
                    svg={Video}
                    isLoading={isLoading}
                    disabled={isLoading}
                    onClick={() => void allowAccess()}
                  >
                    Allow input access
                  </Button>
                ) : null}
                {showRetryDeviceScan ? (
                  <Button
                    variant="tertiary"
                    svg={RefreshCw}
                    disabled={isLoading}
                    onClick={() => void refresh()}
                  >
                    Try again
                  </Button>
                ) : null}
              </div>
            ) : null}
            {error ? (
              <p
                className="rounded-md border border-amber-500/35 bg-amber-950/35 p-3 text-sm text-amber-100"
                role="alert"
              >
                {error}
              </p>
            ) : null}
            <div className="mt-auto flex justify-end gap-2 border-t border-white/10 pt-5">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="cta"
                disabled={!canSave}
                isLoading={isLoading}
                onClick={() => void link()}
              >
                {saveLabel}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};

export default LocalVideoInputPicker;
