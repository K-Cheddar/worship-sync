import { TimerInfo } from "../../types";
import DisplayClock from "./DisplayClock";
import DisplayTimer from "./DisplayTimer";

type ProjectorClockTimerProps = {
  showClock: boolean;
  showTimer: boolean;
  clockFontSize: number;
  timerFontSize: number;
  timerInfo?: TimerInfo;
};

/**
 * Clock and timer for a projector.
 *
 * The monitor reserves a band and shrinks its content to fit. A projector is
 * full-frame room output, so the same treatment would resize every slide the
 * moment someone flips a toggle. This overlays the bottom corners instead and
 * leaves slide layout alone. The scrim keeps the readout legible over a bright
 * background without dimming the slide itself.
 */
const ProjectorClockTimer = ({
  showClock,
  showTimer,
  clockFontSize,
  timerFontSize,
  timerInfo,
}: ProjectorClockTimerProps) => {
  if (!showClock && !showTimer) return null;

  return (
    <div
      className="absolute inset-x-0 bottom-0 flex items-end justify-between px-8 pb-6 pointer-events-none"
      data-testid="projector-clock-timer"
    >
      <div className="drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
        {showClock && <DisplayClock fontSize={clockFontSize} />}
      </div>
      <div className="drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
        {showTimer && (
          <DisplayTimer
            currentTimerInfo={timerInfo}
            fontSize={timerFontSize}
          />
        )}
      </div>
    </div>
  );
};

export default ProjectorClockTimer;
