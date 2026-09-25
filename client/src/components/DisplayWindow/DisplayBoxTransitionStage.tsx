import {
  useCallback,
  useContext,
  useEffect,
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
import {
  useRemoteMediaPreparationManifest,
  useReportRemoteMediaPreparationReadiness,
} from "../../hooks/useMediaPreparationManifest";
import { GlobalInfoContext } from "../../context/globalInfo";
import ElectronMediaSurfacePool from "./ElectronMediaSurfacePool";
import {
  selectElectronMediaSurfaceCandidates,
  type ElectronMediaSurfaceCandidate,
  type ElectronMediaSurfaceView,
} from "../../utils/electronMediaSurfacePool";
import type {
  ElectronMediaDiscovery,
  ElectronMediaSurfaceCandidateDiagnostic,
} from "../../utils/electronMediaSurfaceDiagnostics";
import {
  isMediaSurfaceVisible,
  isPreparedMediaSurfaceUsable,
  mediaSurfaceStatusKey,
  type MediaSurfaceStatus,
} from "../../utils/mediaSurfaceLifecycle";
import {
  DISPLAY_TRANSITION_DURATION_DEFAULT_MS,
  normalizeTransitionDurationMs,
} from "../../utils/displaySettings";
import { mediaPreparationManifestToCandidates } from "../../utils/mediaPreparationManifest";
import { isHLSVideoSource } from "../../utils/isInstantVideoSource";
import { isPlayableMediaSource } from "../../utils/mediaSource";

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
type IncomingVideoPath =
  | "prepared-video"
  | "poster-then-video"
  | "video-fallback"
  | "waiting-for-visual";

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
  transportRole?: "editor" | "none";
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
  /** Total visual transition duration for this output. */
  transitionDurationMs?: number;
  mediaPlayback?: LaneMediaPlaybackOptions;
  renderLane: (
    snapshot: DisplayBoxTransitionSnapshot,
    isPrevious: boolean,
    reportBoxPaintReady: (index: number, ready: boolean) => void,
    laneMedia: LaneRenderMediaOptions,
  ) => ReactNode;
};

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

const isRendererLocalCandidate = (candidate: ElectronMediaSurfaceCandidate) =>
  candidate.sourceKind === "cache" ||
  candidate.sourceKind === "local" ||
  candidate.source.startsWith("media-cache://") ||
  candidate.source.startsWith("worshipsync-media://") ||
  candidate.source.startsWith("blob:");

export const getDisplayTransitionTiming = (durationMs: number) => {
  const durationSeconds =
    normalizeTransitionDurationMs(
      durationMs,
      DISPLAY_TRANSITION_DURATION_DEFAULT_MS,
    ) / 1000;
  const incomingContentOffsetSeconds = Number(
    Math.min(
      CONTENT_INCOMING_OFFSET_SECONDS,
      durationSeconds * 0.2,
    ).toFixed(3),
  );
  return {
    durationMs: durationSeconds * 1000,
    durationSeconds,
    incomingContentOffsetSeconds,
    incomingContentDurationSeconds: Number(
      Math.max(0, durationSeconds - incomingContentOffsetSeconds).toFixed(3),
    ),
  };
};

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

const hasPreparedFrame = (status: MediaSurfaceStatus | undefined) =>
  status?.geometryReady === true &&
  (status.phase === "ready-paused" ||
    status.phase === "activation-requested" ||
    isMediaSurfaceVisible(status));

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
  transitionDurationMs = DISPLAY_TRANSITION_DURATION_DEFAULT_MS,
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
  const timelineGenerationRef = useRef<number | null>(null);
  const mediaOwnersRef = useRef(
    new Map<string, { generation: number; sourceIdentity: string }>(),
  );
  // The stage locks the incoming renderer at the transition boundary. A pool
  // surface that finishes later cannot replace a fallback player mid-slide.
  const incomingVideoPathsRef = useRef(new Map<string, IncomingVideoPath>());
  useLayoutEffect(() => () => {
    timelineRef.current?.kill();
    timelineRef.current = null;
    timelineGenerationRef.current = null;
  }, []);
  const preparedMediaRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const preparedMediaStatusRef = useRef<Record<string, MediaSurfaceStatus>>({});
  const [preparedMediaStatuses, setPreparedMediaStatuses] = useState<
    Record<string, MediaSurfaceStatus>
  >({});
  const [lastSendPath, setLastSendPath] = useState<IncomingVideoPath>(
    "waiting-for-visual",
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
  const requestSentAtRef = useRef<number | undefined>(undefined);
  const videoRequestSentAtRef = useRef(new Map<string, number>());
  const firstFrameLogTokensRef = useRef(new Set<string>());
  const mediaPlaybackRef = useRef(mediaPlayback);
  mediaPlaybackRef.current = mediaPlayback;
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
  const [mediaPosterPaintReadiness, setMediaPosterPaintReadiness] = useState<
    Record<LaneId, { mediaKey: string; ready: boolean } | null>
  >({ a: null, b: null });
  const laneSnapshotsRef = useRef<
    Record<LaneId, DisplayBoxTransitionSnapshot | null>
  >({ a: snapshot, b: null });
  laneSnapshotsRef.current = state.lanes;
  const mediaLaneForContentLane = useCallback((contentLaneId: LaneId): LaneId => {
    if (
      state.phase === "idle" ||
      state.mode === "content" ||
      state.mediaAnchorLaneId === state.activeLaneId
    ) return contentLaneId;
    return contentLaneId === state.activeLaneId
      ? state.mediaAnchorLaneId
      : otherLane(state.mediaAnchorLaneId);
  }, [
    state.activeLaneId,
    state.mediaAnchorLaneId,
    state.mode,
    state.phase,
  ]);

  // Controller tiles already play the current video in their fallback lane.
  // A service-wide pool per tile competes with the editor and output windows
  // for Electron video decoders and can leave tile transitions waiting on it.
  const poolEnabled = Boolean(
    mediaPlayback?.playbackRole === "output" &&
      mediaPlayback.outputId &&
      mediaPlayback.showBackground !== false &&
      window.electronAPI,
  );
  const { sessionKind } = useContext(GlobalInfoContext) || {};
  const servicePreparationEnabled = Boolean(
    poolEnabled ||
      (mediaPlayback?.playbackRole === "output" &&
        mediaPlayback.outputId &&
        sessionKind !== "display"),
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
    enabled: servicePreparationEnabled,
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
  useEffect(() => {
    // Electron poster rendering already resolves through the shared media
    // cache path; a second raw-URL request here could duplicate that fetch.
    if (window.electronAPI) return;
    const probes = poolCandidateResult.posterUrls.map((url) => {
      const image = new Image();
      image.decoding = "async";
      image.src = url;
      return image;
    });
    return () => {
      probes.forEach((image) => {
        image.onload = null;
        image.onerror = null;
        image.src = "";
      });
    };
  }, [poolCandidateResult.posterUrls]);
  const remotePreparation = useRemoteMediaPreparationManifest({
    enabled: poolEnabled && sessionKind === "display",
    outputId: mediaPlayback?.outputId,
  });
  const remoteManifestCandidates = useMemo(
    () =>
      mediaPreparationManifestToCandidates(
        remotePreparation.manifest,
        remotePreparation.cacheMap,
      ),
    [remotePreparation.cacheMap, remotePreparation.manifest],
  );
  const poolCandidates = useMemo(() => {
    if (sessionKind !== "display" || !remotePreparation.manifest) {
      return poolCandidateResult.candidates;
    }
    // Keep the live current-media fallback while the controller's next
    // structural manifest is still in flight. The remote renderer never reads
    // controller-local PouchDB state.
    const currentFallback = poolCandidateResult.candidates.filter(
      (candidate) => candidate.mediaKey === currentPoolMedia?.mediaKey,
    );
    const currentFallbackByKey = new Map(
      currentFallback.map((candidate) => [candidate.mediaKey, candidate]),
    );
    const manifestCandidates = remoteManifestCandidates.map(
      (candidate) => {
        const fallback = currentFallbackByKey.get(candidate.mediaKey);
        return fallback && isRendererLocalCandidate(fallback)
          ? fallback
          : candidate;
      },
    );
    const manifestKeys = new Set(
      remoteManifestCandidates.map((candidate) => candidate.mediaKey),
    );
    return selectElectronMediaSurfaceCandidates({
      candidates: [
        ...manifestCandidates,
        ...currentFallback.filter(
          (candidate) => !manifestKeys.has(candidate.mediaKey),
        ),
      ],
      currentMediaKey: currentPoolMedia?.mediaKey,
      currentItemId: mediaPlayback?.currentItemId,
      protectedMediaKeys: protectedPoolMediaKeys,
      maxSurfaces: mediaPlayback?.preparedSurfaceBudget,
    });
  }, [
    currentPoolMedia?.mediaKey,
    mediaPlayback?.currentItemId,
    mediaPlayback?.preparedSurfaceBudget,
    poolCandidateResult.candidates,
    protectedPoolMediaKeys,
    remoteManifestCandidates,
    remotePreparation.manifest,
    sessionKind,
  ]);
  const usingRemoteManifest = Boolean(
    sessionKind === "display" && remotePreparation.manifest,
  );
  const remoteManifestDiagnostics = useMemo<ElectronMediaSurfaceCandidateDiagnostic[]>(
    () => remoteManifestCandidates.map((candidate) => {
      const pendingHls = isHLSVideoSource(candidate.source);
      const eligible = isPlayableMediaSource(candidate.source) && !pendingHls;
      return {
        mediaKey: candidate.mediaKey,
        originalSource: candidate.originalSource ?? candidate.source,
        resolvedSource: candidate.source !== candidate.originalSource ? candidate.source : undefined,
        sourceKind: candidate.sourceKind ?? "remote",
        status: eligible ? "eligible" : pendingHls ? "pending-cache" : "excluded",
        cacheStatus: eligible ? candidate.source !== candidate.originalSource ? "cached" : "not-required" : pendingHls ? "pending" : "not-cacheable",
        eligible,
        reason: eligible ? "candidate from received remote manifest" : pendingHls ? "waiting for a finite cached rendition" : "manifest source is not a playable finite video",
        itemId: candidate.itemId,
        itemName: candidate.itemName,
        itemIndex: candidate.itemIndex,
      };
    }),
    [remoteManifestCandidates],
  );
  const remoteManifestDiscovery = useMemo<ElectronMediaDiscovery | undefined>(() => {
    const manifest = remotePreparation.manifest;
    if (!usingRemoteManifest || !manifest) return undefined;
    const diagnosticsByKey = new Map(remoteManifestDiagnostics.map((diagnostic) => [diagnostic.mediaKey, diagnostic]));
    const items = manifest.items.map((item) => ({
      itemId: item.itemId,
      itemName: item.itemName,
      itemIndex: item.itemIndex,
      videos: item.media.map((media) => {
        const diagnostic = diagnosticsByKey.get(media.mediaKey);
        return {
          mediaKey: media.mediaKey,
          source: diagnostic?.resolvedSource ?? media.source.url,
          originalSource: media.source.url,
          resolvedSource: diagnostic?.resolvedSource,
          sourceKind: diagnostic?.sourceKind ?? "remote",
          status: diagnostic?.status ?? "excluded",
          cacheStatus: diagnostic?.cacheStatus ?? "unavailable",
        };
      }),
    }));
    const inventoryKeys = new Set(items.flatMap((item) => item.videos.map((video) => video.mediaKey)));
    const finiteKeys = new Set(remoteManifestDiagnostics.filter((entry) => entry.status === "eligible").map((entry) => entry.mediaKey));
    const pendingKeys = new Set(remoteManifestDiagnostics.filter((entry) => entry.status === "pending-cache").map((entry) => entry.mediaKey));
    const excludedKeys = new Set(remoteManifestDiagnostics.filter((entry) => entry.status === "excluded").map((entry) => entry.mediaKey));
    return {
      renderer: "projector",
      outputId: mediaPlayback?.outputId,
      controllerProfileId: manifest.controllerProfileId,
      controllerProfileName: manifest.controllerProfileName,
      outlineScope: manifest.outlineScope,
      outlineId: manifest.outlineId,
      outlineName: manifest.outlineName,
      targetOutlineId: manifest.outlineId,
      targetOutlineName: manifest.outlineName,
      loadedOutlineId: manifest.outlineId ?? undefined,
      loadedOutlineName: manifest.outlineName,
      outlineLoadState: "loaded",
      inventoryState: "complete",
      expectedItemCount: manifest.items.length,
      itemCount: manifest.items.length,
      uniqueVideoInventoryCount: inventoryKeys.size,
      finitePlayableSourceCount: finiteKeys.size,
      pendingHlsCacheCount: pendingKeys.size,
      intentionallyExcludedVideoCount: excludedKeys.size,
      uniqueFiniteVideoCount: finiteKeys.size,
      items,
    };
  }, [mediaPlayback?.outputId, remoteManifestDiagnostics, remotePreparation.manifest, usingRemoteManifest]);
  const lifecycleRoute = mediaPlayback?.windowRole ?? "display-window";
  const lifecycleRole = mediaPlayback?.isEditor
    ? "editor-preview"
    : mediaPlayback?.playbackRole === "preview"
      ? "projector-preview"
      : "projector-output";
  const lifecycleOutlineId = mediaPlayback?.preparedMediaOutlineId;
  const remoteSurfaceStatuses = useMemo(
    () => Object.values(preparedMediaStatuses).filter((status) =>
      status.route === lifecycleRoute &&
      status.role === lifecycleRole &&
      status.outlineId === lifecycleOutlineId,
    ),
    [lifecycleOutlineId, lifecycleRole, lifecycleRoute, preparedMediaStatuses],
  );
  useReportRemoteMediaPreparationReadiness({
    enabled: sessionKind === "display" && Boolean(mediaPlayback?.outputId),
    outputId: mediaPlayback?.outputId,
    manifest: remotePreparation.manifest,
    manifestReceivedAt: remotePreparation.manifestReceivedAt,
    source: usingRemoteManifest
      ? remotePreparation.manifestReceivedAt ? "remote-manifest" : "cached-manifest"
      : window.electronAPI ? "local-fallback" : "browser-poster",
    candidateCount: usingRemoteManifest ? remoteManifestDiagnostics.length : poolCandidates.length,
    finiteCandidateCount: usingRemoteManifest
      ? new Set(remoteManifestDiagnostics.filter((entry) => entry.status === "eligible").map((entry) => entry.mediaKey)).size
      : poolCandidateResult.discovery.finitePlayableSourceCount ?? 0,
    pendingCacheCount: usingRemoteManifest
      ? new Set(remoteManifestDiagnostics.filter((entry) => entry.status === "pending-cache").map((entry) => entry.mediaKey)).size
      : poolCandidateResult.discovery.pendingHlsCacheCount ?? 0,
    readyCount: new Set(remoteSurfaceStatuses.filter((status) => status.phase === "ready-paused" || status.phase === "active-playing").map((status) => status.mediaKey)).size,
    preparingCount: new Set(remoteSurfaceStatuses.filter((status) => status.phase === "preparing" || status.phase === "activation-requested").map((status) => status.mediaKey)).size,
    failedCount: new Set(remoteSurfaceStatuses.filter((status) => status.phase === "error").map((status) => status.mediaKey)).size,
    errors: remoteSurfaceStatuses.filter((status) => status.phase === "error").map((status) => (status.error ?? "Video preparation failed").replace(/https?:\/\/\S+/gi, "[media URL]")),
  });

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
            status.timestamp < current.timestamp))
      ) {
        return;
      }
      const owner = mediaOwnersRef.current.get(status.mediaKey);
      if (
        (status.phase === "error" || status.phase === "disposed") &&
        owner?.generation === status.generation
      ) {
        mediaOwnersRef.current.delete(status.mediaKey);
      }
      preparedMediaStatusRef.current[key] = status;
      if (status.phase === "disposed") {
        delete preparedMediaStatusRef.current[key];
        setPreparedMediaStatuses((all) => {
          if (!(key in all)) return all;
          const next = { ...all };
          delete next[key];
          return next;
        });
      } else {
        setPreparedMediaStatuses((all) =>
          all[key] === status ? all : { ...all, [key]: status },
        );
      }
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
      requestSentAtRef.current = performance.now();
      const retainedMediaKeys = new Set(
        [
          ...Object.values(state.lanes).map((lane) =>
            lane?.backgroundMedia.kind === "fileVideo"
              ? lane.backgroundMedia.mediaKey
              : undefined,
          ),
          snapshot.backgroundMedia.kind === "fileVideo"
            ? snapshot.backgroundMedia.mediaKey
            : undefined,
        ].filter((key): key is string => Boolean(key)),
      );
      for (const key of videoRequestSentAtRef.current.keys()) {
        if (!retainedMediaKeys.has(key)) videoRequestSentAtRef.current.delete(key);
      }
      const retainedSnapshotKeys = new Set([
        ...Object.values(state.lanes)
          .map((lane) => lane?.key)
          .filter((key): key is string => Boolean(key)),
        snapshot.key,
      ]);
      for (const key of incomingVideoPathsRef.current.keys()) {
        if (!retainedSnapshotKeys.has(key)) incomingVideoPathsRef.current.delete(key);
      }
      if (snapshot.backgroundMedia.kind === "fileVideo") {
        videoRequestSentAtRef.current.set(
          snapshot.backgroundMedia.mediaKey,
          requestSentAtRef.current,
        );
      }
      logVideoCue("transition.requested", {
        outputId: mediaPlayback?.outputId,
        windowRole: mediaPlayback?.windowRole,
        snapshotKey: snapshot.key,
        media: getLaneBackgroundMediaKey(snapshot.backgroundMedia),
        generation: requestGenerationRef.current,
        priorPhase: state.phase,
        sendTimestamp: requestSentAtRef.current,
        incomingPath: "waiting-for-visual",
        posterReadyAtSelection: false,
        preparedSurfaceReadyAtSelection: false,
      });
    }

    // The latest operator request must take over immediately. Preserve one
    // coherent baseline, kill the obsolete fade, and prepare the new request
    // directly instead of making it wait behind a queued destination.
    if (isNewRequest) {
      const activeTimeline = timelineRef.current;
      if (activeTimeline) {
        activeTimeline.kill();
      }
      if (timelineRef.current === activeTimeline && activeTimeline) {
        timelineRef.current = null;
        timelineGenerationRef.current = null;
      }
    }

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
        mediaRefs.current[mediaLaneForContentLane(incomingLaneId)] ??
          preparedMediaRefs.current[
            getLanePreparedMediaKey(
              state.lanes[incomingLaneId]?.backgroundMedia,
            )
          ],
      );
      const activeMediaOpacity = readLaneOpacity(
        mediaRefs.current[mediaLaneForContentLane(activeLaneId)] ??
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
        const baselineMediaLaneId =
          state.mode === "content"
            ? state.mediaAnchorLaneId
            : mediaLaneForContentLane(baselineLaneId);
        const baselineMediaKey = getLanePreparedMediaKey(
          baselineSnapshot.backgroundMedia,
        );
        const baselineOwner = mediaOwnersRef.current.get(baselineMediaKey);
        mediaOwnersRef.current.clear();
        if (baselineOwner !== undefined) {
          mediaOwnersRef.current.set(baselineMediaKey, baselineOwner);
        }
        for (const laneId of ["a", "b"] as const) {
          const mediaOpacity = laneId === baselineMediaLaneId ? 1 : 0;
          const contentOpacity = laneId === baselineLaneId ? 1 : 0;
          if (mediaRefs.current[laneId]) {
            gsap.set(mediaRefs.current[laneId], { opacity: mediaOpacity });
          }
          if (contentRefs.current[laneId]) {
            gsap.set(contentRefs.current[laneId], { opacity: contentOpacity });
          }
          const preparedMediaKey = getLanePreparedMediaKey(
            state.lanes[mediaLaneForContentLane(laneId)]?.backgroundMedia,
          );
          if (preparedMediaRefs.current[preparedMediaKey]) {
            gsap.set(preparedMediaRefs.current[preparedMediaKey], {
              opacity: mediaOpacity,
            });
          }
        }
        if (
          backgroundIdentityOf(baselineSnapshot) === backgroundIdentityOf(snapshot) &&
          foregroundIdentityOf(baselineSnapshot) === foregroundIdentityOf(snapshot)
        ) {
          setState({
            activeLaneId: baselineLaneId,
            lanes: lanePair(baselineLaneId, snapshot, null),
            phase: "idle",
            requestedKey: snapshot.key,
            queuedSnapshot: null,
            mode: "full",
            mediaAnchorLaneId: baselineMediaLaneId,
          });
          return;
        }
        const nextMode = resolveTransitionMode(baselineSnapshot, snapshot);
        setState({
          activeLaneId: baselineLaneId,
          lanes: lanePair(baselineLaneId, baselineSnapshot, snapshot),
          phase: "preparing",
          requestedKey: snapshot.key,
          queuedSnapshot: null,
          mode: nextMode,
          mediaAnchorLaneId: baselineMediaLaneId,
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
  }, [mediaLaneForContentLane, mediaPlayback?.outputId, mediaPlayback?.windowRole, shouldAnimate, snapshot, state]);

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
      if (ready && laneSnapshot.backgroundMedia.kind === "fileVideo") {
        const sendTimestamp = videoRequestSentAtRef.current.get(
          laneSnapshot.backgroundMedia.mediaKey,
        );
        const logToken = `${laneSnapshot.backgroundMedia.mediaKey}:${sendTimestamp ?? "initial"}`;
        if (!firstFrameLogTokensRef.current.has(logToken)) {
          firstFrameLogTokensRef.current.add(logToken);
          while (firstFrameLogTokensRef.current.size > 8) {
            const oldest = firstFrameLogTokensRef.current.values().next().value;
            if (oldest === undefined) break;
            firstFrameLogTokensRef.current.delete(oldest);
          }
          const presentedTimestamp = performance.now();
          logVideoCue("transition.firstVideoFrame", {
            mediaKey: laneSnapshot.backgroundMedia.mediaKey,
            presentedTimestamp,
            sendToFirstPresentedFrameMs:
              sendTimestamp == null ? undefined : presentedTimestamp - sendTimestamp,
          });
        }
      }
      setMediaLivePaintReadiness((current) => {
        const laneState = current[laneId];
        if (laneState?.mediaKey === mediaKey && laneState.ready === ready) return current;
        return { ...current, [laneId]: { mediaKey, ready } };
      });
    },
    [],
  );

  const reportMediaPosterPaintReady = useCallback(
    (laneId: LaneId, mediaKey: string, ready: boolean) => {
      const laneSnapshot = laneSnapshotsRef.current[laneId];
      if (
        !laneSnapshot ||
        getLaneBackgroundMediaKey(laneSnapshot.backgroundMedia) !== mediaKey
      ) return;
      setMediaPosterPaintReadiness((current) => {
        const laneState = current[laneId];
        if (laneState?.mediaKey === mediaKey && laneState.ready === ready) {
          return current;
        }
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
          status.outlineId === lifecycleOutlineId,
      ),
    [
      lifecycleOutlineId,
      lifecycleRole,
      lifecycleRoute,
      preparedMediaStatuses,
    ],
  );

  const usesPreparedSurface = useCallback(
    (
      laneId: LaneId,
      mediaSnapshot?: DisplayBoxTransitionSnapshot["backgroundMedia"],
      snapshotKey?: string,
    ): boolean => {
      const media = mediaSnapshot ?? state.lanes[laneId]?.backgroundMedia;
      const preparedKey = getLanePreparedMediaKey(media);
      if (!poolEnabled || preparedKey === "none") return false;
      if (snapshotKey) {
        const selectedPath = incomingVideoPathsRef.current.get(snapshotKey);
        if (selectedPath && selectedPath !== "prepared-video") return false;
      }
      const owner = mediaOwnersRef.current.get(preparedKey);
      const status = preparedStatusForKey(preparedKey);
      if (owner !== undefined) {
        if (
          !status ||
          status.generation !== owner.generation ||
          !isPreparedMediaSurfaceUsable(status)
        ) {
          mediaOwnersRef.current.delete(preparedKey);
          return false;
        }
        // Once adopted, harmless geometry/status churn does not hand the
        // visual back to the fallback renderer. Terminal status does.
        return true;
      }
      // A pool surface may be warm for the current slide without owning the
      // audience-facing lane. Keep the normal renderer authoritative until a
      // transition explicitly adopts the prepared surface.
      // The foreground can move to the other lane after a content-only fade.
      // Its background is still the live fallback player, so a warm pool copy
      // of that same media must not silently replace it at its starting frame.
      if (
        preparedKey ===
        getLanePreparedMediaKey(
          state.lanes[state.activeLaneId]?.backgroundMedia,
        )
      ) return false;
      const cue = mediaPlayback?.activeFileVideoPlayback?.mediaKey === preparedKey
        ? mediaPlayback.activeFileVideoPlayback
        : undefined;
      if (cue && !cue.paused && status?.phase !== "active-playing") {
        // A cued video must be moving before its prepared surface can enter
        // the fade; otherwise the retained starting frame visibly catches up.
        return false;
      }
      return hasPreparedFrame(status);
    },
    [
      poolEnabled,
      mediaPlayback?.activeFileVideoPlayback,
      preparedStatusForKey,
      state.activeLaneId,
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
    const mediaLaneId = mediaLaneForContentLane(laneId);
    const mediaState = mediaPaintReadiness[laneId];
    const preparedStatus = preparedStatusForKey(preparedMediaKey);
    const usesPrepared = usesPreparedSurface(
      mediaLaneId,
      laneSnapshot.backgroundMedia,
      laneSnapshot.key,
    );
    const mediaReady =
      mode === "content" ||
      mediaKey === "none" ||
      (usesPrepared
        ? hasPreparedFrame(preparedStatus)
        : mediaState?.mediaKey === mediaKey && mediaState.ready);
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
      const incomingMedia = incomingSnapshot?.backgroundMedia;
      const incomingKey = getLanePreparedMediaKey(incomingMedia);
      const outgoingKey = getLanePreparedMediaKey(
        state.lanes[state.activeLaneId]?.backgroundMedia,
      );
      const incomingUsesPrepared = usesPreparedSurface(
        mediaLaneForContentLane(incomingLaneId),
        incomingMedia,
        incomingSnapshot?.key,
      );
      if (incomingKey !== outgoingKey) mediaOwnersRef.current.delete(outgoingKey);
      if (incomingMedia?.kind === "fileVideo" && incomingUsesPrepared) {
        const status = preparedStatusForKey(incomingKey);
        if (status) {
          mediaOwnersRef.current.set(incomingKey, {
            generation: status.generation,
            sourceIdentity: status.sourceIdentity,
          });
        }
      }
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
          mediaAnchorLaneId: mediaLaneForContentLane(nextActiveLaneId),
        };
      });
      return;
    }

    const incomingMedia = incomingSnapshot?.backgroundMedia;
    const incomingPreparedKey = getLanePreparedMediaKey(incomingMedia);
    const incomingUsesPrepared = usesPreparedSurface(
      mediaLaneForContentLane(incomingLaneId),
      incomingMedia,
      incomingSnapshot?.key,
    );
    const incomingFallbackLiveReady =
      incomingMedia?.kind === "fileVideo" &&
      mediaLivePaintReadiness[incomingLaneId]?.mediaKey ===
        getLaneBackgroundMediaKey(incomingMedia) &&
      mediaLivePaintReadiness[incomingLaneId]?.ready === true;
    if (incomingMedia?.kind === "fileVideo") {
      const path: IncomingVideoPath = incomingUsesPrepared
        ? "prepared-video"
        : mediaPosterPaintReadiness[incomingLaneId]?.mediaKey ===
              getLaneBackgroundMediaKey(incomingMedia) &&
            mediaPosterPaintReadiness[incomingLaneId]?.ready === true
          ? "poster-then-video"
          : incomingFallbackLiveReady
            ? "video-fallback"
            : "waiting-for-visual";
      if (incomingSnapshot) {
        incomingVideoPathsRef.current.set(incomingSnapshot.key, path);
      }
      setLastMediaKey(incomingMedia.mediaKey);
      setLastSendPath(path);
      setPosterShown(path === "poster-then-video");
      setTransitionStart({
        mediaKey: incomingPreparedKey,
        timestamp: performance.now(),
      });
      logVideoCue("transition.pathSelected", {
        mediaKey: incomingPreparedKey,
        path,
        posterReadyAtSelection:
          mediaPosterPaintReadiness[incomingLaneId]?.mediaKey ===
            getLaneBackgroundMediaKey(incomingMedia) &&
          mediaPosterPaintReadiness[incomingLaneId]?.ready === true,
        preparedSurfaceReadyAtSelection: incomingUsesPrepared,
      });
    } else {
      setLastMediaKey(undefined);
      setLastSendPath("waiting-for-visual");
      setPosterShown(false);
    }

    // Choose the actual DOM owner once. A late pool status must not replace a
    // fallback element while GSAP is fading that element into view.
    if (incomingUsesPrepared) {
      const incomingStatus = preparedStatusForKey(incomingPreparedKey);
      if (incomingStatus) {
        mediaOwnersRef.current.set(incomingPreparedKey, {
          generation: incomingStatus.generation,
          sourceIdentity: incomingStatus.sourceIdentity,
        });
      }
    } else {
      mediaOwnersRef.current.delete(incomingPreparedKey);
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
        slideTransitionStartTimestamp: performance.now(),
        sendToSlideTransitionStartMs:
          requestSentAtRef.current == null
            ? undefined
            : performance.now() - requestSentAtRef.current,
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
    mediaPosterPaintReadiness,
    mediaPaintReadiness,
    mediaPlayback?.outputId,
    mediaPlayback?.windowRole,
    preparedMediaStatuses,
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
      !incomingSnapshot ||
      snapshot.key !== state.requestedKey
    ) {
      return;
    }

    const mode = state.mode;
    const mediaElementForLane = (laneId: LaneId) => {
      const laneMedia = state.lanes[laneId]?.backgroundMedia;
      const preparedKey = getLanePreparedMediaKey(laneMedia);
      return mediaOwnersRef.current.has(preparedKey)
        ? preparedMediaRefs.current[preparedKey]
        : mediaRefs.current[mediaLaneForContentLane(laneId)];
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

    // Pool status and geometry can change while a fade is running. The visual
    // transition belongs to this request, not to those readiness updates.
    if (timelineRef.current) return;
    const outgoingKey = state.lanes[state.activeLaneId]?.key;
    const incomingKey = incomingSnapshot.key;
    const timing = getDisplayTransitionTiming(transitionDurationMs);
    const completeTransition = () => {
        if (animationGeneration !== requestGenerationRef.current) {
          if (timelineGenerationRef.current === animationGeneration) {
            timelineRef.current = null;
            timelineGenerationRef.current = null;
          }
          return;
        }
        // Zero-duration cuts intentionally have no timeline; otherwise the
        // active timeline must belong to this request generation.
        if (
          timelineRef.current !== null &&
          timelineGenerationRef.current !== animationGeneration
        ) {
          return;
        }
        timelineRef.current = null;
        timelineGenerationRef.current = null;
        logVideoCue("transition.complete", {
          outputId: mediaPlaybackRef.current?.outputId,
          windowRole: mediaPlaybackRef.current?.windowRole,
          outgoingKey,
          incomingKey,
          mode,
          sendToSlideTransitionCompleteMs:
            requestSentAtRef.current == null
              ? undefined
              : performance.now() - requestSentAtRef.current,
        });
        const completedMedia = incomingSnapshot.backgroundMedia;
        const outgoingMediaKey = getLanePreparedMediaKey(
          state.lanes[state.activeLaneId]?.backgroundMedia,
        );
        if (outgoingMediaKey !== getLanePreparedMediaKey(completedMedia)) {
          mediaOwnersRef.current.delete(outgoingMediaKey);
        }
        if (completedMedia.kind === "fileVideo") {
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
                mediaAnchorLaneId: mediaLaneForContentLane(currentIncomingLaneId),
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
                mediaAnchorLaneId: mediaLaneForContentLane(currentIncomingLaneId),
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
            mediaAnchorLaneId: mediaLaneForContentLane(currentIncomingLaneId),
          };
        });
      };

    // A cut still goes through the same readiness and lane-settle path, but it
    // must not create a zero-length GSAP timeline or leave stale opacity on a
    // lane that React is about to reuse.
    if (timing.durationSeconds === 0) {
      if (animateMedia && outgoingMedia && incomingMedia) {
        gsap.set(outgoingMedia, { opacity: 0 });
        gsap.set(incomingMedia, { opacity: 1 });
      }
      if (animateContent && outgoingContent && incomingContent) {
        gsap.set(outgoingContent, { opacity: 0 });
        gsap.set(incomingContent, { opacity: 1 });
      }
      completeTransition();
      return;
    }

    const timeline = gsap.timeline({ onComplete: completeTransition });
    timelineRef.current = timeline;
    timelineGenerationRef.current = animationGeneration;
    timeline.addLabel("crossfade", 0);

    if (animateMedia && outgoingMedia && incomingMedia) {
      gsap.set(outgoingMedia, { opacity: 1 });
      gsap.set(incomingMedia, { opacity: 0 });
      timeline.fromTo(
        outgoingMedia,
        { opacity: 1 },
        {
          opacity: 0,
          duration: timing.durationSeconds,
          ease: TRANSITION_EASE,
        },
        "crossfade",
      );
      timeline.fromTo(
        incomingMedia,
        { opacity: 0 },
        {
          opacity: 1,
          duration: timing.durationSeconds,
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
        { opacity: 0, duration: timing.durationSeconds, ease: TRANSITION_EASE },
        "crossfade",
      );
      timeline.fromTo(
        incomingContent,
        { opacity: 0 },
        {
          opacity: 1,
          duration: timing.incomingContentDurationSeconds,
          ease: TRANSITION_EASE,
        },
        `crossfade+=${timing.incomingContentOffsetSeconds}`,
      );
    }

  // Readiness selects the owner before this effect runs. Once animating, the
  // timeline owns opacity exclusively; status/diagnostic churn must not
  // recreate or reset it.
  }, [
    incomingLaneId,
    incomingSnapshot,
    mediaLaneForContentLane,
    state.activeLaneId,
    state.lanes,
    state.mode,
    state.phase,
    state.requestedKey,
    snapshot.key,
    transitionDurationMs,
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
    isMediaPrevious: boolean;
    mediaContentLaneId: LaneId;
    hostsMedia: boolean;
    hostsContent: boolean;
    mediaKey: string;
    fullFramePaintReady: boolean;
    liveVideoPaintReady: boolean;
    usesPreparedSurface: boolean;
    mediaAudioEnabled: boolean;
    mediaOpacity: number | undefined;
    mediaStackOffset: number;
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
    const mediaContentLaneId = mediaLaneForContentLane(laneId);
    const isMediaPrevious = inFlight && laneId === state.mediaAnchorLaneId;

    // Shared-media modes: only the media anchor hosts the player. The anchor
    // may have no content snapshot after a content-only settle — still host
    // media there using the active slide's background.
    const hostsMedia = sharedMediaHost
      ? laneId === state.mediaAnchorLaneId && mediaSourceSnapshot != null
      : state.lanes[mediaContentLaneId] != null;
    const hostsContent =
      laneSnapshot != null && (!isMediaMode || isActive);

    if (!hostsMedia && !hostsContent) return [];

    const mediaSnapshot = hostsMedia
      ? sharedMediaHost
        ? mediaSourceSnapshot
        : state.lanes[mediaContentLaneId]
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
      mediaSnapshot?.key,
    );
    const mediaState = mediaPaintReadiness[mediaContentLaneId];
    const fullFramePaintReady =
      isContentMode ||
      mediaKey === "none" ||
      (usesPrepared
        ? hasPreparedFrame(
            preparedStatusForKey(preparedMediaKey),
          )
        : mediaState?.mediaKey === mediaKey && mediaState.ready);
    const liveMediaState = mediaLivePaintReadiness[mediaContentLaneId];
    const liveVideoPaintReady =
      mediaKey !== "none" &&
      (usesPrepared
        ? isMediaSurfaceVisible(preparedStatusForKey(preparedMediaKey))
        : liveMediaState?.mediaKey === mediaKey && liveMediaState.ready);
    // Keep the current audience owner audible while a replacement prepares,
    // keep incoming media muted until the coordinated fade starts, and avoid
    // two audible owners during the fade itself.
    const mediaAudioEnabled =
      mediaPlayback?.fileVideoAudioEnabled === true &&
      (state.phase === "idle" ||
        state.mode === "content" ||
        (state.phase === "preparing" && isMediaPrevious) ||
        (state.phase === "animating" && isMediaPrevious));

    let mediaOpacity: number | undefined;
    let contentOpacity: number | undefined;

    if (state.phase === "animating") {
      mediaOpacity = undefined;
      contentOpacity = undefined;
    } else if (isContentMode) {
      mediaOpacity = hostsMedia ? 1 : 0;
      contentOpacity = isActive ? 1 : 0;
    } else if (isMediaMode) {
      mediaOpacity = isMediaPrevious ? 1 : 0;
      contentOpacity = hostsContent ? 1 : 0;
    } else if (isFullMode) {
      mediaOpacity = isMediaPrevious ? 1 : 0;
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
        isMediaPrevious,
        mediaContentLaneId,
        hostsMedia,
        hostsContent,
        mediaKey,
        fullFramePaintReady,
        liveVideoPaintReady,
        usesPreparedSurface: usesPrepared,
        mediaAudioEnabled,
        mediaOpacity,
        mediaStackOffset: roleStackOffset(isMediaPrevious),
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
        zIndex: laneView.mediaStackOffset,
         shouldPlay:
           laneView.hostsMedia &&
           (laneView.usesPreparedSurface ||
             (state.phase !== "idle" && !laneView.isMediaPrevious)),
        muted:
          !laneView.mediaAudioEnabled || !laneView.usesPreparedSurface,
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
          candidateDiagnostics={usingRemoteManifest ? remoteManifestDiagnostics : poolCandidateResult.diagnostics}
          views={poolViews}
          onStatusChange={reportPreparedMediaStatus}
          route={lifecycleRoute}
          role={lifecycleRole}
          outlineId={lifecycleOutlineId}
          onSurfaceElement={reportPreparedMediaElement}
          discovery={remoteManifestDiscovery ?? poolCandidateResult.discovery}
          poolCapacity={poolCandidateResult.poolCapacity}
          transitionDurationMs={normalizeTransitionDurationMs(
            transitionDurationMs,
          )}
          preparationSource={
            usingRemoteManifest
              ? remotePreparation.manifestReceivedAt ? "server-manifest" : "cached-manifest"
              : sessionKind === "display"
                ? "local-fallback"
                : "local-pouchdb"
          }
          manifestRevision={remotePreparation.manifest?.revision}
          manifestOutlineId={remotePreparation.manifest?.outlineId}
          manifestOutlineName={remotePreparation.manifest?.outlineName}
          manifestPublishedAt={remotePreparation.manifest?.publishedAt}
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
            isMediaPrevious,
            mediaContentLaneId,
            hostsMedia,
            mediaKey,
            mediaOpacity,
            needsStillHold,
            mediaStackOffset,
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
                  isMediaPrevious ? "outgoing" : inFlight ? "incoming" : "active"
                }
                style={{
                  ...(mediaOpacity == null ? {} : { opacity: mediaOpacity }),
                  zIndex: mediaStackOffset,
                  willChange: "opacity",
                }}
              >
                <LaneFullFrameMedia
                  key={`${laneId}:${mediaKey}`}
                  media={
                    mediaSnapshot.backgroundMedia ?? NONE_LANE_BACKGROUND_MEDIA
                  }
                  isPrevious={isMediaPrevious}
                  onPaintReadyChange={(ready) =>
                    reportMediaPaintReady(mediaContentLaneId, mediaKey, ready)
                  }
                  onLivePaintReadyChange={(ready) =>
                    reportMediaLivePaintReady(mediaContentLaneId, mediaKey, ready)
                  }
                  onPosterPaintReadyChange={(ready) =>
                    reportMediaPosterPaintReady(mediaContentLaneId, mediaKey, ready)
                  }
                  fileVideoAudioEnabled={mediaAudioEnabled}
                  volume={mediaPlayback?.volume}
                  playbackRole={mediaPlayback?.playbackRole}
                  preloadRole={mediaPlayback?.preloadRole}
                  transportRole={mediaPlayback?.transportRole}
                  suspendPlayback={mediaPlayback?.suspendPlayback}
                  playback={resolvePlaybackForLane(
                    laneId,
                    mediaSnapshot.backgroundMedia,
                  )}
                  isEditor={mediaPlayback?.isEditor}
                  outputId={mediaPlayback?.outputId}
                  windowRole={mediaPlayback?.windowRole}
                  transitionSendTimestamp={
                    mediaSnapshot.backgroundMedia.kind === "fileVideo"
                      ? videoRequestSentAtRef.current.get(
                          mediaSnapshot.backgroundMedia.mediaKey,
                        )
                      : undefined
                  }
                  localVideo={mediaPlayback?.localVideo}
                />
                {needsStillHold &&
                  renderLane(
                    mediaSnapshot,
                    isMediaPrevious,
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
                  ...(contentOpacity == null ? {} : { opacity: contentOpacity }),
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
