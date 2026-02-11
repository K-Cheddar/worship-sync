import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import {
  BibleDisplayInfo,
  Box,
  DisplayType,
  FormattedTextDisplayInfo,
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
import DisplayClock from "./DisplayClock";
import DisplayTimer from "./DisplayTimer";
import { useSelector } from "../../hooks";
import { REFERENCE_WIDTH, REFERENCE_HEIGHT } from "../../constants";

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

    const {
      monitorSettings: { showClock, showTimer, clockFontSize, timerFontSize },
    } = useSelector((state) => state.undoable.present.preferences);

    // Only show clock and timer when showMonitorClockTimer is true
    const effectiveShowClock = showMonitorClockTimer ? showClock : false;
    const effectiveShowTimer = showMonitorClockTimer ? showTimer : false;

    const hasReducedSpace = isMonitor && (effectiveShowClock || effectiveShowTimer);

    // Calculate scale, height, and top based on the higher font size
    // At max font size (25): scaleY = 0.9, height = 90%, top = -5%
    // At min font size (15): scaleY = 0.95, height = 95%, top = -2.5%
    const maxFontSize = 25;
    const minFontSize = 15;
    const higherFontSize = Math.max(
      effectiveShowClock ? clockFontSize : 0,
      effectiveShowTimer ? timerFontSize : 0
    );
    // Normalize font size to range [0, 1] where 0 = min (15) and 1 = max (25)
    const normalizedRatio =
      (higherFontSize - minFontSize) / (maxFontSize - minFontSize);

    // Linear interpolation between min and max values
    const scaleY = 0.95 - normalizedRatio * 0.05; // 0.95 at min, 0.9 at max
    const heightPercent = 95 - normalizedRatio * 5; // 95% at min, 90% at max
    const topPercent = -2.5 - normalizedRatio * 2.5; // -2.5% at min, -5% at max

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

    // Render all content - wrap in scaled container when using transform
    const renderContent = () => {
      const innerContent = (
        <>
          {showBackground && shouldPlayVideo && activeVideoUrl && (
            <HLSPlayer
              src={activeVideoUrl}
              onLoadedData={() => setIsWindowVideoLoaded(true)}
              onError={() => setIsWindowVideoLoaded(false)}
              videoBox={videoBox}
            />
          )}
          {boxes.map((box, index) => {
            if (isEditor)
              return (
                <DisplayEditor
                  key={box.id}
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
              );
            if (isStream)
              return (
                <DisplayStreamText
                  key={box.id}
                  box={box}
                  prevBox={prevBoxes[index]}
                  width={effectiveWidth}
                  time={time}
                  timerInfo={timerInfo}
                  referenceWidth={REFERENCE_WIDTH}
                  referenceHeight={REFERENCE_HEIGHT}
                />
              );

            if (isDisplay)
              return (
                <div
                  key={box.id}
                  style={
                    hasReducedSpace
                      ? {
                        scale: `0.95 ${scaleY}`,
                        width: "100%",
                        height: `${heightPercent}%`,
                        position: "absolute",
                        top: `${topPercent}%`,
                      }
                      : undefined
                  }
                >
                  <DisplayBox
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
                  />
                </div>
              );
            return null;
          })}
          {prevBoxes.map((box, index) => {
            if (isDisplay)
              return (
                <div
                  key={box.id}
                  style={
                    hasReducedSpace
                      ? {
                        scale: `0.95 ${scaleY}`,
                        width: "100%",
                        height: `${heightPercent}%`,
                        position: "absolute",
                        top: `${topPercent}%`,
                      }
                      : undefined
                  }
                >
                  <DisplayBox
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
                </div>
              );
            if (isStream)
              return (
                <DisplayStreamText
                  key={box.id}
                  box={box}
                  width={effectiveWidth}
                  time={time}
                  timerInfo={prevTimerInfo}
                  isPrev
                  prevBox={boxes[index]}
                  referenceWidth={REFERENCE_WIDTH}
                  referenceHeight={REFERENCE_HEIGHT}
                />
              );
            return null;
          })}

          {isDisplay && isMonitor && (
            <>
              {effectiveShowClock && (
                <DisplayClock
                  width={effectiveWidth}
                  time={time}
                  fontSize={clockFontSize}
                />
              )}
              {effectiveShowTimer && (
                <DisplayTimer
                  width={effectiveWidth}
                  time={time}
                  currentTimerInfo={timerInfo}
                  fontSize={timerFontSize}
                />
              )}
            </>
          )}

          {isStream && !overlayPreviewMode && (
            <>
              <DisplayStreamBible
                width={effectiveWidth}
                shouldAnimate={shouldAnimate}
                bibleDisplayInfo={bibleDisplayInfo}
                prevBibleDisplayInfo={prevBibleDisplayInfo}
                ref={containerRef}
              />

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

              <DisplayStreamFormattedText
                width={effectiveWidth}
                shouldAnimate={shouldAnimate}
                formattedTextDisplayInfo={formattedTextDisplayInfo}
                prevFormattedTextDisplayInfo={prevFormattedTextDisplayInfo}
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
