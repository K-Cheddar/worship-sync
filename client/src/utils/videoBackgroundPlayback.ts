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
  | { type: "play"; generation: number }
  | { type: "pause"; generation: number }
  | { type: "seek"; generation: number; positionSeconds: number }
  | { type: "restart"; generation: number };

/**
 * A command before it is stamped with a generation. The Omit has to
 * distribute over the union, or every variant collapses to the shared `type`
 * field and `positionSeconds` becomes unassignable.
 */
type PreviewCommandInput = VideoPreviewCommand extends infer Command
  ? Command extends VideoPreviewCommand
    ? Omit<Command, "generation">
    : never
  : never;

const emptySnapshot = (): VideoPreviewSnapshot => ({
  mediaKey: "",
  currentTime: 0,
  duration: 0,
  paused: true,
});

let snapshot = emptySnapshot();
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

const snapshotListeners = new Set<(next: VideoPreviewSnapshot) => void>();
const commandListeners = new Set<(command: VideoPreviewCommand) => void>();

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
  if (media.localVideoFile) {
    return `local-video:${media.localVideoFile.id}:${media.localVideoFile.contentRevision ?? "legacy"}`;
  }
  return `remote:${media.id || media.publicId || media.background}`;
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
 * How far a surface may drift from the cue clock before it re-seeks. Large
 * enough to ignore decode jitter, small enough that no one in the room can
 * see two screens disagree.
 */
export const VIDEO_CUE_DRIFT_TOLERANCE_SECONDS = 0.35;

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

export const getVideoPreviewSnapshot = (): VideoPreviewSnapshot => snapshot;

export const subscribeVideoPreviewSnapshot = (
  listener: (next: VideoPreviewSnapshot) => void,
): (() => void) => {
  snapshotListeners.add(listener);
  return () => {
    snapshotListeners.delete(listener);
  };
};

/** Sub-frame playhead moves are not worth a re-render of the transport UI. */
const REPORT_EPSILON_SECONDS = 0.05;

export const reportVideoPreviewState = (next: VideoPreviewSnapshot): void => {
  // `timeupdate` fires several times a second on every surface; skipping
  // no-op reports keeps the transport UI off React's render path unless the
  // operator would actually see a difference.
  if (
    snapshot.mediaKey === next.mediaKey &&
    snapshot.paused === next.paused &&
    Math.abs(snapshot.duration - next.duration) < REPORT_EPSILON_SECONDS &&
    Math.abs(snapshot.currentTime - next.currentTime) < REPORT_EPSILON_SECONDS
  ) {
    return;
  }
  snapshot = next;
  snapshotListeners.forEach((listener) => listener(snapshot));
};

export const clearVideoPreviewState = (mediaKey?: string): void => {
  if (mediaKey && snapshot.mediaKey && snapshot.mediaKey !== mediaKey) return;
  snapshot = emptySnapshot();
  snapshotListeners.forEach((listener) => listener(snapshot));
};

export const subscribeVideoPreviewCommands = (
  listener: (command: VideoPreviewCommand) => void,
): (() => void) => {
  commandListeners.add(listener);
  return () => {
    commandListeners.delete(listener);
  };
};

const emitPreviewCommand = (
  command: PreviewCommandInput,
): VideoPreviewCommand => {
  commandGeneration += 1;
  const next = {
    ...command,
    generation: commandGeneration,
  } as VideoPreviewCommand;
  if (snapshot.mediaKey) dirtyMediaKey = snapshot.mediaKey;
  commandListeners.forEach((listener) => listener(next));
  return next;
};

export const playVideoPreview = (): void => {
  emitPreviewCommand({ type: "play" });
};

export const pauseVideoPreview = (): void => {
  emitPreviewCommand({ type: "pause" });
};

export const seekVideoPreview = (positionSeconds: number): void => {
  emitPreviewCommand({ type: "seek", positionSeconds });
};

export const restartVideoPreview = (): void => {
  emitPreviewCommand({ type: "restart" });
};

/**
 * Reports (and clears) whether the operator changed transport for `mediaKey`
 * since the last send. Keyed per media so touching one clip never forces an
 * unrelated clip to restart on its next send.
 */
export const consumeVideoPreviewDirty = (mediaKey?: string): boolean => {
  const wasDirty = mediaKey ? dirtyMediaKey === mediaKey : dirtyMediaKey !== null;
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
  snapshot = {
    mediaKey: update.mediaKey,
    currentTime: update.positionSeconds,
    duration: snapshot.mediaKey === update.mediaKey ? snapshot.duration : 0,
    paused: update.paused,
  };
  snapshotListeners.forEach((listener) => listener(snapshot));
  dirtyMediaKey = update.mediaKey;

  if (options?.emitPreviewCommands === false) return cue;

  if (update.applySeek) {
    emitPreviewCommand({
      type: "seek",
      positionSeconds: update.positionSeconds,
    });
  }
  if (update.paused) {
    emitPreviewCommand({ type: "pause" });
  } else {
    emitPreviewCommand({ type: "play" });
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
    restartVideoPreview();
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

  const samePreview = snapshot.mediaKey === mediaKey;
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
  snapshot = emptySnapshot();
  dirtyMediaKey = null;
  cueGeneration = 0;
  commandGeneration = 0;
  snapshotListeners.clear();
  commandListeners.clear();
};
