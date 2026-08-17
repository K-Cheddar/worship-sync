import { useMemo } from "react";
import { TimerInfo } from "../../types";
import { useSelector } from "../../hooks";
import { useLiveRemainingSeconds } from "../../hooks/useLiveRemainingSeconds";
import { formatTime } from "./TimerDisplay";
import { isTimerLive } from "../../utils/timerUtils";

type DisplayTimerProps = {
  currentTimerInfo?: TimerInfo;
  fontSize: number;
  /** Timer this display counts down; null/omitted inherits the church default. */
  timerId?: string | null;
};

const DisplayTimer = ({
  currentTimerInfo,
  fontSize,
  timerId: timerIdOverride,
}: DisplayTimerProps) => {
  const churchTimerId = useSelector(
    (state) => state.undoable.present.preferences.monitorSettings.timerId,
  );
  // Per-display timer when the surface knows its display; otherwise the
  // church-wide setting, which previews and editors still use.
  const timerId = timerIdOverride ?? churchTimerId;

  const timer = useSelector((state) =>
    state.timers.timers.find((t) => t.id === timerId),
  );
  const liveRemaining = useLiveRemainingSeconds(timer);

  const displayTime = useMemo(() => {
    if (!timer || liveRemaining === null) return null;
    return formatTime(liveRemaining, timer.showMinutesOnly).toString();
  }, [timer, liveRemaining]);

  // The band is for a timer that is actually counting. A stopped or paused one —
  // or one still flagged running with a long-past endTime — has no live number
  // to contribute, so it stays off rather than resting on a value.
  if (
    !timer ||
    !displayTime ||
    currentTimerInfo?.id === timerId ||
    !isTimerLive(timer)
  )
    return null;
  return (
    <span
      className="whitespace-nowrap tabular-nums"
      style={{
        fontSize: `${fontSize}px`,
        color: timer?.color || "#ffffff",
      }}
    >
      {displayTime}
    </span>
  );
};

export default DisplayTimer;
