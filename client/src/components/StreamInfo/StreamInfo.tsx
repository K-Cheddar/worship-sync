import { useMemo } from "react";
import { useSelector } from "../../hooks";
import { RootState } from "../../store/store";
import { formatTime } from "../DisplayWindow/TimerDisplay";
import { ServiceTime } from "../../types";

type Props = {
  upcomingService?: ServiceTime | null;
};

const StreamInfo = ({ upcomingService }: Props) => {
  const timers = useSelector((state: RootState) => state.timers.timers);

  const timer = useMemo(() => {
    if (!timers?.length) return undefined;
    const nextServiceTimer = timers.find((t) => t.id === "next-service");
    return nextServiceTimer;
  }, [timers]);

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

  if (!timer) return null;

  const nameFontsize = (upcomingService?.nameFontSize ?? 12) / 10;
  const timeFontSize = (upcomingService?.timeFontSize ?? 35) / 10;
  const shouldShowName = upcomingService?.shouldShowName ?? true;

  return (
    <div className="fixed inset-0 pointer-events-none background-transparent">
      <div
        className={`absolute ${positionClasses} transform px-[1%] py-[0.5%] rounded-[5%_/_10%] font-semibold select-none flex flex-col items-center justify-center`}
        style={{
          color: upcomingService?.color || undefined,
          backgroundColor: upcomingService?.background || undefined,
        }}
      >
        {shouldShowName && (
          <div style={{ fontSize: `${nameFontsize}vw` }}>
            {upcomingService?.name} begins in
          </div>
        )}
        <div className="leading-none" style={{ fontSize: `${timeFontSize}vw` }}>
          {timer.timerType === "countdown" && timer.status === "stopped"
            ? timer.countdownTime || "00:00"
            : formatTime(timer.remainingTime || 0, timer.showMinutesOnly)}
        </div>
      </div>
    </div>
  );
};

export default StreamInfo;
