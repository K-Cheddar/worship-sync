import React from "react";
import { Box, TimerInfo } from "../../types";
import DisplayBox from "./DisplayBox";
import MonitorDisplayBox from "./MonitorDisplayBox";
import DisplayClock from "./DisplayClock";
import DisplayTimer from "./DisplayTimer";
import HLSPlayer from "./HLSVideoPlayer";
import VerseDisplay from "./VerseDisplay";
import {
  REFERENCE_WIDTH,
  REFERENCE_HEIGHT,
  MONITOR_BAND_CURRENT_PX,
  MONITOR_BAND_NEXT_PX,
  MONITOR_BAND_CLOCK_TIMER_PX,
} from "../../constants";

function renderBand(
  bandHeightPx: number,
  content: React.ReactNode,
  alignBottom?: boolean,
  contentOpacity?: number
) {
  return (
    <div
      className="flex justify-center overflow-hidden shrink-0"
      style={{ height: bandHeightPx, ...(alignBottom && { alignItems: "flex-end" }) }}
    >
      <div
        className="w-full h-full relative"
        style={contentOpacity !== undefined ? { opacity: contentOpacity } : undefined}
      >
        {content}
      </div>
    </div>
  );
}

type MonitorViewProps = {
  boxes: Box[];
  prevBoxes: Box[];
  nextBoxes?: Box[];
  prevNextBoxes?: Box[];
  /** Bible next-slide: box at index 2 (reference) rendered in clock/timer band */
  bibleInfoBox?: Box | null;
  showNextSlide?: boolean;
  showBackground: boolean;
  shouldAnimate: boolean;
  effectiveWidth: number;
  time?: number;
  timerInfo?: TimerInfo;
  prevTimerInfo?: TimerInfo;
  activeVideoUrl?: string;
  resolvedVideoUrl?: string;
  isWindowVideoLoaded?: boolean;
  videoBox?: Box;
  scaleFactor: number;
  effectiveShowClock: boolean;
  effectiveShowTimer: boolean;
  clockFontSize: number;
  timerFontSize: number;
  onVideoLoaded?: () => void;
  onVideoError?: () => void;
  /** 'next' = slide up, 'prev' = slide down, 'jump' = fade. Defaults to 'next' when undefined. */
  transitionDirection?: "next" | "prev" | "jump";
};

const MonitorView = ({
  boxes,
  prevBoxes = [],
  nextBoxes = [],
  prevNextBoxes = [],
  bibleInfoBox,
  showNextSlide = false,
  showBackground,
  shouldAnimate,
  effectiveWidth,
  time,
  timerInfo,
  prevTimerInfo,
  activeVideoUrl,
  resolvedVideoUrl,
  isWindowVideoLoaded,
  videoBox,
  scaleFactor,
  effectiveShowClock,
  effectiveShowTimer,
  clockFontSize,
  timerFontSize,
  onVideoLoaded,
  onVideoError,
  transitionDirection = "next",
}: MonitorViewProps) => {
  const useNextSlideLayout = showNextSlide && nextBoxes.length > 0;

  const renderCurrentBand = () => (
    <>
      {prevBoxes.map((box, i) => (
        <MonitorDisplayBox
          key={`prev-${box.id}`}
          box={box}
          prevBox={boxes[i]}
          shouldAnimate={shouldAnimate}
          isPrev
          transitionDirection={transitionDirection}
        />
      ))}
      {boxes.map((box, i) => (
        <MonitorDisplayBox
          key={box.id}
          box={box}
          prevBox={prevBoxes[i]}
          shouldAnimate={shouldAnimate}
          transitionDirection={transitionDirection}
        />
      ))}
    </>
  );

  const renderNextBand = () => (
    <>
      {prevNextBoxes.map((box, i) => (
        <MonitorDisplayBox
          key={`prev-next-${box.id}`}
          box={box}
          prevBox={nextBoxes[i]}
          shouldAnimate={shouldAnimate}
          isPrev
          transitionDirection={transitionDirection}
        />
      ))}
      {nextBoxes.map((box, i) => (
        <MonitorDisplayBox
          key={box.id}
          box={box}
          prevBox={prevNextBoxes[i]}
          shouldAnimate={shouldAnimate}
          transitionDirection={transitionDirection}
        />
      ))}
    </>
  );

  const clockTimerBand = (
    <div
      className="flex items-center gap-1 w-full z-10 bg-black relative bottom-[8px]"
      style={{
        height: MONITOR_BAND_CLOCK_TIMER_PX,
      }}
    >
      <div className="flex flex-1 justify-start items-center min-w-0 h-full">
        {effectiveShowClock && (
          <DisplayClock
            fontSize={clockFontSize}
          />
        )}
      </div>
      <div className="flex flex-2 justify-center items-center min-w-0 overflow-hidden text-center h-full">
        {bibleInfoBox && (
          <div
            className="w-full overflow-hidden text-center whitespace-pre-line leading-tight"
            style={{
              fontSize: 70,
              color: bibleInfoBox.fontColor,
              textAlign: bibleInfoBox.align || "center",
              fontWeight: bibleInfoBox.isBold ? "bold" : "normal",
              fontStyle: bibleInfoBox.isItalic ? "italic" : "normal",
            }}
          >
            {(bibleInfoBox.words ?? "").includes("\u200B") ? (
              <VerseDisplay
                words={(bibleInfoBox.words ?? "").trim().replace(/\n{2,}/g, "\n")}
                className="text-gray-400"
              />
            ) : (
              (bibleInfoBox.words ?? "").trim().replace(/\n{2,}/g, "\n")
            )}
          </div>
        )}
      </div>
      <div className="flex flex-1 justify-end items-center min-w-0 h-full">
        {effectiveShowTimer && (
          <DisplayTimer
            currentTimerInfo={timerInfo}
            fontSize={timerFontSize}
          />
        )}
      </div>
    </div>
  );

  if (useNextSlideLayout) {
    return (
      <div
        key="monitor-next-slide-layout"
        className="bg-black w-full h-full flex flex-col px-4"
      >
        {renderBand(
          MONITOR_BAND_CURRENT_PX,
          renderCurrentBand()
        )}

        <div
          className="shrink-0 bg-gray-600 h-2 w-full"
          aria-hidden
        />

        <div
          className="relative shrink-0 w-full"
          style={{ height: MONITOR_BAND_NEXT_PX }}
        >
          {renderBand(
            MONITOR_BAND_NEXT_PX,
            renderNextBand(),
            false,
            0.75
          )}
          <div
            className="absolute bottom-[-4px] left-0 right-0 pointer-events-none"
            style={{
              height: 64,
              background: "linear-gradient(to bottom, transparent, #000)",
            }}
          />
        </div>

        {clockTimerBand}
      </div>
    );
  }

  const showClockTimer = effectiveShowClock || effectiveShowTimer;
  const contentHeightPx = showClockTimer
    ? REFERENCE_HEIGHT - MONITOR_BAND_CLOCK_TIMER_PX
    : REFERENCE_HEIGHT;

  // Single-slide: use DisplayBox (reference 1080p) scaled to fit content area
  const singleSlideScale = contentHeightPx / REFERENCE_HEIGHT;

  return (
    <div
      key="monitor-single-slide-layout"
      className="bg-black w-full flex flex-col px-4"
      style={{
        height: REFERENCE_HEIGHT,
      }}
    >
      <div
        className="w-full flex justify-center overflow-hidden"
        style={{ height: contentHeightPx }}
      >
        <div
          className="relative w-full h-full"
          style={{ transform: `scale(${singleSlideScale})`, transformOrigin: "top center" }}
        >
          {showBackground && activeVideoUrl && resolvedVideoUrl && videoBox && (
            <HLSPlayer
              src={resolvedVideoUrl}
              originalSrc={activeVideoUrl}
              onLoadedData={onVideoLoaded}
              onError={onVideoError}
              videoBox={videoBox}
            />
          )}
          {boxes.map((box, i) => (
            <DisplayBox
              key={`current-${box.id ?? i}`}
              box={box}
              width={effectiveWidth}
              showBackground={showBackground}
              index={i}
              shouldAnimate={shouldAnimate}
              prevBox={prevBoxes[i]}
              time={time}
              timerInfo={timerInfo}
              activeVideoUrl={activeVideoUrl}
              isWindowVideoLoaded={isWindowVideoLoaded}
              referenceWidth={REFERENCE_WIDTH}
              referenceHeight={REFERENCE_HEIGHT}
              scaleFactor={scaleFactor}
            />
          ))}
          {prevBoxes.map((box, i) => (
            <DisplayBox
              key={`prev-${box.id ?? i}`}
              box={box}
              width={effectiveWidth}
              showBackground={showBackground}
              index={i}
              shouldAnimate={shouldAnimate}
              prevBox={boxes[i]}
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
      </div>

      {showClockTimer && clockTimerBand}
    </div>
  );
};

export default MonitorView;
