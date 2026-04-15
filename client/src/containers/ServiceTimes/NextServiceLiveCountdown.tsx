import { useMemo } from "react";
import { useSelector } from "../../hooks";
import { getNextServiceTimerId } from "../../constants/nextServiceTimer";
import { formatTime } from "../../components/DisplayWindow/TimerDisplay";
import type { RootState } from "../../store/store";
import type { ServiceTime } from "../../types";
import ServiceTimeCountdownFace from "./ServiceTimeCountdownFace";

type Props = {
  service: ServiceTime;
  hostId?: string;
};

/**
 * Live next-service countdown for the info controller, using the same Redux timer as stream-info.
 */
const NextServiceLiveCountdown = ({ service, hostId }: Props) => {
  const timerId = getNextServiceTimerId(hostId);
  const timer = useSelector((s: RootState) =>
    s.timers.timers.find((t) => t.id === timerId)
  );

  const display = useMemo(() => {
    if (!timer) return null;
    if (timer.timerType === "countdown" && timer.status === "stopped") {
      return timer.countdownTime || "00:00";
    }
    return formatTime(timer.remainingTime || 0, timer.showMinutesOnly);
  }, [timer]);

  if (!display) {
    return null;
  }

  return (
    <div className="inline-block w-max shrink-0 self-start">
      <ServiceTimeCountdownFace
        service={service}
        timeText={display}
        timeDisplay="livePulseAtZero"
        fontSpec="preview"
        paddingSpec="infoPanel"
        nameClassName="whitespace-nowrap leading-none"
      />
    </div>
  );
};

export default NextServiceLiveCountdown;
