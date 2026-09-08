import type {
  LocalVideoCaptureKind,
  LocalVideoInputMediaSource,
  LocalVideoInputPresentation,
} from "../types";
import generateRandomId from "./generateRandomId";

const MAX_DEVICE_ID_LENGTH = 512;
const MAX_LABEL_LENGTH = 120;
const LOCAL_VIDEO_INPUTS_KEY = "worshipsync_local_video_inputs";

const DEFAULT_LABELS: Record<LocalVideoCaptureKind, string> = {
  device: "Video input",
  screen: "Screen",
  window: "Window",
};

const normalizeCaptureKind = (value: unknown): LocalVideoCaptureKind =>
  value === "screen" || value === "window" ? value : "device";

/** Desktop shares are named for what they show; hardware keeps the input wording. */
export const getDefaultLocalVideoInputLabel = (
  captureKind: LocalVideoCaptureKind = "device",
) => DEFAULT_LABELS[captureKind];

export const isDesktopCaptureKind = (
  captureKind: LocalVideoCaptureKind | undefined,
): captureKind is "screen" | "window" =>
  captureKind === "screen" || captureKind === "window";

/**
 * Hardware inputs keep the payload they have always synced: an absent kind
 * already means `device`, so only desktop shares add the field.
 */
const captureKindFields = (captureKind: LocalVideoCaptureKind) =>
  isDesktopCaptureKind(captureKind) ? { captureKind } : {};

export const createLocalVideoInputMediaSource = (
  label = "Video input",
  captureKind: LocalVideoCaptureKind = "device",
): LocalVideoInputMediaSource => ({
  kind: "local-video-input",
  sourceId: `local_video_${generateRandomId()}`,
  label:
    cleanString(label, MAX_LABEL_LENGTH) ||
    getDefaultLocalVideoInputLabel(captureKind),
  ...captureKindFields(captureKind),
  fit: "contain",
  audioEnabled: true,
});

export const normalizeLocalVideoInputMediaSource = (
  value: unknown,
): LocalVideoInputMediaSource | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== "local-video-input") return undefined;
  const sourceId = cleanString(candidate.sourceId, MAX_DEVICE_ID_LENGTH);
  if (!sourceId) return undefined;
  const captureKind = normalizeCaptureKind(candidate.captureKind);
  return {
    kind: "local-video-input",
    sourceId,
    label:
      cleanString(candidate.label, MAX_LABEL_LENGTH) ||
      getDefaultLocalVideoInputLabel(captureKind),
    ...captureKindFields(captureKind),
    ...(candidate.fit === "cover" || candidate.fit === "contain"
      ? { fit: candidate.fit }
      : {}),
    ...(typeof candidate.audioEnabled === "boolean"
      ? { audioEnabled: candidate.audioEnabled }
      : {}),
    ...(candidate.ownerDeviceId
      ? {
          ownerDeviceId: cleanString(
            candidate.ownerDeviceId,
            MAX_DEVICE_ID_LENGTH,
          ),
        }
      : {}),
    ...(candidate.ownerLabel
      ? { ownerLabel: cleanString(candidate.ownerLabel, MAX_LABEL_LENGTH) }
      : {}),
  };
};

export type LocalVideoInputBinding = {
  sourceId: string;
  /** Hardware device id, or the desktop capture source id for screens/windows. */
  deviceId: string;
  deviceLabel: string;
  audioDeviceId?: string;
  audioDeviceLabel?: string;
  captureKind?: LocalVideoCaptureKind;
  /** Window/screen title, used to find a share again after it is reopened. */
  displaySourceName?: string;
  /** Desktop capture may carry this computer's own sound instead of an input. */
  systemAudio?: boolean;
};

export type LocalVideoInputBindingOptions = {
  captureKind?: LocalVideoCaptureKind;
  displaySourceName?: string;
  systemAudio?: boolean;
};

const buildBindingExtras = (options?: LocalVideoInputBindingOptions) => {
  const captureKind = normalizeCaptureKind(options?.captureKind);
  if (captureKind === "device") return {};
  const displaySourceName = cleanString(
    options?.displaySourceName,
    MAX_LABEL_LENGTH,
  );
  return {
    captureKind,
    ...(displaySourceName ? { displaySourceName } : {}),
    ...(options?.systemAudio ? { systemAudio: true } : {}),
  };
};

const cleanString = (value: unknown, maxLength: number) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

/**
 * Validate the synchronized route metadata. The hardware id stays in the
 * owning browser profile; no media stream or reusable URL is synchronized.
 */
export const normalizeLocalVideoInput = (
  value: unknown,
): LocalVideoInputPresentation | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  const sourceId = cleanString(candidate.sourceId, MAX_DEVICE_ID_LENGTH);
  const ownerDeviceId = cleanString(
    candidate.ownerDeviceId,
    MAX_DEVICE_ID_LENGTH,
  );
  if (!sourceId || !ownerDeviceId) return undefined;
  const captureKind = normalizeCaptureKind(candidate.captureKind);

  return {
    sourceId,
    ownerDeviceId,
    deviceLabel:
      cleanString(candidate.deviceLabel, MAX_LABEL_LENGTH) ||
      getDefaultLocalVideoInputLabel(captureKind),
    ownerLabel:
      cleanString(candidate.ownerLabel, MAX_LABEL_LENGTH) || "source device",
    ...captureKindFields(captureKind),
    ...(candidate.fit === "cover" || candidate.fit === "contain"
      ? { fit: candidate.fit }
      : {}),
    ...(typeof candidate.audioEnabled === "boolean"
      ? { audioEnabled: candidate.audioEnabled }
      : {}),
  };
};

const readLocalBindings = (): LocalVideoInputBinding[] => {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(
      localStorage.getItem(LOCAL_VIDEO_INPUTS_KEY) ?? "[]",
    );
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value): LocalVideoInputBinding[] => {
      if (!value || typeof value !== "object") return [];
      const candidate = value as Record<string, unknown>;
      const sourceId = cleanString(candidate.sourceId, MAX_DEVICE_ID_LENGTH);
      const deviceId = cleanString(candidate.deviceId, MAX_DEVICE_ID_LENGTH);
      if (!sourceId || !deviceId) return [];
      const audioDeviceId = cleanString(
        candidate.audioDeviceId,
        MAX_DEVICE_ID_LENGTH,
      );
      const captureKind = normalizeCaptureKind(candidate.captureKind);
      return [{
        sourceId,
        deviceId,
        deviceLabel:
          cleanString(candidate.deviceLabel, MAX_LABEL_LENGTH) ||
          getDefaultLocalVideoInputLabel(captureKind),
        ...buildBindingExtras({
          captureKind,
          displaySourceName: candidate.displaySourceName as string | undefined,
          systemAudio: candidate.systemAudio === true,
        }),
        ...(audioDeviceId
          ? {
              audioDeviceId,
              audioDeviceLabel:
                cleanString(candidate.audioDeviceLabel, MAX_LABEL_LENGTH) ||
                "Audio input",
            }
          : {}),
      }];
    });
  } catch {
    return [];
  }
};

/** Keep the hardware id on this browser profile and return its safe route id. */
export const registerLocalVideoInput = (
  deviceId: string,
  deviceLabel: string,
  audioDeviceId?: string,
  audioDeviceLabel?: string,
  options?: LocalVideoInputBindingOptions,
) => {
  const cleanDeviceId = cleanString(deviceId, MAX_DEVICE_ID_LENGTH);
  if (!cleanDeviceId) return undefined;
  const bindings = readLocalBindings();
  const existing = bindings.find((binding) => binding.deviceId === cleanDeviceId);
  const cleanAudioDeviceId = cleanString(
    audioDeviceId,
    MAX_DEVICE_ID_LENGTH,
  );
  const binding: LocalVideoInputBinding = {
    sourceId: existing?.sourceId ?? `local_video_${generateRandomId()}`,
    deviceId: cleanDeviceId,
    deviceLabel:
      cleanString(deviceLabel, MAX_LABEL_LENGTH) ||
      getDefaultLocalVideoInputLabel(options?.captureKind),
    ...buildBindingExtras(options),
    ...(cleanAudioDeviceId
      ? {
          audioDeviceId: cleanAudioDeviceId,
          audioDeviceLabel:
            cleanString(audioDeviceLabel, MAX_LABEL_LENGTH) || "Audio input",
        }
      : {}),
  };
  const nextBindings = existing
    ? bindings.map((candidate) =>
        candidate.sourceId === existing.sourceId ? binding : candidate,
      )
    : [...bindings, binding];
  try {
    localStorage.setItem(
      LOCAL_VIDEO_INPUTS_KEY,
      JSON.stringify(nextBindings),
    );
  } catch {
    return undefined;
  }
  return binding;
};

/** Link a saved logical source to hardware on this workstation only. */
export const bindLocalVideoInput = (
  sourceId: string,
  deviceId: string,
  deviceLabel: string,
  audioDeviceId?: string,
  audioDeviceLabel?: string,
  options?: LocalVideoInputBindingOptions,
) => {
  const cleanSourceId = cleanString(sourceId, MAX_DEVICE_ID_LENGTH);
  const cleanDeviceId = cleanString(deviceId, MAX_DEVICE_ID_LENGTH);
  if (!cleanSourceId || !cleanDeviceId) return undefined;
  const bindings = readLocalBindings();
  const cleanAudioDeviceId = cleanString(audioDeviceId, MAX_DEVICE_ID_LENGTH);
  const binding: LocalVideoInputBinding = {
    sourceId: cleanSourceId,
    deviceId: cleanDeviceId,
    deviceLabel:
      cleanString(deviceLabel, MAX_LABEL_LENGTH) ||
      getDefaultLocalVideoInputLabel(options?.captureKind),
    ...buildBindingExtras(options),
    ...(cleanAudioDeviceId
      ? {
          audioDeviceId: cleanAudioDeviceId,
          audioDeviceLabel:
            cleanString(audioDeviceLabel, MAX_LABEL_LENGTH) || "Audio input",
        }
      : {}),
  };
  const nextBindings = bindings.some(
    (candidate) => candidate.sourceId === cleanSourceId,
  )
    ? bindings.map((candidate) =>
        candidate.sourceId === cleanSourceId ? binding : candidate,
      )
    : [...bindings, binding];
  try {
    localStorage.setItem(LOCAL_VIDEO_INPUTS_KEY, JSON.stringify(nextBindings));
  } catch {
    return undefined;
  }
  return binding;
};

export const buildLocalVideoInputPresentation = (
  source: LocalVideoInputMediaSource,
  ownerDeviceId: string,
  ownerLabel: string,
): LocalVideoInputPresentation | undefined => {
  const normalized = normalizeLocalVideoInputMediaSource(source);
  if (!normalized) return undefined;
  const binding = resolveLocalVideoInputBinding(normalized.sourceId);
  if (!binding) return undefined;
  return {
    sourceId: normalized.sourceId,
    // A share keeps its saved name; hardware keeps the bound device name.
    deviceLabel: isDesktopCaptureKind(normalized.captureKind)
      ? normalized.label || binding.deviceLabel
      : binding.deviceLabel || normalized.label,
    ownerDeviceId,
    ownerLabel,
    ...captureKindFields(normalized.captureKind ?? "device"),
    fit: normalized.fit,
    audioEnabled: normalized.audioEnabled,
  };
};

export const resolveLocalVideoInputBinding = (sourceId: string) =>
  readLocalBindings().find((binding) => binding.sourceId === sourceId);

export const resolveLocalVideoInputDeviceId = (sourceId: string) =>
  resolveLocalVideoInputBinding(sourceId)?.deviceId;

export const getVideoInputErrorMessage = (
  error: unknown,
  includesAudio = false,
) => {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return includesAudio
      ? "Allow video and sound access on this device, then try again."
      : "Allow camera access on this device, then try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "Reconnect the video input, then try again.";
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return "Close other apps using this input, then try again.";
  }
  return "Check the input connection and camera permission, then try again.";
};

/** Desktop shares fail for different reasons than a cable, so guide differently. */
export const getDesktopCaptureErrorMessage = (
  error: unknown,
  captureKind: LocalVideoCaptureKind = "screen",
) => {
  const target = captureKind === "window" ? "window" : "screen";
  // Matched by name so this copy helper stays free of capture-runtime imports.
  const errorName = error instanceof Error ? error.name : "";
  if (errorName === "DesktopCaptureShareEndedError") {
    return `Sharing stopped. Open Media on this computer and share the ${target} again.`;
  }
  if (errorName === "DesktopCaptureSourceMissingError") {
    return `This ${target} is no longer open. Choose it again on this computer.`;
  }
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return `Allow screen recording for WorshipSync on this computer, then share the ${target} again.`;
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return `This ${target} is no longer open. Choose it again on this computer.`;
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return `This ${target} could not be captured. Choose it again on this computer.`;
  }
  return `Choose the ${target} again on this computer, then try again.`;
};

/** One entry point for status copy across hardware inputs and desktop shares. */
export const getLocalVideoSourceErrorMessage = (
  error: unknown,
  captureKind: LocalVideoCaptureKind | undefined,
  includesAudio = false,
) =>
  isDesktopCaptureKind(captureKind)
    ? getDesktopCaptureErrorMessage(error, captureKind)
    : getVideoInputErrorMessage(error, includesAudio);

export const getAudioInputErrorMessage = (error: unknown) => {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Allow sound access on this device, then try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "Reconnect the audio input, then try again.";
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return "Close other apps using the audio input, then try again.";
  }
  return "Check the audio input and sound permission, then try again.";
};
