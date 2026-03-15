import { useMemo } from "react";
import { TimerInfo } from "../../types";
import { useSelector } from "../../hooks";
import { formatTime } from "./TimerDisplay";

type DisplayTimerProps = {
  currentTimerInfo?: TimerInfo;
  fontSize: number;
};

const DisplayTimer = ({
  currentTimerInfo,
  fontSize,
}: DisplayTimerProps) => {
  const {
    monitorSettings: { timerId },
  } = useSelector((state) => state.undoable.present.preferences);

  const timer = useSelector((state) =>
    state.timers.timers.find((t) => t.id === timerId)
  );

  const displayTime = useMemo(() => {
    if (!timer) return null;

    const formatTime12Hour = (timeString: string) => {
      const [hours, minutes] = timeString.split(":");
      const hour = parseInt(hours);
      const ampm = hour >= 12 ? "PM" : "AM";
      const hour12 = hour % 12 || 12;
      return `${hour12}:${minutes} ${ampm}`;
    };

    if (timer.timerType === "countdown" && timer.status === "stopped") {
      return formatTime12Hour(timer.countdownTime || "00:00");
    }
    return formatTime(
      timer?.remainingTime || 0,
      timer.showMinutesOnly
    ).toString();
  }, [timer]);

  if (
    !timer ||
    !displayTime ||
    currentTimerInfo?.id === timerId ||
    timer?.status === "stopped"
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
