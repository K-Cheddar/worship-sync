import type { ServiceTime } from "../../types";
import ServiceTimeCountdownFace, {
  serviceTimeNextServicePanelFaceLayoutProps,
} from "./ServiceTimeCountdownFace";

type Props = {
  service: ServiceTime;
  timeText: string | null;
};

/**
 * Live next-service countdown in Service Times.
 * Uses clamped container-relative type so the pill stays legible in narrow panels.
 */
const NextServiceLiveCountdown = ({ service, timeText }: Props) => {
  if (!timeText) {
    return null;
  }

  return (
    <div className="@container flex w-full max-w-full justify-center">
      <ServiceTimeCountdownFace
        {...serviceTimeNextServicePanelFaceLayoutProps}
        service={service}
        timeText={timeText}
        timeDisplay="livePulseAtZero"
        extraSurfaceStyle={{ maxWidth: "100%" }}
      />
    </div>
  );
};

export default NextServiceLiveCountdown;
