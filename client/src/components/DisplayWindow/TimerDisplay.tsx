import { useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSelector } from "react-redux";
import { TimerInfo, ServiceTime } from "../../types";
import type { RootState } from "../../store/store";
import useNextServiceCountdownText from "../../hooks/useNextServiceCountdownText";
import useDisplayedUpcomingService from "../../hooks/useDisplayedUpcomingService";
import { GlobalInfoContext } from "../../context/globalInfo";
import { onValue, ref } from "firebase/database";
import { getChurchDataPath } from "../../utils/firebasePaths";
import { NEXT_SERVICE_UPCOMING_REFRESH_GRACE_MS } from "../../constants/nextServiceTimer";

interface TimerDisplayProps {
  timerInfo?: TimerInfo;
  words: string;
}

export function formatTime(
  seconds: number,
  showMinutesOnly?: boolean,
  separateSections?: false,
): string;
export function formatTime(
  seconds: number,
  showMinutesOnly: boolean | undefined,
  separateSections: true,
): ReactNode;
export function formatTime(
  seconds: number,
  showMinutesOnly?: boolean,
  separateSections = false,
): string | ReactNode {
  const totalSec = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const paddedMinutes = minutes.toString().padStart(2, "0");
  const paddedSecs = secs.toString().padStart(2, "0");

  if (showMinutesOnly) {
    const totalMinutes = Math.floor(totalSec / 60);
    return totalMinutes.toString();
  }

  if (hours === 0 && totalSec < 60) {
    const secOnly = String(totalSec);
    if (separateSections) {
      return <span className="inline-block">{secOnly}</span>;
    }
    return secOnly;
  }

  if (hours === 0 && separateSections) {
    return (
      <>
        <span className="inline-block">{minutes}</span>
        <span className="inline-block">:{paddedSecs}</span>
      </>
    );
  }

  if (hours === 0) {
    return [minutes, paddedSecs].join(":");
  }

  if (separateSections) {
    return (
      <>
        <span className="inline-block">{hours}</span>
        <span className="inline-block">:{paddedMinutes}</span>
        <span className="inline-block">:{paddedSecs}</span>
      </>
    );
  }

  return [hours, paddedMinutes, paddedSecs].join(":");
}

/**
 * Renders the countdown to the upcoming service time.
 * Subscribes to Firebase directly so it works on every display surface
 * (monitor, projector, stream) without depending on Redux being populated.
 */
const ServiceTimeCountdown = ({ color }: { color?: string }) => {
  const { firebaseDb, churchId, loginState } = useContext(GlobalInfoContext) || {};
  const [services, setServices] = useState<ServiceTime[]>([]);
  const reduxServices = useSelector(
    (state: RootState | { undoable?: { present?: { serviceTimes?: { list?: ServiceTime[] } } } }) =>
      state.undoable?.present?.serviceTimes?.list ?? [],
  );

  useEffect(() => {
    if (!firebaseDb || loginState === "guest" || !churchId) return;
    const servicesRef = ref(firebaseDb, getChurchDataPath(churchId, "services"));
    const unsubscribe = onValue(servicesRef, (snapshot) => {
      const data = snapshot.val() as ServiceTime[] | null;
      setServices(data ?? []);
    });
    return unsubscribe;
  }, [firebaseDb, churchId, loginState]);

  const activeServices = reduxServices.length > 0 ? reduxServices : services;
  const upcomingService = useDisplayedUpcomingService(
    activeServices,
    NEXT_SERVICE_UPCOMING_REFRESH_GRACE_MS,
  );
  const targetIso = useMemo(() => {
    return upcomingService?.nextAt.toISOString() ?? null;
  }, [upcomingService]);
  const countdownText = useNextServiceCountdownText(targetIso);

  return (
    <span
      className="inline-flex flex-wrap whitespace-nowrap tabular-nums"
      style={color ? { color } : undefined}
    >
      {countdownText ?? "--:--"}
    </span>
  );
};

const TimerDisplay = ({ timerInfo, words }: TimerDisplayProps) => {
  const timer = useSelector((state: RootState) =>
    state.timers.timers.find((t) => t.id === timerInfo?.id)
  );

  // Handle {{service-time}} placeholder — renders upcoming service countdown from Redux.
  if (words.includes("{{service-time}}")) {
    const parts = words.split("{{service-time}}");
    return (
      <>
        {parts.map((part, index) => (
          <span key={index}>
            {part}
            {index < parts.length - 1 && <ServiceTimeCountdown />}
          </span>
        ))}
      </>
    );
  }

  if (!timerInfo) return <>{words.replace("{{timer}}", "")}</>;
  const resolvedTimer = timer || timerInfo;

  const parts = words.split("{{timer}}");

  const formatTime12Hour = (timeString: string) => {
    const [hours, minutes] = timeString.split(":");
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? "PM" : "AM";
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

  const getDisplayTime = () => {
    if (
      resolvedTimer.timerType === "countdown" &&
      resolvedTimer.status === "stopped"
    ) {
      return formatTime12Hour(resolvedTimer.countdownTime || "00:00");
    }
    return formatTime(
      resolvedTimer.remainingTime || 0,
      resolvedTimer.showMinutesOnly
    );
  };

  return (
    <>
      {parts.map((part, index) => (
        <span key={index}>
          {part}
          {index < parts.length - 1 && (
            <span
              className="inline-flex flex-wrap whitespace-nowrap tabular-nums"
              style={{ color: resolvedTimer.color || "#ffffff" }}
            >
              {getDisplayTime()}
            </span>
          )}
        </span>
      ))}
    </>
  );
};

export default TimerDisplay;

// MAY use in future
