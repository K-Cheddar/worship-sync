export type LocalVideoPixelSize = {
  width: number;
  height: number;
};

export type LocalVideoCaptureProfile = LocalVideoPixelSize & {
  id: "720p" | "1080p" | "1440p" | "2160p";
};

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
    CAPTURE_PROFILES.slice(1).find(
      (profile) =>
        required.width <= profile.width && required.height <= profile.height,
    ) ?? CAPTURE_PROFILES[CAPTURE_PROFILES.length - 1]
  );
};

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
  const frames = Math.min(60, Math.max(1, frameRate));
  const calculated = pixels * frames * 0.09;
  const bounded = Math.min(45_000_000, Math.max(4_000_000, calculated));
  return Math.round(bounded / 250_000) * 250_000;
};
