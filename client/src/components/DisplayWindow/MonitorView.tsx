import React from "react";
import { Box, TimerInfo, VideoBackgroundPlaybackCue } from "../../types";
import DisplayBox from "./DisplayBox";
import MonitorDisplayBox from "./MonitorDisplayBox";
import MonitorBandBackground from "./MonitorBandBackground";
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
  contentOpacity?: number,
) {
  return (
    <div
      className="relative z-10 flex justify-center overflow-hidden shrink-0"
      style={{
        height: bandHeightPx,
        ...(alignBottom && { alignItems: "flex-end" }),
      }}
    >
      <div
        className="w-full h-full relative"
        style={
          contentOpacity !== undefined ? { opacity: contentOpacity } : undefined
        }
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
  videoMuted?: boolean;
  videoVolume?: number;
  videoPlayback?: VideoBackgroundPlaybackCue;
  /** 'next' = slide up, 'prev' = slide down, 'jump' = fade. Defaults to 'next' when undefined. */
  transitionDirection?: "next" | "prev" | "jump";
  /** Current local/live media behind the monitor's text and chrome. */
  currentMediaLayer?: React.ReactNode;
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
  videoMuted = true,
  videoVolume = 1,
  videoPlayback,
  transitionDirection = "next",
  currentMediaLayer,
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
        {effectiveShowClock && <DisplayClock fontSize={clockFontSize} />}
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
                words={(bibleInfoBox.words ?? "")
                  .trim()
                  .replace(/\n{2,}/g, "\n")}
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
          <DisplayTimer currentTimerInfo={timerInfo} fontSize={timerFontSize} />
        )}
      </div>
    </div>
  );

  if (useNextSlideLayout) {
    return (
      <div
        key="monitor-next-slide-layout"
        className="relative isolate bg-black w-full h-full flex flex-col px-4"
      >
        {showBackground && <MonitorBandBackground box={boxes[0]} />}

        {currentMediaLayer && (
          <div
            className="pointer-events-none absolute inset-0 z-0"
            data-testid="monitor-full-frame-media-layer"
          >
            {currentMediaLayer}
          </div>
        )}

        {renderBand(MONITOR_BAND_CURRENT_PX, renderCurrentBand())}

        <div className="shrink-0 bg-gray-600 h-2 w-full" aria-hidden />

        <div
          className="relative shrink-0 w-full"
          style={{ height: MONITOR_BAND_NEXT_PX }}
        >
          {renderBand(MONITOR_BAND_NEXT_PX, renderNextBand(), false, 0.75)}
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
          style={{
            transform: `scale(${singleSlideScale})`,
            transformOrigin: "top center",
          }}
        >
          {currentMediaLayer}
          {showBackground && activeVideoUrl && resolvedVideoUrl && videoBox && (
            <HLSPlayer
              src={resolvedVideoUrl}
              originalSrc={activeVideoUrl}
              onLoadedData={onVideoLoaded}
              onError={onVideoError}
              videoBox={videoBox}
              muted={videoMuted}
              volume={videoVolume}
              playbackRole="output"
              playback={videoPlayback}
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
