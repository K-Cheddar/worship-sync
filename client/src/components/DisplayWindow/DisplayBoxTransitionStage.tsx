import {
  useCallback,
  useLayoutEffect,
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
  getSnapshotBackgroundIdentity,
  getSnapshotForegroundIdentity,
  NONE_LANE_BACKGROUND_MEDIA,
  type LaneBackgroundMedia,
} from "./laneBackgroundMedia";

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
    if (isNewRequest) requestGenerationRef.current += 1;

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
        mediaRefs.current[incomingLaneId],
      );
      const activeMediaOpacity = readLaneOpacity(
        mediaRefs.current[activeLaneId],
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
      const baselineSnapshot =
        state.lanes[baselineLaneId] ?? state.lanes[activeLaneId];

      if (baselineSnapshot) {
        timelineRef.current?.kill();
        timelineRef.current = null;
        for (const laneId of ["a", "b"] as const) {
          const opacity = laneId === baselineLaneId ? 1 : 0;
          if (mediaRefs.current[laneId]) {
            gsap.set(mediaRefs.current[laneId], { opacity });
          }
          if (contentRefs.current[laneId]) {
            gsap.set(contentRefs.current[laneId], { opacity });
          }
        }
        setState({
          activeLaneId: baselineLaneId,
          lanes: lanePair(baselineLaneId, baselineSnapshot, snapshot),
          phase: "preparing",
          requestedKey: snapshot.key,
          queuedSnapshot: null,
          mode: resolveTransitionMode(baselineSnapshot, snapshot),
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
  }, [mediaPlayback?.outputId, mediaPlayback?.windowRole, snapshot, state]);

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
    const mediaReady =
      mode === "content" ||
      mediaKey === "none" ||
      (mediaState?.mediaKey === mediaKey && mediaState.ready);
    return boxesReady && mediaReady;
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

    setState((current) =>
      current.phase === "preparing"
        ? { ...current, phase: "animating" }
        : current,
    );
  }, [incomingPaintReady, shouldAnimate, state.phase]);

  useLayoutEffect(() => {
    if (state.phase !== "animating" || !incomingSnapshot) return;

    const mode = state.mode;
    const outgoingMedia = mediaRefs.current[state.activeLaneId];
    const incomingMedia = mediaRefs.current[incomingLaneId];
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
  }, [
    incomingLaneId,
    incomingSnapshot,
    state.activeLaneId,
    state.lanes,
    state.mode,
    state.phase,
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
    const mediaState = mediaPaintReadiness[laneId];
    const fullFramePaintReady =
      isContentMode ||
      mediaKey === "none" ||
      (mediaState?.mediaKey === mediaKey && mediaState.ready);
    const liveMediaState = mediaLivePaintReadiness[laneId];
    const liveVideoPaintReady =
      mediaKey !== "none" &&
      liveMediaState?.mediaKey === mediaKey &&
      liveMediaState.ready;

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
        mediaOpacity,
        contentOpacity,
        needsStillHold,
        paintBackground:
          !needsStillHold &&
          !(sharedMediaHost && hasSharedFullFrame) &&
          !(isContentMode && hasSharedFullFrame),
        stackOffset: roleStackOffset(isPrevious),
      },
    ];
  });

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
          }) => {
            if (!hostsMedia || !mediaSnapshot) return null;
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
