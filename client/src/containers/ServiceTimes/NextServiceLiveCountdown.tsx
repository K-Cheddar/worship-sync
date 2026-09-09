import type { ServiceTime } from "../../types";
import ServiceTimeCountdownFace, {
  serviceTimeNextServicePanelFaceLayoutProps,
} from "./ServiceTimeCountdownFace";
import NextServiceCountdown from "../../components/NextServiceCountdownText/NextServiceCountdown";

type Props = {
  service: ServiceTime;
  targetIso: string | null;
};

/**
 * Live next-service countdown in Service Times.
 * Owns countdown state so the Service Times page does not re-render every second.
 * Uses clamped container-relative type so the pill stays legible in narrow panels.
 */
const NextServiceLiveCountdown = ({ service, targetIso }: Props) => (
  <NextServiceCountdown targetIso={targetIso}>
    {(timeText) => (
      <div className="@container flex w-full max-w-full justify-center">
        <ServiceTimeCountdownFace
          {...serviceTimeNextServicePanelFaceLayoutProps}
          service={service}
          timeText={timeText}
          timeDisplay="livePulseAtZero"
          extraSurfaceStyle={{ maxWidth: "100%" }}
        />
      </div>
    )}
  </NextServiceCountdown>
);

export default NextServiceLiveCountdown;
