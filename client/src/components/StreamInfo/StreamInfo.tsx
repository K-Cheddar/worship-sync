import { useMemo } from "react";
import ServiceTimeCountdownFace, {
  serviceTimeStreamInfoFaceLayoutProps,
} from "../../containers/ServiceTimes/ServiceTimeCountdownFace";
import { ServiceTime } from "../../types";

type Props = {
  upcomingService?: ServiceTime | null;
  timeText: string | null;
};

const StreamInfo = ({ upcomingService, timeText }: Props) => {
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

  if (!upcomingService || !timeText) return null;

  return (
    <div className="fixed inset-0 pointer-events-none background-transparent">
      <div className={`absolute ${positionClasses} transform`}>
        <ServiceTimeCountdownFace
          {...serviceTimeStreamInfoFaceLayoutProps}
          service={upcomingService}
          timeText={timeText}
          timeDisplay="livePulseAtZero"
        />
      </div>
    </div>
  );
};

export default StreamInfo;
