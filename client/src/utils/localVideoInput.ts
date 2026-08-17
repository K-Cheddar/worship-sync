import type {
  LocalVideoInputMediaSource,
  LocalVideoInputPresentation,
} from "../types";
import generateRandomId from "./generateRandomId";

const MAX_DEVICE_ID_LENGTH = 512;
const MAX_LABEL_LENGTH = 120;
const LOCAL_VIDEO_INPUTS_KEY = "worshipsync_local_video_inputs";

export const createLocalVideoInputMediaSource = (
  label = "Video input",
): LocalVideoInputMediaSource => ({
  kind: "local-video-input",
  sourceId: `local_video_${generateRandomId()}`,
  label: cleanString(label, MAX_LABEL_LENGTH) || "Video input",
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
  return {
    kind: "local-video-input",
    sourceId,
    label: cleanString(candidate.label, MAX_LABEL_LENGTH) || "Video input",
    ...(candidate.fit === "cover" || candidate.fit === "contain"
      ? { fit: candidate.fit }
      : {}),
    ...(typeof candidate.audioEnabled === "boolean"
      ? { audioEnabled: candidate.audioEnabled }
      : {}),
  };
};

export type LocalVideoInputBinding = {
  sourceId: string;
  deviceId: string;
  deviceLabel: string;
  audioDeviceId?: string;
  audioDeviceLabel?: string;
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

  return {
    sourceId,
    ownerDeviceId,
    deviceLabel:
      cleanString(candidate.deviceLabel, MAX_LABEL_LENGTH) || "Video input",
    ownerLabel:
      cleanString(candidate.ownerLabel, MAX_LABEL_LENGTH) || "source device",
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
      return [{
        sourceId,
        deviceId,
        deviceLabel:
          cleanString(candidate.deviceLabel, MAX_LABEL_LENGTH) || "Video input",
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
    deviceLabel: cleanString(deviceLabel, MAX_LABEL_LENGTH) || "Video input",
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
) => {
  const cleanSourceId = cleanString(sourceId, MAX_DEVICE_ID_LENGTH);
  const cleanDeviceId = cleanString(deviceId, MAX_DEVICE_ID_LENGTH);
  if (!cleanSourceId || !cleanDeviceId) return undefined;
  const bindings = readLocalBindings();
  const cleanAudioDeviceId = cleanString(audioDeviceId, MAX_DEVICE_ID_LENGTH);
  const binding: LocalVideoInputBinding = {
    sourceId: cleanSourceId,
    deviceId: cleanDeviceId,
    deviceLabel: cleanString(deviceLabel, MAX_LABEL_LENGTH) || "Video input",
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
    deviceLabel: binding.deviceLabel || normalized.label,
    ownerDeviceId,
    ownerLabel,
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
