import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "../../utils/localVideoInput";
import {
  acquireWarmLocalVideoCapture,
  LocalVideoCaptureOwnedError,
  releaseWarmLocalVideoCapture,
  resetWarmLocalVideoCapture,
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

const enumerateInputs = async () => {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  return (await navigator.mediaDevices.enumerateDevices()).filter(
    (device) => device.kind === "videoinput" || device.kind === "audioinput",
  );
};

const stopShare = (share: BrowserShare | undefined) =>
  share?.stream.getTracks().forEach((track) => track.stop());

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
  const refreshRequestRef = useRef(0);
  const desktopRequestRef = useRef(0);
  const linkedShareRef = useRef<MediaStream | undefined>(undefined);
  const runningInElectron = isElectron();

  const refresh = useCallback(async () => {
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
      const videoInputs = next.filter((device) => device.kind === "videoinput");
      const audioInputs = next.filter((device) => device.kind === "audioinput");
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
  }, [isDesktopMode, source]);

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
    setLabel(
      source?.label ??
        getDefaultLocalVideoInputLabel(isDesktopMode ? "screen" : "device"),
    );
    setIsLabelEdited(Boolean(source?.label));
    setFit(source?.fit ?? "contain");
    void refresh();
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

  const videoInputs = useMemo(
    () => devices.filter((device) => device.kind === "videoinput"),
    [devices],
  );
  const audioInputs = useMemo(
    () => devices.filter((device) => device.kind === "audioinput"),
    [devices],
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
    const suggested = selectedDesktopSource?.name ?? browserShare?.name;
    if (suggested) setLabel(suggested);
  }, [browserShare?.name, isLabelEdited, selectedDesktopSource?.name]);

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
    onLinked({
      ...nextSource,
      label: label.trim() || nextSource.label,
      captureKind: nextCaptureKind,
      fit,
      audioEnabled,
    });
    setOpen(false);
  };

  const linkDesktopShare = async (nextSource: LocalVideoInputMediaSource) => {
    if (!canListDesktopSources) {
      const share = browserShare;
      if (!share) return;
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
        return;
      }
      linkedShareRef.current = share.stream;
      keepBrowserDesktopShare(nextSource.sourceId, share.stream);
      finishLink(
        nextSource,
        share.captureKind,
        share.stream.getAudioTracks().length > 0,
      );
      return;
    }

    const desktopSource = selectedDesktopSource;
    if (!desktopSource) return;
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
      return;
    }
    await acquireWarmLocalVideoCapture(
      nextSource.sourceId,
      linked,
      true,
      PICKER_CAPTURE_CONSUMER_ID,
    );
    finishLink(
      nextSource,
      desktopSource.kind,
      useSystemAudio || Boolean(selectedAudioInput),
    );
  };

  const linkVideoInput = async (nextSource: LocalVideoInputMediaSource) => {
    const video = videoInputs.find(
      (device) => device.deviceId === videoDeviceId,
    );
    if (!video) return;
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
      return;
    }
    await acquireWarmLocalVideoCapture(
      nextSource.sourceId,
      linked,
      true,
      PICKER_CAPTURE_CONSUMER_ID,
    );
    finishLink(nextSource, "device", Boolean(selectedAudioInput));
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
    try {
      await resetWarmLocalVideoCapture(nextSource.sourceId);
      if (isDesktopMode) {
        await linkDesktopShare(nextSource);
        return;
      }
      await linkVideoInput(nextSource);
    } catch (nextError) {
      if (nextError instanceof LocalVideoCaptureOwnedError) {
        finishLink(
          nextSource,
          isDesktopMode ? captureKind : "device",
          useSystemAudio || Boolean(selectedAudioInput),
        );
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
        PICKER_CAPTURE_CONSUMER_ID,
      ).catch((releaseError) =>
        console.error(
          "Video input setup could not release capture:",
          releaseError,
        ),
      );
      setIsLoading(false);
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
      ? "Media saves the share name. This computer keeps the screen or window it points to."
      : "Media saves the share name. Choose what to share in this browser; sharing ends when this tab closes.";
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
                {selectedDesktopSource?.thumbnailDataUrl ? (
                  <img
                    src={selectedDesktopSource.thumbnailDataUrl}
                    alt={`Preview of ${selectedDesktopSource.name}`}
                    className="w-full rounded border border-white/10 bg-black object-contain"
                  />
                ) : null}
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
                  {browserShare ? "Choose a different share" : "Choose what to share"}
                </Button>
                <p className="text-sm text-neutral-300">
                  {browserShare
                    ? `Sharing ${browserShare.name}. Sound follows what you allowed in the share window.`
                    : "Pick a screen, window, or tab in the browser share window."}
                </p>
              </div>
            ) : null}
            {!isDesktopMode ? (
              <Select
                label="Video input"
                options={videoOptions}
                value={videoDeviceId}
                onChange={setVideoDeviceId}
                selectClassName="w-full"
                disabled={!hasEnumeratedDevices || videoInputs.length === 0}
              />
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
            <div className="mt-auto flex justify-end border-t border-white/10 pt-5">
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
