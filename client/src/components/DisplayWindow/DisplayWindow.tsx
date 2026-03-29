import React, {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BibleDisplayInfo,
  Box,
  DisplayType,
  FormattedTextDisplayInfo,
  MonitorLayoutMode,
  OverlayInfo,
  TimerInfo,
} from "../../types";
import cn from "classnames";
import DisplayBox from "./DisplayBox";
import DisplayStreamBible from "./DisplayStreamBible";
import DisplayParticipantOverlay from "./DisplayParticipantOverlay";
import DisplayStbOverlay from "./DisplayStbOverlay";
import DisplayQrCodeOverlay from "./DisplayQrCodeOverlay";
import DisplayEditor from "./DisplayEditor";
import DisplayStreamText from "./DisplayStreamText";
import DisplayImageOverlay from "./DisplayImageOverlay";
import DisplayStreamFormattedText from "./DisplayStreamFormattedText";
import HLSPlayer from "./HLSVideoPlayer";
import MonitorView from "./MonitorView";
import { useSelector } from "../../hooks";
import { useCachedVideoUrl } from "../../hooks/useCachedMediaUrl";
import { REFERENCE_WIDTH, REFERENCE_HEIGHT } from "../../constants";

const STREAM_OVERLAY_TOTAL_VISIBLE_MS = {
  stb: 3000,
  qr: 5000,
  image: 5000,
} as const;

const STREAM_PREV_OVERLAY_EXIT_MS = 1500;
const DISPLAY_PREV_LAYER_VISIBLE_MS = 500;
const STREAM_PREV_TEXT_LAYER_VISIBLE_MS = 350;

const hasParticipantOverlayData = (overlay?: OverlayInfo) =>
  Boolean(overlay?.name || overlay?.title || overlay?.event);

const hasStbOverlayData = (overlay?: OverlayInfo) =>
  Boolean(overlay?.heading || overlay?.subHeading);

const hasQrOverlayData = (overlay?: OverlayInfo) =>
  Boolean(overlay?.url || overlay?.description);

const hasImageOverlayData = (overlay?: OverlayInfo) => Boolean(overlay?.imageUrl);

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
  currentHasData,
  currentTime,
}: {
  prevHasData: boolean;
  prevTime?: number;
  prevDuration?: number;
  prevTotalVisibleMs: number | null;
  currentHasData: boolean;
  currentTime?: number;
}) => {
  if (!prevHasData || currentHasData || currentTime == null) return null;
  const prevVisibleUntilMs = getOverlayVisibleUntilMs({
    hasData: prevHasData,
    time: prevTime,
    duration: prevDuration,
    totalVisibleMs: prevTotalVisibleMs,
  });
  if (
    prevVisibleUntilMs != null &&
    Number.isFinite(prevVisibleUntilMs) &&
    currentTime >= prevVisibleUntilMs
  ) {
    return null;
  }
  return currentTime + STREAM_PREV_OVERLAY_EXIT_MS;
};

type DisplayWindowProps = {
  prevBoxes?: Box[];
  boxes?: Box[];
  onChange?: ({
    index,
    value,
    box,
    cursorPosition,
  }: {
    index: number;
    value: string;
    box: Box;
    cursorPosition: number;
  }) => void;
  width?: number; // Optional: if not provided, component will scale to fit container
  showBorder?: boolean;
  displayType?: DisplayType;
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
  timerInfo?: TimerInfo;
  prevTimerInfo?: TimerInfo;
  shouldAnimate?: boolean;
  shouldPlayVideo?: boolean;
  time?: number;
  prevTime?: number;
  selectBox?: (index: number) => void;
  selectedBox?: number;
  isBoxLocked?: boolean[];
  disabled?: boolean;
  className?: string;
  showMonitorClockTimer?: boolean;
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
      participantOverlayInfo,
      prevParticipantOverlayInfo,
      stbOverlayInfo,
      prevStbOverlayInfo,
      shouldAnimate = false,
      shouldPlayVideo = false,
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
      isBoxLocked,
      disabled = false,
      className,
      showMonitorClockTimer = false,
      overlayPreviewMode = false,
      nextBoxes = [],
      prevNextBoxes = [],
      bibleInfoBox,
      transitionDirection,
      streamItemContentBlocked = false,
      monitorLayoutMode = "content-only",
    }: DisplayWindowProps,
    ref
  ) => {
    const fallbackRef = useRef<HTMLDivElement | null>(null);
    const elementRef = useRef<HTMLDivElement | null>(null);

    // Handle both callback refs and object refs
    const setRef = (node: HTMLDivElement | null) => {
      elementRef.current = node;
      fallbackRef.current = node;

      if (typeof ref === 'function') {
        ref(node);
      } else if (ref) {
        (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }
    };

    const containerRef = setRef;

    const [actualWidthPx, setActualWidthPx] = useState<number>(0);
    const [actualHeightPx, setActualHeightPx] = useState<number>(0);
    const [displayPrevLayerBoxes, setDisplayPrevLayerBoxes] = useState<Box[]>(
      [],
    );
    const [streamPrevTextLayerBoxes, setStreamPrevTextLayerBoxes] = useState<
      Box[]
    >([]);
    const displayPrevLayerTokenRef = useRef(0);
    const streamPrevTextLayerTokenRef = useRef(0);

    // Use ResizeObserver to track actual container width and height in pixels
    useEffect(() => {
      const element = elementRef.current || fallbackRef.current;

      if (!element) {
        // Retry after a brief delay if element isn't available yet
        const timeoutId = setTimeout(() => {
          const retryElement = elementRef.current || fallbackRef.current;
          if (retryElement) {
            const widthInPixels = retryElement.offsetWidth || retryElement.clientWidth;
            const heightInPixels = retryElement.offsetHeight || retryElement.clientHeight;
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
          const widthInPixels = entry.borderBoxSize?.[0]?.inlineSize || entry.contentRect.width;
          const heightInPixels = entry.borderBoxSize?.[0]?.blockSize || entry.contentRect.height;
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
    const heightScale = actualHeightPx > 0 ? actualHeightPx / REFERENCE_HEIGHT : 0;
    const scaleFactor = actualWidthPx > 0 && actualHeightPx > 0
      ? Math.min(widthScale, heightScale)
      : widthScale; // Fallback to width scale if height not measured yet

    // Components should use reference width for calculations
    const effectiveWidth = (REFERENCE_WIDTH / window.innerWidth) * 100; // Convert px to vw for compatibility


    const showBackground =
      displayType === "projector" ||
      displayType === "slide" ||
      displayType === "editor";
    const isStream = displayType === "stream";
    const isEditor = displayType === "editor";
    const isDisplay = !isStream && !isEditor;
    const isMonitor = displayType === "monitor";
    const shouldUseFullMonitorLayout =
      isMonitor && monitorLayoutMode === "full-monitor";
    const isSlide = displayType === "slide";
    const [streamOverlayNowMs, setStreamOverlayNowMs] = useState(() => Date.now());
    const storedMonitorSettings = useSelector(
      (state) => state.undoable.present.preferences.monitorSettings
    );

    const hasStreamItemData = useMemo(() => {
      const hasBoxes = (boxes?.length ?? 0) > 0;
      const hasBible =
        !!(bibleDisplayInfo?.title?.trim() || bibleDisplayInfo?.text?.trim());
      const hasFormatted = !!(formattedTextDisplayInfo?.text?.trim());
      return hasBoxes || hasBible || hasFormatted;
    }, [boxes?.length, bibleDisplayInfo?.title, bibleDisplayInfo?.text, formattedTextDisplayInfo?.text]);

    const streamOverlayHideUntilMs = useMemo(() => {
      const visibleUntilValues = [
        getOverlayVisibleUntilMs({
          hasData: hasParticipantOverlayData(participantOverlayInfo),
          time: participantOverlayInfo?.time,
          duration: participantOverlayInfo?.duration,
          totalVisibleMs: getParticipantOverlayTotalVisibleMs(participantOverlayInfo),
        }),
        getOverlayVisibleUntilMs({
          hasData: hasStbOverlayData(stbOverlayInfo),
          time: stbOverlayInfo?.time,
          duration: stbOverlayInfo?.duration,
          totalVisibleMs: STREAM_OVERLAY_TOTAL_VISIBLE_MS.stb,
        }),
        getOverlayVisibleUntilMs({
          hasData: hasQrOverlayData(qrCodeOverlayInfo),
          time: qrCodeOverlayInfo?.time,
          duration: qrCodeOverlayInfo?.duration,
          totalVisibleMs: STREAM_OVERLAY_TOTAL_VISIBLE_MS.qr,
        }),
        getOverlayVisibleUntilMs({
          hasData: hasImageOverlayData(imageOverlayInfo),
          time: imageOverlayInfo?.time,
          duration: imageOverlayInfo?.duration,
          totalVisibleMs: STREAM_OVERLAY_TOTAL_VISIBLE_MS.image,
        }),
        getPrevOverlayVisibleUntilMs({
          prevHasData: hasParticipantOverlayData(prevParticipantOverlayInfo),
          prevTime: prevParticipantOverlayInfo?.time,
          prevDuration: prevParticipantOverlayInfo?.duration,
          prevTotalVisibleMs: getParticipantOverlayTotalVisibleMs(
            prevParticipantOverlayInfo,
          ),
          currentHasData: hasParticipantOverlayData(participantOverlayInfo),
          currentTime: participantOverlayInfo?.time,
        }),
        getPrevOverlayVisibleUntilMs({
          prevHasData: hasStbOverlayData(prevStbOverlayInfo),
          prevTime: prevStbOverlayInfo?.time,
          prevDuration: prevStbOverlayInfo?.duration,
          prevTotalVisibleMs: STREAM_OVERLAY_TOTAL_VISIBLE_MS.stb,
          currentHasData: hasStbOverlayData(stbOverlayInfo),
          currentTime: stbOverlayInfo?.time,
        }),
        getPrevOverlayVisibleUntilMs({
          prevHasData: hasQrOverlayData(prevQrCodeOverlayInfo),
          prevTime: prevQrCodeOverlayInfo?.time,
          prevDuration: prevQrCodeOverlayInfo?.duration,
          prevTotalVisibleMs: STREAM_OVERLAY_TOTAL_VISIBLE_MS.qr,
          currentHasData: hasQrOverlayData(qrCodeOverlayInfo),
          currentTime: qrCodeOverlayInfo?.time,
        }),
        getPrevOverlayVisibleUntilMs({
          prevHasData: hasImageOverlayData(prevImageOverlayInfo),
          prevTime: prevImageOverlayInfo?.time,
          prevDuration: prevImageOverlayInfo?.duration,
          prevTotalVisibleMs: STREAM_OVERLAY_TOTAL_VISIBLE_MS.image,
          currentHasData: hasImageOverlayData(imageOverlayInfo),
          currentTime: imageOverlayInfo?.time,
        }),
      ].filter((value): value is number => value != null);

      if (visibleUntilValues.length === 0) return null;
      if (visibleUntilValues.some((value) => !Number.isFinite(value))) {
        return Number.POSITIVE_INFINITY;
      }

      return Math.max(...visibleUntilValues);
    }, [
      imageOverlayInfo,
      participantOverlayInfo,
      prevImageOverlayInfo,
      prevParticipantOverlayInfo,
      prevQrCodeOverlayInfo,
      prevStbOverlayInfo,
      qrCodeOverlayInfo,
      stbOverlayInfo,
    ]);

    const hasActiveStreamOverlay =
      streamOverlayHideUntilMs != null &&
      (streamOverlayHideUntilMs === Number.POSITIVE_INFINITY ||
        streamOverlayNowMs < streamOverlayHideUntilMs);

    useEffect(() => {
      if (!isStream || overlayPreviewMode) return;
      const nowMs = Date.now();
      setStreamOverlayNowMs(nowMs);

      if (
        streamOverlayHideUntilMs == null ||
        !Number.isFinite(streamOverlayHideUntilMs) ||
        streamOverlayHideUntilMs <= nowMs
      ) {
        return;
      }

      const timeoutId = window.setTimeout(() => {
        setStreamOverlayNowMs(Date.now());
      }, Math.max(0, streamOverlayHideUntilMs - nowMs) + 20);

      return () => window.clearTimeout(timeoutId);
    }, [
      isStream,
      overlayPreviewMode,
      streamOverlayHideUntilMs,
    ]);

    // Item content is shown only when we have item data, the operator hasn't manually hidden it,
    // and no active stream overlay is temporarily overriding the item layer.
    const showStreamItemContent =
      hasStreamItemData &&
      !streamItemContentBlocked &&
      !hasActiveStreamOverlay;

    const slideHasWords = useMemo(
      () => boxes.some((box) => Boolean(box.words?.trim())),
      [boxes]
    );

    useEffect(() => {
      if (!isDisplay || shouldUseFullMonitorLayout || prevBoxes.length === 0) {
        setDisplayPrevLayerBoxes((current) =>
          current.length === 0 ? current : [],
        );
        return;
      }

      const token = ++displayPrevLayerTokenRef.current;
      setDisplayPrevLayerBoxes(prevBoxes);

      const timeoutId = window.setTimeout(() => {
        setDisplayPrevLayerBoxes((current) =>
          displayPrevLayerTokenRef.current === token ? [] : current,
        );
      }, DISPLAY_PREV_LAYER_VISIBLE_MS);

      return () => window.clearTimeout(timeoutId);
    }, [isDisplay, shouldUseFullMonitorLayout, prevBoxes]);

    useEffect(() => {
      if (!isStream || overlayPreviewMode || prevBoxes.length === 0) {
        setStreamPrevTextLayerBoxes((current) =>
          current.length === 0 ? current : [],
        );
        return;
      }

      const token = ++streamPrevTextLayerTokenRef.current;
      setStreamPrevTextLayerBoxes(prevBoxes);

      const timeoutId = window.setTimeout(() => {
        setStreamPrevTextLayerBoxes((current) =>
          streamPrevTextLayerTokenRef.current === token ? [] : current,
        );
      }, STREAM_PREV_TEXT_LAYER_VISIBLE_MS);

      return () => window.clearTimeout(timeoutId);
    }, [isStream, overlayPreviewMode, prevBoxes]);

    // Determine the active background video (if any) from boxes
    const { videoBox, desiredVideoUrl } = useMemo(() => {
      if (!shouldPlayVideo || !showBackground)
        return { videoBox: undefined, desiredVideoUrl: undefined };
      const videoBox = boxes.find(
        (b) => b.mediaInfo?.type === "video" && b.mediaInfo?.background
      );
      return { videoBox, desiredVideoUrl: videoBox?.mediaInfo?.background };
    }, [boxes, showBackground, shouldPlayVideo]);

    const [activeVideoUrl, setActiveVideoUrl] = useState<string | undefined>(
      undefined
    );
    const [isWindowVideoLoaded, setIsWindowVideoLoaded] = useState(false);
    const resolvedVideoUrl = useCachedVideoUrl(activeVideoUrl);

    const showClock = storedMonitorSettings?.showClock ?? true;
    const showTimer = storedMonitorSettings?.showTimer ?? true;
    const showNextSlide = storedMonitorSettings?.showNextSlide ?? false;
    const clockFontSize = storedMonitorSettings?.clockFontSize ?? 75;
    const timerFontSize = storedMonitorSettings?.timerFontSize ?? 75;

    // Only show clock and timer when showMonitorClockTimer is true
    const effectiveShowClock = showMonitorClockTimer ? showClock : false;
    const effectiveShowTimer = showMonitorClockTimer ? showTimer : false;

    // Keep the video element mounted and update src only when the URL changes
    useEffect(() => {
      if (desiredVideoUrl && desiredVideoUrl !== activeVideoUrl) {
        setIsWindowVideoLoaded(false);
        setActiveVideoUrl(desiredVideoUrl);
      }
      if (!desiredVideoUrl) {
        // If there is no desired video, clear active video
        setActiveVideoUrl(undefined);
        setIsWindowVideoLoaded(false);
      }
    }, [desiredVideoUrl, activeVideoUrl]);

    // Hide placeholder immediately when using a locally-cached video
    useEffect(() => {
      if (resolvedVideoUrl?.startsWith("media-cache://")) {
        setIsWindowVideoLoaded(true);
      }
    }, [resolvedVideoUrl]);

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
              prevBoxes={prevBoxes}
              nextBoxes={nextBoxes}
              prevNextBoxes={prevNextBoxes}
              bibleInfoBox={bibleInfoBox}
              showNextSlide={showNextSlide && (nextBoxes?.length ?? 0) > 0}
              showBackground={showBackground}
              shouldAnimate={shouldAnimate}
              effectiveWidth={effectiveWidth}
              time={time}
              timerInfo={timerInfo}
              prevTimerInfo={prevTimerInfo}
              activeVideoUrl={activeVideoUrl}
              resolvedVideoUrl={resolvedVideoUrl}
              isWindowVideoLoaded={isWindowVideoLoaded}
              videoBox={videoBox}
              scaleFactor={scaleFactor}
              effectiveShowClock={effectiveShowClock}
              effectiveShowTimer={effectiveShowTimer}
              clockFontSize={clockFontSize}
              timerFontSize={timerFontSize}
              onVideoLoaded={() => setIsWindowVideoLoaded(true)}
              onVideoError={() => setIsWindowVideoLoaded(false)}
              transitionDirection={transitionDirection}
            />
          </div>
        );
      }

      const currentDisplayLayer =
        isDisplay && !shouldUseFullMonitorLayout ? (
          <div className="absolute inset-0" data-testid="current-display-layer">
            {boxes.map((box, index) => (
              <DisplayBox
                key={`current-${box.id}`}
                box={box}
                width={effectiveWidth}
                showBackground={showBackground}
                index={index}
                shouldAnimate={shouldAnimate}
                prevBox={prevBoxes[index]}
                time={time}
                timerInfo={timerInfo}
                activeVideoUrl={activeVideoUrl}
                isWindowVideoLoaded={isWindowVideoLoaded}
                referenceWidth={REFERENCE_WIDTH}
                referenceHeight={REFERENCE_HEIGHT}
                scaleFactor={scaleFactor}
                brightness={
                  isSlide && index === 0 && slideHasWords ? 30 : undefined
                }
                isSimpleFont={isSlide}
              />
            ))}
          </div>
        ) : null;

      const prevDisplayLayer =
        isDisplay && !shouldUseFullMonitorLayout && displayPrevLayerBoxes.length > 0 ? (
          <div className="absolute inset-0" data-testid="prev-display-layer">
            {displayPrevLayerBoxes.map((box, index) => (
              <DisplayBox
                key={`prev-${box.id}`}
                box={box}
                width={effectiveWidth}
                showBackground={showBackground}
                index={index}
                shouldAnimate={shouldAnimate}
                prevBox={boxes[index]}
                time={time}
                timerInfo={prevTimerInfo}
                activeVideoUrl={activeVideoUrl}
                isWindowVideoLoaded={isWindowVideoLoaded}
                isPrev
                referenceWidth={REFERENCE_WIDTH}
                referenceHeight={REFERENCE_HEIGHT}
                scaleFactor={scaleFactor}
              />
            ))}
          </div>
        ) : null;

      const currentStreamTextLayer =
        isStream && !overlayPreviewMode ? (
          <div className="absolute inset-0" data-testid="current-stream-text-layer">
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
        isStream && !overlayPreviewMode && streamPrevTextLayerBoxes.length > 0 ? (
          <div className="absolute inset-0" data-testid="prev-stream-text-layer">
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
              key={`editor-${box.id}`}
              box={box}
              width={effectiveWidth}
              onChange={onChange}
              index={index}
              selectBox={selectBox}
              isSelected={selectedBox === index}
              isBoxLocked={isBoxLocked?.[index] ?? true}
              disabled={disabled}
              referenceWidth={REFERENCE_WIDTH}
              referenceHeight={REFERENCE_HEIGHT}
              scaleFactor={scaleFactor}
              activeVideoUrl={activeVideoUrl}
              isWindowVideoLoaded={isWindowVideoLoaded}
            />
          ))}
        </div>
      ) : null;

      const innerContent = (
        <>
          {showBackground &&
            shouldPlayVideo &&
            activeVideoUrl &&
            resolvedVideoUrl && (
              <HLSPlayer
                src={resolvedVideoUrl}
                originalSrc={activeVideoUrl}
                onLoadedData={() => setIsWindowVideoLoaded(true)}
                onError={() => setIsWindowVideoLoaded(false)}
                videoBox={videoBox}
              />
            )}


          {editorLayer}
          {currentDisplayLayer}
          {prevDisplayLayer}

          {isStream && !overlayPreviewMode && (
            <>
              {/* Layer 1: stream item (text/bible/formatted). Hidden when overlay-only ON; fades back when turned OFF. */}
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
                  prevBibleDisplayInfo={prevBibleDisplayInfo}
                  ref={containerRef}
                />
                <DisplayStreamFormattedText
                  width={effectiveWidth}
                  shouldAnimate={shouldAnimate}
                  formattedTextDisplayInfo={formattedTextDisplayInfo}
                  prevFormattedTextDisplayInfo={prevFormattedTextDisplayInfo}
                />
              </div>

              {/* Layer 2: stream overlays. Active overlays temporarily override the item layer without destroying it. */}
              <DisplayStbOverlay
                width={effectiveWidth}
                shouldAnimate={shouldAnimate}
                stbOverlayInfo={stbOverlayInfo}
                prevStbOverlayInfo={prevStbOverlayInfo}
                ref={containerRef}
              />

              <DisplayParticipantOverlay
                width={effectiveWidth}
                shouldAnimate={shouldAnimate}
                participantOverlayInfo={participantOverlayInfo}
                prevParticipantOverlayInfo={prevParticipantOverlayInfo}
                ref={containerRef}
              />

              <DisplayQrCodeOverlay
                width={effectiveWidth}
                shouldAnimate={shouldAnimate}
                qrCodeOverlayInfo={qrCodeOverlayInfo}
                prevQrCodeOverlayInfo={prevQrCodeOverlayInfo}
                ref={containerRef}
              />

              <DisplayImageOverlay
                width={effectiveWidth}
                shouldAnimate={shouldAnimate}
                imageOverlayInfo={imageOverlayInfo}
                prevImageOverlayInfo={prevImageOverlayInfo}
                ref={containerRef}
              />
            </>
          )}

          {isStream && overlayPreviewMode && (() => {
            const previewWidth = actualWidthPx > 0 ? (actualWidthPx / window.innerWidth) * 100 : effectiveWidth;
            const previewProps = { width: previewWidth, shouldAnimate, ref: containerRef, shouldFillContainer: true };
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

    return (
      <div
        className={cn(
          "relative overflow-hidden overflow-anywhere text-white aspect-video",
          showBorder && "border border-gray-500",
          className
        )}
        ref={containerRef}
        id={isEditor ? "display-editor" : undefined}
        style={{
          // Ensure parent has defined width to constrain scaled content
          // If className is provided (like "w-full"), let CSS handle it but ensure container is constrained
          width: width
            ? `${width}vw`
            : className
              ? "100%" // When using transform with className, ensure width is set
              : "100%",
          fontFamily: "Inter, sans-serif",
          // Prevent scaled inner container from affecting layout
          contain: "layout size",
          isolation: "isolate",
        }}
      >
        {renderContent()}
      </div>
    );
  }
);

export default DisplayWindow;
