import { useMemo } from "react";
import { useSelector } from "../../hooks";
import { getNextServiceTimerId } from "../../constants/nextServiceTimer";
import ServiceTimeCountdownFace from "../../containers/ServiceTimes/ServiceTimeCountdownFace";
import { RootState } from "../../store/store";
import { formatTime } from "../DisplayWindow/TimerDisplay";
import { ServiceTime } from "../../types";

type Props = {
  upcomingService?: ServiceTime | null;
  hostId?: string;
};

const StreamInfo = ({ upcomingService, hostId }: Props) => {
  const timerId = getNextServiceTimerId(hostId);
  const timers = useSelector((state: RootState) => state.timers.timers);

  const timer = useMemo(() => {
    if (!timers?.length) return undefined;
    return timers.find((t) => t.id === timerId);
  }, [timerId, timers]);

  const positionClasses = useMemo(() => {
    const pos = upcomingService?.position ?? "top-right";
    switch (pos) {
      case "top-left":
        return "top-[1%] left-[1%]";
      case "bottom-left":
        return "bottom-[1%] left-[1%]";
      case "bottom-right":
        return "bottom-[1%] right-[1%]";
      case "center":
        return "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2";
      case "top-right":
      default:
        return "top-[1%] right-[1%]";
    }
  }, [upcomingService?.position]);

  if (!timer || !upcomingService) return null;

  const timeText =
    timer.timerType === "countdown" && timer.status === "stopped"
      ? timer.countdownTime || "00:00"
      : formatTime(timer.remainingTime || 0, timer.showMinutesOnly);

  return (
    <div className="fixed inset-0 pointer-events-none background-transparent">
      <div className={`absolute ${positionClasses} transform`}>
        <ServiceTimeCountdownFace
          service={upcomingService}
          timeText={timeText}
          timeDisplay="livePulseAtZero"
          fontSpec="streamFullscreen"
          paddingSpec="streamInfo"
          includeNameTimeGap={false}
          nameClassName="leading-none whitespace-nowrap"
          timeClassName="leading-none tabular-nums"
        />
      </div>
    </div>
  );
};

export default StreamInfo;
