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
import type { ElectronMediaDiscovery } from "../../utils/electronMediaSurfaceDiagnostics";
import {
  isMediaSurfaceVisible,
  mediaSurfaceStatusKey,
  type MediaSurfaceStatus,
} from "../../utils/mediaSurfaceLifecycle";
import { areEquivalentMediaSources } from "../../utils/mediaSource";

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

type TransitionState = {
  activeLaneId: LaneId;
  lanes: Record<LaneId, DisplayBoxTransitionSnapshot | null>;
  phase: "idle" | "preparing" | "animating";
  requestedKey: string;
  queuedSnapshot: DisplayBoxTransitionSnapshot | null;
  mode: TransitionMode;
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
  /** Resolved outline for this output's controller scope. */
  preparedMediaOutlineId?: string | null;
  preparedMediaContext?: Pick<
    ElectronMediaDiscovery,
    | "controllerProfileId"
    | "controllerProfileName"
    | "outlineScope"
    | "outlineId"
    | "outlineName"
    | "contextSource"
  >;
  preparedSurfaceBudget?: number;
  preparedMediaScope?: "service" | "current-item";
  /** Resolved display setting; false means this surface does not paint backgrounds. */
  showBackground?: boolean;
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

const TRANSITION_DURATION_SECONDS = 0.5;
const CONTENT_INCOMING_OFFSET_SECONDS = 0.1;
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
  const preparedMediaRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const preparedMediaStatusRef = useRef<Record<string, MediaSurfaceStatus>>({});
  const [preparedMediaStatuses, setPreparedMediaStatuses] = useState<
    Record<string, MediaSurfaceStatus>
  >({});
  const [lastSendPath, setLastSendPath] = useState<"pool" | "fallback">(
    "fallback",
  );
  const [lastMediaKey, setLastMediaKey] = useState<string | undefined>();
  const [posterShown, setPosterShown] = useState<boolean | undefined>();
  const [transitionStart, setTransitionStart] = useState<
    { mediaKey: string; timestamp: number } | undefined
  >();
  const [transitionComplete, setTransitionComplete] = useState<
    { mediaKey: string; timestamp: number } | undefined
  >();
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
    (mediaPlayback?.playbackRole === "output" ||
      (mediaPlayback?.playbackRole === "preview" && mediaPlayback.isEditor)) &&
      (mediaPlayback.playbackRole === "preview" || mediaPlayback.outputId) &&
      mediaPlayback.showBackground !== false &&
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
    outlineId: mediaPlayback?.preparedMediaOutlineId,
    currentMedia: currentPoolMedia,
    protectedMediaKeys: protectedPoolMediaKeys,
    maxSurfaces: mediaPlayback?.preparedSurfaceBudget,
    scope: mediaPlayback?.preparedMediaScope,
    renderer: "projector",
    controllerProfileId:
      mediaPlayback?.preparedMediaContext?.controllerProfileId,
    controllerProfileName:
      mediaPlayback?.preparedMediaContext?.controllerProfileName,
    outlineScope: mediaPlayback?.preparedMediaContext?.outlineScope,
    outlineName: mediaPlayback?.preparedMediaContext?.outlineName,
    contextSource: mediaPlayback?.preparedMediaContext?.contextSource,
  });
  const poolCandidates = poolCandidateResult.candidates;
  const lifecycleRoute = mediaPlayback?.windowRole ?? "display-window";
  const lifecycleRole = mediaPlayback?.isEditor
    ? "editor-preview"
    : "projector-output";
  const lifecycleOutlineId = mediaPlayback?.preparedMediaOutlineId;

  useLayoutEffect(() => {
    const currentStatuses = Object.values(preparedMediaStatusRef.current).filter(
      (status) =>
        status.route === lifecycleRoute &&
        status.role === lifecycleRole &&
        status.outlineId === lifecycleOutlineId,
    );
    const nextStatuses = Object.fromEntries(
      currentStatuses.map((status) => [mediaSurfaceStatusKey(status), status]),
    );
    preparedMediaStatusRef.current = nextStatuses;
    setPreparedMediaStatuses((current) => {
      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(nextStatuses);
      if (
        currentKeys.length === nextKeys.length &&
        currentKeys.every((key) => current[key] === nextStatuses[key])
      ) {
        return current;
      }
      return nextStatuses;
    });
  }, [lifecycleOutlineId, lifecycleRole, lifecycleRoute]);

  const reportPreparedMediaStatus = useCallback(
    (status: MediaSurfaceStatus) => {
      if (
        status.route !== lifecycleRoute ||
        status.role !== lifecycleRole ||
        status.outlineId !== lifecycleOutlineId
      ) {
        return;
      }
      const key = mediaSurfaceStatusKey(status);
      const current = preparedMediaStatusRef.current[key];
      if (
        current &&
        (status.generation < current.generation ||
          (status.generation === current.generation &&
            status.sourceIdentity !== current.sourceIdentity))
      ) {
        return;
      }
      if (status.phase === "disposed") {
        delete preparedMediaStatusRef.current[key];
        setPreparedMediaStatuses((all) => {
          if (!(key in all)) return all;
          const next = { ...all };
          delete next[key];
          return next;
        });
        return;
      }
      preparedMediaStatusRef.current[key] = status;
      setPreparedMediaStatuses((all) =>
        all[key] === status ? all : { ...all, [key]: status },
      );
    },
    [lifecycleOutlineId, lifecycleRole, lifecycleRoute],
  );
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
            getLanePreparedMediaKey(
              state.lanes[incomingLaneId]?.backgroundMedia,
            )
          ],
      );
      const activeMediaOpacity = readLaneOpacity(
        mediaRefs.current[activeLaneId] ??
          preparedMediaRefs.current[
            getLanePreparedMediaKey(state.lanes[activeLaneId]?.backgroundMedia)
          ],
      );
      let baselineLaneId = activeLaneId;
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

      if (baselineSnapshot) {
        timelineRef.current?.kill();
        timelineRef.current = null;
        for (const laneId of ["a", "b"] as const) {
          const mediaOpacity = laneId === baselineLaneId ? 1 : 0;
          const contentOpacity = laneId === baselineLaneId ? 1 : 0;
          if (mediaRefs.current[laneId]) {
            gsap.set(mediaRefs.current[laneId], { opacity: mediaOpacity });
          }
          if (contentRefs.current[laneId]) {
            gsap.set(contentRefs.current[laneId], { opacity: contentOpacity });
          }
          const preparedMediaKey = getLanePreparedMediaKey(
            state.lanes[laneId]?.backgroundMedia,
          );
          if (preparedMediaRefs.current[preparedMediaKey]) {
            gsap.set(preparedMediaRefs.current[preparedMediaKey], {
              opacity: mediaOpacity,
            });
          }
        }
        const nextMode = resolveTransitionMode(baselineSnapshot, snapshot);
        setState({
          activeLaneId: baselineLaneId,
          lanes: lanePair(baselineLaneId, baselineSnapshot, snapshot),
          phase: "preparing",
          requestedKey: snapshot.key,
          queuedSnapshot: null,
          mode: nextMode,
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
      return {
        ...current,
        lanes: { ...current.lanes, [incomingLaneId]: snapshot },
        phase: "preparing",
        requestedKey: snapshot.key,
        queuedSnapshot: null,
        mode,
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

  const preparedStatusForKey = useCallback(
    (mediaKey: string): MediaSurfaceStatus | undefined =>
      Object.values(preparedMediaStatuses).find(
        (status) =>
          status.mediaKey === mediaKey &&
          status.route === lifecycleRoute &&
          status.role === lifecycleRole &&
          status.outlineId === lifecycleOutlineId &&
          (() => {
            const candidate = poolCandidates.find(
              (entry) => entry.mediaKey === mediaKey,
            );
            return (
              !candidate ||
              areEquivalentMediaSources(candidate.source, status.sourceIdentity)
            );
          })(),
      ),
    [
      lifecycleOutlineId,
      lifecycleRole,
      lifecycleRoute,
      poolCandidates,
      preparedMediaStatuses,
    ],
  );

  const usesPreparedSurface = useCallback(
    (
      laneId: LaneId,
      mediaSnapshot?: DisplayBoxTransitionSnapshot["backgroundMedia"],
    ): boolean => {
      const media = mediaSnapshot ?? state.lanes[laneId]?.backgroundMedia;
      const preparedKey = getLanePreparedMediaKey(media);
      if (!poolEnabled || preparedKey === "none") return false;
      const status = preparedStatusForKey(preparedKey);
      return isMediaSurfaceVisible(status);
    },
    [
      poolEnabled,
      preparedStatusForKey,
      state.lanes,
    ],
  );

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
    const preparedMediaKey = getLanePreparedMediaKey(
      laneSnapshot.backgroundMedia,
    );
    const mediaState = mediaPaintReadiness[laneId];
    const isIncomingLane =
      state.phase !== "idle" && laneId === otherLane(state.activeLaneId);
    const preparedStatus = preparedStatusForKey(preparedMediaKey);
    const preparedCandidateSelected =
      poolEnabled &&
      isIncomingLane &&
      laneSnapshot.backgroundMedia.kind === "fileVideo" &&
      poolCandidates.some((candidate) => candidate.mediaKey === preparedMediaKey) &&
      preparedStatus?.phase !== "disposed" &&
      !preparedStatus?.error;
    const usesPrepared = usesPreparedSurface(
      laneId,
      laneSnapshot.backgroundMedia,
    );
    const mediaReady =
      mode === "content" ||
      mediaKey === "none" ||
      (usesPrepared
        ? isMediaSurfaceVisible(preparedStatus)
        : mediaState?.mediaKey === mediaKey && mediaState.ready);
    const activeSnapshot = state.lanes[state.activeLaneId];
    const outgoingMediaKey = getLaneBackgroundMediaKey(
      activeSnapshot?.backgroundMedia,
    );
    const outgoingUsesPrepared = usesPreparedSurface(
      state.activeLaneId,
      activeSnapshot?.backgroundMedia,
    );
    const outgoingPreparedMediaKey = getLanePreparedMediaKey(
      activeSnapshot?.backgroundMedia,
    );
    const outgoingPreparedStatus = preparedStatusForKey(outgoingPreparedMediaKey);
    const outgoingActivePrepared = isMediaSurfaceVisible(outgoingPreparedStatus);
    const outgoingLiveMedia = mediaLivePaintReadiness[state.activeLaneId];
    const outgoingFileVideoCanBeLive =
      activeSnapshot?.backgroundMedia.kind === "fileVideo" &&
      (outgoingActivePrepared ||
        (outgoingUsesPrepared
        ? isMediaSurfaceVisible(outgoingPreparedStatus)
        : outgoingLiveMedia?.mediaKey !== outgoingMediaKey ||
          outgoingLiveMedia.ready));
    const incomingFileVideoMustBeLive =
      mode !== "content" &&
      laneSnapshot.backgroundMedia.kind === "fileVideo" &&
      outgoingFileVideoCanBeLive &&
      outgoingMediaKey !== mediaKey;
    const incomingUsesPreparedSurface = preparedCandidateSelected || usesPrepared;
    const incomingLiveMedia = mediaLivePaintReadiness[laneId];
    const incomingLiveReady =
      incomingUsesPreparedSurface
        ? isMediaSurfaceVisible(preparedStatus)
        : incomingLiveMedia?.mediaKey === mediaKey && incomingLiveMedia.ready;

    // READY means the retained starting frame can paint while hidden. When a
    // different prepared file video replaces a live outgoing file video, the
    // incoming surface must also resume playback and present an advancing
    // frame before it is allowed to cover the outgoing surface.
    if (
      preparedCandidateSelected &&
      (!isMediaSurfaceVisible(preparedStatus) ||
        (incomingFileVideoMustBeLive && !incomingLiveReady))
    ) {
      return false;
    }

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

    const incomingMedia = incomingSnapshot?.backgroundMedia;
    const incomingPreparedKey = getLanePreparedMediaKey(incomingMedia);
    const incomingUsesPrepared = usesPreparedSurface(
      incomingLaneId,
      incomingMedia,
    );
    const incomingFallbackLiveReady =
      incomingMedia?.kind === "fileVideo" &&
      mediaLivePaintReadiness[incomingLaneId]?.mediaKey ===
        getLaneBackgroundMediaKey(incomingMedia) &&
      mediaLivePaintReadiness[incomingLaneId]?.ready === true;
    if (incomingMedia?.kind === "fileVideo") {
      setLastMediaKey(incomingMedia.mediaKey);
      setLastSendPath(incomingUsesPrepared ? "pool" : "fallback");
      setPosterShown(!incomingUsesPrepared && !incomingFallbackLiveReady);
      if (incomingUsesPrepared) {
        setTransitionStart({
          mediaKey: incomingPreparedKey,
          timestamp: performance.now(),
        });
      }
    } else {
      setLastMediaKey(undefined);
      setLastSendPath("fallback");
      setPosterShown(false);
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
    preparedMediaStatuses,
    poolCandidates,
    poolEnabled,
    shouldAnimate,
    state.activeLaneId,
    state.mode,
    state.lanes,
    state.phase,
  ]);

  useLayoutEffect(() => {
    if (
      state.phase !== "animating" ||
      !incomingSnapshot
    ) {
      return;
    }

    const mode = state.mode;
    const mediaElementForLane = (laneId: LaneId) => {
      const laneMedia = state.lanes[laneId]?.backgroundMedia;
      const preparedKey = getLanePreparedMediaKey(laneMedia);
      return usesPreparedSurface(laneId, laneMedia)
        ? preparedMediaRefs.current[preparedKey]
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
        const completedMedia = incomingSnapshot.backgroundMedia;
        if (
          completedMedia.kind === "fileVideo" &&
          usesPreparedSurface(incomingLaneId, completedMedia)
        ) {
          setTransitionComplete({
            mediaKey: getLanePreparedMediaKey(completedMedia),
            timestamp: performance.now(),
          });
        }
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
        incomingMedia,
        { opacity: 0 },
        {
          opacity: 1,
          duration: TRANSITION_DURATION_SECONDS,
          ease: TRANSITION_EASE,
        },
        "crossfade",
      );
    }

    if (animateContent && outgoingContent && incomingContent) {
      gsap.set(outgoingContent, { opacity: 1 });
      gsap.set(incomingContent, { opacity: 0 });
      timeline.fromTo(
        outgoingContent,
        { opacity: 1 },
        { opacity: 0, duration: TRANSITION_DURATION_SECONDS, ease: TRANSITION_EASE },
        "crossfade",
      );
      timeline.fromTo(
        incomingContent,
        { opacity: 0 },
        {
          opacity: 1,
          duration: TRANSITION_DURATION_SECONDS,
          ease: TRANSITION_EASE,
        },
        `crossfade+=${CONTENT_INCOMING_OFFSET_SECONDS}`,
      );
    }

    return () => {
      timeline.kill();
      if (timelineRef.current === timeline) timelineRef.current = null;
    };
  // Re-resolve the media element when readiness or lane ownership changes so a
  // prepared wrapper can take part in the same coordinated timeline.
  }, [
    incomingLaneId,
    incomingSnapshot,
    state.activeLaneId,
    state.lanes,
    state.mode,
    state.phase,
    preparedMediaStatuses,
    poolCandidates,
    mediaPlayback?.outputId,
    mediaPlayback?.windowRole,
    usesPreparedSurface,
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
    mediaAudioEnabled: boolean;
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
    const preparedMediaKey = getLanePreparedMediaKey(
      (mediaSnapshot ?? contentSnapshot)?.backgroundMedia,
    );
    const usesPrepared = usesPreparedSurface(
      laneId,
      mediaSnapshot?.backgroundMedia,
    );
    const mediaState = mediaPaintReadiness[laneId];
    const fullFramePaintReady =
      isContentMode ||
      mediaKey === "none" ||
      (usesPrepared
        ? isMediaSurfaceVisible(
            preparedStatusForKey(preparedMediaKey),
          )
        : mediaState?.mediaKey === mediaKey && mediaState.ready);
    const liveMediaState = mediaLivePaintReadiness[laneId];
    const liveVideoPaintReady =
      mediaKey !== "none" &&
      (usesPrepared
        ? isMediaSurfaceVisible(
            preparedStatusForKey(preparedMediaKey),
          )
        : liveMediaState?.mediaKey === mediaKey && liveMediaState.ready);
    // Keep the current audience owner audible while a replacement prepares,
    // keep incoming media muted until the coordinated fade starts, and avoid
    // two audible owners during the fade itself.
    const mediaAudioEnabled =
      mediaPlayback?.fileVideoAudioEnabled === true &&
      (state.phase === "idle" ||
        state.mode === "content" ||
        (state.phase === "preparing" && isPrevious) ||
        (state.phase === "animating" && !isPrevious));

    let mediaOpacity: number | undefined;
    let contentOpacity: number | undefined;

    if (state.phase === "animating") {
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
        mediaAudioEnabled,
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
        !laneView.mediaSnapshot ||
        laneView.mediaSnapshot.backgroundMedia.kind !== "fileVideo"
      ) {
        return views;
      }
      const media = laneView.mediaSnapshot.backgroundMedia;
      const preparedMediaKey = getLanePreparedMediaKey(media);
      if (views.has(preparedMediaKey)) return views;
      views.set(preparedMediaKey, {
        mediaKey: preparedMediaKey,
        source: media.originalSrc,
        videoBox: media.videoBox,
         // The pool must receive the selected incoming view while it is still
         // ready-paused so it can request activation. It remains transparent
         // until the shared lifecycle reports active-playing.
         opacity: laneView.usesPreparedSurface ? laneView.mediaOpacity : 0,
        zIndex: laneView.stackOffset,
         shouldPlay:
           laneView.hostsMedia &&
           (laneView.usesPreparedSurface ||
             (state.phase !== "idle" && !laneView.isPrevious)),
        muted:
          !laneView.mediaAudioEnabled,
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
      data-prepared-media-status={Object.values(preparedMediaStatuses)
        .map((status) => `${status.mediaKey}:${status.phase}`)
        .join(",")}
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
          onStatusChange={reportPreparedMediaStatus}
          route={lifecycleRoute}
          role={lifecycleRole}
          outlineId={lifecycleOutlineId}
          onSurfaceElement={reportPreparedMediaElement}
          discovery={poolCandidateResult.discovery}
          poolCapacity={poolCandidateResult.poolCapacity}
          transitionStart={transitionStart}
          transitionComplete={transitionComplete}
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
            mediaAudioEnabled,
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
                  fileVideoAudioEnabled={mediaAudioEnabled}
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
                  // Keep the lane wrapper stable so GSAP can own its opacity,
                  // but make the rendered foreground identity explicit. A lane
                  // may be reused for the newest request during an interrupted
                  // fade; reconciling that subtree in place can retain a
                  // renderer's old text/content node. Media is intentionally
                  // outside this keyed subtree and remains mounted.
                  key={`content-${laneId}:${foregroundIdentityOf(contentSnapshot)}`}
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
