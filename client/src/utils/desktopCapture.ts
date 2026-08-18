import type { LocalVideoCaptureKind } from "../types";
import {
  bindLocalVideoInput,
  type LocalVideoInputBinding,
} from "./localVideoInput";

/**
 * Screen and window capture for live output. The desktop app re-opens a saved
 * share silently through Electron's capture source ids, so a controller reload
 * never interrupts a live screen. Browsers cannot reopen a share without a
 * click, so a share captured in the browser is kept warm in this module and
 * handed back to the capture pool instead of being torn down.
 */

/** Screen content is mostly static; 30 fps keeps the live machine responsive. */
export const DESKTOP_CAPTURE_FRAME_RATE = 30;
const DESKTOP_CAPTURE_MAX_WIDTH = 1_920;
const DESKTOP_CAPTURE_MAX_HEIGHT = 1_080;

export type DesktopCaptureSource = {
  id: string;
  name: string;
  kind: "screen" | "window";
  thumbnailDataUrl?: string;
};

export class DesktopCaptureShareEndedError extends Error {
  constructor(captureKind: LocalVideoCaptureKind = "screen") {
    super(`This ${captureKind} share is no longer running.`);
    this.name = "DesktopCaptureShareEndedError";
  }
}

export class DesktopCaptureSourceMissingError extends Error {
  constructor(captureKind: LocalVideoCaptureKind = "screen") {
    super(`This ${captureKind} is no longer available to capture.`);
    this.name = "DesktopCaptureSourceMissingError";
  }
}

export class DesktopCaptureUnsupportedError extends Error {
  constructor() {
    super("Screen sharing is not supported in this browser.");
    this.name = "DesktopCaptureUnsupportedError";
  }
}

type LegacyDesktopConstraints = {
  mandatory: {
    chromeMediaSource: "desktop";
    chromeMediaSourceId?: string;
    maxWidth?: number;
    maxHeight?: number;
    maxFrameRate?: number;
  };
};

const getDesktopSourceApi = () =>
  typeof window === "undefined"
    ? undefined
    : window.electronAPI?.getDesktopCaptureSources;

/** Electron lists sources in-app; browsers use their own picker instead. */
export const supportsDesktopSourceList = () =>
  typeof getDesktopSourceApi() === "function";

export const supportsDesktopCapture = () =>
  supportsDesktopSourceList() ||
  (typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getDisplayMedia === "function");

export const listDesktopCaptureSources = async (options?: {
  withThumbnails?: boolean;
}): Promise<DesktopCaptureSource[]> => {
  const getSources = getDesktopSourceApi();
  if (!getSources) return [];
  const sources = await getSources({
    withThumbnails: options?.withThumbnails ?? false,
  });
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    kind: source.id.startsWith("window:") ? "window" : "screen",
    ...(source.thumbnailDataUrl
      ? { thumbnailDataUrl: source.thumbnailDataUrl }
      : {}),
  }));
};

/**
 * Browser shares stay live between capture-pool consumers. Only an explicit
 * relink, a page unload, or the browser's own stop control ends them.
 */
const warmBrowserShares = new Map<string, MediaStream>();

const hasLiveVideo = (stream: MediaStream) =>
  stream.getVideoTracks().some((track) => track.readyState === "live");

const stopStream = (stream: MediaStream) =>
  stream.getTracks().forEach((track) => track.stop());

const dropWarmBrowserShare = (sourceId: string) => {
  const existing = warmBrowserShares.get(sourceId);
  if (!existing) return;
  warmBrowserShares.delete(sourceId);
  stopStream(existing);
};

const shareListeners = new Set<(sourceId: string) => void>();

/** Lets a view that gave up on a stopped share pick up the replacement. */
export const subscribeBrowserDesktopShares = (
  listener: (sourceId: string) => void,
) => {
  shareListeners.add(listener);
  return () => shareListeners.delete(listener);
};

/** Hands a stream captured during a click to the capture pool. */
export const keepBrowserDesktopShare = (
  sourceId: string,
  stream: MediaStream,
) => {
  if (warmBrowserShares.get(sourceId) === stream) return;
  dropWarmBrowserShare(sourceId);
  warmBrowserShares.set(sourceId, stream);
  shareListeners.forEach((listener) => listener(sourceId));
  stream
    .getVideoTracks()
    .forEach((track) =>
      track.addEventListener?.(
        "ended",
        () => {
          if (warmBrowserShares.get(sourceId) === stream) {
            warmBrowserShares.delete(sourceId);
          }
        },
        { once: true },
      ),
    );
};

export const hasBrowserDesktopShare = (sourceId: string) => {
  const stream = warmBrowserShares.get(sourceId);
  if (!stream) return false;
  if (hasLiveVideo(stream)) return true;
  warmBrowserShares.delete(sourceId);
  return false;
};

export const stopBrowserDesktopShare = (sourceId: string) =>
  dropWarmBrowserShare(sourceId);

export const stopAllBrowserDesktopShares = () =>
  [...warmBrowserShares.keys()].forEach(dropWarmBrowserShare);

const detectCaptureKind = (stream: MediaStream): "screen" | "window" => {
  const surface = stream.getVideoTracks()[0]?.getSettings?.()
    .displaySurface as string | undefined;
  return surface === "window" ? "window" : "screen";
};

/**
 * Opens the browser's own share picker. Must run inside a click: browsers
 * reject `getDisplayMedia` without a fresh user gesture.
 */
export const requestBrowserDesktopCapture = async (): Promise<{
  stream: MediaStream;
  captureKind: "screen" | "window";
  name: string;
}> => {
  const getDisplayMedia = navigator.mediaDevices?.getDisplayMedia;
  if (!getDisplayMedia) throw new DesktopCaptureUnsupportedError();
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: DESKTOP_CAPTURE_FRAME_RATE } },
    audio: true,
  });
  const captureKind = detectCaptureKind(stream);
  return {
    stream,
    captureKind,
    name:
      stream.getVideoTracks()[0]?.label?.trim() ||
      (captureKind === "window" ? "Window" : "Screen"),
  };
};

/**
 * Finds the saved source again. Window ids change every time an app reopens,
 * so fall back to the saved title and re-save the refreshed id.
 */
const resolveElectronSourceId = async (binding: LocalVideoInputBinding) => {
  const captureKind = binding.captureKind === "window" ? "window" : "screen";
  const sources = await listDesktopCaptureSources();
  // Without a listing there is nothing to correct; the saved id is best effort.
  if (sources.length === 0) return binding.deviceId;
  if (sources.some((source) => source.id === binding.deviceId)) {
    return binding.deviceId;
  }
  const renamed = binding.displaySourceName
    ? sources.find(
        (source) =>
          source.kind === captureKind &&
          source.name === binding.displaySourceName,
      )
    : undefined;
  if (!renamed) throw new DesktopCaptureSourceMissingError(captureKind);
  bindLocalVideoInput(
    binding.sourceId,
    renamed.id,
    binding.deviceLabel,
    binding.audioDeviceId,
    binding.audioDeviceLabel,
    {
      captureKind,
      displaySourceName: renamed.name,
      systemAudio: binding.systemAudio,
    },
  );
  return renamed.id;
};

const buildElectronConstraints = (
  sourceId: string,
  withSystemAudio: boolean,
) =>
  ({
    audio: withSystemAudio
      ? ({ mandatory: { chromeMediaSource: "desktop" } } as LegacyDesktopConstraints)
      : false,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: sourceId,
        maxWidth: DESKTOP_CAPTURE_MAX_WIDTH,
        maxHeight: DESKTOP_CAPTURE_MAX_HEIGHT,
        maxFrameRate: DESKTOP_CAPTURE_FRAME_RATE,
      },
    } as LegacyDesktopConstraints,
    // Electron's desktop capture uses Chromium's legacy constraint shape, which
    // the standard MediaStreamConstraints type does not describe.
  }) as unknown as MediaStreamConstraints;

const openElectronDesktopCapture = async (binding: LocalVideoInputBinding) => {
  const sourceId = await resolveElectronSourceId(binding);
  if (!binding.systemAudio) {
    return {
      stream: await navigator.mediaDevices.getUserMedia(
        buildElectronConstraints(sourceId, false),
      ),
    };
  }
  try {
    return {
      stream: await navigator.mediaDevices.getUserMedia(
        buildElectronConstraints(sourceId, true),
      ),
    };
  } catch (systemAudioError) {
    // This computer's sound is not capturable on every platform. Keep the
    // picture live and report the sound loss to the owning view.
    return {
      stream: await navigator.mediaDevices.getUserMedia(
        buildElectronConstraints(sourceId, false),
      ),
      systemAudioError,
    };
  }
};

/**
 * Opens a saved screen or window share. Never prompts: the desktop app reopens
 * silently and the browser reuses the share captured when it was chosen.
 */
export const openDesktopCapture = async (
  binding: LocalVideoInputBinding,
): Promise<{ stream: MediaStream; systemAudioError?: unknown }> => {
  if (supportsDesktopSourceList()) return openElectronDesktopCapture(binding);

  const warmShare = warmBrowserShares.get(binding.sourceId);
  if (!warmShare || !hasLiveVideo(warmShare)) {
    warmBrowserShares.delete(binding.sourceId);
    throw new DesktopCaptureShareEndedError(binding.captureKind);
  }
  return { stream: warmShare };
};

/**
 * Releases a capture the pool no longer needs. A browser share is parked
 * instead of stopped so switching slides does not force a new click.
 */
export const releaseDesktopCapture = (
  binding: LocalVideoInputBinding,
  stream: MediaStream,
) => {
  if (!supportsDesktopSourceList() && hasLiveVideo(stream)) {
    keepBrowserDesktopShare(binding.sourceId, stream);
    return;
  }
  stopStream(stream);
};

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", stopAllBrowserDesktopShares);
}
