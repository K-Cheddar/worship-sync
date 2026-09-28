import {
  localVideoDiagnosticsEnabled,
  recordLocalVideoConstraints,
} from "./localVideoDiagnostics";

export type LocalVideoPixelSize = {
  width: number;
  height: number;
};

export type LocalVideoCaptureProfile = LocalVideoPixelSize & {
  id: "720p" | "1080p" | "1440p" | "2160p";
};

export const LOCAL_VIDEO_CAPTURE_FRAME_RATE = {
  preview: 30,
  audience: 60,
} as const;

export const DEFAULT_LOCAL_VIDEO_CAPTURE_FRAME_RATE =
  LOCAL_VIDEO_CAPTURE_FRAME_RATE.audience;

const CAPTURE_PROFILES: LocalVideoCaptureProfile[] = [
  { id: "720p", width: 1_280, height: 720 },
  { id: "1080p", width: 1_920, height: 1_080 },
  { id: "1440p", width: 2_560, height: 1_440 },
  { id: "2160p", width: 3_840, height: 2_160 },
];

export const DEFAULT_LOCAL_VIDEO_CAPTURE_PROFILE = CAPTURE_PROFILES[1];

const normalizeDimension = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;

/**
 * Selects the smallest standard capture mode that covers every rendered
 * output. A finite 4K ceiling keeps one unusual window from requesting an
 * unbounded camera mode while preserving native detail on common displays.
 */
export const resolveLocalVideoCaptureProfile = (
  targets: LocalVideoPixelSize[],
): LocalVideoCaptureProfile => {
  const required = targets.reduce<LocalVideoPixelSize>(
    (maximum, target) => ({
      width: Math.max(maximum.width, normalizeDimension(target.width)),
      height: Math.max(maximum.height, normalizeDimension(target.height)),
    }),
    { width: 0, height: 0 },
  );
  if (required.width === 0 || required.height === 0) {
    return DEFAULT_LOCAL_VIDEO_CAPTURE_PROFILE;
  }
  return (
    CAPTURE_PROFILES.find(
      (profile) =>
        required.width <= profile.width && required.height <= profile.height,
    ) ?? CAPTURE_PROFILES[CAPTURE_PROFILES.length - 1]
  );
};

/** Preview roles favor lower capture cost; unknown roles retain audience quality. */
export const getLocalVideoCaptureFrameRateForRole = (windowRole?: string) =>
  windowRole === "editor" || windowRole === "slide" || windowRole?.endsWith("-preview")
    ? LOCAL_VIDEO_CAPTURE_FRAME_RATE.preview
    : LOCAL_VIDEO_CAPTURE_FRAME_RATE.audience;

export const resolveLocalVideoCaptureFrameRate = (demands: number[]): number =>
  demands.length === 0
    ? DEFAULT_LOCAL_VIDEO_CAPTURE_FRAME_RATE
    : Math.max(
        ...demands.map((demand) =>
          Number.isFinite(demand)
            ? Math.min(DEFAULT_LOCAL_VIDEO_CAPTURE_FRAME_RATE, Math.max(1, Math.round(demand)))
            : DEFAULT_LOCAL_VIDEO_CAPTURE_FRAME_RATE,
        ),
      );

const MAX_CAPTURE_FRAME_RATE = DEFAULT_LOCAL_VIDEO_CAPTURE_FRAME_RATE;

const lastAppliedProfileByTrack = new WeakMap<
  MediaStreamTrack,
  string
>();

/**
 * VP8 realtime bitrate based on delivered pixels rather than monitor labels.
 * About 0.09 bits per pixel per frame retains motion detail while bounded
 * queues, rather than a low bitrate, remain the latency control.
 */
export const getLocalVideoRealtimeBitrate = (
  width: number,
  height: number,
  frameRate: number,
) => {
  const pixels = Math.max(1, width) * Math.max(1, height);
  const frames = Math.min(MAX_CAPTURE_FRAME_RATE, Math.max(1, frameRate));
  const calculated = pixels * frames * 0.09;
  const bounded = Math.min(45_000_000, Math.max(4_000_000, calculated));
  return Math.round(bounded / 250_000) * 250_000;
};

/**
 * Ask a local capture track for the smallest profile that covers the rendered
 * output. Skips when the track is already on that profile. Desktop and
 * fixed-mode cameras may reject renegotiation; callers treat that as
 * non-fatal and keep the existing mode.
 */
export const applyLocalVideoCaptureProfile = async (
  stream: MediaStream,
  targetWidth: number,
  targetHeight: number,
  sourceId?: string,
  targetFrameRate: number = DEFAULT_LOCAL_VIDEO_CAPTURE_FRAME_RATE,
) => {
  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack?.applyConstraints) return;
  const profile = resolveLocalVideoCaptureProfile([
    { width: targetWidth, height: targetHeight },
  ]);
  const profileKey = `${profile.id}:${targetFrameRate}`;
  if (lastAppliedProfileByTrack.get(videoTrack) === profileKey) return;
  const requestedConstraints = {
    width: { ideal: profile.width },
    height: { ideal: profile.height },
    frameRate: { ideal: targetFrameRate },
  };
  const diagnosticsEnabled = Boolean(sourceId && localVideoDiagnosticsEnabled());
  const before = diagnosticsEnabled ? videoTrack.getSettings?.() : undefined;
  try {
    await videoTrack.applyConstraints(requestedConstraints);
    lastAppliedProfileByTrack.set(videoTrack, profileKey);
    if (sourceId && diagnosticsEnabled) recordLocalVideoConstraints(sourceId, { profile, requestedConstraints, before, succeeded: true, after: videoTrack.getSettings?.() });
  } catch {
    if (sourceId && diagnosticsEnabled) recordLocalVideoConstraints(sourceId, { profile, requestedConstraints, before, succeeded: false, after: videoTrack.getSettings?.() });
    // Keep the closest available mode rather than surfacing a toast.
  }
};
