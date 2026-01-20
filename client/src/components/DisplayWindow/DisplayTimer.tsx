import { useMemo } from "react";
import { Box, TimerInfo } from "../../types";
import { useSelector } from "../../hooks";
import DisplayBox from "./DisplayBox";
import { formatTime } from "./TimerDisplay";
import { createMonitorDisplayBox } from "./utils";

type DisplayTimerProps = {
  width: number;
  time?: number;
  currentTimerInfo?: TimerInfo;
  fontSize: number;
};

const DisplayTimer = ({
  width,
  time,
  currentTimerInfo,
  fontSize,
}: DisplayTimerProps) => {
  const {
    monitorSettings: { timerId },
  } = useSelector((state) => state.undoable.present.preferences);

  const timer = useSelector((state) =>
    state.timers.timers.find((t) => t.id === timerId)
  );

  // Create timer box for monitor display
  const timerBox: Box | undefined = useMemo(() => {
    if (!timer) return undefined;

    const formatTime12Hour = (timeString: string) => {
      const [hours, minutes] = timeString.split(":");
      const hour = parseInt(hours);
      const ampm = hour >= 12 ? "PM" : "AM";
      const hour12 = hour % 12 || 12;
      return `${hour12}:${minutes} ${ampm}`;
    };

    const getDisplayTime = () => {
      if (timer.timerType === "countdown" && timer.status === "stopped") {
        return formatTime12Hour(timer.countdownTime || "00:00");
      }
      return formatTime(
        timer?.remainingTime || 0,
        timer.showMinutesOnly
      ).toString();
    };

    const timerString = getDisplayTime();

    return createMonitorDisplayBox({
      id: "monitor-timer-box",
      words: timerString,
      x: 59, // Position on the right side
      fontSize,
      fontColor: timer?.color || "#ffffff",
      align: "right",
    });
  }, [timer, fontSize]);

  if (
    !timerBox ||
    currentTimerInfo?.id === timerId ||
    timer?.status === "stopped"
  )
    return null;

  return (
    <DisplayBox
      box={timerBox}
      width={width}
      showBackground={false}
      index={0}
      shouldAnimate={false}
      time={time}
    />
  );
};

export default DisplayTimer;
