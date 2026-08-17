import {
  getAudioInputErrorMessage,
  type LocalVideoInputBinding,
} from "./localVideoInput";
import { reportLocalVideoIssue } from "./localVideoIssues";
import { publishLocalVideoMedia } from "./localVideoMediaRelay";
import { publishLocalVideoPreview } from "./localVideoPreviewRelay";
import { publishLocalVideoRealtime } from "./localVideoRealtimeRelay";
import { DEFAULT_LOCAL_VIDEO_CAPTURE_PROFILE } from "./localVideoQuality";
import { publishLocalVideoCaptureQuality } from "./localVideoCaptureQualityRelay";

type CaptureResult = {
  stream: MediaStream;
  audioError?: unknown;
};

type SourcePublisher = {
  video: HTMLVideoElement;
  stopMedia: () => void;
  stopPreview: () => void;
  stopRealtime: () => void;
  stopQuality: () => void;
};

type CaptureEntry = {
  bindingKey: string;
  promise: Promise<CaptureResult>;
  sourceIds: Set<string>;
  pendingPublishers: Set<string>;
  publishers: Map<string, SourcePublisher>;
  releaseLock?: () => void;
};

type CaptureLockManager = {
  request: (
    name: string,
    options: { mode: "exclusive"; ifAvailable: true },
    callback: (lock: unknown | null) => Promise<void>,
  ) => Promise<void>;
};

export class LocalVideoCaptureOwnedError extends Error {
  constructor() {
    super("This local input is already owned by another app window.");
    this.name = "LocalVideoCaptureOwnedError";
  }
}

const capturesByBinding = new Map<string, CaptureEntry>();
const capturesBySource = new Map<string, CaptureEntry>();
const consumersBySource = new Map<string, Set<string>>();

const bindingKeyFor = (binding: LocalVideoInputBinding) =>
  `${binding.deviceId}\u0000${binding.audioDeviceId ?? ""}`;

const stopStream = (stream: MediaStream) => {
  stream.getTracks().forEach((track) => track.stop());
};

const stopPublisher = (entry: CaptureEntry, sourceId: string) => {
  entry.pendingPublishers.delete(sourceId);
  const publisher = entry.publishers.get(sourceId);
  if (!publisher) return;
  entry.publishers.delete(sourceId);
  publisher.stopPreview();
  publisher.stopRealtime();
  publisher.stopQuality();
  publisher.stopMedia();
  publisher.video.srcObject = null;
};

const ensurePublisher = (sourceId: string, entry: CaptureEntry) => {
  if (
    entry.publishers.has(sourceId) ||
    entry.pendingPublishers.has(sourceId) ||
    typeof document === "undefined"
  ) {
    return;
  }
  entry.pendingPublishers.add(sourceId);
  void entry.promise.then(
    ({ stream, audioError }) => {
      entry.pendingPublishers.delete(sourceId);
      if (capturesBySource.get(sourceId) !== entry) return;
      if (audioError) {
        reportLocalVideoIssue(
          sourceId,
          `${getAudioInputErrorMessage(audioError)} Video will continue without sound.`,
        );
      }
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      entry.publishers.set(sourceId, {
        video,
        stopPreview: publishLocalVideoPreview(sourceId, video),
        stopRealtime: publishLocalVideoRealtime(sourceId, video, stream),
        stopMedia: publishLocalVideoMedia(sourceId, stream),
        stopQuality: publishLocalVideoCaptureQuality(sourceId, stream),
      });
      const playPromise = video.play();
      void playPromise?.catch(() => undefined);
    },
    () => {
      entry.pendingPublishers.delete(sourceId);
    },
  );
};

const openCapture = async (
  binding: LocalVideoInputBinding,
): Promise<CaptureResult> => {
  const mediaDevices = navigator.mediaDevices;
  if (!mediaDevices?.getUserMedia) {
    throw new Error("Video inputs are not supported in this browser.");
  }

  const stream = await mediaDevices.getUserMedia({
    audio: false,
    video: {
      deviceId: { exact: binding.deviceId },
      width: { ideal: DEFAULT_LOCAL_VIDEO_CAPTURE_PROFILE.width },
      height: { ideal: DEFAULT_LOCAL_VIDEO_CAPTURE_PROFILE.height },
      frameRate: { ideal: 60 },
    },
  });

  let audioError: unknown;
  if (binding.audioDeviceId) {
    try {
      const audioStream = await mediaDevices.getUserMedia({
        audio: { deviceId: { exact: binding.audioDeviceId } },
        video: false,
      });
      audioStream.getAudioTracks().forEach((track) => stream.addTrack(track));
    } catch (error) {
      audioError = error;
    }
  }

  return { stream, audioError };
};

const removeEntry = (entry: CaptureEntry) => {
  if (capturesByBinding.get(entry.bindingKey) === entry) {
    capturesByBinding.delete(entry.bindingKey);
  }
  entry.sourceIds.forEach((sourceId) => {
    if (capturesBySource.get(sourceId) === entry) {
      capturesBySource.delete(sourceId);
    }
    stopPublisher(entry, sourceId);
    consumersBySource.delete(sourceId);
  });
  entry.sourceIds.clear();
};

const stopEntry = async (entry: CaptureEntry) => {
  removeEntry(entry);
  try {
    const { stream } = await entry.promise;
    stopStream(stream);
  } catch {
    // A failed pending capture has no tracks to release.
  } finally {
    entry.releaseLock?.();
    entry.releaseLock = undefined;
  }
};

const openCaptureWithOwnership = (
  entry: CaptureEntry,
  binding: LocalVideoInputBinding,
) => {
  const lockManager = (navigator as Navigator & { locks?: CaptureLockManager })
    .locks;
  if (!lockManager) return openCapture(binding);

  return new Promise<CaptureResult>((resolve, reject) => {
    void lockManager
      .request(
        `worshipsync-local-video-broker:${entry.bindingKey}`,
        { mode: "exclusive", ifAvailable: true },
        async (lock) => {
          if (!lock) {
            reject(new LocalVideoCaptureOwnedError());
            return;
          }
          try {
            const result = await openCapture(binding);
            resolve(result);
            await new Promise<void>((release) => {
              entry.releaseLock = release;
            });
          } catch (error) {
            reject(error);
          }
        },
      )
      .catch(reject);
  });
};

const createEntry = (
  sourceId: string,
  binding: LocalVideoInputBinding,
  bindingKey: string,
) => {
  let entry: CaptureEntry;
  entry = {
    bindingKey,
    promise: Promise.resolve(undefined as never),
    sourceIds: new Set([sourceId]),
    pendingPublishers: new Set(),
    publishers: new Map(),
  };
  const promise = openCaptureWithOwnership(entry, binding)
    .then((result) => {
      const forgetEndedCapture = () => void stopEntry(entry);
      // Losing optional audio must not tear down a healthy video feed. The
      // owning view reports the audio warning while video continues; only the
      // required video track invalidates this pooled capture.
      result.stream
        .getVideoTracks()
        .forEach((track) =>
          track.addEventListener?.("ended", forgetEndedCapture, { once: true }),
        );
      return result;
    })
    .catch((error) => {
      removeEntry(entry);
      throw error;
    });
  entry.promise = promise;
  capturesByBinding.set(bindingKey, entry);
  capturesBySource.set(sourceId, entry);
  return entry;
};

/**
 * Keeps one capture per physical video/audio binding. Web Locks elect one owner
 * across app windows; logical slides sharing that hardware reuse both tracks
 * and add only a relay publisher for their own stable source id.
 */
export const acquireWarmLocalVideoCapture = async (
  sourceId: string,
  binding: LocalVideoInputBinding,
  publish = false,
  consumerId = "legacy",
) => {
  const bindingKey = bindingKeyFor(binding);
  let entry = capturesBySource.get(sourceId);

  if (entry && entry.bindingKey !== bindingKey) {
    entry.sourceIds.delete(sourceId);
    capturesBySource.delete(sourceId);
    stopPublisher(entry, sourceId);
    if (entry.sourceIds.size === 0) await stopEntry(entry);
    entry = undefined;
  }

  if (!entry) {
    entry = capturesByBinding.get(bindingKey);
    if (entry) {
      entry.sourceIds.add(sourceId);
      capturesBySource.set(sourceId, entry);
    } else {
      entry = createEntry(sourceId, binding, bindingKey);
    }
  }

  if (publish) ensurePublisher(sourceId, entry);
  const consumers = consumersBySource.get(sourceId) ?? new Set<string>();
  consumers.add(consumerId);
  consumersBySource.set(sourceId, consumers);
  return entry.promise;
};

/** Release one consumer without disrupting other views or live outputs. */
export const releaseWarmLocalVideoCapture = async (
  sourceId: string,
  consumerId: string,
) => {
  const consumers = consumersBySource.get(sourceId);
  if (!consumers) return;
  consumers.delete(consumerId);
  if (consumers.size > 0) return;
  consumersBySource.delete(sourceId);

  const entry = capturesBySource.get(sourceId);
  if (!entry) return;
  capturesBySource.delete(sourceId);
  entry.sourceIds.delete(sourceId);
  stopPublisher(entry, sourceId);
  if (entry.sourceIds.size === 0) await stopEntry(entry);
};

/** Stop one logical source without disrupting aliases using the same hardware. */
export const resetWarmLocalVideoCapture = async (sourceId: string) => {
  consumersBySource.delete(sourceId);
  const entry = capturesBySource.get(sourceId);
  if (!entry) return;
  capturesBySource.delete(sourceId);
  entry.sourceIds.delete(sourceId);
  stopPublisher(entry, sourceId);
  if (entry.sourceIds.size === 0) await stopEntry(entry);
};

export const resetAllWarmLocalVideoCaptures = () => {
  const entries = [...new Set(capturesByBinding.values())];
  return Promise.all(entries.map(stopEntry)).then(() => undefined);
};

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    void resetAllWarmLocalVideoCaptures();
  });
}
