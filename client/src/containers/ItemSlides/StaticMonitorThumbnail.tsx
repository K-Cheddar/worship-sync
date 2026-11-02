import { memo } from "react";
import type { ItemSlideType, TimerInfo } from "../../types";
import {
  MONITOR_BAND_CLOCK_TIMER_PX,
  MONITOR_BAND_CURRENT_PX,
  MONITOR_BAND_NEXT_PX,
  REFERENCE_HEIGHT,
  REFERENCE_WIDTH,
} from "../../constants";
import type { ResolvedDisplaySettings } from "../../utils/displaySettings";
import DisplayBox from "../../components/DisplayWindow/DisplayBox";
import MonitorBandBackground from "../../components/DisplayWindow/MonitorBandBackground";
import MonitorDisplayBox from "../../components/DisplayWindow/MonitorDisplayBox";
import VerseDisplay from "../../components/DisplayWindow/VerseDisplay";

type StaticMonitorThumbnailProps = {
  slide: ItemSlideType;
  monitorSlide?: ItemSlideType;
  nextSlide?: ItemSlideType;
  itemType: string;
  settings: ResolvedDisplaySettings;
  timerInfo?: TimerInfo;
  scaleFactor: number;
};

// Representative samples keep thumbnail chrome static without per-slide clocks.
const PREVIEW_CLOCK_TIME = new Date(2000, 0, 1, 10, 30).toLocaleTimeString([], {
  hour: "numeric",
  minute: "2-digit",
});
const PREVIEW_TIMER_TIME = "05:00";

const isMonitorNextSlideType = (itemType: string) =>
  itemType === "song" || itemType === "bible" || itemType === "free";

const StaticMonitorThumbnail = ({
  slide,
  monitorSlide = slide,
  nextSlide,
  itemType,
  settings,
  timerInfo,
  scaleFactor,
}: StaticMonitorThumbnailProps) => {
  const showNextSlide =
    isMonitorNextSlideType(itemType) &&
    settings.showNextSlide &&
    Boolean(nextSlide) &&
    slide.boxes.every((box, index) => index === 0 || box.height <= 55);
  const showClockTimer = settings.showClock || settings.showTimer;
  const contentHeight = showClockTimer
    ? REFERENCE_HEIGHT - MONITOR_BAND_CLOCK_TIMER_PX
    : REFERENCE_HEIGHT;
  const singleSlideScale = contentHeight / REFERENCE_HEIGHT;
  const referenceCanvasStyle = {
    width: `${REFERENCE_WIDTH}px`,
    height: `${REFERENCE_HEIGHT}px`,
    transform: `translate(-50%, -50%) scale(${scaleFactor})`,
    transformOrigin: "center center",
    position: "absolute" as const,
    top: "50%",
    left: "50%",
    isolation: "isolate" as const,
  };

  const renderClockTimerBand = () => (
    <div
      className="flex items-center gap-1 w-full z-10 bg-black relative bottom-[8px]"
      style={{ height: MONITOR_BAND_CLOCK_TIMER_PX }}
      data-testid="monitor-preview-clock-timer-band"
    >
      <div className="flex flex-1 justify-start items-center min-w-0 h-full">
        {settings.showClock && (
          <span
            className="text-white whitespace-nowrap tabular-nums"
            style={{ fontSize: `${settings.clockFontSize}px` }}
            data-testid="monitor-preview-clock"
          >
            {PREVIEW_CLOCK_TIME}
          </span>
        )}
      </div>
      <div className="flex flex-2 justify-center items-center min-w-0 overflow-hidden text-center h-full">
        {itemType === "bible" && monitorSlide.boxes[2] && (
          <div
            className="w-full overflow-hidden text-center whitespace-pre-line leading-tight"
            style={{
              fontSize: 70,
              color: monitorSlide.boxes[2].fontColor,
              textAlign: monitorSlide.boxes[2].align || "center",
              fontWeight: monitorSlide.boxes[2].isBold ? "bold" : "normal",
              fontStyle: monitorSlide.boxes[2].isItalic ? "italic" : "normal",
            }}
          >
            {(monitorSlide.boxes[2].words ?? "").includes("\u200B") ? (
              <VerseDisplay
                words={(monitorSlide.boxes[2].words ?? "")
                  .trim()
                  .replace(/\n{2,}/g, "\n")}
                className="text-gray-400"
              />
            ) : (
              (monitorSlide.boxes[2].words ?? "")
                .trim()
                .replace(/\n{2,}/g, "\n")
            )}
          </div>
        )}
      </div>
      <div className="flex flex-1 justify-end items-center min-w-0 h-full">
        {settings.showTimer && (
          <span
            className="text-white whitespace-nowrap tabular-nums"
            style={{ fontSize: `${settings.timerFontSize}px` }}
            data-testid="monitor-preview-timer"
          >
            {PREVIEW_TIMER_TIME}
          </span>
        )}
      </div>
    </div>
  );

  return (
    <div
      className="relative aspect-video w-full overflow-hidden overflow-anywhere border border-gray-500 text-white bg-black"
      style={{ fontFamily: "Inter, sans-serif" }}
      data-testid="static-slide-thumbnail"
      data-preview-mode="monitor"
    >
      <div
        data-testid="static-slide-reference-canvas"
        style={referenceCanvasStyle}
      >
        {showNextSlide ? (
          <div
            className="relative isolate bg-black w-full h-full flex flex-col px-4"
            data-testid="monitor-preview-next-slide-layout"
          >
            {settings.showBackground && (
              <MonitorBandBackground box={monitorSlide.boxes[0]} />
            )}
            <div
              className="relative z-10 flex justify-center overflow-hidden shrink-0"
              style={{ height: MONITOR_BAND_CURRENT_PX }}
            >
              <div className="w-full h-full relative">
                {(monitorSlide.monitorCurrentBandBoxes ?? monitorSlide.boxes).map(
                  (box, index) => (
                    <MonitorDisplayBox
                      key={box.id || index}
                      box={box}
                      shouldAnimate={false}
                    />
                  ),
                )}
              </div>
            </div>
            <div className="shrink-0 bg-gray-600 h-2 w-full" aria-hidden />
            <div
              className="relative shrink-0 w-full"
              style={{ height: MONITOR_BAND_NEXT_PX }}
            >
              <div
                className="relative z-10 flex justify-center overflow-hidden shrink-0"
                style={{ height: MONITOR_BAND_NEXT_PX }}
              >
                <div
                  className="w-full h-full relative"
                  style={{ opacity: 0.75 }}
                >
                  {(nextSlide?.monitorNextBandBoxes ?? nextSlide?.boxes ?? []).map(
                    (box, index) => (
                      <MonitorDisplayBox
                        key={box.id || index}
                        box={box}
                        shouldAnimate={false}
                      />
                    ),
                  )}
                </div>
              </div>
              <div
                className="absolute bottom-[-4px] left-0 right-0 pointer-events-none"
                style={{
                  height: 64,
                  background: "linear-gradient(to bottom, transparent, #000)",
                }}
              />
            </div>
            {renderClockTimerBand()}
          </div>
        ) : (
          <div
            className="bg-black w-full flex flex-col px-4"
            style={{ height: REFERENCE_HEIGHT }}
            data-testid="monitor-preview-single-slide-layout"
          >
            <div
              className="w-full flex justify-center overflow-hidden"
              style={{ height: contentHeight }}
            >
              <div
                className="relative w-full h-full"
                style={{
                  transform: `scale(${singleSlideScale})`,
                  transformOrigin: "top center",
                }}
              >
                {monitorSlide.boxes.map((box, index) => (
                  <DisplayBox
                    key={box.id || index}
                    box={box}
                    width={100}
                    showBackground={settings.showBackground}
                    index={index}
                    timerInfo={timerInfo}
                  />
                ))}
              </div>
            </div>
            {showClockTimer && renderClockTimerBand()}
          </div>
        )}
      </div>
    </div>
  );
};

export default memo(StaticMonitorThumbnail);
