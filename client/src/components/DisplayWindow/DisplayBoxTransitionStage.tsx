import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import gsap from "gsap";
import type {
  Box,
  TimerInfo,
  VideoBackgroundPlaybackCue,
} from "../../types";
import LaneFullFrameMedia from "./LaneFullFrameMedia";
import {
  getLaneBackgroundMediaKey,
  getLanePreparedMediaKey,
  getSnapshotBackgroundIdentity,
  getSnapshotForegroundIdentity,
  NONE_LANE_BACKGROUND_MEDIA,
  type LaneBackgroundMedia,
} from "./laneBackgroundMedia";
import { logVideoCue } from "../../utils/videoBackgroundPlayback";
import { useServiceVideoCandidates } from "../../hooks/useServiceVideoCandidates";
import ElectronMediaSurfacePool from "./ElectronMediaSurfacePool";
import type {
  ElectronMediaSurfaceCandidate,
  ElectronMediaSurfaceView,
} from "../../utils/electronMediaSurfacePool";

type LaneId = "a" | "b";

export type DisplayBoxTransitionSnapshot = {
  key: string;
  boxes: Box[];
  time?: number;
  timerInfo?: TimerInfo;
  backgroundMedia: LaneBackgroundMedia;
};

/** Which visual planes participate in the in-flight transition. */
type TransitionMode = "full" | "content" | "media";
type PlanePhase = "preparing" | "animating" | "settled";

type TransitionState = {
  activeLaneId: LaneId;
  lanes: Record<LaneId, DisplayBoxTransitionSnapshot | null>;
  phase: "idle" | "preparing" | "animating";
  requestedKey: string;
  queuedSnapshot: DisplayBoxTransitionSnapshot | null;
  mode: TransitionMode;
  /** Present only for a full transition with meaningful independent content. */
  foregroundPhase?: PlanePhase;
  mediaPhase?: PlanePhase;
  /**
   * Lane that owns the live full-frame media element during content-only
   * transitions. Never flips mid-fade so the <video>/capture node stays put.
   */
  mediaAnchorLaneId: LaneId;
};

export type LaneMediaPlaybackOptions = {
  outputId?: string;
  windowRole?: string;
  currentItemId?: string;
  preparedSurfaceBudget?: number;
  fileVideoAudioEnabled?: boolean;
  volume?: number;
  playbackRole?: "preview" | "output";
  preloadRole?: "preview" | "output";
  suspendPlayback?: boolean;
  /** Cue for the current live file-video lane. */
  activeFileVideoPlayback?: VideoBackgroundPlaybackCue;
  isEditor?: boolean;
  localVideo?: {
    playAudio: boolean;
    captureEnabled: boolean;
    receiveHighQuality: boolean;
    publishPreview: boolean;
    showErrors: boolean;
    transparentBackground: boolean;
    contentVisible: boolean;
  };
};

export type LaneRenderMediaOptions = {
  fullFramePaintReady: boolean;
  /** Actual live video has painted and may replace its fallback image. */
  liveVideoPaintReady: boolean;
  /** Still/box backgrounds. False when the stage already paints them. */
  paintBackground: boolean;
  /** Lyrics/text/timer foreground. False for the non-fading still hold layer. */
  paintForeground: boolean;
};

type DisplayBoxTransitionStageProps = {
  snapshot: DisplayBoxTransitionSnapshot;
  shouldAnimate: boolean;
  mediaPlayback?: LaneMediaPlaybackOptions;
  renderLane: (
    snapshot: DisplayBoxTransitionSnapshot,
    isPrevious: boolean,
    reportBoxPaintReady: (index: number, ready: boolean) => void,
    laneMedia: LaneRenderMediaOptions,
  ) => ReactNode;
};

const TRANSITION_SECONDS = 0.5;
/** Front-loaded so the first frames of the fade are perceptible immediately. */
const TRANSITION_EASE = "power2.out";
/**
 * Content must always paint above media across both lanes. Nesting media inside
 * a higher-z lane wrapper hid incoming lyrics whenever the media anchor was the
 * top lane (every other song after A/B promotion).
 */
const MEDIA_PLANE_Z = 0;
const CONTENT_PLANE_Z = 10;

export const getDisplayBoxesLayerKey = (boxes: Box[]) =>
  JSON.stringify(boxes);

/** Role-based stacking only — never prefer lane "a" over "b". */
const roleStackOffset = (isOutgoing: boolean) => (isOutgoing ? 0 : 1);

const phaseForPlanes = (
  foregroundPhase: PlanePhase,
  mediaPhase: PlanePhase,
): TransitionState["phase"] => {
  if (foregroundPhase === "animating" || mediaPhase === "animating") {
    return "animating";
  }
  if (foregroundPhase === "preparing" || mediaPhase === "preparing") {
    return "preparing";
  }
  return "idle";
};

const otherLane = (laneId: LaneId): LaneId => (laneId === "a" ? "b" : "a");

/** Build a typed A/B lane map without computed-key Record widening. */
const lanePair = (
  firstId: LaneId,
  first: DisplayBoxTransitionSnapshot | null,
  second: DisplayBoxTransitionSnapshot | null,
): Record<LaneId, DisplayBoxTransitionSnapshot | null> =>
  firstId === "a" ? { a: first, b: second } : { a: second, b: first };

const snapshotsMatch = (
  left: DisplayBoxTransitionSnapshot,
  right: DisplayBoxTransitionSnapshot,
) =>
  left.key === right.key &&
  left.boxes === right.boxes &&
  left.time === right.time &&
  left.timerInfo === right.timerInfo &&
  left.backgroundMedia === right.backgroundMedia;

const backgroundIdentityOf = (snapshot: DisplayBoxTransitionSnapshot) =>
  getSnapshotBackgroundIdentity(snapshot.backgroundMedia, snapshot.boxes);

const foregroundIdentityOf = (snapshot: DisplayBoxTransitionSnapshot) =>
  getSnapshotForegroundIdentity(snapshot.boxes);

/** Media-only/custom visual slides must not advance their meaningful content before media. */
const hasIndependentForeground = (snapshot: DisplayBoxTransitionSnapshot): boolean =>
  snapshot.boxes.some(
    (box) => Boolean(box.words?.trim() || box.label?.trim()),
  );

const resolveTransitionMode = (
  active: DisplayBoxTransitionSnapshot,
  next: DisplayBoxTransitionSnapshot,
): TransitionMode => {
  const sameBackground =
    backgroundIdentityOf(active) === backgroundIdentityOf(next);
  const sameForeground =
    foregroundIdentityOf(active) === foregroundIdentityOf(next);
  if (sameBackground && !sameForeground) return "content";
  if (!sameBackground && sameForeground) return "media";
  return "full";
};

const readLaneOpacity = (element: HTMLDivElement | null) => {
  if (!element) return undefined;
  const opacity = Number.parseFloat(element.style.opacity);
  return Number.isFinite(opacity) ? opacity : undefined;
};

/**
 * Owns one deterministic background-media + box transition.
 *
 * Background and foreground identities are compared independently:
 * - same media + changed text → content-only fade (media element stays mounted)
 * - changed media + same text → media-only fade (text stays put)
 * - both changed → full lane crossfade
 *
 * Media ownership (`mediaAnchorLaneId`) is independent of foreground ownership
 * (`activeLaneId`) so a content-only settle never remounts the winning text
 * onto the lane that just faded out.
 */
const DisplayBoxTransitionStage = ({
  snapshot,
  shouldAnimate,
  mediaPlayback,
  renderLane,
}: DisplayBoxTransitionStageProps) => {
  const mediaRefs = useRef<Record<LaneId, HTMLDivElement | null>>({
    a: null,
    b: null,
  });
  const contentRefs = useRef<Record<LaneId, HTMLDivElement | null>>({
    a: null,
    b: null,
  });
  const timelineRef = useRef<GSAPTimeline | null>(null);
  const independentContentTimelineRef = useRef<GSAPTimeline | null>(null);
  const independentMediaTimelineRef = useRef<GSAPTimeline | null>(null);
  const preparedMediaRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const preparedMediaReadyRef = useRef<Record<string, boolean>>({});
  const preparedMediaLiveReadyRef = useRef<Record<string, boolean>>({});
  const adoptedPreparedMediaKeysRef = useRef(new Set<string>());
  const [preparedMediaReady, setPreparedMediaReady] = useState<
    Record<string, boolean>
  >({});
  const [preparedMediaLiveReady, setPreparedMediaLiveReady] = useState<
    Record<string, boolean>
  >({});
  const [lastSendPath, setLastSendPath] = useState<"pool" | "fallback">(
    "fallback",
  );
  const [lastMediaKey, setLastMediaKey] = useState<string | undefined>();
  const [posterShown, setPosterShown] = useState(false);
  const requestGenerationRef = useRef(0);
  const [state, setState] = useState<TransitionState>(() => ({
    activeLaneId: "a",
    lanes: { a: snapshot, b: null },
    phase: "idle",
    requestedKey: snapshot.key,
    queuedSnapshot: null,
    mode: "full",
    mediaAnchorLaneId: "a",
  }));
  const [boxPaintReadiness, setBoxPaintReadiness] = useState<
    Record<LaneId, { key: string; readyIndexes: number[] } | null>
  >({ a: null, b: null });
  const [mediaPaintReadiness, setMediaPaintReadiness] = useState<
    Record<LaneId, { mediaKey: string; ready: boolean } | null>
  >({ a: null, b: null });
  const [mediaLivePaintReadiness, setMediaLivePaintReadiness] = useState<
    Record<LaneId, { mediaKey: string; ready: boolean } | null>
  >({ a: null, b: null });
  const laneSnapshotsRef = useRef<
    Record<LaneId, DisplayBoxTransitionSnapshot | null>
  >({ a: snapshot, b: null });
  laneSnapshotsRef.current = state.lanes;

  const poolEnabled = Boolean(
    mediaPlayback?.playbackRole === "output" &&
      mediaPlayback.outputId &&
      window.electronAPI,
  );
  const currentPoolMedia = useMemo<ElectronMediaSurfaceCandidate | undefined>(
    () =>
      snapshot.backgroundMedia.kind === "fileVideo"
        ? {
            mediaKey: snapshot.backgroundMedia.mediaKey,
            source: snapshot.backgroundMedia.originalSrc,
            itemId: mediaPlayback?.currentItemId,
          }
        : undefined,
    [mediaPlayback?.currentItemId, snapshot.backgroundMedia],
  );
  const protectedPoolMediaKeys = useMemo(
    () =>
      Array.from(
        new Set(
          Object.values(state.lanes)
            .map((lane) =>
              getLanePreparedMediaKey(lane?.backgroundMedia) === "none"
                ? undefined
                : getLanePreparedMediaKey(lane?.backgroundMedia),
            )
            .filter((mediaKey): mediaKey is string => Boolean(mediaKey)),
        ),
      ),
    [state.lanes],
  );
  const poolCandidateResult = useServiceVideoCandidates({
    enabled: poolEnabled,
    outputId: mediaPlayback?.outputId,
    currentItemId: mediaPlayback?.currentItemId,
    currentMedia: currentPoolMedia,
    protectedMediaKeys: protectedPoolMediaKeys,
    maxSurfaces: mediaPlayback?.preparedSurfaceBudget,
  });
  const poolCandidates = poolCandidateResult.candidates;
  /**
   * Playback ownership follows the lane's media identity, not its transient
   * visual role. A lane can become the baseline during an interruption while
   * still rendering the cue it received as the incoming lane.
   */
  const lanePlaybackRef = useRef<
    Record<
      LaneId,
      { mediaKey: string; cue: VideoBackgroundPlaybackCue } | undefined
    >
  >({ a: undefined, b: undefined });
  // A cue belongs to a media identity, not to whichever lane currently has
  // the active role. This also protects the first render of a transition,
  // before the layout effect promotes the old lane to outgoing.
  const resolvePlaybackForLane = (
    laneId: LaneId,
    media: LaneBackgroundMedia,
  ): VideoBackgroundPlaybackCue | undefined => {
    if (media.kind !== "fileVideo") return undefined;

    const lanePlayback = lanePlaybackRef.current[laneId];
    if (lanePlayback?.mediaKey === media.mediaKey) return lanePlayback.cue;

    const activeCue = mediaPlayback?.activeFileVideoPlayback;
    if (activeCue?.mediaKey === media.mediaKey) return activeCue;
    return undefined;
  };

  useLayoutEffect(() => {
    const activeCue = mediaPlayback?.activeFileVideoPlayback;
    if (!activeCue) return;

    for (const laneId of ["a", "b"] as const) {
      const laneSnapshot = state.lanes[laneId];
      const laneMedia = laneSnapshot?.backgroundMedia;
      const mediaKey =
        laneMedia?.kind === "fileVideo" ? laneMedia.mediaKey : "none";
      if (mediaKey === activeCue.mediaKey) {
        lanePlaybackRef.current[laneId] = {
          mediaKey,
          cue: activeCue,
        };
      }
    }
  }, [
    mediaPlayback?.activeFileVideoPlayback,
    state.lanes,
  ]);

  useLayoutEffect(() => {
    const isNewRequest = snapshot.key !== state.requestedKey;
    if (isNewRequest) {
      requestGenerationRef.current += 1;
      logVideoCue("transition.requested", {
        outputId: mediaPlayback?.outputId,
        windowRole: mediaPlayback?.windowRole,
        snapshotKey: snapshot.key,
        media: getLaneBackgroundMediaKey(snapshot.backgroundMedia),
        generation: requestGenerationRef.current,
        priorPhase: state.phase,
      });
    }

    // The latest operator request must take over immediately. Preserve one
    // coherent baseline, kill the obsolete fade, and prepare the new request
    // directly instead of making it wait behind a queued destination.
    if (isNewRequest && state.phase === "animating") {
      const activeLaneId = state.activeLaneId;
      const incomingLaneId = otherLane(activeLaneId);
      const incomingContentOpacity = readLaneOpacity(
        contentRefs.current[incomingLaneId],
      );
      const activeContentOpacity = readLaneOpacity(
        contentRefs.current[activeLaneId],
      );
      const incomingMediaOpacity = readLaneOpacity(
        mediaRefs.current[incomingLaneId] ??
          preparedMediaRefs.current[
            getLaneBackgroundMediaKey(
              state.lanes[incomingLaneId]?.backgroundMedia,
            )
          ],
      );
      const activeMediaOpacity = readLaneOpacity(
        mediaRefs.current[activeLaneId] ??
          preparedMediaRefs.current[
            getLaneBackgroundMediaKey(state.lanes[activeLaneId]?.backgroundMedia)
          ],
      );
      let baselineLaneId = activeLaneId;
      let contentBaselineLaneId = activeLaneId;
      let mediaBaselineLaneId = activeLaneId;
      if (state.mode === "content") {
        // The existing media anchor is the stable baseline for lyric-only
        // interruption; keeping it in place avoids remounting video/capture.
        baselineLaneId = state.mediaAnchorLaneId;
      } else if (
        state.mode === "full" &&
        incomingContentOpacity != null &&
        activeContentOpacity != null &&
        incomingMediaOpacity != null &&
        activeMediaOpacity != null &&
        incomingContentOpacity >= activeContentOpacity &&
        incomingMediaOpacity >= activeMediaOpacity
      ) {
        // A full transition can use the incoming lane only when both visual
        // planes have become dominant; this never combines split baselines.
        baselineLaneId = incomingLaneId;
      }
      let baselineSnapshot =
        state.lanes[baselineLaneId] ?? state.lanes[activeLaneId];

      if (
        state.mode === "full" &&
        state.foregroundPhase != null &&
        state.mediaPhase != null
      ) {
        contentBaselineLaneId =
          state.foregroundPhase === "settled" ||
          (incomingContentOpacity != null &&
            activeContentOpacity != null &&
            incomingContentOpacity >= activeContentOpacity)
            ? incomingLaneId
            : activeLaneId;
        mediaBaselineLaneId =
          state.mediaPhase === "settled" ||
          (incomingMediaOpacity != null &&
            activeMediaOpacity != null &&
            incomingMediaOpacity >= activeMediaOpacity)
            ? incomingLaneId
            : activeLaneId;
        const foregroundBaseline = state.lanes[contentBaselineLaneId];
        const mediaBaseline = state.lanes[mediaBaselineLaneId];
        if (foregroundBaseline && mediaBaseline) {
          baselineLaneId = activeLaneId;
          baselineSnapshot = {
            key: `baseline:${foregroundBaseline.key}:${getLaneBackgroundMediaKey(
              mediaBaseline.backgroundMedia,
            )}`,
            boxes: foregroundBaseline.boxes,
            time: foregroundBaseline.time,
            timerInfo: foregroundBaseline.timerInfo,
            backgroundMedia: mediaBaseline.backgroundMedia,
          };
        }
      }
      if (state.foregroundPhase == null || state.mediaPhase == null) {
        contentBaselineLaneId = baselineLaneId;
        mediaBaselineLaneId = baselineLaneId;
      }

      if (baselineSnapshot) {
        timelineRef.current?.kill();
        timelineRef.current = null;
        independentContentTimelineRef.current?.kill();
        independentContentTimelineRef.current = null;
        independentMediaTimelineRef.current?.kill();
        independentMediaTimelineRef.current = null;
        for (const laneId of ["a", "b"] as const) {
          const mediaOpacity =
            laneId === mediaBaselineLaneId ? 1 : 0;
          const contentOpacity =
            laneId === contentBaselineLaneId ? 1 : 0;
          if (mediaRefs.current[laneId]) {
            gsap.set(mediaRefs.current[laneId], { opacity: mediaOpacity });
          }
          if (contentRefs.current[laneId]) {
            gsap.set(contentRefs.current[laneId], { opacity: contentOpacity });
          }
          const laneMediaKey = getLaneBackgroundMediaKey(
            state.lanes[laneId]?.backgroundMedia,
          );
          if (preparedMediaRefs.current[laneMediaKey]) {
            gsap.set(preparedMediaRefs.current[laneMediaKey], {
              opacity: mediaOpacity,
            });
          }
        }
        const nextMode = resolveTransitionMode(baselineSnapshot, snapshot);
        const independentPlanes =
          shouldAnimate &&
          nextMode === "full" &&
          hasIndependentForeground(snapshot);
        setState({
          activeLaneId: baselineLaneId,
          lanes: lanePair(baselineLaneId, baselineSnapshot, snapshot),
          phase: "preparing",
          requestedKey: snapshot.key,
          queuedSnapshot: null,
          mode: nextMode,
          foregroundPhase: independentPlanes ? "preparing" : undefined,
          mediaPhase: independentPlanes ? "preparing" : undefined,
          mediaAnchorLaneId: baselineLaneId,
        });
        return;
      }
    }

    setState((current) => {
      const active = current.lanes[current.activeLaneId];
      if (!active) {
        return {
          activeLaneId: current.activeLaneId,
          lanes: { ...current.lanes, [current.activeLaneId]: snapshot },
          phase: "idle",
          requestedKey: snapshot.key,
          queuedSnapshot: null,
          mode: "full",
          mediaAnchorLaneId: current.activeLaneId,
        };
      }

      const sameBackground =
        backgroundIdentityOf(active) === backgroundIdentityOf(snapshot);
      const sameForeground =
        foregroundIdentityOf(active) === foregroundIdentityOf(snapshot);

      // Identical visual slide: keep the live surface as-is.
      if (sameBackground && sameForeground) {
        if (snapshotsMatch(active, snapshot) && current.phase === "idle") {
          return current;
        }
        if (current.phase === "idle") {
          return {
            ...current,
            lanes: { ...current.lanes, [current.activeLaneId]: snapshot },
            requestedKey: snapshot.key,
          };
        }
        if (current.phase === "animating") return current;
        // Preparing: refresh the incoming lane if it already targets this key.
        if (snapshot.key === current.requestedKey) {
          const incomingLaneId = otherLane(current.activeLaneId);
          const incoming = current.lanes[incomingLaneId];
          if (incoming && !snapshotsMatch(incoming, snapshot)) {
            return {
              ...current,
              lanes: { ...current.lanes, [incomingLaneId]: snapshot },
            };
          }
        }
        return current;
      }

      if (snapshot.key === current.requestedKey) {
        if (current.phase === "idle") {
          if (!snapshotsMatch(active, snapshot)) {
            return {
              ...current,
              lanes: { ...current.lanes, [current.activeLaneId]: snapshot },
            };
          }
        }

        if (current.phase === "preparing") {
          const incomingLaneId = otherLane(current.activeLaneId);
          const incoming = current.lanes[incomingLaneId];
          if (incoming && !snapshotsMatch(incoming, snapshot)) {
            return {
              ...current,
              lanes: { ...current.lanes, [incomingLaneId]: snapshot },
            };
          }
        }

        if (current.phase === "animating") {
          const latestIncoming =
            current.queuedSnapshot ??
            current.lanes[otherLane(current.activeLaneId)];
          if (latestIncoming && !snapshotsMatch(latestIncoming, snapshot)) {
            return { ...current, queuedSnapshot: snapshot };
          }
        }

        return current;
      }

      if (current.phase === "animating") return current;

      const mode = resolveTransitionMode(active, snapshot);
      const incomingLaneId = otherLane(current.activeLaneId);
      const independentPlanes =
        shouldAnimate &&
        mode === "full" &&
        hasIndependentForeground(snapshot);
      return {
        ...current,
        lanes: { ...current.lanes, [incomingLaneId]: snapshot },
        phase: "preparing",
        requestedKey: snapshot.key,
        queuedSnapshot: null,
        mode,
        foregroundPhase: independentPlanes ? "preparing" : undefined,
        mediaPhase: independentPlanes ? "preparing" : undefined,
        // Content-only: keep the existing media host. Do not retarget the
        // anchor to activeLaneId — after a prior content settle those differ.
        mediaAnchorLaneId: current.mediaAnchorLaneId,
      };
    });
  }, [mediaPlayback?.outputId, mediaPlayback?.windowRole, shouldAnimate, snapshot, state]);

  const reportBoxPaintReady = useCallback(
    (laneId: LaneId, laneKey: string, index: number, ready: boolean) => {
      if (laneSnapshotsRef.current[laneId]?.key !== laneKey) return;
      setBoxPaintReadiness((current) => {
        const laneState = current[laneId];
        const readyIndexes =
          laneState?.key === laneKey ? laneState.readyIndexes : [];
        const hasIndex = readyIndexes.includes(index);
        if (hasIndex === ready && laneState?.key === laneKey) return current;

        return {
          ...current,
          [laneId]: {
            key: laneKey,
            readyIndexes: ready
              ? [...readyIndexes, index]
              : readyIndexes.filter((readyIndex) => readyIndex !== index),
          },
        };
      });
    },
    [],
  );

  const reportMediaPaintReady = useCallback(
    (laneId: LaneId, mediaKey: string, ready: boolean) => {
      const laneSnapshot = laneSnapshotsRef.current[laneId];
      if (
        !laneSnapshot ||
        getLaneBackgroundMediaKey(laneSnapshot.backgroundMedia) !== mediaKey
      ) {
        return;
      }
      setMediaPaintReadiness((current) => {
        const laneState = current[laneId];
        if (
          laneState?.mediaKey === mediaKey &&
          laneState.ready === ready
        ) {
          return current;
        }
        return {
          ...current,
          [laneId]: { mediaKey, ready },
        };
      });
    },
    [],
  );

  const reportMediaLivePaintReady = useCallback(
    (laneId: LaneId, mediaKey: string, ready: boolean) => {
      const laneSnapshot = laneSnapshotsRef.current[laneId];
      if (!laneSnapshot || getLaneBackgroundMediaKey(laneSnapshot.backgroundMedia) !== mediaKey) return;
      setMediaLivePaintReadiness((current) => {
        const laneState = current[laneId];
        if (laneState?.mediaKey === mediaKey && laneState.ready === ready) return current;
        return { ...current, [laneId]: { mediaKey, ready } };
      });
    },
    [],
  );

  const reportPreparedMediaReady = useCallback(
    (mediaKey: string, ready: boolean) => {
      preparedMediaReadyRef.current[mediaKey] = ready;
      setPreparedMediaReady((current) =>
        current[mediaKey] === ready ? current : { ...current, [mediaKey]: ready },
      );
    },
    [],
  );

  const reportPreparedMediaLiveReady = useCallback(
    (mediaKey: string, ready: boolean) => {
      preparedMediaLiveReadyRef.current[mediaKey] = ready;
      setPreparedMediaLiveReady((current) =>
        current[mediaKey] === ready ? current : { ...current, [mediaKey]: ready },
      );
    },
    [],
  );

  const reportPreparedMediaElement = useCallback(
    (mediaKey: string, element: HTMLDivElement | null) => {
      if (element) {
        preparedMediaRefs.current[mediaKey] = element;
      } else {
        delete preparedMediaRefs.current[mediaKey];
      }
    },
    [],
  );

  const getPreparedMediaKey = (
    laneId: LaneId,
    mediaKey: string,
    mediaSnapshot?: DisplayBoxTransitionSnapshot["backgroundMedia"],
  ): string => {
    const media = mediaSnapshot ?? state.lanes[laneId]?.backgroundMedia;
    return getLanePreparedMediaKey(media) === "none"
      ? mediaKey
      : getLanePreparedMediaKey(media);
  };

  const usesPreparedSurface = (
    laneId: LaneId,
    mediaKey: string,
    mediaSnapshot?: DisplayBoxTransitionSnapshot["backgroundMedia"],
  ): boolean => {
    const preparedKey = getPreparedMediaKey(laneId, mediaKey, mediaSnapshot);
    if (!poolEnabled || preparedKey === "none" || !preparedMediaReady[preparedKey]) {
      return false;
    }
    const isIncoming =
      state.phase !== "idle" && laneId === otherLane(state.activeLaneId);
    const isActiveLane = laneId === state.activeLaneId;
    return isIncoming || isActiveLane || adoptedPreparedMediaKeysRef.current.has(preparedKey);
  };

  useLayoutEffect(() => {
    const media = snapshot.backgroundMedia;
    if (media.kind !== "fileVideo") {
      setLastMediaKey(undefined);
      setLastSendPath("fallback");
      setPosterShown(false);
      return;
    }
    const pooled = poolEnabled && preparedMediaReady[media.mediaKey] === true;
    setLastMediaKey(media.mediaKey);
    setLastSendPath(pooled ? "pool" : "fallback");
    setPosterShown(!pooled);
  }, [poolEnabled, preparedMediaReady, snapshot]);

  const isLanePaintReady = (
    laneId: LaneId,
    laneSnapshot: DisplayBoxTransitionSnapshot,
    mode: TransitionMode,
  ) => {
    const boxState = boxPaintReadiness[laneId];
    const boxesReady =
      mode === "media" ||
      laneSnapshot.boxes.length === 0 ||
      (boxState?.key === laneSnapshot.key &&
        laneSnapshot.boxes.every((_, index) =>
          boxState.readyIndexes.includes(index),
        ));
    const mediaKey = getLaneBackgroundMediaKey(laneSnapshot.backgroundMedia);
    const mediaState = mediaPaintReadiness[laneId];
    const usesPrepared = usesPreparedSurface(laneId, mediaKey);
    const mediaReady =
      mode === "content" ||
      mediaKey === "none" ||
      (usesPrepared
        ? preparedMediaLiveReady[mediaKey] === true
        : mediaState?.mediaKey === mediaKey && mediaState.ready);
    const activeSnapshot = state.lanes[state.activeLaneId];
    const outgoingMediaKey = getLaneBackgroundMediaKey(
      activeSnapshot?.backgroundMedia,
    );
    const outgoingUsesPrepared = usesPreparedSurface(
      state.activeLaneId,
      outgoingMediaKey,
    );
    const outgoingLiveMedia = mediaLivePaintReadiness[state.activeLaneId];
    const outgoingFileVideoCanBeLive =
      activeSnapshot?.backgroundMedia.kind === "fileVideo" &&
      (outgoingUsesPrepared
        ? preparedMediaLiveReady[outgoingMediaKey] !== false
        : outgoingLiveMedia?.mediaKey !== outgoingMediaKey ||
          outgoingLiveMedia.ready);
    const incomingFileVideoMustBeLive =
      mode !== "content" &&
      laneSnapshot.backgroundMedia.kind === "fileVideo" &&
      outgoingFileVideoCanBeLive &&
      outgoingMediaKey !== mediaKey;
    const incomingLiveMedia = mediaLivePaintReadiness[laneId];
    const incomingLiveReady =
      usesPrepared
        ? preparedMediaLiveReady[mediaKey] === true
        : incomingLiveMedia?.mediaKey === mediaKey && incomingLiveMedia.ready;

    // A poster is a legitimate first-paint fallback, but never a destination
    // for a live file-video replacement. Hold the valid outgoing video until
    // the incoming video has presented a real frame.
    return boxesReady && mediaReady && (!incomingFileVideoMustBeLive || incomingLiveReady);
  };

  const incomingLaneId = otherLane(state.activeLaneId);
  const incomingSnapshot = state.lanes[incomingLaneId];
  const incomingPaintReady = Boolean(
    incomingSnapshot &&
    isLanePaintReady(incomingLaneId, incomingSnapshot, state.mode),
  );

  useLayoutEffect(() => {
    if (state.phase === "idle") return;
    const incomingMedia = incomingSnapshot?.backgroundMedia;
    if (
      incomingMedia?.kind === "fileVideo" &&
      preparedMediaReady[incomingMedia.mediaKey]
    ) {
      adoptedPreparedMediaKeysRef.current.add(incomingMedia.mediaKey);
    }
  }, [incomingSnapshot, preparedMediaReady, state.phase]);

  useLayoutEffect(() => {
    const independentPlanes =
      state.mode === "full" &&
      state.foregroundPhase != null &&
      state.mediaPhase != null;

    if (independentPlanes) {
      if (state.phase === "idle" || !incomingSnapshot) return;
      const incomingContentReady = isLanePaintReady(
        incomingLaneId,
        incomingSnapshot,
        "content",
      );
      setState((current) => {
        if (
          current.mode !== "full" ||
          current.foregroundPhase == null ||
          current.mediaPhase == null
        ) {
          return current;
        }
        const foregroundPhase =
          current.foregroundPhase === "preparing" && incomingContentReady
            ? "animating"
            : current.foregroundPhase;
        const mediaPhase =
          current.mediaPhase === "preparing" && incomingPaintReady
            ? "animating"
            : current.mediaPhase;
        if (
          current.foregroundPhase === "preparing" &&
          current.mediaPhase === "preparing" &&
          incomingContentReady &&
          incomingPaintReady
        ) {
          // The normal full transition remains one coordinated timeline when
          // both planes are already ready. Split timing is only needed when a
          // delayed media plane would otherwise hold back meaningful text.
          return {
            ...current,
            phase: "animating",
            foregroundPhase: undefined,
            mediaPhase: undefined,
          };
        }
        if (
          foregroundPhase === current.foregroundPhase &&
          mediaPhase === current.mediaPhase
        ) {
          return current;
        }
        logVideoCue("transition.planes-ready", {
          outputId: mediaPlayback?.outputId,
          windowRole: mediaPlayback?.windowRole,
          foreground: foregroundPhase,
          media: mediaPhase,
        });
        return {
          ...current,
          foregroundPhase,
          mediaPhase,
          phase: phaseForPlanes(foregroundPhase, mediaPhase),
        };
      });
      return;
    }

    if (state.phase !== "preparing" || !incomingPaintReady) return;

    if (!shouldAnimate) {
      setState((current) => {
        if (current.phase !== "preparing") return current;
        const nextActiveLaneId = otherLane(current.activeLaneId);
        const nextSnapshot = current.lanes[nextActiveLaneId];
        // Content-only: keep winning foreground on the incoming lane and leave
        // media on its anchor so neither surface remounts.
        if (current.mode === "content") {
          return {
            activeLaneId: nextActiveLaneId,
            lanes: lanePair(nextActiveLaneId, nextSnapshot, null),
            phase: "idle",
            requestedKey: nextSnapshot?.key ?? current.requestedKey,
            queuedSnapshot: null,
            mode: "full",
            mediaAnchorLaneId: current.mediaAnchorLaneId,
          };
        }
        return {
          activeLaneId: nextActiveLaneId,
          lanes: {
            ...current.lanes,
            [current.activeLaneId]: null,
          },
          phase: "idle",
          requestedKey: nextSnapshot?.key ?? current.requestedKey,
          queuedSnapshot: null,
          mode: "full",
          mediaAnchorLaneId: nextActiveLaneId,
        };
      });
      return;
    }

    setState((current) => {
      if (current.phase !== "preparing") return current;
      const incoming = current.lanes[otherLane(current.activeLaneId)];
      logVideoCue("transition.animating", {
        outputId: mediaPlayback?.outputId,
        windowRole: mediaPlayback?.windowRole,
        outgoingKey: current.lanes[current.activeLaneId]?.key,
        incomingKey: incoming?.key,
        outgoingMedia: getLaneBackgroundMediaKey(
          current.lanes[current.activeLaneId]?.backgroundMedia,
        ),
        incomingMedia: getLaneBackgroundMediaKey(incoming?.backgroundMedia),
        mode: current.mode,
      });
      return { ...current, phase: "animating" };
    });
  // The readiness helper is intentionally render-scoped so it reads the same
  // lane snapshot as this effect; its concrete readiness inputs are listed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    boxPaintReadiness,
    incomingPaintReady,
    incomingLaneId,
    incomingSnapshot,
    mediaLivePaintReadiness,
    mediaPaintReadiness,
    mediaPlayback?.outputId,
    mediaPlayback?.windowRole,
    preparedMediaLiveReady,
    preparedMediaReady,
    shouldAnimate,
    state.activeLaneId,
    state.foregroundPhase,
    state.mediaPhase,
    state.mode,
    state.lanes,
    state.phase,
  ]);

  const completeIndependentPlane = useCallback(
    (plane: "foreground" | "media") => {
      setState((current) => {
        if (current.foregroundPhase == null || current.mediaPhase == null) {
          return current;
        }
        const foregroundPhase =
          plane === "foreground" ? "settled" : current.foregroundPhase;
        const mediaPhase = plane === "media" ? "settled" : current.mediaPhase;
        if (foregroundPhase !== "settled" || mediaPhase !== "settled") {
          return {
            ...current,
            foregroundPhase,
            mediaPhase,
            phase: phaseForPlanes(foregroundPhase, mediaPhase),
          };
        }

        const nextActiveLaneId = otherLane(current.activeLaneId);
        const nextSnapshot = current.lanes[nextActiveLaneId];
        return {
          activeLaneId: nextActiveLaneId,
          lanes: lanePair(nextActiveLaneId, nextSnapshot, null),
          phase: "idle",
          requestedKey: nextSnapshot?.key ?? current.requestedKey,
          queuedSnapshot: null,
          mode: "full",
          mediaAnchorLaneId: nextActiveLaneId,
        };
      });
    },
    [],
  );

  useLayoutEffect(() => {
    if (
      state.mode !== "full" ||
      state.foregroundPhase !== "animating" ||
      !incomingSnapshot
    ) {
      return;
    }
    const outgoingContent = contentRefs.current[state.activeLaneId];
    const incomingContent = contentRefs.current[incomingLaneId];
    if (!outgoingContent || !incomingContent) return;

    independentContentTimelineRef.current?.kill();
    const animationGeneration = requestGenerationRef.current;
    const timeline = gsap.timeline({
      onComplete: () => {
        if (animationGeneration !== requestGenerationRef.current) return;
        completeIndependentPlane("foreground");
      },
    });
    independentContentTimelineRef.current = timeline;
    timeline.fromTo(
      outgoingContent,
      { opacity: 1 },
      { opacity: 0, duration: TRANSITION_SECONDS, ease: TRANSITION_EASE },
      0,
    );
    timeline.fromTo(
      incomingContent,
      { opacity: 0 },
      { opacity: 1, duration: TRANSITION_SECONDS, ease: TRANSITION_EASE },
      0,
    );

    return () => {
      timeline.kill();
      if (independentContentTimelineRef.current === timeline) {
        independentContentTimelineRef.current = null;
      }
    };
  }, [
    completeIndependentPlane,
    incomingLaneId,
    incomingSnapshot,
    state.activeLaneId,
    state.foregroundPhase,
    state.lanes,
    state.mode,
  ]);

  useLayoutEffect(() => {
    if (
      state.mode !== "full" ||
      state.mediaPhase !== "animating" ||
      !incomingSnapshot
    ) {
      return;
    }
    const mediaElementForLane = (laneId: LaneId) => {
      const laneMedia = state.lanes[laneId]?.backgroundMedia;
      const mediaKey = getLaneBackgroundMediaKey(laneMedia);
      const preparedKey = getPreparedMediaKey(laneId, mediaKey, laneMedia);
      return usesPreparedSurface(laneId, mediaKey)
        ? preparedMediaRefs.current[preparedKey]
        : mediaRefs.current[laneId];
    };
    const outgoingMedia = mediaElementForLane(state.activeLaneId);
    const incomingMedia = mediaElementForLane(incomingLaneId);
    if (!outgoingMedia || !incomingMedia) return;

    independentMediaTimelineRef.current?.kill();
    const animationGeneration = requestGenerationRef.current;
    const timeline = gsap.timeline({
      onComplete: () => {
        if (animationGeneration !== requestGenerationRef.current) return;
        completeIndependentPlane("media");
      },
    });
    independentMediaTimelineRef.current = timeline;
    timeline.fromTo(
      outgoingMedia,
      { opacity: 1 },
      { opacity: 0, duration: TRANSITION_SECONDS, ease: TRANSITION_EASE },
      0,
    );
    timeline.fromTo(
      incomingMedia,
      { opacity: 0 },
      { opacity: 1, duration: TRANSITION_SECONDS, ease: TRANSITION_EASE },
      0,
    );

    return () => {
      timeline.kill();
      if (independentMediaTimelineRef.current === timeline) {
        independentMediaTimelineRef.current = null;
      }
    };
  // The media element resolver intentionally reads the current render's lane
  // ownership; adding its function identity would restart an active fade.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    completeIndependentPlane,
    incomingLaneId,
    incomingSnapshot,
    state.activeLaneId,
    state.lanes,
    state.mediaPhase,
    state.mode,
  ]);

  useLayoutEffect(() => {
    if (
      state.phase !== "animating" ||
      !incomingSnapshot ||
      (state.mode === "full" && state.foregroundPhase != null)
    ) {
      return;
    }

    const mode = state.mode;
    const mediaElementForLane = (laneId: LaneId) => {
      const laneMedia = state.lanes[laneId]?.backgroundMedia;
      const mediaKey = getLaneBackgroundMediaKey(laneMedia);
      return usesPreparedSurface(laneId, mediaKey)
        ? preparedMediaRefs.current[mediaKey]
        : mediaRefs.current[laneId];
    };
    const outgoingMedia = mediaElementForLane(state.activeLaneId);
    const incomingMedia = mediaElementForLane(incomingLaneId);
    const outgoingContent = contentRefs.current[state.activeLaneId];
    const incomingContent = contentRefs.current[incomingLaneId];

    const animateMedia = mode === "full" || mode === "media";
    const animateContent = mode === "full" || mode === "content";
    const animationGeneration = requestGenerationRef.current;

    if (animateMedia && (!outgoingMedia || !incomingMedia)) return;
    if (animateContent && (!outgoingContent || !incomingContent)) return;

    timelineRef.current?.kill();
    const outgoingKey = state.lanes[state.activeLaneId]?.key;
    const incomingKey = incomingSnapshot.key;
    const timeline = gsap.timeline({
      onComplete: () => {
        if (animationGeneration !== requestGenerationRef.current) return;
        logVideoCue("transition.complete", {
          outputId: mediaPlayback?.outputId,
          windowRole: mediaPlayback?.windowRole,
          outgoingKey,
          incomingKey,
          mode,
        });
        // Do NOT clearProps("opacity") here. Clearing restores default opacity
        // 1 on the outgoing wrapper while old content is still mounted, which
        // paints a one-frame flash of the previous lyrics before React
        // unmounts that lane. Leave GSAP opacity in place until the wrapper is
        // removed or reused; preparing/idle React styles reset the next use.
        setState((current) => {
          const currentIncomingLaneId = otherLane(current.activeLaneId);
          if (
            current.phase !== "animating" ||
            current.lanes[current.activeLaneId]?.key !== outgoingKey ||
            current.lanes[currentIncomingLaneId]?.key !== incomingKey
          ) {
            return current;
          }

          const queued = current.queuedSnapshot;
          const completedOutgoingLaneId = current.activeLaneId;
          const completedIncoming = current.lanes[currentIncomingLaneId];

          /**
           * Content-only settle: keep the winning foreground on the incoming
           * lane (already at opacity 1). Media stays on mediaAnchorLaneId.
           */
          const settleContentOnly = (
            winning: DisplayBoxTransitionSnapshot | null,
            nextPhase: "idle" | "preparing",
            nextQueued: DisplayBoxTransitionSnapshot | null,
          ): TransitionState => {
            const contentLaneId = currentIncomingLaneId;
            return {
              activeLaneId: contentLaneId,
              lanes: lanePair(
                contentLaneId,
                winning,
                nextPhase === "preparing" && nextQueued ? nextQueued : null,
              ),
              phase: nextPhase,
              requestedKey:
                nextPhase === "preparing" && nextQueued
                  ? nextQueued.key
                  : (winning?.key ?? current.requestedKey),
              queuedSnapshot: null,
              mode:
                nextPhase === "preparing" && nextQueued && winning
                  ? resolveTransitionMode(winning, nextQueued)
                  : "full",
              mediaAnchorLaneId: current.mediaAnchorLaneId,
            };
          };

          if (queued) {
            const sameAsIncoming =
              completedIncoming != null &&
              backgroundIdentityOf(queued) ===
              backgroundIdentityOf(completedIncoming) &&
              foregroundIdentityOf(queued) ===
              foregroundIdentityOf(completedIncoming);
            if (sameAsIncoming) {
              if (current.mode === "content") {
                return settleContentOnly(queued, "idle", null);
              }
              return {
                activeLaneId: currentIncomingLaneId,
                lanes: lanePair(currentIncomingLaneId, queued, null),
                phase: "idle",
                requestedKey: queued.key,
                queuedSnapshot: null,
                mode: "full",
                mediaAnchorLaneId: currentIncomingLaneId,
              };
            }
            if (queued.key !== incomingKey) {
              if (current.mode === "content") {
                const bgSame =
                  completedIncoming != null &&
                  backgroundIdentityOf(queued) ===
                  backgroundIdentityOf(completedIncoming);
                if (bgSame) {
                  // Another lyric on the same media: winning content stays on
                  // the incoming lane; queue prepares in the free lane.
                  return {
                    activeLaneId: currentIncomingLaneId,
                    lanes: lanePair(
                      currentIncomingLaneId,
                      completedIncoming,
                      queued,
                    ),
                    phase: "preparing",
                    requestedKey: queued.key,
                    queuedSnapshot: null,
                    mode: "content",
                    mediaAnchorLaneId: current.mediaAnchorLaneId,
                  };
                }
                return settleContentOnly(completedIncoming, "preparing", queued);
              }
              return {
                activeLaneId: currentIncomingLaneId,
                lanes: {
                  ...current.lanes,
                  [completedOutgoingLaneId]: queued,
                },
                phase: "preparing",
                requestedKey: queued.key,
                queuedSnapshot: null,
                mode: completedIncoming
                  ? resolveTransitionMode(completedIncoming, queued)
                  : "full",
                mediaAnchorLaneId: currentIncomingLaneId,
              };
            }
          }

          const settledIncoming =
            queued?.key === incomingKey
              ? queued
              : current.lanes[currentIncomingLaneId];

          if (current.mode === "content") {
            return settleContentOnly(settledIncoming, "idle", null);
          }

          return {
            activeLaneId: currentIncomingLaneId,
            lanes: lanePair(currentIncomingLaneId, settledIncoming, null),
            phase: "idle",
            requestedKey: incomingKey,
            queuedSnapshot: null,
            mode: "full",
            mediaAnchorLaneId: currentIncomingLaneId,
          };
        });
      },
    });
    timelineRef.current = timeline;
    timeline.addLabel("crossfade", 0);

    if (animateMedia && outgoingMedia && incomingMedia) {
      gsap.set(outgoingMedia, { opacity: 1 });
      gsap.set(incomingMedia, { opacity: 0 });
      timeline.fromTo(
        outgoingMedia,
        { opacity: 1 },
        { opacity: 0, duration: TRANSITION_SECONDS, ease: TRANSITION_EASE },
        "crossfade",
      );
      timeline.fromTo(
        incomingMedia,
        { opacity: 0 },
        { opacity: 1, duration: TRANSITION_SECONDS, ease: TRANSITION_EASE },
        "crossfade",
      );
    }

    if (animateContent && outgoingContent && incomingContent) {
      gsap.set(outgoingContent, { opacity: 1 });
      gsap.set(incomingContent, { opacity: 0 });
      timeline.fromTo(
        outgoingContent,
        { opacity: 1 },
        { opacity: 0, duration: TRANSITION_SECONDS, ease: TRANSITION_EASE },
        "crossfade",
      );
      timeline.fromTo(
        incomingContent,
        { opacity: 0 },
        { opacity: 1, duration: TRANSITION_SECONDS, ease: TRANSITION_EASE },
        "crossfade",
      );
    }

    return () => {
      timeline.kill();
      if (timelineRef.current === timeline) timelineRef.current = null;
    };
  // The media element resolver intentionally reads the current render's lane
  // ownership; adding its function identity would restart an active fade.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    incomingLaneId,
    incomingSnapshot,
    state.activeLaneId,
    state.lanes,
    state.mode,
    state.phase,
    mediaPlayback?.outputId,
    mediaPlayback?.windowRole,
  ]);

  const hasFullFrameMedia = (laneSnapshot: DisplayBoxTransitionSnapshot) =>
    getLaneBackgroundMediaKey(laneSnapshot.backgroundMedia) !== "none";

  const inFlight = state.phase !== "idle";
  const isContentMode = inFlight && state.mode === "content";
  const isMediaMode = inFlight && state.mode === "media";
  const isFullMode = inFlight && state.mode === "full";
  const sharedMediaHost =
    !isFullMode && !isMediaMode; /* idle or content-only */

  type LaneView = {
    laneId: LaneId;
    /** Snapshot used for content rendering when this lane hosts content. */
    contentSnapshot: DisplayBoxTransitionSnapshot | null;
    /** Snapshot whose backgroundMedia feeds this lane's media host. */
    mediaSnapshot: DisplayBoxTransitionSnapshot | null;
    isActive: boolean;
    isPrevious: boolean;
    hostsMedia: boolean;
    hostsContent: boolean;
    mediaKey: string;
    fullFramePaintReady: boolean;
    liveVideoPaintReady: boolean;
    usesPreparedSurface: boolean;
    mediaOpacity: number | undefined;
    contentOpacity: number | undefined;
    needsStillHold: boolean;
    paintBackground: boolean;
    stackOffset: number;
  };

  const activeSnapshot = state.lanes[state.activeLaneId];
  const mediaSourceSnapshot =
    state.lanes[state.mediaAnchorLaneId] ?? activeSnapshot;

  const laneViews: LaneView[] = (["a", "b"] as const).flatMap((laneId) => {
    const laneSnapshot = state.lanes[laneId];
    const isActive = laneId === state.activeLaneId;
    const isPrevious = inFlight && isActive;

    // Shared-media modes: only the media anchor hosts the player. The anchor
    // may have no content snapshot after a content-only settle — still host
    // media there using the active slide's background.
    const hostsMedia = sharedMediaHost
      ? laneId === state.mediaAnchorLaneId && mediaSourceSnapshot != null
      : laneSnapshot != null;
    const hostsContent =
      laneSnapshot != null && (!isMediaMode || isActive);

    if (!hostsMedia && !hostsContent) return [];

    const mediaSnapshot = hostsMedia
      ? sharedMediaHost
        ? mediaSourceSnapshot
        : laneSnapshot
      : null;
    const contentSnapshot = hostsContent ? laneSnapshot : null;
    if (!mediaSnapshot && !contentSnapshot) return [];

    const mediaKey = getLaneBackgroundMediaKey(
      (mediaSnapshot ?? contentSnapshot)?.backgroundMedia ??
      NONE_LANE_BACKGROUND_MEDIA,
    );
    const usesPrepared = usesPreparedSurface(
      laneId,
      mediaKey,
      mediaSnapshot?.backgroundMedia,
    );
    const mediaState = mediaPaintReadiness[laneId];
    const fullFramePaintReady =
      isContentMode ||
      mediaKey === "none" ||
      (usesPrepared
        ? preparedMediaReady[mediaKey] === true
        : mediaState?.mediaKey === mediaKey && mediaState.ready);
    const liveMediaState = mediaLivePaintReadiness[laneId];
    const liveVideoPaintReady =
      mediaKey !== "none" &&
      (usesPrepared
        ? preparedMediaLiveReady[mediaKey] === true
        : liveMediaState?.mediaKey === mediaKey && liveMediaState.ready);

    let mediaOpacity: number | undefined;
    let contentOpacity: number | undefined;

    const independentPlanes =
      isFullMode &&
      state.foregroundPhase != null &&
      state.mediaPhase != null;
    if (independentPlanes) {
      if (state.foregroundPhase === "preparing") {
        contentOpacity = isActive ? 1 : 0;
      } else if (state.foregroundPhase === "animating") {
        contentOpacity = undefined;
      } else {
        contentOpacity = isActive ? 0 : 1;
      }

      if (state.mediaPhase === "preparing") {
        mediaOpacity = isActive ? 1 : 0;
      } else if (state.mediaPhase === "animating") {
        mediaOpacity = undefined;
      } else {
        mediaOpacity = isActive ? 0 : 1;
      }
    } else if (state.phase === "animating") {
      mediaOpacity = undefined;
      contentOpacity = undefined;
    } else if (isContentMode) {
      mediaOpacity = hostsMedia ? 1 : 0;
      contentOpacity = isActive ? 1 : 0;
    } else if (isMediaMode) {
      mediaOpacity = isActive ? 1 : 0;
      contentOpacity = hostsContent ? 1 : 0;
    } else if (isFullMode) {
      mediaOpacity = isActive ? 1 : 0;
      contentOpacity = isActive ? 1 : 0;
    } else {
      mediaOpacity = 1;
      contentOpacity = 1;
    }

    const stillSource = mediaSnapshot ?? contentSnapshot;
    const needsStillHold = Boolean(
      isContentMode &&
      hostsMedia &&
      stillSource &&
      !hasFullFrameMedia(stillSource) &&
      backgroundIdentityOf(stillSource).startsWith("boxes:"),
    );

    const hasSharedFullFrame =
      mediaSourceSnapshot != null && hasFullFrameMedia(mediaSourceSnapshot);

    return [
      {
        laneId,
        contentSnapshot,
        mediaSnapshot,
        isActive,
        isPrevious,
        hostsMedia,
        hostsContent,
        mediaKey,
        fullFramePaintReady,
        liveVideoPaintReady,
        usesPreparedSurface: usesPrepared,
        mediaOpacity,
        contentOpacity,
        needsStillHold,
        paintBackground:
          !usesPrepared &&
          !needsStillHold &&
          !(sharedMediaHost && hasSharedFullFrame) &&
          !(isContentMode && hasSharedFullFrame),
        stackOffset: roleStackOffset(isPrevious),
      },
    ];
  });

  const poolViews = Array.from(
    laneViews.reduce((views, laneView) => {
      if (
        !laneView.usesPreparedSurface ||
        !laneView.mediaSnapshot ||
        laneView.mediaSnapshot.backgroundMedia.kind !== "fileVideo"
      ) {
        return views;
      }
      const media = laneView.mediaSnapshot.backgroundMedia;
      if (views.has(media.mediaKey)) return views;
      views.set(media.mediaKey, {
        mediaKey: media.mediaKey,
        source: media.originalSrc,
        videoBox: media.videoBox,
        opacity: laneView.mediaOpacity,
        zIndex: laneView.stackOffset,
        shouldPlay: laneView.hostsMedia,
        muted:
          laneView.isPrevious ||
          !(mediaPlayback?.fileVideoAudioEnabled ?? false),
        volume: mediaPlayback?.volume ?? 1,
        playback: resolvePlaybackForLane(
          laneView.laneId,
          laneView.mediaSnapshot.backgroundMedia,
        ),
      });
      return views;
    }, new Map<string, ElectronMediaSurfaceView>()).values(),
  );

  return (
    <div
      className="absolute inset-0"
      data-testid="display-box-transition-stage"
      data-transition-phase={state.phase}
      data-transition-mode={state.phase === "idle" ? "idle" : state.mode}
      data-active-lane={state.activeLaneId}
      data-media-anchor-lane={state.mediaAnchorLaneId}
    >
      {/* Media below content globally — never nest under a lane z-index shell. */}
      <div
        className="absolute inset-0"
        data-testid="display-box-transition-media-plane"
        data-plane="media"
        style={{ zIndex: MEDIA_PLANE_Z, pointerEvents: "none" }}
      >
        <ElectronMediaSurfacePool
          enabled={poolEnabled}
          candidates={poolCandidates}
          candidateDiagnostics={poolCandidateResult.diagnostics}
          views={poolViews}
          onReadyChange={reportPreparedMediaReady}
          onLiveReadyChange={reportPreparedMediaLiveReady}
          onSurfaceElement={reportPreparedMediaElement}
          lastSendPath={lastSendPath}
          lastMediaKey={lastMediaKey}
          posterShown={posterShown}
          outputId={mediaPlayback?.outputId}
          windowRole={mediaPlayback?.windowRole}
        />
        {laneViews.map(
          ({
            laneId,
            mediaSnapshot,
            isActive,
            isPrevious,
            hostsMedia,
            mediaKey,
            mediaOpacity,
            needsStillHold,
            stackOffset,
            usesPreparedSurface,
          }) => {
            if (!hostsMedia || !mediaSnapshot || usesPreparedSurface) return null;
            return (
              <div
                key={`media-${laneId}`}
                ref={(node) => {
                  mediaRefs.current[laneId] = node;
                }}
                className="absolute inset-0"
                data-testid={`display-box-transition-media-${laneId}`}
                data-lane-role={
                  isPrevious ? "outgoing" : isActive ? "active" : "incoming"
                }
                style={{
                  opacity: mediaOpacity,
                  zIndex: stackOffset,
                  willChange: "opacity",
                }}
              >
                <LaneFullFrameMedia
                  key={`${laneId}:${mediaKey}`}
                  media={
                    mediaSnapshot.backgroundMedia ?? NONE_LANE_BACKGROUND_MEDIA
                  }
                  isPrevious={isPrevious}
                  onPaintReadyChange={(ready) =>
                    reportMediaPaintReady(laneId, mediaKey, ready)
                  }
                  onLivePaintReadyChange={(ready) =>
                    reportMediaLivePaintReady(laneId, mediaKey, ready)
                  }
                  fileVideoAudioEnabled={mediaPlayback?.fileVideoAudioEnabled}
                  volume={mediaPlayback?.volume}
                  playbackRole={mediaPlayback?.playbackRole}
                  preloadRole={mediaPlayback?.preloadRole}
                  suspendPlayback={mediaPlayback?.suspendPlayback}
                  playback={resolvePlaybackForLane(
                    laneId,
                    mediaSnapshot.backgroundMedia,
                  )}
                  isEditor={mediaPlayback?.isEditor}
                  outputId={mediaPlayback?.outputId}
                  windowRole={mediaPlayback?.windowRole}
                  localVideo={mediaPlayback?.localVideo}
                />
                {needsStillHold &&
                  renderLane(
                    mediaSnapshot,
                    isPrevious,
                    (index, ready) =>
                      reportBoxPaintReady(
                        laneId,
                        mediaSnapshot.key,
                        index,
                        ready,
                      ),
                    {
                      fullFramePaintReady: true,
                      liveVideoPaintReady: true,
                      paintBackground: true,
                      paintForeground: false,
                    },
                  )}
              </div>
            );
          },
        )}
      </div>

      <div
        className="absolute inset-0"
        data-testid="display-box-transition-content-plane"
        data-plane="content"
        style={{ zIndex: CONTENT_PLANE_Z, pointerEvents: "none" }}
      >
        {laneViews.map(
          ({
            laneId,
            contentSnapshot,
            isActive,
            isPrevious,
            hostsContent,
            mediaKey,
            fullFramePaintReady,
            liveVideoPaintReady,
            contentOpacity,
            needsStillHold,
            paintBackground,
            stackOffset,
          }) => {
            if (!hostsContent || !contentSnapshot) return null;
            return (
              <div
                key={`content-${laneId}`}
                ref={(node) => {
                  contentRefs.current[laneId] = node;
                }}
                className="absolute inset-0"
                data-testid={`display-box-transition-content-${laneId}`}
                data-lane-role={
                  isPrevious ? "outgoing" : isActive ? "active" : "incoming"
                }
                data-snapshot-key={contentSnapshot.key}
                data-background-media={mediaKey}
                data-background-identity={backgroundIdentityOf(contentSnapshot)}
                data-foreground-identity={foregroundIdentityOf(contentSnapshot)}
                style={{
                  opacity: contentOpacity,
                  zIndex: stackOffset,
                  willChange: "opacity",
                }}
              >
                <div
                  data-testid={`display-box-transition-lane-${laneId}`}
                  data-lane-role={
                    isPrevious ? "outgoing" : isActive ? "active" : "incoming"
                  }
                  className="absolute inset-0"
                >
                  {renderLane(
                    contentSnapshot,
                    isPrevious,
                    (index, ready) =>
                      reportBoxPaintReady(
                        laneId,
                        contentSnapshot.key,
                        index,
                        ready,
                      ),
                    {
                      fullFramePaintReady,
                      liveVideoPaintReady,
                      paintBackground: paintBackground && !needsStillHold,
                      paintForeground: true,
                    },
                  )}
                </div>
              </div>
            );
          },
        )}
      </div>
    </div>
  );
};

export default DisplayBoxTransitionStage;
