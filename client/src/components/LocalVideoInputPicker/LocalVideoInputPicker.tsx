import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Cable, RefreshCw, Video } from "lucide-react";
import type { LocalVideoInputMediaSource } from "../../types";
import {
  bindLocalVideoInput,
  createLocalVideoInputMediaSource,
  getVideoInputErrorMessage,
  resolveLocalVideoInputBinding,
} from "../../utils/localVideoInput";
import {
  acquireWarmLocalVideoCapture,
  LocalVideoCaptureOwnedError,
  releaseWarmLocalVideoCapture,
  resetWarmLocalVideoCapture,
} from "../../utils/localVideoCapturePool";
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

type LocalVideoInputPickerProps = {
  source?: LocalVideoInputMediaSource;
  onLinked: (source: LocalVideoInputMediaSource) => void;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
};

const enumerateInputs = async () => {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  return (await navigator.mediaDevices.enumerateDevices()).filter(
    (device) => device.kind === "videoinput" || device.kind === "audioinput",
  );
};

const LocalVideoInputPicker = ({
  source,
  onLinked,
  className,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: LocalVideoInputPickerProps) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (nextOpen: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDeviceId, setVideoDeviceId] = useState("");
  const [audioDeviceId, setAudioDeviceId] = useState("");
  const [label, setLabel] = useState(source?.label ?? "Video input");
  const [fit, setFit] = useState<"contain" | "cover">(source?.fit ?? "contain");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [deviceEnumerationFailed, setDeviceEnumerationFailed] = useState(false);
  const [hasEnumeratedDevices, setHasEnumeratedDevices] = useState(false);
  const refreshRequestRef = useRef(0);
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
      setAudioDeviceId((current) =>
        audioInputs.some(
          (device) => device.deviceId === (current || binding?.audioDeviceId),
        )
          ? current || binding?.audioDeviceId || ""
          : "",
      );
    } catch (nextError) {
      if (requestId !== refreshRequestRef.current) return;
      setHasEnumeratedDevices(true);
      setDeviceEnumerationFailed(true);
      setDevices([]);
      setVideoDeviceId("");
      setAudioDeviceId("");
      setError(getVideoInputErrorMessage(nextError));
    }
  }, [source]);

  useEffect(() => {
    if (!open) return;
    setLabel(source?.label ?? "Video input");
    setFit(source?.fit ?? "contain");
    void refresh();
  }, [open, refresh, source?.fit, source?.label]);

  useEffect(() => {
    if (!open) return;
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;
    const handleDeviceChange = () => void refresh();
    mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () =>
      mediaDevices.removeEventListener("devicechange", handleDeviceChange);
  }, [open, refresh]);

  const videoInputs = useMemo(
    () => devices.filter((device) => device.kind === "videoinput"),
    [devices],
  );
  const audioInputs = useMemo(
    () => devices.filter((device) => device.kind === "audioinput"),
    [devices],
  );
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
  const audioOptions = [
    { value: "", label: "No sound" },
    ...audioInputs.map((device, index) => ({
      value: device.deviceId,
      label: device.label || `Audio input ${index + 1}`,
    })),
  ];
  const hasLabeledVideoInput = videoInputs.some((device) =>
    Boolean(device.label.trim()),
  );
  const showAllowAccess =
    !runningInElectron && hasEnumeratedDevices && !hasLabeledVideoInput;
  const showRetryDeviceScan =
    deviceEnumerationFailed ||
    (runningInElectron &&
      hasEnumeratedDevices &&
      !isLoading &&
      videoInputs.length === 0);

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

  const link = async () => {
    const video = videoInputs.find(
      (device) => device.deviceId === videoDeviceId,
    );
    if (!video) return;
    const audio = audioInputs.find(
      (device) => device.deviceId === audioDeviceId,
    );
    const nextSource = source ?? createLocalVideoInputMediaSource(label);
    setIsLoading(true);
    setError("");
    try {
      await resetWarmLocalVideoCapture(nextSource.sourceId);
      const linked = bindLocalVideoInput(
        nextSource.sourceId,
        video.deviceId,
        video.label || label || "Video input",
        audio?.deviceId,
        audio?.label,
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
      onLinked({
        ...nextSource,
        label: label.trim() || nextSource.label,
        fit,
        audioEnabled: Boolean(audio),
      });
      setOpen(false);
    } catch (nextError) {
      if (nextError instanceof LocalVideoCaptureOwnedError) {
        onLinked({
          ...nextSource,
          label: label.trim() || nextSource.label,
          fit,
          audioEnabled: Boolean(audio),
        });
        setOpen(false);
        return;
      }
      setError(getVideoInputErrorMessage(nextError));
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

  return (
    <>
      {!hideTrigger ? (
        <Button
          variant="tertiary"
          svg={source ? Cable : Video}
          className={className}
          onClick={() => setOpen(true)}
        >
          {source ? "Relink input" : "Add video input"}
        </Button>
      ) : null}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="max-w-lg">
          <SheetHeader>
            <SheetTitle>
              {source ? "Relink video input" : "Add video input"}
            </SheetTitle>
            <SheetDescription>
              Media saves a logical input name. This computer keeps the USB
              hardware mapping locally.
            </SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
            <Input
              label="Input name"
              value={label}
              onChange={(value) => setLabel(String(value))}
            />
            <Select
              label="Video input"
              options={videoOptions}
              value={videoDeviceId}
              onChange={setVideoDeviceId}
              selectClassName="w-full"
              disabled={!hasEnumeratedDevices || videoInputs.length === 0}
            />
            <Select
              label="Sound"
              options={audioOptions}
              value={audioDeviceId}
              onChange={setAudioDeviceId}
              selectClassName="w-full"
            />
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
                disabled={!videoDeviceId || isLoading}
                isLoading={isLoading}
                onClick={() => void link()}
              >
                {source ? "Save local link" : "Add to Media"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};

export default LocalVideoInputPicker;
