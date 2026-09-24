import type {
  ItemSlideType,
  MediaType,
  VideoBackgroundPlaybackCue,
  VideoBackgroundSendMode,
} from "../types";
import { serverNow } from "./serverTime";

export type VideoPreviewSnapshot = {
  mediaKey: string;
  currentTime: number;
  duration: number;
  paused: boolean;
};

export type VideoPreviewCommand =
  | { type: "play"; mediaKey: string; generation: number }
  | { type: "pause"; mediaKey: string; generation: number }
  | { type: "seek"; mediaKey: string; generation: number; positionSeconds: number }
  | { type: "restart"; mediaKey: string; generation: number };

/**
 * A command before it is stamped with a generation. The Omit has to
 * distribute over the union, or every variant collapses to the shared `type`
 * field and `positionSeconds` becomes unassignable.
 */
type PreviewCommandInput = VideoPreviewCommand extends infer Command
  ? Command extends VideoPreviewCommand
    ? Omit<Command, "generation" | "mediaKey">
    : never
  : never;

const emptySnapshot = (): VideoPreviewSnapshot => ({
  mediaKey: "",
  currentTime: 0,
  duration: 0,
  paused: true,
});

const snapshots = new Map<string, VideoPreviewSnapshot>();
const emptySnapshots = new Map<string, VideoPreviewSnapshot>();
/** Media whose preview transport the operator touched since the last send. */
let dirtyMediaKey: string | null = null;
let cueGeneration = 0;

/**
 * Cues are compared against ones that outlive this session: every output slot
 * keeps the last generation it received, and that survives in Firebase and in
 * the restored snapshot. A counter restarting at 0 therefore makes every new
 * cue look older than what a live output already holds, and the output ignores
 * transport for the rest of the service. Server time keeps generations ordered
 * across restarts and across machines; the +1 keeps two cues in the same
 * millisecond distinct.
 */
const nextCueGeneration = (): number => {
  cueGeneration = Math.max(cueGeneration + 1, serverNow());
  return cueGeneration;
};
let commandGeneration = 0;

const snapshotListeners = new Map<string, Set<(next: VideoPreviewSnapshot) => void>>();
const commandListeners = new Map<string, Set<(command: VideoPreviewCommand) => void>>();
let reporterGeneration = 0;
const activeReporterByMediaKey = new Map<string, number>();

export const isFileVideoBackground = (media?: MediaType): boolean => {
  if (!media || media.type !== "video" || !media.background) return false;
  if (media.localVideoInput) return false;
  return !media.background.startsWith("local-video-input://");
};

export const getSlideVideoBackgroundMedia = (
  slide?: ItemSlideType | null,
): MediaType | undefined =>
  slide?.boxes?.find((box) => isFileVideoBackground(box.mediaInfo))?.mediaInfo;

export const getVideoBackgroundMediaKey = (
  media?: MediaType,
): string | undefined => {
  if (!isFileVideoBackground(media) || !media) return undefined;
  if (media.localVideoFile && !media.localVideoFile.preferCloudPlayback) {
    return `local-video:${media.localVideoFile.id}:${media.localVideoFile.contentRevision ?? "legacy"}`;
  }
  return `remote:${media.muxPlaybackId || media.id || media.publicId || media.background}`;
};

/**
 * Send mode for a slide's video background. Slides authored before this was
 * per slide carry no value, and "continue" is what they behaved as.
 */
export const getSlideVideoBackgroundSendMode = (
  slide?: ItemSlideType | null,
): VideoBackgroundSendMode => slide?.videoBackgroundSendMode ?? "continue";

export const formatVideoClock = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const paddedSeconds = rest.toString().padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${paddedSeconds}`;
  }
  return `${minutes}:${paddedSeconds}`;
};

export const resolveVideoPlaybackPosition = (
  cue: Pick<
    VideoBackgroundPlaybackCue,
    "positionSeconds" | "paused" | "atServerMs"
  >,
  duration?: number,
  nowMs: number = serverNow(),
): number => {
  const elapsed = cue.paused ? 0 : Math.max(0, (nowMs - cue.atServerMs) / 1000);
  let position = Math.max(0, cue.positionSeconds + elapsed);
  if (duration && Number.isFinite(duration) && duration > 0) {
    position %= duration;
  }
  return position;
};

/**
 * How far a surface may drift from the cue clock before it needs correction.
 * Large enough to ignore decode jitter, small enough that no one in the room
 * can see two screens disagree.
 */
export const VIDEO_CUE_DRIFT_TOLERANCE_SECONDS = 0.35;

/** A persistent error this large is faster and safer to correct with one seek. */
export const VIDEO_CUE_HARD_SEEK_THRESHOLD_SECONDS = 1.5;

/** Keep audio/video correction subtle while allowing a stalled player to catch up. */
export const VIDEO_CUE_PLAYBACK_RATE_MIN = 0.98;
export const VIDEO_CUE_PLAYBACK_RATE_MAX = 1.02;
/** Do not leave a surface rate-correcting indefinitely; seek once instead. */
export const VIDEO_CUE_RATE_CORRECTION_MAX_DURATION_MS = 10_000;
const VIDEO_CUE_PLAYBACK_RATE_GAIN = 0.02;

export type VideoCueCorrection =
  | "none"
  | "speed up"
  | "slow down"
  | "return to 1x"
  | "hard seek";

export type VideoCueCorrectionDecision = {
  correction: VideoCueCorrection;
  playbackRate: number;
  shouldSeek: boolean;
};

/**
 * Selects the least disruptive way to bring an active player back to the cue
 * clock. Invalid drift is treated as a hard error so a bad playhead cannot
 * leave the output running indefinitely at an unknown position.
 */
export const resolveVideoCueCorrection = (
  drift: number,
  currentPlaybackRate: number,
): VideoCueCorrectionDecision => {
  if (
    !Number.isFinite(drift) ||
    Math.abs(drift) >= VIDEO_CUE_HARD_SEEK_THRESHOLD_SECONDS
  ) {
    return {
      correction: "hard seek",
      playbackRate: 1,
      shouldSeek: true,
    };
  }

  if (Math.abs(drift) <= VIDEO_CUE_DRIFT_TOLERANCE_SECONDS) {
    return {
      correction: currentPlaybackRate === 1 ? "none" : "return to 1x",
      playbackRate: 1,
      shouldSeek: false,
    };
  }

  const playbackRate = Math.min(
    VIDEO_CUE_PLAYBACK_RATE_MAX,
    Math.max(
      VIDEO_CUE_PLAYBACK_RATE_MIN,
      1 + drift * VIDEO_CUE_PLAYBACK_RATE_GAIN,
    ),
  );

  return {
    correction: drift > 0 ? "speed up" : "slow down",
    playbackRate,
    shouldSeek: false,
  };
};

/**
 * Signed seconds a surface sitting at `actualSeconds` is *behind* the cue
 * clock. Looping videos wrap, so the raw difference is folded into
 * [-duration/2, duration/2]: a player that just wrapped past the end reads as
 * slightly ahead rather than a whole duration behind.
 */
export const resolveVideoCueDrift = (
  cue: Pick<
    VideoBackgroundPlaybackCue,
    "positionSeconds" | "paused" | "atServerMs"
  >,
  actualSeconds: number,
  duration?: number,
  nowMs: number = serverNow(),
): number => {
  const expected = resolveVideoPlaybackPosition(cue, duration, nowMs);
  let drift = expected - actualSeconds;
  if (duration && Number.isFinite(duration) && duration > 0) {
    drift = ((drift % duration) + duration) % duration;
    if (drift > duration / 2) drift -= duration;
  }
  return drift;
};

/**
 * Opt-in tracing for the transport path, which spans the controller, Firebase
 * and each output window. Enable per window with
 * `window.__wsVideoDebug = true` in that window's devtools, then reproduce.
 */
export const logVideoCue = (scope: string, detail: unknown): void => {
  if (!(window as { __wsVideoDebug?: boolean }).__wsVideoDebug) return;
  console.log(`[video-cue] ${scope}`, detail);
};

const emptySnapshotFor = (mediaKey: string): VideoPreviewSnapshot => ({
  ...emptySnapshot(),
  mediaKey,
});

export const getVideoPreviewSnapshot = (mediaKey: string): VideoPreviewSnapshot =>
  snapshots.get(mediaKey) ?? getEmptySnapshot(mediaKey);

const getEmptySnapshot = (mediaKey: string): VideoPreviewSnapshot => {
  const cached = emptySnapshots.get(mediaKey);
  if (cached) return cached;
  const empty = emptySnapshotFor(mediaKey);
  emptySnapshots.set(mediaKey, empty);
  return empty;
};

export const subscribeVideoPreviewSnapshot = (
  mediaKey: string,
  listener: (next: VideoPreviewSnapshot) => void,
): (() => void) => {
  const listeners = snapshotListeners.get(mediaKey) ?? new Set();
  listeners.add(listener);
  snapshotListeners.set(mediaKey, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      snapshotListeners.delete(mediaKey);
      if (!snapshots.has(mediaKey)) emptySnapshots.delete(mediaKey);
    }
  };
};

/** Sub-frame playhead moves are not worth a re-render of the transport UI. */
const REPORT_EPSILON_SECONDS = 0.05;

const publishVideoPreviewState = (next: VideoPreviewSnapshot): void => {
  const snapshot = getVideoPreviewSnapshot(next.mediaKey);
  const hasSnapshot = snapshots.has(next.mediaKey);
  // `timeupdate` fires several times a second on every surface; skipping
  // no-op reports keeps the transport UI off React's render path unless the
  // operator would actually see a difference.
  if (
    snapshot.paused === next.paused &&
    Math.abs(snapshot.duration - next.duration) < REPORT_EPSILON_SECONDS &&
    Math.abs(snapshot.currentTime - next.currentTime) < REPORT_EPSILON_SECONDS
  ) {
    if (!hasSnapshot) snapshots.set(next.mediaKey, next);
    return;
  }
  snapshots.set(next.mediaKey, next);
  snapshotListeners.get(next.mediaKey)?.forEach((listener) => listener(next));
};

export const reportVideoPreviewState = (next: VideoPreviewSnapshot): void => {
  publishVideoPreviewState(next);
};

/** Claims one media's editor transport until this reporter is replaced or cleared. */
export const createVideoPreviewReporter = (mediaKey: string) => {
  const reporterId = ++reporterGeneration;
  activeReporterByMediaKey.set(mediaKey, reporterId);
  return {
    report: (next: VideoPreviewSnapshot) => {
      if (
        activeReporterByMediaKey.get(mediaKey) !== reporterId ||
        next.mediaKey !== mediaKey
      ) return;
      publishVideoPreviewState(next);
    },
    clear: () => {
      if (activeReporterByMediaKey.get(mediaKey) !== reporterId) return;
      activeReporterByMediaKey.delete(mediaKey);
      clearVideoPreviewState(mediaKey);
    },
  };
};

export const clearVideoPreviewState = (mediaKey?: string): void => {
  const keys = mediaKey ? [mediaKey] : [...snapshots.keys()];
  keys.forEach((key) => {
    snapshots.delete(key);
    const listeners = snapshotListeners.get(key);
    if (!listeners?.size) {
      emptySnapshots.delete(key);
      return;
    }
    const next = emptySnapshotFor(key);
    emptySnapshots.set(key, next);
    listeners.forEach((listener) => listener(next));
  });
};

export const subscribeVideoPreviewCommands = (
  mediaKey: string,
  listener: (command: VideoPreviewCommand) => void,
): (() => void) => {
  const listeners = commandListeners.get(mediaKey) ?? new Set();
  listeners.add(listener);
  commandListeners.set(mediaKey, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) commandListeners.delete(mediaKey);
  };
};

const emitPreviewCommand = (
  mediaKey: string,
  command: PreviewCommandInput,
): VideoPreviewCommand => {
  commandGeneration += 1;
  const next = {
    ...command,
    mediaKey,
    generation: commandGeneration,
  } as VideoPreviewCommand;
  dirtyMediaKey = mediaKey;
  commandListeners.get(mediaKey)?.forEach((listener) => listener(next));
  return next;
};

export const playVideoPreview = (mediaKey: string): void => {
  emitPreviewCommand(mediaKey, { type: "play" });
};

export const pauseVideoPreview = (mediaKey: string): void => {
  emitPreviewCommand(mediaKey, { type: "pause" });
};

export const seekVideoPreview = (mediaKey: string, positionSeconds: number): void => {
  emitPreviewCommand(mediaKey, { type: "seek", positionSeconds });
};

export const restartVideoPreview = (mediaKey: string): void => {
  emitPreviewCommand(mediaKey, { type: "restart" });
};

/**
 * Reports (and clears) whether the operator changed transport for `mediaKey`
 * since the last send. Keyed per media so touching one clip never forces an
 * unrelated clip to restart on its next send.
 */
export const consumeVideoPreviewDirty = (mediaKey?: string): boolean => {
  const wasDirty = mediaKey
    ? dirtyMediaKey === mediaKey
    : dirtyMediaKey !== null;
  if (!mediaKey || wasDirty) dirtyMediaKey = null;
  return wasDirty;
};

export type VideoTransportUpdate = {
  mediaKey: string;
  positionSeconds: number;
  paused: boolean;
  applySeek: boolean;
};

export const buildVideoPlaybackCue = (
  update: VideoTransportUpdate,
): VideoBackgroundPlaybackCue => ({
  mediaKey: update.mediaKey,
  positionSeconds: update.positionSeconds,
  paused: update.paused,
  atServerMs: serverNow(),
  generation: nextCueGeneration(),
  applySeek: update.applySeek,
});

/** Applies operator transport and updates the local preview snapshot. */
export const applyVideoBackgroundTransport = (
  update: VideoTransportUpdate,
  options?: { emitPreviewCommands?: boolean },
): VideoBackgroundPlaybackCue => {
  const cue = buildVideoPlaybackCue(update);
  publishVideoPreviewState({
    mediaKey: update.mediaKey,
    currentTime: update.positionSeconds,
    duration: getVideoPreviewSnapshot(update.mediaKey).duration,
    paused: update.paused,
  });
  dirtyMediaKey = update.mediaKey;

  if (options?.emitPreviewCommands === false) return cue;

  if (update.applySeek) {
    emitPreviewCommand(update.mediaKey, {
      type: "seek",
      positionSeconds: update.positionSeconds,
    });
  }
  if (update.paused) {
    emitPreviewCommand(update.mediaKey, { type: "pause" });
  } else {
    emitPreviewCommand(update.mediaKey, { type: "play" });
  }

  return cue;
};

export const resolveSyncedVideoPlayback = (
  outputs: Record<
    string,
    {
      isTransmitting: boolean;
      info: { videoPlayback?: VideoBackgroundPlaybackCue };
    }
  >,
  mediaKey: string | undefined,
): VideoBackgroundPlaybackCue | undefined => {
  if (!mediaKey) return undefined;
  let best: VideoBackgroundPlaybackCue | undefined;
  for (const slot of Object.values(outputs)) {
    if (!slot.isTransmitting) continue;
    const cue = slot.info.videoPlayback;
    if (cue?.mediaKey !== mediaKey) continue;
    if (!best || (cue.generation ?? 0) > (best.generation ?? 0)) {
      best = cue;
    }
  }
  return best;
};

type OutputSlotForEditorPreview = {
  isTransmitting: boolean;
  info: {
    slide?: ItemSlideType | null;
    videoPlayback?: VideoBackgroundPlaybackCue;
  };
};

/**
 * Live transport drives outputs via Redux cues and stops emitting local preview
 * commands. The editor DisplayWindow has to follow that same cue, or the
 * preview stays paused while Projector/Monitor/Stream keep playing.
 */
export const resolveEditorPreviewVideoPlayback = (
  outputs: Record<string, OutputSlotForEditorPreview>,
  slide?: ItemSlideType | null,
): VideoBackgroundPlaybackCue | undefined => {
  const mediaKey = getVideoBackgroundMediaKey(
    getSlideVideoBackgroundMedia(slide),
  );
  if (!mediaKey || !slide?.id) return undefined;

  const isSelectedSlideLive = Object.values(outputs).some((slot) => {
    if (!slot.isTransmitting || slot.info.slide?.id !== slide.id) return false;
    return (
      getVideoBackgroundMediaKey(
        getSlideVideoBackgroundMedia(slot.info.slide),
      ) === mediaKey
    );
  });
  if (!isSelectedSlideLive) {
    // The editor owns a real DisplayWindow even before transmit. Keep its
    // local preview playing from the beginning; a live output cue below still
    // takes precedence once this slide is on air.
    return {
      mediaKey,
      positionSeconds: 0,
      paused: false,
      atServerMs: serverNow(),
      generation: 0,
      applySeek: false,
    };
  }

  return resolveSyncedVideoPlayback(outputs, mediaKey);
};

export const buildVideoPlaybackCueForSend = (
  slide?: ItemSlideType | null,
  options?: { liveCue?: VideoBackgroundPlaybackCue },
): VideoBackgroundPlaybackCue | undefined => {
  const media = getSlideVideoBackgroundMedia(slide);
  const mediaKey = getVideoBackgroundMediaKey(media);
  if (!mediaKey) return undefined;

  const mode = getSlideVideoBackgroundSendMode(slide);
  const generation = nextCueGeneration();

  if (mode === "restart") {
    restartVideoPreview(mediaKey);
    consumeVideoPreviewDirty(mediaKey);
    return {
      mediaKey,
      positionSeconds: 0,
      paused: false,
      atServerMs: serverNow(),
      generation,
      applySeek: true,
    };
  }

  const snapshot = getVideoPreviewSnapshot(mediaKey);
  const samePreview = snapshots.has(mediaKey);
  const dirty = consumeVideoPreviewDirty(mediaKey);

  // An output already playing this video knows where it is; the local preview
  // may not. A controller that just joined, or one whose editor preview is not
  // mounted, has an empty snapshot and would otherwise restart a live video
  // from zero. The operator's own scrub still wins over the live playhead.
  const liveCue =
    options?.liveCue?.mediaKey === mediaKey ? options.liveCue : undefined;
  if (liveCue && !dirty) {
    const knownDuration =
      (samePreview ? snapshot.duration : 0) ||
      (typeof media?.duration === "number" ? media.duration : 0);
    return {
      mediaKey,
      positionSeconds: resolveVideoPlaybackPosition(
        liveCue,
        knownDuration || undefined,
      ),
      paused: false,
      atServerMs: serverNow(),
      generation,
      // Outputs are already there; only a surface loading this src fresh seeks.
      applySeek: false,
    };
  }

  const isFreshSend = dirty || !samePreview;
  return {
    mediaKey,
    positionSeconds: samePreview ? snapshot.currentTime : 0,
    // Sending a slide always starts its video. An operator who paused the
    // editor preview to line something up should not have to press play again
    // on the way to air, and a paused background is never what a send means.
    paused: false,
    atServerMs: serverNow(),
    generation,
    applySeek: isFreshSend,
  };
};

export const resetVideoBackgroundPlaybackForTests = (): void => {
  snapshots.clear();
  emptySnapshots.clear();
  dirtyMediaKey = null;
  cueGeneration = 0;
  commandGeneration = 0;
  snapshotListeners.clear();
  commandListeners.clear();
  activeReporterByMediaKey.clear();
};
