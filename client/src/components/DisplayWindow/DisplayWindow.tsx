import React, {
  useCallback,
  useContext,
  forwardRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BibleDisplayInfo,
  BoardPostStreamInfo,
  Box,
  DisplayType,
  FormattedTextDisplayInfo,
  LocalVideoInputPresentation,
  MonitorLayoutMode,
  OverlayInfo,
  TimerInfo,
  VideoBackgroundPlaybackCue,
} from "../../types";
import cn from "classnames";
import DisplayBox from "./DisplayBox";
import DisplayStreamBible from "./DisplayStreamBible";
import DisplayParticipantOverlay from "./DisplayParticipantOverlay";
import DisplayStbOverlay from "./DisplayStbOverlay";
import DisplayQrCodeOverlay from "./DisplayQrCodeOverlay";
import DisplayEditor, { DisplayEditorChangeInfo } from "./DisplayEditor";
import DisplayStreamText from "./DisplayStreamText";
import DisplayImageOverlay from "./DisplayImageOverlay";
import DisplayStreamFormattedText from "./DisplayStreamFormattedText";
import DisplayBoardPostOverlay from "./DisplayBoardPostOverlay";
import HLSPlayer from "./HLSVideoPlayer";
import MonitorView from "./MonitorView";
import ProjectorClockTimer from "./ProjectorClockTimer";
import { useSelector } from "../../hooks";
import { useCachedVideoUrl } from "../../hooks/useCachedMediaUrl";
import { REFERENCE_WIDTH, REFERENCE_HEIGHT } from "../../constants";
import {
  selectDisplayOutputs,
  selectDisplayOutputsLoaded,
} from "../../store/displayOutputsSlice";
import { selectControllerProfiles } from "../../store/controllerProfilesSlice";
import { getOwningControllerProfile } from "../../utils/controllerProfiles";
import { resolveOutlineForScope } from "../../utils/outlineScope";
import {
  isDisplayChromeReady,
  resolveDisplaySettings,
  resolveOutputDefaults,
} from "../../utils/displaySettings";
import { useScreenOverrides } from "../../hooks/useScreenOverrides";
import { GlobalInfoContext } from "../../context/globalInfo";
import { serverNow } from "../../utils/serverTime";
import {
  getVideoBackgroundMediaKey,
  logVideoCue,
} from "../../utils/videoBackgroundPlayback";
import LocalVideoInputLayer from "./LocalVideoInputLayer";
import { useLocalVideoFileUrl } from "../../hooks/useLocalVideoFileUrl";
import DisplayBoxTransitionStage, {
  type DisplayBoxTransitionSnapshot,
  type LaneMediaPlaybackOptions,
  getDisplayBoxesLayerKey,
} from "./DisplayBoxTransitionStage";
import ElectronEditorPreparedMediaPreview from "./ElectronEditorPreparedMediaPreview";
import {
  getLaneBackgroundMediaKey,
  resolveLaneBackgroundMedia,
} from "./laneBackgroundMedia";
import { calculateReferenceScaleFactor } from "./referenceCanvas";
import { resolveDisplayRenderProfile } from "./displayRenderProfile";
import type { ElectronMediaDiscovery } from "../../utils/electronMediaSurfaceDiagnostics";
import {
  usePreparedMediaContext,
  type PreparedMediaContext,
} from "../../utils/preparedMediaContext";

const STREAM_OVERLAY_TOTAL_VISIBLE_MS = {
  stb: 3000,
  qr: 5000,
  image: 5000,
  boardPost: 2000,
} as const;

const STREAM_PREV_OVERLAY_EXIT_MS = 1500;
const STREAM_PREV_BOARD_POST_EXIT_MS = 500;
const DISPLAY_PREV_LAYER_VISIBLE_MS = 500;
const STREAM_PREV_TEXT_LAYER_VISIBLE_MS = 350;

type StreamOverlayKeepAliveMap = Record<string, number>;
type StreamOverlayKeepAliveMode = "max" | "replace";

/** Stable empty list so suppressing prev does not churn effect deps. */
const EMPTY_BOXES: Box[] = [];

const getStreamTextLayerKey = (info?: {
  title?: string;
  text?: string;
}) => `${info?.title?.trim() ?? ""}~${info?.text?.trim() ?? ""}`;

const getFormattedTextLayerKey = (info?: { text?: string }) =>
  info?.text?.trim() ?? "";

const hasParticipantOverlayData = (overlay?: OverlayInfo) =>
  Boolean(overlay?.name || overlay?.title || overlay?.event);

const hasStbOverlayData = (overlay?: OverlayInfo) =>
  Boolean(overlay?.heading || overlay?.subHeading);

const hasQrOverlayData = (overlay?: OverlayInfo) =>
  Boolean(overlay?.url || overlay?.description);

const hasImageOverlayData = (overlay?: OverlayInfo) =>
  Boolean(overlay?.imageUrl);

const hasBoardPostData = (info?: BoardPostStreamInfo) =>
  Boolean(info?.text?.trim());

const buildStreamOverlayIdentityKey = (
  type: string,
  info: OverlayInfo | BoardPostStreamInfo | undefined,
  primaryValue: string | undefined,
) => {
  const trimmedPrimaryValue = primaryValue?.trim();
  if (!info || !trimmedPrimaryValue) return null;

  return [
    type,
    info.transitionSequence ?? "",
    info?.time ?? "",
    "id" in info ? (info.id ?? "") : "",
    trimmedPrimaryValue,
  ].join("::");
};

const getLocalOverlayVisibleMs = (
  durationSeconds: number | undefined,
  totalVisibleMs: number | null,
) => {
  if (totalVisibleMs == null) return null;
  return Math.max(0, durationSeconds ?? 0) * 1000 + totalVisibleMs;
};

const pruneExpiredOverlayKeepAliveEntries = (
  keepAliveByKey: StreamOverlayKeepAliveMap,
  nowMs: number,
) => {
  const activeEntries = Object.entries(keepAliveByKey).filter(
    ([, untilMs]) => untilMs > nowMs,
  );

  if (activeEntries.length === Object.keys(keepAliveByKey).length) {
    return keepAliveByKey;
  }

  return Object.fromEntries(activeEntries);
};

const getParticipantOverlayTotalVisibleMs = (overlay?: OverlayInfo) => {
  const lineCount = [overlay?.name, overlay?.title, overlay?.event].filter(
    (value): value is string => Boolean(value),
  ).length;

  if (lineCount === 0) return null;

  const isCenter = overlay?.formatting?.participantOverlayPosition === "center";
  const enterDurationMs = 2500;
  const innerStartMs = isCenter ? 500 : 250;
  const innerDurationMs = 2500;
  const staggerMs = 500;
  const lastInnerEndMs =
    innerStartMs + innerDurationMs + Math.max(0, lineCount - 1) * staggerMs;

  return Math.max(enterDurationMs, lastInnerEndMs) + 2500;
};

const getOverlayVisibleUntilMs = ({
  hasData,
  time,
  duration,
  totalVisibleMs,
}: {
  hasData: boolean;
  time?: number;
  duration?: number;
  totalVisibleMs: number | null;
}) => {
  if (!hasData || totalVisibleMs == null) return null;
  if (time == null) return Number.POSITIVE_INFINITY;
  const durationMs = Math.max(0, duration ?? 0) * 1000;
  return time + durationMs + totalVisibleMs;
};

const getPrevOverlayVisibleUntilMs = ({
  prevHasData,
  prevTime,
  prevDuration,
  prevTotalVisibleMs,
  prevTransitionSequence,
  currentTime,
  currentHasData,
  currentTransitionSequence,
  nowMs,
}: {
  prevHasData: boolean;
  prevTime?: number;
  prevDuration?: number;
  prevTotalVisibleMs: number | null;
  prevTransitionSequence?: number;
  currentTime?: number;
  /** False when the live slot is an empty placeholder (e.g. after another overlay took the layer). */
  currentHasData: boolean;
  currentTransitionSequence?: number;
  nowMs: number;
}) => {
  if (!prevHasData || currentTime == null) return null;
  if (
    prevTransitionSequence != null &&
    currentTransitionSequence != null &&
    currentTransitionSequence <= prevTransitionSequence
  ) {
    return null;
  }
  if (prevTime != null && currentTime <= prevTime) return null;
  const prevVisibleUntilMs = getOverlayVisibleUntilMs({
    hasData: prevHasData,
    time: prevTime,
    duration: prevDuration,
    totalVisibleMs: prevTotalVisibleMs,
  });
  // Same-type: new live content past prev's natural end → do not show prev exit.
  if (
    currentHasData &&
    prevVisibleUntilMs != null &&
    Number.isFinite(prevVisibleUntilMs) &&
    currentTime >= prevVisibleUntilMs
  ) {
    return null;
  }
  // Cleared live slot: compare wall clock so a stale prev does not keep the
  // stream item hidden, but do not use `currentTime` here — after a cross-type
  // switch the empty slot gets a new timestamp that can be past prev's model
  // end while the exit should still run.
  if (
    !currentHasData &&
    prevVisibleUntilMs != null &&
    Number.isFinite(prevVisibleUntilMs) &&
    nowMs >= prevVisibleUntilMs
  ) {
    return null;
  }
  return currentTime + STREAM_PREV_OVERLAY_EXIT_MS;
};

type DisplayWindowProps = {
  prevBoxes?: Box[];
  boxes?: Box[];
  onChange?: (info: DisplayEditorChangeInfo) => void;
  width?: number; // Optional: if not provided, component will scale to fit container
  showBorder?: boolean;
  displayType?: DisplayType;
  /** Display output whose settings this surface renders with. */
  outputId?: string;
  /** Current outline item used only as a local media-preparation priority hint. */
  currentItemId?: string;
  /** Explicit controller-owned preparation context, used by editor surfaces. */
  preparedMediaContext?: PreparedMediaContext;
  /**
   * Opt in to the high-quality local video path (direct capture and/or relay).
   * Live outputs and same-machine operator previews set this so the booth
   * mirrors audience motion instead of low-res still previews.
   */
  canCaptureLocalVideo?: boolean;
  /**
   * Open or share the capture in this window (editor + controller previews).
   * Fullscreen projector/monitor/stream leave this off so USB cameras stay
   * exclusively owned by the capture host and arrive via relay.
   */
  directLocalVideoCapture?: boolean;
  /**
   * When false, local video stays silent even if screen settings allow sound.
   * Operator preview tiles mute so three cards do not play house audio.
   */
  playLocalVideoAudio?: boolean;
  participantOverlayInfo?: OverlayInfo;
  prevParticipantOverlayInfo?: OverlayInfo;
  stbOverlayInfo?: OverlayInfo;
  prevStbOverlayInfo?: OverlayInfo;
  qrCodeOverlayInfo?: OverlayInfo;
  prevQrCodeOverlayInfo?: OverlayInfo;
  imageOverlayInfo?: OverlayInfo;
  prevImageOverlayInfo?: OverlayInfo;
  bibleDisplayInfo?: BibleDisplayInfo;
  prevBibleDisplayInfo?: BibleDisplayInfo;
  formattedTextDisplayInfo?: FormattedTextDisplayInfo;
  prevFormattedTextDisplayInfo?: FormattedTextDisplayInfo;
  boardPostStreamInfo?: BoardPostStreamInfo;
  prevBoardPostStreamInfo?: BoardPostStreamInfo;
  timerInfo?: TimerInfo;
  prevTimerInfo?: TimerInfo;
  shouldAnimate?: boolean;
  /** Keep file-video elements mounted while paused, e.g. in a hidden preview tab. */
  suspendVideoPlayback?: boolean;
  /** Render file-video backgrounds; use suspendVideoPlayback to pause without unloading. */
  shouldPlayVideo?: boolean;
  /** Buffering policy for file-video backgrounds; output defaults to auto. */
  videoPreloadRole?: "preview" | "output";
  time?: number;
  prevTime?: number;
  selectBox?: (index: number) => void;
  selectedBox?: number;
  isBoxLocked?: boolean[];
  /** Show editor-only box outlines used for positioning and selection. */
  showEditorBoxBorder?: boolean;
  boxCursorPositions?: Record<number, number>;
  disabled?: boolean;
  className?: string;
  showClockTimer?: boolean;
  /** When true with displayType="stream", renders only overlay(s) filling the container (e.g. for preview). */
  overlayPreviewMode?: boolean;
  /** For monitor with "display next slide": boxes for the next slide. */
  nextBoxes?: Box[];
  prevNextBoxes?: Box[];
  /** Bible next-slide layout: box at index 2 (reference) shown in clock/timer band. */
  bibleInfoBox?: Box | null;
  /** Monitor slide transition: 'next' = slide up, 'prev' = slide down, 'jump' = fade */
  transitionDirection?: "next" | "prev" | "jump";
  /** When true, stream item content is faded out; overlays still show. Synced for multi-device. */
  streamItemContentBlocked?: boolean;
  /** Monitor rendering mode: full monitor chrome only for the live monitor surfaces. */
  monitorLayoutMode?: MonitorLayoutMode;
  /** Projector-only capture source. Remote devices render an unavailable status. */
  localVideoInput?: LocalVideoInputPresentation;
  /** Outgoing capture source retained briefly for the media crossfade. */
  prevLocalVideoInput?: LocalVideoInputPresentation;
  /** Live file/HLS background playhead synced from the controller preview. */
  videoPlayback?: VideoBackgroundPlaybackCue;
};

const DisplayWindow = forwardRef<HTMLDivElement, DisplayWindowProps>(
  (
    {
      prevBoxes = [],
      boxes = [],
      onChange,
      width,
      showBorder = false,
      displayType,

      outputId,
      currentItemId,
      preparedMediaContext: preparedMediaContextOverride,

      canCaptureLocalVideo = false,
      directLocalVideoCapture = false,
      playLocalVideoAudio = true,
      participantOverlayInfo,
      prevParticipantOverlayInfo,
      stbOverlayInfo,
      prevStbOverlayInfo,
      shouldAnimate = false,
      suspendVideoPlayback = false,
      shouldPlayVideo = false,
      videoPreloadRole,
      time,
      prevTime,
      bibleDisplayInfo,
      prevBibleDisplayInfo,
      qrCodeOverlayInfo,
      prevQrCodeOverlayInfo,
      imageOverlayInfo,
      prevImageOverlayInfo,
      timerInfo,
      prevTimerInfo,
      selectBox,
      selectedBox,
      formattedTextDisplayInfo,
      prevFormattedTextDisplayInfo,
      boardPostStreamInfo,
      prevBoardPostStreamInfo,
      isBoxLocked,
      showEditorBoxBorder = true,
      boxCursorPositions,
      disabled = false,
      className,
      showClockTimer = false,
      overlayPreviewMode = false,
      nextBoxes = [],
      prevNextBoxes = [],
      bibleInfoBox,
      transitionDirection,
      streamItemContentBlocked = false,
      monitorLayoutMode = "content-only",
      localVideoInput,
      prevLocalVideoInput,
      videoPlayback,
    }: DisplayWindowProps,
    ref,
  ) => {
    const fallbackRef = useRef<HTMLDivElement | null>(null);
    const elementRef = useRef<HTMLDivElement | null>(null);
    // Handle both callback refs and object refs
    const setRef = (node: HTMLDivElement | null) => {
      elementRef.current = node;
      fallbackRef.current = node;

      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }
    };

    const containerRef = setRef;

    const [actualWidthPx, setActualWidthPx] = useState<number>(0);
    const [actualHeightPx, setActualHeightPx] = useState<number>(0);
    const [streamPrevTextLayerBoxes, setStreamPrevTextLayerBoxes] = useState<
      Box[]
    >([]);
    const [activePrevLocalVideoInput, setActivePrevLocalVideoInput] =
      useState<LocalVideoInputPresentation>();
    const [hiddenPrevLocalVideoSourceId, setHiddenPrevLocalVideoSourceId] =
      useState<string>();
    const streamPrevTextLayerTokenRef = useRef(0);
    // First transition key seen by this instance. Opening a display onto already
    // live Redux state includes stale prevInfo; that key must fade in current
    // only. Later key changes keep normal crossfades.
    const initialDisplayTransitionKeyRef = useRef<string | null>(null);
    const initialLocalVideoTransitionKeyRef = useRef<string | null>(null);
    const initialBibleTransitionKeyRef = useRef<string | null>(null);
    const initialFormattedTextTransitionKeyRef = useRef<string | null>(null);

    // Use ResizeObserver to track actual container width and height in pixels
    useEffect(() => {
      const element = elementRef.current || fallbackRef.current;

      if (!element) {
        // Retry after a brief delay if element isn't available yet
        const timeoutId = setTimeout(() => {
          const retryElement = elementRef.current || fallbackRef.current;
          if (retryElement) {
            const widthInPixels =
              retryElement.offsetWidth || retryElement.clientWidth;
            const heightInPixels =
              retryElement.offsetHeight || retryElement.clientHeight;
            if (widthInPixels > 0) {
              setActualWidthPx(widthInPixels);
            }
            if (heightInPixels > 0) {
              setActualHeightPx(heightInPixels);
            }
          }
        }, 0);
        return () => clearTimeout(timeoutId);
      }

      const resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) {
          const widthInPixels =
            entry.borderBoxSize?.[0]?.inlineSize || entry.contentRect.width;
          const heightInPixels =
            entry.borderBoxSize?.[0]?.blockSize || entry.contentRect.height;
          if (widthInPixels > 0) {
            setActualWidthPx(widthInPixels);
          }
          if (heightInPixels > 0) {
            setActualHeightPx(heightInPixels);
          }
        }
      });

      resizeObserver.observe(element);

      return () => {
        resizeObserver.disconnect();
      };
    }, []);

    // Calculate scale factors based on both width and height constraints.
    // Use the smaller scale factor to ensure content fits within both constraints.
    // Always use transform scaling. Until we've measured the container, render at scale 0.
    const widthScale = actualWidthPx > 0 ? actualWidthPx / REFERENCE_WIDTH : 0;
    const scaleFactor =
      actualWidthPx > 0 && actualHeightPx > 0
        ? calculateReferenceScaleFactor(actualWidthPx, actualHeightPx)
        : widthScale; // Fallback to width scale if height not measured yet

    // Components should use reference width for calculations
    const effectiveWidth = (REFERENCE_WIDTH / window.innerWidth) * 100; // Convert px to vw for compatibility

    const isStream = displayType === "stream";
    const isEditor = displayType === "editor";
    const isDisplay = !isStream && !isEditor;
    const isMonitor = displayType === "monitor";
    const [editorPreparedActive, setEditorPreparedActive] = useState(false);
    const [editorPreparedActiveMediaKey, setEditorPreparedActiveMediaKey] =
      useState<string>();
    const shouldUseFullMonitorLayout =
      isMonitor && monitorLayoutMode === "full-monitor";
    const localVideoTransitionKey = `${localVideoInput?.sourceId ?? ""}::${prevLocalVideoInput?.sourceId ?? ""
      }`;
    if (initialLocalVideoTransitionKeyRef.current === null) {
      initialLocalVideoTransitionKeyRef.current = localVideoTransitionKey;
    }
    const canCrossfadeLocalVideo =
      Boolean(prevLocalVideoInput) &&
      localVideoTransitionKey !== initialLocalVideoTransitionKeyRef.current;
    const effectivePrevLocalVideoInput = canCrossfadeLocalVideo
      ? prevLocalVideoInput
      : undefined;
    useLayoutEffect(() => {
      // Projector/slide surfaces host local video inside the transition stage.
      if (isDisplay && !shouldUseFullMonitorLayout) {
        setActivePrevLocalVideoInput(undefined);
        setHiddenPrevLocalVideoSourceId(undefined);
        return;
      }
      if (
        !shouldAnimate ||
        !effectivePrevLocalVideoInput ||
        effectivePrevLocalVideoInput.sourceId === localVideoInput?.sourceId
      ) {
        setActivePrevLocalVideoInput(undefined);
        setHiddenPrevLocalVideoSourceId(undefined);
        return;
      }
      setActivePrevLocalVideoInput(effectivePrevLocalVideoInput);
      setHiddenPrevLocalVideoSourceId(undefined);
      const timeoutId = window.setTimeout(() => {
        setActivePrevLocalVideoInput(undefined);
        setHiddenPrevLocalVideoSourceId(effectivePrevLocalVideoInput.sourceId);
      }, DISPLAY_PREV_LAYER_VISIBLE_MS);
      return () => window.clearTimeout(timeoutId);
    }, [
      isDisplay,
      localVideoInput?.sourceId,
      effectivePrevLocalVideoInput,
      shouldAnimate,
      shouldUseFullMonitorLayout,
    ]);
    const [streamOverlayNowMs, setStreamOverlayNowMs] = useState(() =>
      serverNow(),
    );
    const [streamOverlayKeepAliveByKey, setStreamOverlayKeepAliveByKey] =
      useState<StreamOverlayKeepAliveMap>({});
    // Settings resolve per display: registry defaults, then this screen's own
    // overrides. Previews and editors are not tied to a display, so they fall
    // back to the built-in surface for their render profile.
    const fallbackOutputType =
      displayType === "monitor" ||
      displayType === "stream" ||
      displayType === "projector"
        ? displayType
        : "projector";
    const settingsOutputId = outputId ?? fallbackOutputType;
    const registryOutputs = useSelector(selectDisplayOutputs);
    const registryLoaded = useSelector(selectDisplayOutputsLoaded);
    const controllerProfiles = useSelector(selectControllerProfiles);
    const preparedMediaOutlines = useSelector(
      (state) => state.undoable?.present?.itemLists?.currentLists ?? [],
    );
    const preparedMediaSelectedIds = useSelector(
      (state) => state.undoable?.present?.itemLists?.selectedIdByScope ?? {},
    );
    const preparedMediaContextFallback = useMemo<
      Pick<
        ElectronMediaDiscovery,
        | "controllerProfileId"
        | "controllerProfileName"
        | "outlineScope"
        | "outlineId"
        | "outlineName"
      >
    >(() => {
      const owner = outputId
        ? getOwningControllerProfile(controllerProfiles, outputId)
        : controllerProfiles.find((profile) => profile.type === "presentation");
      const outline = owner
        ? resolveOutlineForScope(
            preparedMediaOutlines,
            owner.outlineScope,
            preparedMediaSelectedIds[owner.outlineScope],
          )
        : undefined;
      return {
        controllerProfileId: owner?.id,
        controllerProfileName: owner?.name,
        outlineScope: owner?.outlineScope,
        outlineId: outline?._id ?? null,
        outlineName: outline?.name,
      };
    }, [
      controllerProfiles,
      outputId,
      preparedMediaOutlines,
      preparedMediaSelectedIds,
    ]);
    const preparedMediaContextFallbackValue = useMemo<PreparedMediaContext>(
      () => ({
        controllerProfileId:
          preparedMediaContextFallback.controllerProfileId ?? "presentation",
        controllerProfileName: preparedMediaContextFallback.controllerProfileName,
        outlineScope: preparedMediaContextFallback.outlineScope ?? "presentation",
        outlineId: preparedMediaContextFallback.outlineId ?? null,
        outlineName: preparedMediaContextFallback.outlineName,
        contextSource: "persisted ItemLists fallback",
      }),
      [preparedMediaContextFallback],
    );
    const preparedMediaContext = usePreparedMediaContext(
      preparedMediaContextOverride ?? preparedMediaContextFallbackValue,
    );
    const preparedMediaOutlineId = preparedMediaContext.outlineId;
    const pairedDeviceSettings =
      useContext(GlobalInfoContext)?.device?.settings;
    // The built-in monitor keeps honouring the church-wide monitorSettings until
    // it is configured as a display, so legacy monitor settings do not silently
    // stop affecting anything.
    const legacyMonitorSettings = useSelector((state) =>
      settingsOutputId === "monitor"
        ? state.undoable?.present?.preferences?.monitorSettings
        : undefined,
    );
    // Subscribed rather than read once: a screen setting changed on the
    // controller has to reach this window without a reload.
    const screenOverrides = useScreenOverrides(
      settingsOutputId,
      pairedDeviceSettings,
    );
    const resolvedDisplaySettings = useMemo(() => {
      const output = registryOutputs.find(
        (candidate) => candidate.id === settingsOutputId,
      );
      const outputDefaults = resolveOutputDefaults(
        output?.settings,
        legacyMonitorSettings,
      );
      // The profile decides the defaults: a monitor keeps backgrounds off until
      // an operator opts in, where a projector has always shown them.
      return resolveDisplaySettings(
        outputDefaults,
        screenOverrides,
        output?.type ?? fallbackOutputType,
      );
    }, [
      fallbackOutputType,
      legacyMonitorSettings,
      screenOverrides,
      registryOutputs,
      settingsOutputId,
    ]);

    // Slide thumbnails and the editor always show their background; the surfaces
    // that render to a room honour the display's own setting.
    const displayRenderProfile = resolveDisplayRenderProfile(displayType, boxes);
    const supportsBackground = displayRenderProfile.supportsBackground;
    // Room surfaces honour the display's own setting; thumbnails and the editor
    // always show their background.
    const isRoomSurface =
      displayType === "projector" || displayType === "monitor";
    const showBackground =
      supportsBackground &&
      (!isRoomSurface || resolvedDisplaySettings.showBackground);

    const hasStreamItemData = useMemo(() => {
      const hasBoxes = (boxes?.length ?? 0) > 0;
      const hasBible = !!(
        bibleDisplayInfo?.title?.trim() || bibleDisplayInfo?.text?.trim()
      );
      const hasFormatted = !!formattedTextDisplayInfo?.text?.trim();
      return hasBoxes || hasBible || hasFormatted || Boolean(localVideoInput);
    }, [
      boxes?.length,
      bibleDisplayInfo?.title,
      bibleDisplayInfo?.text,
      formattedTextDisplayInfo?.text,
      localVideoInput,
    ]);

    // Keep the scheduled state clock for automatic rerenders, but never let a
    // stale cached value remount an overlay that has already expired in wall
    // clock time when another prop change causes a fresh render.
    const streamOverlayEvaluationNowMs =
      isStream && !overlayPreviewMode
        ? Math.max(streamOverlayNowMs, serverNow())
        : streamOverlayNowMs;

    useEffect(() => {
      if (!isStream || overlayPreviewMode) return;

      setStreamOverlayKeepAliveByKey((prev) =>
        pruneExpiredOverlayKeepAliveEntries(prev, streamOverlayEvaluationNowMs),
      );
    }, [isStream, overlayPreviewMode, streamOverlayEvaluationNowMs]);

    const registerLocalStreamOverlayWindow = useCallback(
      (
        overlayKey: string | null,
        localVisibleMs: number | null,
        mode: StreamOverlayKeepAliveMode = "max",
      ) => {
        if (
          !isStream ||
          overlayPreviewMode ||
          overlayKey == null ||
          localVisibleMs == null ||
          !Number.isFinite(localVisibleMs) ||
          localVisibleMs <= 0
        ) {
          return;
        }

        const keepUntilMs = serverNow() + localVisibleMs;
        setStreamOverlayKeepAliveByKey((prev) => {
          const next = pruneExpiredOverlayKeepAliveEntries(prev, serverNow());
          if (mode === "max" && (next[overlayKey] ?? 0) >= keepUntilMs) {
            return next;
          }

          return {
            ...next,
            [overlayKey]: keepUntilMs,
          };
        });
      },
      [isStream, overlayPreviewMode],
    );

    const participantOverlayVisibleUntilMs = getOverlayVisibleUntilMs({
      hasData: hasParticipantOverlayData(participantOverlayInfo),
      time: participantOverlayInfo?.time,
      duration: participantOverlayInfo?.duration,
      totalVisibleMs: getParticipantOverlayTotalVisibleMs(
        participantOverlayInfo,
      ),
    });
    const participantPrevOverlayVisibleUntilMs = getPrevOverlayVisibleUntilMs({
      prevHasData: hasParticipantOverlayData(prevParticipantOverlayInfo),
      prevTime: prevParticipantOverlayInfo?.time,
      prevDuration: prevParticipantOverlayInfo?.duration,
      prevTotalVisibleMs: getParticipantOverlayTotalVisibleMs(
        prevParticipantOverlayInfo,
      ),
      prevTransitionSequence: prevParticipantOverlayInfo?.transitionSequence,
      currentTime: participantOverlayInfo?.time,
      currentHasData: hasParticipantOverlayData(participantOverlayInfo),
      currentTransitionSequence: participantOverlayInfo?.transitionSequence,
      nowMs: streamOverlayEvaluationNowMs,
    });
    const stbOverlayVisibleUntilMs = getOverlayVisibleUntilMs({
      hasData: hasStbOverlayData(stbOverlayInfo),
      time: stbOverlayInfo?.time,
      duration: stbOverlayInfo?.duration,
      totalVisibleMs: STREAM_OVERLAY_TOTAL_VISIBLE_MS.stb,
    });
    const stbPrevOverlayVisibleUntilMs = getPrevOverlayVisibleUntilMs({
      prevHasData: hasStbOverlayData(prevStbOverlayInfo),
      prevTime: prevStbOverlayInfo?.time,
      prevDuration: prevStbOverlayInfo?.duration,
      prevTotalVisibleMs: STREAM_OVERLAY_TOTAL_VISIBLE_MS.stb,
      prevTransitionSequence: prevStbOverlayInfo?.transitionSequence,
      currentTime: stbOverlayInfo?.time,
      currentHasData: hasStbOverlayData(stbOverlayInfo),
      currentTransitionSequence: stbOverlayInfo?.transitionSequence,
      nowMs: streamOverlayEvaluationNowMs,
    });
    const qrOverlayVisibleUntilMs = getOverlayVisibleUntilMs({
      hasData: hasQrOverlayData(qrCodeOverlayInfo),
      time: qrCodeOverlayInfo?.time,
      duration: qrCodeOverlayInfo?.duration,
      totalVisibleMs: STREAM_OVERLAY_TOTAL_VISIBLE_MS.qr,
    });
    const qrPrevOverlayVisibleUntilMs = getPrevOverlayVisibleUntilMs({
      prevHasData: hasQrOverlayData(prevQrCodeOverlayInfo),
      prevTime: prevQrCodeOverlayInfo?.time,
      prevDuration: prevQrCodeOverlayInfo?.duration,
      prevTotalVisibleMs: STREAM_OVERLAY_TOTAL_VISIBLE_MS.qr,
      prevTransitionSequence: prevQrCodeOverlayInfo?.transitionSequence,
      currentTime: qrCodeOverlayInfo?.time,
      currentHasData: hasQrOverlayData(qrCodeOverlayInfo),
      currentTransitionSequence: qrCodeOverlayInfo?.transitionSequence,
      nowMs: streamOverlayEvaluationNowMs,
    });
    const imageOverlayVisibleUntilMs = getOverlayVisibleUntilMs({
      hasData: hasImageOverlayData(imageOverlayInfo),
      time: imageOverlayInfo?.time,
      duration: imageOverlayInfo?.duration,
      totalVisibleMs: STREAM_OVERLAY_TOTAL_VISIBLE_MS.image,
    });
    const imagePrevOverlayVisibleUntilMs = getPrevOverlayVisibleUntilMs({
      prevHasData: hasImageOverlayData(prevImageOverlayInfo),
      prevTime: prevImageOverlayInfo?.time,
      prevDuration: prevImageOverlayInfo?.duration,
      prevTotalVisibleMs: STREAM_OVERLAY_TOTAL_VISIBLE_MS.image,
      prevTransitionSequence: prevImageOverlayInfo?.transitionSequence,
      currentTime: imageOverlayInfo?.time,
      currentHasData: hasImageOverlayData(imageOverlayInfo),
      currentTransitionSequence: imageOverlayInfo?.transitionSequence,
      nowMs: streamOverlayEvaluationNowMs,
    });
    const boardPostOverlayVisibleUntilMs = getOverlayVisibleUntilMs({
      hasData: hasBoardPostData(boardPostStreamInfo),
      time: boardPostStreamInfo?.time,
      duration: boardPostStreamInfo?.duration,
      totalVisibleMs: STREAM_OVERLAY_TOTAL_VISIBLE_MS.boardPost,
    });
    const boardPostPrevOverlayVisibleUntilMs = getPrevOverlayVisibleUntilMs({
      prevHasData: hasBoardPostData(prevBoardPostStreamInfo),
      prevTime: prevBoardPostStreamInfo?.time,
      prevDuration: prevBoardPostStreamInfo?.duration,
      prevTotalVisibleMs: STREAM_OVERLAY_TOTAL_VISIBLE_MS.boardPost,
      prevTransitionSequence: prevBoardPostStreamInfo?.transitionSequence,
      currentTime: boardPostStreamInfo?.time,
      currentHasData: hasBoardPostData(boardPostStreamInfo),
      currentTransitionSequence: boardPostStreamInfo?.transitionSequence,
      nowMs: streamOverlayEvaluationNowMs,
    });

    const participantOverlaySyncVisible =
      participantOverlayVisibleUntilMs != null &&
      (!Number.isFinite(participantOverlayVisibleUntilMs) ||
        streamOverlayEvaluationNowMs < participantOverlayVisibleUntilMs);
    const prevParticipantOverlaySyncVisible =
      participantPrevOverlayVisibleUntilMs != null &&
      (!Number.isFinite(participantPrevOverlayVisibleUntilMs) ||
        streamOverlayEvaluationNowMs < participantPrevOverlayVisibleUntilMs);
    const stbOverlaySyncVisible =
      stbOverlayVisibleUntilMs != null &&
      (!Number.isFinite(stbOverlayVisibleUntilMs) ||
        streamOverlayEvaluationNowMs < stbOverlayVisibleUntilMs);
    const prevStbOverlaySyncVisible =
      stbPrevOverlayVisibleUntilMs != null &&
      (!Number.isFinite(stbPrevOverlayVisibleUntilMs) ||
        streamOverlayEvaluationNowMs < stbPrevOverlayVisibleUntilMs);
    const qrOverlaySyncVisible =
      qrOverlayVisibleUntilMs != null &&
      (!Number.isFinite(qrOverlayVisibleUntilMs) ||
        streamOverlayEvaluationNowMs < qrOverlayVisibleUntilMs);
    const prevQrOverlaySyncVisible =
      qrPrevOverlayVisibleUntilMs != null &&
      (!Number.isFinite(qrPrevOverlayVisibleUntilMs) ||
        streamOverlayEvaluationNowMs < qrPrevOverlayVisibleUntilMs);
    const imageOverlaySyncVisible =
      imageOverlayVisibleUntilMs != null &&
      (!Number.isFinite(imageOverlayVisibleUntilMs) ||
        streamOverlayEvaluationNowMs < imageOverlayVisibleUntilMs);
    const prevImageOverlaySyncVisible =
      imagePrevOverlayVisibleUntilMs != null &&
      (!Number.isFinite(imagePrevOverlayVisibleUntilMs) ||
        streamOverlayEvaluationNowMs < imagePrevOverlayVisibleUntilMs);
    const boardPostOverlaySyncVisible =
      boardPostOverlayVisibleUntilMs != null &&
      (!Number.isFinite(boardPostOverlayVisibleUntilMs) ||
        streamOverlayEvaluationNowMs < boardPostOverlayVisibleUntilMs);
    const prevBoardPostOverlaySyncVisible =
      boardPostPrevOverlayVisibleUntilMs != null &&
      (!Number.isFinite(boardPostPrevOverlayVisibleUntilMs) ||
        streamOverlayEvaluationNowMs < boardPostPrevOverlayVisibleUntilMs);

    const participantOverlayKey = buildStreamOverlayIdentityKey(
      "participant",
      participantOverlayInfo,
      [
        participantOverlayInfo?.name,
        participantOverlayInfo?.title,
        participantOverlayInfo?.event,
      ]
        .filter((value): value is string => Boolean(value))
        .join("|"),
    );
    const prevParticipantOverlayKey = buildStreamOverlayIdentityKey(
      "participant",
      prevParticipantOverlayInfo,
      [
        prevParticipantOverlayInfo?.name,
        prevParticipantOverlayInfo?.title,
        prevParticipantOverlayInfo?.event,
      ]
        .filter((value): value is string => Boolean(value))
        .join("|"),
    );
    const stbOverlayKey = buildStreamOverlayIdentityKey(
      "stb",
      stbOverlayInfo,
      [stbOverlayInfo?.heading, stbOverlayInfo?.subHeading]
        .filter((value): value is string => Boolean(value))
        .join("|"),
    );
    const prevStbOverlayKey = buildStreamOverlayIdentityKey(
      "stb",
      prevStbOverlayInfo,
      [prevStbOverlayInfo?.heading, prevStbOverlayInfo?.subHeading]
        .filter((value): value is string => Boolean(value))
        .join("|"),
    );
    const qrOverlayKey = buildStreamOverlayIdentityKey(
      "qr",
      qrCodeOverlayInfo,
      [qrCodeOverlayInfo?.url, qrCodeOverlayInfo?.description]
        .filter((value): value is string => Boolean(value))
        .join("|"),
    );
    const prevQrOverlayKey = buildStreamOverlayIdentityKey(
      "qr",
      prevQrCodeOverlayInfo,
      [prevQrCodeOverlayInfo?.url, prevQrCodeOverlayInfo?.description]
        .filter((value): value is string => Boolean(value))
        .join("|"),
    );
    const imageOverlayKey = buildStreamOverlayIdentityKey(
      "image",
      imageOverlayInfo,
      imageOverlayInfo?.imageUrl,
    );
    const prevImageOverlayKey = buildStreamOverlayIdentityKey(
      "image",
      prevImageOverlayInfo,
      prevImageOverlayInfo?.imageUrl,
    );
    const boardPostOverlayKey = buildStreamOverlayIdentityKey(
      "board-post",
      boardPostStreamInfo,
      boardPostStreamInfo?.text,
    );
    const prevBoardPostOverlayKey = buildStreamOverlayIdentityKey(
      "board-post",
      prevBoardPostStreamInfo,
      prevBoardPostStreamInfo?.text,
    );

    const isLocallyKeptAlive = (overlayKey: string | null) =>
      overlayKey != null &&
      (streamOverlayKeepAliveByKey[overlayKey] ?? 0) >
      streamOverlayEvaluationNowMs;

    const participantOverlayLocalVisibleMs = getLocalOverlayVisibleMs(
      participantOverlayInfo?.duration,
      getParticipantOverlayTotalVisibleMs(participantOverlayInfo),
    );
    const stbOverlayLocalVisibleMs = getLocalOverlayVisibleMs(
      stbOverlayInfo?.duration,
      STREAM_OVERLAY_TOTAL_VISIBLE_MS.stb,
    );
    const qrOverlayLocalVisibleMs = getLocalOverlayVisibleMs(
      qrCodeOverlayInfo?.duration,
      STREAM_OVERLAY_TOTAL_VISIBLE_MS.qr,
    );
    const imageOverlayLocalVisibleMs = getLocalOverlayVisibleMs(
      imageOverlayInfo?.duration,
      STREAM_OVERLAY_TOTAL_VISIBLE_MS.image,
    );
    const boardPostOverlayLocalVisibleMs = getLocalOverlayVisibleMs(
      boardPostStreamInfo?.duration,
      STREAM_OVERLAY_TOTAL_VISIBLE_MS.boardPost,
    );

    const showParticipantOverlay =
      participantOverlaySyncVisible ||
      isLocallyKeptAlive(participantOverlayKey);
    const showPrevParticipantOverlay =
      prevParticipantOverlaySyncVisible ||
      isLocallyKeptAlive(prevParticipantOverlayKey);
    const showStbOverlay =
      stbOverlaySyncVisible || isLocallyKeptAlive(stbOverlayKey);
    const showPrevStbOverlay =
      prevStbOverlaySyncVisible || isLocallyKeptAlive(prevStbOverlayKey);
    const showQrOverlay =
      qrOverlaySyncVisible || isLocallyKeptAlive(qrOverlayKey);
    const showPrevQrOverlay =
      prevQrOverlaySyncVisible || isLocallyKeptAlive(prevQrOverlayKey);
    const showImageOverlay =
      imageOverlaySyncVisible || isLocallyKeptAlive(imageOverlayKey);
    const showPrevImageOverlay =
      prevImageOverlaySyncVisible || isLocallyKeptAlive(prevImageOverlayKey);
    const showBoardPostOverlay =
      boardPostOverlaySyncVisible || isLocallyKeptAlive(boardPostOverlayKey);
    const showPrevBoardPostOverlay =
      prevBoardPostOverlaySyncVisible ||
      isLocallyKeptAlive(prevBoardPostOverlayKey);

    const streamOverlayHideUntilMs = useMemo(() => {
      const visibleUntilValues = [
        participantOverlayVisibleUntilMs,
        stbOverlayVisibleUntilMs,
        qrOverlayVisibleUntilMs,
        imageOverlayVisibleUntilMs,
        participantPrevOverlayVisibleUntilMs,
        stbPrevOverlayVisibleUntilMs,
        qrPrevOverlayVisibleUntilMs,
        imagePrevOverlayVisibleUntilMs,
        boardPostOverlayVisibleUntilMs,
        boardPostPrevOverlayVisibleUntilMs,
        ...Object.values(streamOverlayKeepAliveByKey),
      ].filter((value): value is number => value != null);

      if (visibleUntilValues.length === 0) return null;
      if (visibleUntilValues.some((value) => !Number.isFinite(value))) {
        return Number.POSITIVE_INFINITY;
      }

      return Math.max(...visibleUntilValues);
    }, [
      boardPostOverlayVisibleUntilMs,
      boardPostPrevOverlayVisibleUntilMs,
      imageOverlayVisibleUntilMs,
      imagePrevOverlayVisibleUntilMs,
      participantOverlayVisibleUntilMs,
      participantPrevOverlayVisibleUntilMs,
      qrOverlayVisibleUntilMs,
      qrPrevOverlayVisibleUntilMs,
      stbOverlayVisibleUntilMs,
      stbPrevOverlayVisibleUntilMs,
      streamOverlayKeepAliveByKey,
    ]);

    const visibleParticipantOverlayInfo = useMemo(
      () => (showParticipantOverlay ? participantOverlayInfo : undefined),
      [participantOverlayInfo, showParticipantOverlay],
    );

    const visiblePrevParticipantOverlayInfo = useMemo(
      () =>
        showPrevParticipantOverlay ? prevParticipantOverlayInfo : undefined,
      [prevParticipantOverlayInfo, showPrevParticipantOverlay],
    );

    const visibleStbOverlayInfo = useMemo(
      () => (showStbOverlay ? stbOverlayInfo : undefined),
      [showStbOverlay, stbOverlayInfo],
    );

    const visiblePrevStbOverlayInfo = useMemo(
      () => (showPrevStbOverlay ? prevStbOverlayInfo : undefined),
      [prevStbOverlayInfo, showPrevStbOverlay],
    );

    const visibleQrCodeOverlayInfo = useMemo(
      () => (showQrOverlay ? qrCodeOverlayInfo : undefined),
      [qrCodeOverlayInfo, showQrOverlay],
    );

    const visiblePrevQrCodeOverlayInfo = useMemo(
      () => (showPrevQrOverlay ? prevQrCodeOverlayInfo : undefined),
      [prevQrCodeOverlayInfo, showPrevQrOverlay],
    );

    const visibleImageOverlayInfo = useMemo(
      () => (showImageOverlay ? imageOverlayInfo : undefined),
      [imageOverlayInfo, showImageOverlay],
    );

    const visiblePrevImageOverlayInfo = useMemo(
      () => (showPrevImageOverlay ? prevImageOverlayInfo : undefined),
      [prevImageOverlayInfo, showPrevImageOverlay],
    );

    const visibleBoardPostStreamInfo = useMemo(
      () => (showBoardPostOverlay ? boardPostStreamInfo : undefined),
      [boardPostStreamInfo, showBoardPostOverlay],
    );

    const visiblePrevBoardPostStreamInfo = useMemo(
      () => (showPrevBoardPostOverlay ? prevBoardPostStreamInfo : undefined),
      [prevBoardPostStreamInfo, showPrevBoardPostOverlay],
    );

    const hasActiveStreamOverlay =
      streamOverlayHideUntilMs != null &&
      (streamOverlayHideUntilMs === Number.POSITIVE_INFINITY ||
        streamOverlayEvaluationNowMs < streamOverlayHideUntilMs);

    useEffect(() => {
      if (!isStream || overlayPreviewMode) return;
      const nowMs = serverNow();
      setStreamOverlayNowMs(nowMs);

      if (
        streamOverlayHideUntilMs == null ||
        !Number.isFinite(streamOverlayHideUntilMs) ||
        streamOverlayHideUntilMs <= nowMs
      ) {
        return;
      }

      const timeoutId = window.setTimeout(
        () => {
          setStreamOverlayNowMs(serverNow());
        },
        Math.max(0, streamOverlayHideUntilMs - nowMs) + 20,
      );

      return () => window.clearTimeout(timeoutId);
    }, [isStream, overlayPreviewMode, streamOverlayHideUntilMs]);

    const displayPrevLayerKey = useMemo(
      () => getDisplayBoxesLayerKey(prevBoxes),
      [prevBoxes],
    );
    const currentDisplayLayerKey = useMemo(
      () => getDisplayBoxesLayerKey(boxes),
      [boxes],
    );
    // Include transmit `time` so re-sending the same visual slide still counts as
    // a new transition for stream text and other prev-state consumers.
    const rawDisplayTransitionKey = `${currentDisplayLayerKey}::${displayPrevLayerKey}::${time ?? ""}`;
    if (initialDisplayTransitionKeyRef.current === null) {
      initialDisplayTransitionKeyRef.current = rawDisplayTransitionKey;
    }
    // Opening onto live content must fade in current only. The first
    // current::prev pair is historical Redux state, not a transition this
    // surface witnessed. Later key changes keep normal crossfades.
    const canCrossfadeFromPrev =
      displayPrevLayerKey !== "" &&
      rawDisplayTransitionKey !== initialDisplayTransitionKeyRef.current;
    // Suppress the prev *layer* on the first stale Redux pair; skip-text still
    // compares against the raw prevBoxes prop below.
    const effectivePrevBoxes = canCrossfadeFromPrev ? prevBoxes : EMPTY_BOXES;

    const bibleLayerKey = getStreamTextLayerKey(bibleDisplayInfo);
    const prevBibleLayerKey = getStreamTextLayerKey(prevBibleDisplayInfo);
    const rawBibleTransitionKey = `${bibleLayerKey}::${prevBibleLayerKey}`;
    if (initialBibleTransitionKeyRef.current === null) {
      initialBibleTransitionKeyRef.current = rawBibleTransitionKey;
    }
    const canCrossfadeBible =
      prevBibleLayerKey !== "" &&
      rawBibleTransitionKey !== initialBibleTransitionKeyRef.current;
    const effectivePrevBibleDisplayInfo = canCrossfadeBible
      ? prevBibleDisplayInfo
      : undefined;

    const formattedTextLayerKey = getFormattedTextLayerKey(
      formattedTextDisplayInfo,
    );
    const prevFormattedTextLayerKey = getFormattedTextLayerKey(
      prevFormattedTextDisplayInfo,
    );
    const rawFormattedTextTransitionKey = `${formattedTextLayerKey}::${prevFormattedTextLayerKey}`;
    if (initialFormattedTextTransitionKeyRef.current === null) {
      initialFormattedTextTransitionKeyRef.current =
        rawFormattedTextTransitionKey;
    }
    const canCrossfadeFormattedText =
      prevFormattedTextLayerKey !== "" &&
      rawFormattedTextTransitionKey !==
      initialFormattedTextTransitionKeyRef.current;
    const effectivePrevFormattedTextDisplayInfo = canCrossfadeFormattedText
      ? prevFormattedTextDisplayInfo
      : undefined;

    // Item content still animating out (e.g. after Clear, when current is empty but
    // prev holds the outgoing bible/formatted/text). Keep the item layer visible so
    // those exit animations can fade rather than being cut to opacity 0 instantly.
    const hasExitingStreamItemData = useMemo(() => {
      const hasPrevBoxes = streamPrevTextLayerBoxes.length > 0;
      const hasPrevBible = !!(
        effectivePrevBibleDisplayInfo?.title?.trim() ||
        effectivePrevBibleDisplayInfo?.text?.trim()
      );
      const hasPrevFormatted =
        !!effectivePrevFormattedTextDisplayInfo?.text?.trim();
      return (
        hasPrevBoxes ||
        hasPrevBible ||
        hasPrevFormatted ||
        Boolean(activePrevLocalVideoInput)
      );
    }, [
      streamPrevTextLayerBoxes.length,
      effectivePrevBibleDisplayInfo?.title,
      effectivePrevBibleDisplayInfo?.text,
      effectivePrevFormattedTextDisplayInfo?.text,
      activePrevLocalVideoInput,
    ]);

    // Item content is shown only when we have item data, the operator hasn't manually hidden it,
    // and no active stream overlay is temporarily overriding the item layer.
    const showStreamItemContent =
      (hasStreamItemData || hasExitingStreamItemData) &&
      !streamItemContentBlocked &&
      !hasActiveStreamOverlay;

    useLayoutEffect(() => {
      if (!isStream || overlayPreviewMode || effectivePrevBoxes.length === 0) {
        setStreamPrevTextLayerBoxes((current) =>
          current.length === 0 ? current : [],
        );
        return;
      }

      const token = ++streamPrevTextLayerTokenRef.current;
      setStreamPrevTextLayerBoxes(effectivePrevBoxes);

      const timeoutId = window.setTimeout(() => {
        setStreamPrevTextLayerBoxes((current) =>
          streamPrevTextLayerTokenRef.current === token ? [] : current,
        );
      }, STREAM_PREV_TEXT_LAYER_VISIBLE_MS);

      return () => window.clearTimeout(timeoutId);
      // `rawDisplayTransitionKey` includes transmit time so same-slide re-clicks
      // remount the stream prev text layer instead of skipping the handoff.
    }, [
      isStream,
      overlayPreviewMode,
      effectivePrevBoxes,
      rawDisplayTransitionKey,
    ]);

    // Determine the active background video (if any) from boxes
    const { videoBox, rawDesiredVideoUrl } = useMemo(() => {
      if (!shouldPlayVideo || !showBackground)
        return { videoBox: undefined, rawDesiredVideoUrl: undefined };
      const videoBox = boxes.find(
        (b) => b.mediaInfo?.type === "video" && b.mediaInfo?.background,
      );
      return {
        videoBox,
        rawDesiredVideoUrl: videoBox?.mediaInfo?.background,
      };
    }, [boxes, showBackground, shouldPlayVideo]);
    const videoMediaKey = useMemo(
      () => getVideoBackgroundMediaKey(videoBox?.mediaInfo),
      [videoBox?.mediaInfo],
    );
    const editorPreparedPreviewEnabled = Boolean(
      isEditor &&
        showBackground &&
        shouldPlayVideo &&
        currentItemId &&
        window.electronAPI,
    );
    const reportEditorPreparedActive = useCallback(
      (active: boolean) => {
        setEditorPreparedActive(active);
        setEditorPreparedActiveMediaKey(active ? videoMediaKey : undefined);
      },
      [videoMediaKey],
    );
    const activeVideoPlayback = useMemo(() => {
      const matched =
        videoPlayback?.mediaKey && videoMediaKey
          ? videoPlayback.mediaKey === videoMediaKey
          : false;
      logVideoCue("display.resolve", {
        outputId,
        displayType,
        cueMediaKey: videoPlayback?.mediaKey,
        cueGeneration: videoPlayback?.generation,
        cuePaused: videoPlayback?.paused,
        videoMediaKey,
        matched,
      });
      if (!matched) return undefined;
      return videoPlayback;
    }, [displayType, outputId, videoMediaKey, videoPlayback]);
    const localVideoFile = useLocalVideoFileUrl(
      videoBox?.mediaInfo?.localVideoFile,
    );
    const isCloudPlaybackPending = Boolean(
      videoBox?.mediaInfo?.localVideoFile?.preferCloudPlayback &&
        !videoBox.mediaInfo.localVideoFile.cloudUrl,
    );
    const isAwaitingLocalVideoUrl = Boolean(
      videoBox?.mediaInfo?.localVideoFile &&
      (isCloudPlaybackPending ||
        (localVideoFile.isLocalVideoFile && !localVideoFile.url)),
    );
    let desiredVideoUrl = rawDesiredVideoUrl;
    if (isCloudPlaybackPending) {
      desiredVideoUrl = undefined;
    } else if (localVideoFile.isLocalVideoFile) {
      desiredVideoUrl = localVideoFile.url;
    }
    const editorPreparedCurrentMedia = useMemo(
      () =>
        videoMediaKey && desiredVideoUrl
          ? {
              mediaKey: videoMediaKey,
              source: desiredVideoUrl,
              itemId: currentItemId,
            }
          : undefined,
      [currentItemId, desiredVideoUrl, videoMediaKey],
    );
    const editorPreparedVideoActive =
      editorPreparedPreviewEnabled &&
      editorPreparedActive &&
      editorPreparedActiveMediaKey === videoMediaKey;

    // Underlay surfaces (editor, stream, next-slide monitor) use a single
    // current player — animated displays host media inside the transition stage.
    const showClock = resolvedDisplaySettings.showClock;
    const showTimer = resolvedDisplaySettings.showTimer;
    const showNextSlide = resolvedDisplaySettings.showNextSlide;
    const clockFontSize = resolvedDisplaySettings.clockFontSize;
    const timerFontSize = resolvedDisplaySettings.timerFontSize;
    const useMonitorNextSlideLayout =
      shouldUseFullMonitorLayout &&
      showNextSlide &&
      (nextBoxes?.length ?? 0) > 0;
    const hostsBackgroundMediaInStage =
      (isDisplay && !shouldUseFullMonitorLayout) ||
      (shouldUseFullMonitorLayout && !useMonitorNextSlideLayout);

    // Previews and quick-link thumbnails leave this off; only live output
    // surfaces and the transmit-handler tiles render the clock and timer.
    // Wait for the registry (unless this screen already overrides) so shipped
    // defaults do not flash a clock that the display has turned off.
    const effectiveShowClock =
      showClockTimer &&
        isDisplayChromeReady(registryLoaded, screenOverrides?.showClock)
        ? showClock
        : false;
    const effectiveShowTimer =
      showClockTimer &&
        isDisplayChromeReady(registryLoaded, screenOverrides?.showTimer)
        ? showTimer
        : false;

    // Overlay activity hides lyrics/Bible/formatted text only. Hide Content
    // still hides and mutes local video so operators can drop the camera.
    const localVideoContentVisible = !isStream || !streamItemContentBlocked;
    const localVideoVolume = resolvedDisplaySettings.localVideoVolume / 100;
    const localVideoFileAudioEnabled = Boolean(
      videoBox?.mediaInfo?.localVideoFile &&
      videoBox.mediaInfo.localVideoFile.audioEnabled !== false &&
      resolvedDisplaySettings.localVideoAudioEnabled &&
      displayType !== "editor" &&
      displayType !== "slide" &&
      (!isStream || !streamItemContentBlocked),
    );

    const stageBackgroundMedia = useMemo(
      () =>
        resolveLaneBackgroundMedia({
          boxes,
          showBackground,
          shouldPlayVideo:
            shouldPlayVideo && !isAwaitingLocalVideoUrl,
          localVideoInput: hostsBackgroundMediaInStage
            ? localVideoInput
            : undefined,
          resolvedFileVideoUrl: desiredVideoUrl,
        }),
      [
        boxes,
        desiredVideoUrl,
        hostsBackgroundMediaInStage,
        isAwaitingLocalVideoUrl,
        localVideoInput,
        shouldPlayVideo,
        showBackground,
      ],
    );

    const displayBoxTransitionSnapshot =
      useMemo<DisplayBoxTransitionSnapshot>(() => {
        const mediaKey = getLaneBackgroundMediaKey(stageBackgroundMedia);
        return {
          key: `${currentDisplayLayerKey}::${mediaKey}::${time ?? ""}`,
          boxes,
          time,
          timerInfo,
          backgroundMedia: stageBackgroundMedia,
        };
      }, [
        boxes,
        currentDisplayLayerKey,
        stageBackgroundMedia,
        time,
        timerInfo,
      ]);

    const laneMediaPlayback = useMemo<LaneMediaPlaybackOptions>(
      () => ({
        outputId,
        windowRole: isEditor
          ? "editor"
          : videoPreloadRole === "preview"
            ? `${displayType ?? "unknown"}-preview`
            : displayType ?? "unknown",
        currentItemId,
        preparedMediaOutlineId,
        preparedMediaScope: "service",
        preparedMediaContext,
        showBackground,
        fileVideoAudioEnabled: localVideoFileAudioEnabled,
        volume: localVideoVolume,
        playbackRole: isEditor ? "preview" : "output",
        preloadRole: videoPreloadRole ?? (isEditor ? "preview" : "output"),
        suspendPlayback: suspendVideoPlayback,
        activeFileVideoPlayback: activeVideoPlayback,
        isEditor,
        localVideo: {
          playAudio:
            canCaptureLocalVideo &&
            playLocalVideoAudio &&
            resolvedDisplaySettings.localVideoAudioEnabled &&
            localVideoInput?.audioEnabled !== false &&
            localVideoContentVisible,
          captureEnabled:
            canCaptureLocalVideo &&
            (displayType === "editor" || directLocalVideoCapture),
          receiveHighQuality: canCaptureLocalVideo,
          publishPreview: canCaptureLocalVideo && displayType === "editor",
          showErrors: !canCaptureLocalVideo || displayType === "editor",
          transparentBackground: displayType === "stream",
          contentVisible: localVideoContentVisible,
        },
      }),
      [
        activeVideoPlayback,
        canCaptureLocalVideo,
        directLocalVideoCapture,
        displayType,
        isEditor,
        localVideoContentVisible,
        localVideoFileAudioEnabled,
        localVideoInput?.audioEnabled,
        localVideoVolume,
        playLocalVideoAudio,
        resolvedDisplaySettings.localVideoAudioEnabled,
        suspendVideoPlayback,
        videoPreloadRole,
        outputId,
        currentItemId,
        preparedMediaOutlineId,
        preparedMediaContext,
        showBackground,
      ],
    );

    // Stream / editor / next-slide monitor: underlay local video with optional
    // prev timeout. Stage-hosted displays keep capture inside the lane.
    const useUnderlayLocalVideo =
      Boolean(localVideoInput || effectivePrevLocalVideoInput) &&
      !hostsBackgroundMediaInStage;
    const immediatePrevLocalVideoInput =
      useUnderlayLocalVideo &&
        shouldAnimate &&
        effectivePrevLocalVideoInput &&
        effectivePrevLocalVideoInput.sourceId !== localVideoInput?.sourceId &&
        effectivePrevLocalVideoInput.sourceId !== hiddenPrevLocalVideoSourceId
        ? effectivePrevLocalVideoInput
        : undefined;
    const renderedPrevLocalVideoInput = useUnderlayLocalVideo
      ? immediatePrevLocalVideoInput ??
        (activePrevLocalVideoInput?.sourceId !== localVideoInput?.sourceId
          ? activePrevLocalVideoInput
          : undefined)
      : undefined;
    const localVideoLayer =
      useUnderlayLocalVideo && localVideoInput ? (
        <LocalVideoInputLayer
          key={`local-video-${localVideoInput.sourceId}`}
          input={localVideoInput}
          shouldAnimate={shouldAnimate}
          playAudio={
            canCaptureLocalVideo &&
            playLocalVideoAudio &&
            resolvedDisplaySettings.localVideoAudioEnabled &&
            localVideoInput.audioEnabled !== false &&
            localVideoContentVisible
          }
          volume={localVideoVolume}
          captureEnabled={
            canCaptureLocalVideo &&
            (displayType === "editor" || directLocalVideoCapture)
          }
          receiveHighQuality={canCaptureLocalVideo}
          publishPreview={canCaptureLocalVideo && displayType === "editor"}
          showErrors={!canCaptureLocalVideo || displayType === "editor"}
          transparentBackground={displayType === "stream"}
          outputId={outputId}
          windowRole={displayType ?? "unknown"}
          contentVisible={localVideoContentVisible}
        />
      ) : null;
    const previousLocalVideoLayer =
      useUnderlayLocalVideo && renderedPrevLocalVideoInput ? (
        <LocalVideoInputLayer
          key={`local-video-${renderedPrevLocalVideoInput.sourceId}`}
          input={renderedPrevLocalVideoInput}
          isPrevious
          shouldAnimate={shouldAnimate}
          playAudio={false}
          captureEnabled={false}
          receiveHighQuality={canCaptureLocalVideo}
          showErrors={false}
          transparentBackground={displayType === "stream"}
          outputId={outputId}
          windowRole={displayType ?? "unknown"}
          contentVisible={localVideoContentVisible}
        />
      ) : null;
    const localVideoMediaLayers = (
      <>
        {previousLocalVideoLayer}
        {localVideoLayer}
      </>
    );

    // Single-player underlay for surfaces that do not use the transition stage.
    const shouldRenderUnderlayFileVideo =
      !hostsBackgroundMediaInStage &&
      showBackground &&
      shouldPlayVideo &&
      !localVideoInput &&
      Boolean(desiredVideoUrl) &&
      !isAwaitingLocalVideoUrl &&
      !editorPreparedVideoActive;
    const underlayIsLocalProtocol = Boolean(
      desiredVideoUrl?.startsWith("worshipsync-media://") ||
        desiredVideoUrl?.startsWith("blob:") ||
        desiredVideoUrl?.startsWith("media-cache://"),
    );
    const underlayCachedVideoUrl = useCachedVideoUrl(
      shouldRenderUnderlayFileVideo && !underlayIsLocalProtocol
        ? desiredVideoUrl
        : undefined,
    );
    const underlayResolvedVideoUrl = underlayIsLocalProtocol
      ? desiredVideoUrl
      : underlayCachedVideoUrl;
    const [underlayPaintReady, setUnderlayPaintReady] = useState(false);
    useEffect(() => {
      setUnderlayPaintReady(false);
    }, [desiredVideoUrl, videoMediaKey]);
    const fileVideoMediaLayers =
      shouldRenderUnderlayFileVideo && underlayResolvedVideoUrl && videoBox ? (
        <div
          className="pointer-events-none absolute inset-0"
          data-testid="current-video-background-layer"
          data-paint-ready={underlayPaintReady ? "true" : "false"}
        >
          <HLSPlayer
            src={underlayResolvedVideoUrl}
            originalSrc={desiredVideoUrl}
            onLoadedData={() => setUnderlayPaintReady(true)}
            onError={() => setUnderlayPaintReady(false)}
            videoBox={videoBox}
            muted={!localVideoFileAudioEnabled}
            volume={localVideoVolume}
            playbackRole={isEditor ? "preview" : "output"}
            preloadRole={
              videoPreloadRole ?? (isEditor ? "preview" : "output")
            }
            suspendPlayback={suspendVideoPlayback}
            mediaKey={isEditor ? videoMediaKey : undefined}
            playback={activeVideoPlayback}
            outputId={outputId}
            windowRole={displayType ?? "unknown"}
          />
        </div>
      ) : null;

    const mediaBackgroundLayers = (
      <>
        {fileVideoMediaLayers}
        {localVideoMediaLayers}
      </>
    );

    const activeVideoUrl =
      stageBackgroundMedia.kind === "fileVideo"
        ? stageBackgroundMedia.originalSrc
        : desiredVideoUrl;
    const isWindowVideoLoaded =
      hostsBackgroundMediaInStage || underlayPaintReady || editorPreparedVideoActive;

    // Render all content - wrap in scaled container when using transform
    const renderContent = () => {
      if (shouldUseFullMonitorLayout) {
        return (
          <div
            style={{
              width: `${REFERENCE_WIDTH}px`,
              height: `${REFERENCE_HEIGHT}px`,
              transform: `translate(-50%, -50%) scale(${scaleFactor})`,
              transformOrigin: "center center",
              position: "absolute",
              top: "50%",
              left: "50%",
            }}
          >
            <MonitorView
              boxes={boxes}
              prevBoxes={effectivePrevBoxes}
              nextBoxes={nextBoxes}
              prevNextBoxes={canCrossfadeFromPrev ? prevNextBoxes : EMPTY_BOXES}
              bibleInfoBox={bibleInfoBox}
              showNextSlide={showNextSlide && (nextBoxes?.length ?? 0) > 0}
              showBackground={showBackground}
              shouldAnimate={shouldAnimate}
              transitionDurationMs={resolvedDisplaySettings.transitionDurationMs}
              effectiveWidth={effectiveWidth}
              time={time}
              timerInfo={timerInfo}
              prevTimerInfo={prevTimerInfo}
              scaleFactor={scaleFactor}
              effectiveShowClock={effectiveShowClock}
              effectiveShowTimer={effectiveShowTimer}
              clockFontSize={clockFontSize}
              timerFontSize={timerFontSize}
              transitionDirection={transitionDirection}
              currentMediaLayer={
                useMonitorNextSlideLayout ? mediaBackgroundLayers : undefined
              }
              backgroundMedia={stageBackgroundMedia}
              mediaPlayback={laneMediaPlayback}
            />
          </div>
        );
      }

      const currentDisplayLayer =
        isDisplay && !shouldUseFullMonitorLayout ? (
          <div className="absolute inset-0" data-testid="current-display-layer">
            <DisplayBoxTransitionStage
              snapshot={displayBoxTransitionSnapshot}
              shouldAnimate={shouldAnimate}
              transitionDurationMs={resolvedDisplaySettings.transitionDurationMs}
              mediaPlayback={laneMediaPlayback}
              renderLane={(
                laneSnapshot,
                isPrevious,
                reportPaintReady,
                laneMedia,
              ) => {
                const laneRenderProfile = resolveDisplayRenderProfile(
                  displayType,
                  laneSnapshot.boxes,
                );
                const laneFileVideoUrl =
                  laneSnapshot.backgroundMedia.kind === "fileVideo"
                    ? laneSnapshot.backgroundMedia.originalSrc
                    : undefined;
                return laneSnapshot.boxes.map((box, index) => (
                  <DisplayBox
                    key={index}
                    box={box}
                    width={effectiveWidth}
                    showBackground={showBackground}
                    index={index}
                    shouldAnimate={false}
                    time={laneSnapshot.time}
                    timerInfo={laneSnapshot.timerInfo}
                    activeVideoUrl={laneFileVideoUrl}
                    isWindowVideoLoaded={laneMedia.liveVideoPaintReady}
                    isPrev={isPrevious}
                    referenceWidth={REFERENCE_WIDTH}
                    referenceHeight={REFERENCE_HEIGHT}
                    scaleFactor={scaleFactor}
                    brightness={
                      index === 0
                        ? laneRenderProfile.backgroundBrightness
                        : undefined
                    }
                    isSimpleFont={laneRenderProfile.isSimpleFont}
                    onPaintReadyChange={(ready) =>
                      reportPaintReady(index, ready)
                    }
                    isTransitionManaged
                    paintBackground={laneMedia.paintBackground}
                    paintForeground={laneMedia.paintForeground}
                  />
                ));
              }}
            />
          </div>
        ) : null;

      const currentStreamTextLayer =
        isStream && !overlayPreviewMode ? (
          <div
            className="absolute inset-0"
            data-testid="current-stream-text-layer"
          >
            {boxes.map((box, index) => (
              <DisplayStreamText
                key={`current-${box.id}`}
                box={box}
                prevBox={prevBoxes[index]}
                width={effectiveWidth}
                shouldAnimate={shouldAnimate}
                time={time}
                timerInfo={timerInfo}
                referenceWidth={REFERENCE_WIDTH}
                referenceHeight={REFERENCE_HEIGHT}
              />
            ))}
          </div>
        ) : null;

      const prevStreamTextLayer =
        isStream &&
          !overlayPreviewMode &&
          streamPrevTextLayerBoxes.length > 0 ? (
          <div
            className="absolute inset-0"
            data-testid="prev-stream-text-layer"
          >
            {streamPrevTextLayerBoxes.map((box, index) => (
              <DisplayStreamText
                key={`prev-${box.id}`}
                box={box}
                width={effectiveWidth}
                shouldAnimate={shouldAnimate}
                time={time}
                timerInfo={prevTimerInfo}
                isPrev
                prevBox={boxes[index]}
                referenceWidth={REFERENCE_WIDTH}
                referenceHeight={REFERENCE_HEIGHT}
              />
            ))}
          </div>
        ) : null;

      const editorLayer = isEditor ? (
        <div className="absolute inset-0" data-testid="editor-layer">
          {boxes.map((box, index) => (
            <DisplayEditor
              // Keep the editor box mounted across slide selection so its
              // editor-only image swap can retain the old decoded frame until
              // the next local image is ready. The change remains an instant
              // cut; no display transition runs in the editor.
              key={`editor-${index}`}
              box={box}
              width={effectiveWidth}
              onChange={onChange}
              index={index}
              selectBox={selectBox}
              isSelected={selectedBox === index}
              isBoxLocked={isBoxLocked?.[index] ?? true}
              showEditorBoxBorder={showEditorBoxBorder}
              disabled={disabled}
              referenceWidth={REFERENCE_WIDTH}
              referenceHeight={REFERENCE_HEIGHT}
              scaleFactor={scaleFactor}
              activeVideoUrl={activeVideoUrl}
              isWindowVideoLoaded={isWindowVideoLoaded}
              desiredCursorPosition={boxCursorPositions?.[index]}
            />
          ))}
        </div>
      ) : null;

      const innerContent = (
        <>
          {!hostsBackgroundMediaInStage && fileVideoMediaLayers}

          {editorPreparedPreviewEnabled && (
            <ElectronEditorPreparedMediaPreview
              enabled
              currentItemId={currentItemId}
              currentMedia={editorPreparedCurrentMedia}
              preparedMediaContext={preparedMediaContext}
              videoBox={videoBox}
              playback={activeVideoPlayback}
              volume={localVideoVolume}
              onCurrentFrameReady={reportEditorPreparedActive}
            />
          )}

          {!isStream && !hostsBackgroundMediaInStage && localVideoMediaLayers}

          {editorLayer}
          {currentDisplayLayer}

          {isDisplay && !shouldUseFullMonitorLayout && (
            <ProjectorClockTimer
              showClock={effectiveShowClock}
              showTimer={effectiveShowTimer}
              clockFontSize={clockFontSize}
              timerFontSize={timerFontSize}
              timerInfo={timerInfo}
            />
          )}

          {isStream && !overlayPreviewMode && (
            <>
              {/* Media background: local input stays below slide text and overlays. */}
              {localVideoMediaLayers}

              {/* Item content: hidden while an overlay is active or Hide Content is on. */}
              <div
                data-testid="stream-item-layer"
                className="absolute inset-0 transition-opacity duration-500 ease-out"
                style={{
                  opacity: showStreamItemContent ? 1 : 0,
                  pointerEvents: showStreamItemContent ? "auto" : "none",
                }}
              >
                {currentStreamTextLayer}
                {prevStreamTextLayer}
                <DisplayStreamBible
                  width={effectiveWidth}
                  shouldAnimate={shouldAnimate}
                  bibleDisplayInfo={bibleDisplayInfo}
                  prevBibleDisplayInfo={effectivePrevBibleDisplayInfo}
                  ref={containerRef}
                />
                <DisplayStreamFormattedText
                  width={effectiveWidth}
                  shouldAnimate={shouldAnimate}
                  formattedTextDisplayInfo={formattedTextDisplayInfo}
                  prevFormattedTextDisplayInfo={
                    effectivePrevFormattedTextDisplayInfo
                  }
                />
              </div>

              {/* Stream overlays remain the top layer so lower-thirds/QR/board posts composite over the camera. */}
              {(visibleStbOverlayInfo != null ||
                visiblePrevStbOverlayInfo != null) && (
                  <DisplayStbOverlay
                    width={effectiveWidth}
                    shouldAnimate={shouldAnimate}
                    stbOverlayInfo={visibleStbOverlayInfo}
                    prevStbOverlayInfo={visiblePrevStbOverlayInfo}
                    currentKeepAliveKey={stbOverlayKey}
                    prevKeepAliveKey={prevStbOverlayKey}
                    currentKeepAliveMs={stbOverlayLocalVisibleMs}
                    prevKeepAliveMs={STREAM_PREV_OVERLAY_EXIT_MS}
                    onLocalKeepAliveStart={registerLocalStreamOverlayWindow}
                    ref={containerRef}
                  />
                )}

              {(visibleParticipantOverlayInfo != null ||
                visiblePrevParticipantOverlayInfo != null) && (
                  <DisplayParticipantOverlay
                    width={effectiveWidth}
                    shouldAnimate={shouldAnimate}
                    participantOverlayInfo={visibleParticipantOverlayInfo}
                    prevParticipantOverlayInfo={visiblePrevParticipantOverlayInfo}
                    currentKeepAliveKey={participantOverlayKey}
                    prevKeepAliveKey={prevParticipantOverlayKey}
                    currentKeepAliveMs={participantOverlayLocalVisibleMs}
                    prevKeepAliveMs={STREAM_PREV_OVERLAY_EXIT_MS}
                    onLocalKeepAliveStart={registerLocalStreamOverlayWindow}
                    ref={containerRef}
                  />
                )}

              {(visibleQrCodeOverlayInfo != null ||
                visiblePrevQrCodeOverlayInfo != null) && (
                  <DisplayQrCodeOverlay
                    width={effectiveWidth}
                    shouldAnimate={shouldAnimate}
                    qrCodeOverlayInfo={visibleQrCodeOverlayInfo}
                    prevQrCodeOverlayInfo={visiblePrevQrCodeOverlayInfo}
                    currentKeepAliveKey={qrOverlayKey}
                    prevKeepAliveKey={prevQrOverlayKey}
                    currentKeepAliveMs={qrOverlayLocalVisibleMs}
                    prevKeepAliveMs={STREAM_PREV_OVERLAY_EXIT_MS}
                    onLocalKeepAliveStart={registerLocalStreamOverlayWindow}
                    ref={containerRef}
                  />
                )}

              {(visibleImageOverlayInfo != null ||
                visiblePrevImageOverlayInfo != null) && (
                  <DisplayImageOverlay
                    width={effectiveWidth}
                    shouldAnimate={shouldAnimate}
                    imageOverlayInfo={visibleImageOverlayInfo}
                    prevImageOverlayInfo={visiblePrevImageOverlayInfo}
                    currentKeepAliveKey={imageOverlayKey}
                    prevKeepAliveKey={prevImageOverlayKey}
                    currentKeepAliveMs={imageOverlayLocalVisibleMs}
                    prevKeepAliveMs={STREAM_PREV_OVERLAY_EXIT_MS}
                    onLocalKeepAliveStart={registerLocalStreamOverlayWindow}
                    ref={containerRef}
                  />
                )}

              {(visibleBoardPostStreamInfo != null ||
                visiblePrevBoardPostStreamInfo != null) && (
                  <DisplayBoardPostOverlay
                    width={effectiveWidth}
                    shouldAnimate={shouldAnimate}
                    boardPostStreamInfo={visibleBoardPostStreamInfo}
                    prevBoardPostStreamInfo={visiblePrevBoardPostStreamInfo}
                    currentKeepAliveKey={boardPostOverlayKey}
                    prevKeepAliveKey={prevBoardPostOverlayKey}
                    currentKeepAliveMs={boardPostOverlayLocalVisibleMs}
                    prevKeepAliveMs={STREAM_PREV_BOARD_POST_EXIT_MS}
                    onLocalKeepAliveStart={registerLocalStreamOverlayWindow}
                  />
                )}
            </>
          )}

          {isStream &&
            overlayPreviewMode &&
            (() => {
              const previewWidth =
                actualWidthPx > 0
                  ? (actualWidthPx / window.innerWidth) * 100
                  : effectiveWidth;
              const previewProps = {
                width: previewWidth,
                shouldAnimate,
                ref: containerRef,
                shouldFillContainer: true,
              };
              return (
                <>
                  {stbOverlayInfo != null && (
                    <DisplayStbOverlay
                      {...previewProps}
                      stbOverlayInfo={stbOverlayInfo}
                      prevStbOverlayInfo={prevStbOverlayInfo}
                    />
                  )}
                  {participantOverlayInfo != null && (
                    <DisplayParticipantOverlay
                      {...previewProps}
                      participantOverlayInfo={participantOverlayInfo}
                      prevParticipantOverlayInfo={prevParticipantOverlayInfo}
                    />
                  )}
                  {qrCodeOverlayInfo != null && (
                    <DisplayQrCodeOverlay
                      {...previewProps}
                      qrCodeOverlayInfo={qrCodeOverlayInfo}
                      prevQrCodeOverlayInfo={prevQrCodeOverlayInfo}
                    />
                  )}
                  {imageOverlayInfo != null && (
                    <DisplayImageOverlay
                      {...previewProps}
                      imageOverlayInfo={imageOverlayInfo}
                      prevImageOverlayInfo={prevImageOverlayInfo}
                    />
                  )}
                </>
              );
            })()}
        </>
      );

      // When overlay preview mode, wrapper fills container so overlay can fill for preview
      if (isStream && overlayPreviewMode) {
        return (
          <div
            className="bg-black"
            data-testid="overlay-preview-wrapper"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
            }}
          >
            {innerContent}
          </div>
        );
      }

      // Always wrap in scaled container using transform
      return (
        <div
          id={isEditor ? "display-editor-inner" : undefined}
          className={cn(!isStream && "bg-black")}
          style={{
            width: `${REFERENCE_WIDTH}px`,
            height: `${REFERENCE_HEIGHT}px`,
            transform: `translate(-50%, -50%) scale(${scaleFactor})`,
            transformOrigin: "center center",
            position: "absolute",
            top: "50%",
            left: "50%",
          }}
        >
          {innerContent}
        </div>
      );
    };

    /** Fullscreen projector/monitor only: letterbox/pillarbox in black and center on non-16:9 displays. Stream uses width 100vw without this stage or a black outer wrapper. */
    const fillsViewport =
      width === 100 &&
      (displayType === "projector" || displayType === "monitor");

    const innerStyle: React.CSSProperties = {
      width: fillsViewport
        ? "min(100vw, calc(100dvh * 16 / 9))"
        : width
          ? `${width}vw`
          : "100%",
      fontFamily: "Inter, sans-serif",
      contain: "layout size",
      isolation: "isolate",
    };

    const inner = (
      <div
        className={cn(
          "relative overflow-hidden overflow-anywhere text-white aspect-video",
          showBorder && "border border-gray-500",
          className,
        )}
        ref={containerRef}
        id={isEditor ? "display-editor" : undefined}
        style={innerStyle}
      >
        {renderContent()}
      </div>
    );

    return fillsViewport ? (
      <div
        className="flex h-dvh w-dvw items-center justify-center overflow-hidden bg-black"
        data-testid="display-full-viewport-stage"
      >
        {inner}
      </div>
    ) : (
      inner
    );
  },
);

export default DisplayWindow;
