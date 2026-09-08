import { useMemo, type ReactNode } from "react";
import { useSelector } from "react-redux";
import { useLiveRemainingSeconds } from "../../hooks/useLiveRemainingSeconds";
import { TimerInfo } from "../../types";
import type { RootState } from "../../store/store";
import useNextServiceCountdownText from "../../hooks/useNextServiceCountdownText";
import useDisplayedUpcomingService from "../../hooks/useDisplayedUpcomingService";
import useAvailableServiceTimes from "../../hooks/useAvailableServiceTimes";
import { isTimerLive } from "../../utils/timerUtils";
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

const TimerDisplay = ({ timerInfo, words }: TimerDisplayProps) => {
  const timer = useSelector((state: RootState) =>
    state.timers.timers.find((t) => t.id === timerInfo?.id),
  );
  const liveRemaining = useLiveRemainingSeconds(timer ?? timerInfo);
  const { services: availableServices } = useAvailableServiceTimes();
  const upcomingService = useDisplayedUpcomingService(
    availableServices,
    NEXT_SERVICE_UPCOMING_REFRESH_GRACE_MS,
    { keepRecentlyElapsedDuringGrace: true },
  );
  const targetIso = useMemo(() => {
    return upcomingService?.nextAt.toISOString() ?? null;
  }, [upcomingService]);
  const serviceTimeCountdownText = useNextServiceCountdownText(targetIso);

  // Handle {{service-time}} placeholder — renders upcoming service countdown from Redux.
  if (words.includes("{{service-time}}")) {
    const parts = words.split("{{service-time}}");
    return (
      <>
        {parts.map((part, index) => (
          <span key={index}>
            {part}
            {index < parts.length - 1 && (
              <span className="inline-flex flex-wrap whitespace-nowrap tabular-nums">
                {serviceTimeCountdownText ?? "--:--"}
              </span>
            )}
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
    // A countdown that isn't actively counting shows its target time, not a
    // duration. Keyed on `isTimerLive` rather than status, so a timer still
    // marked running with a long-past endTime resolves to the clock time
    // immediately instead of clamping to 0 until tickTimers stops it.
    if (
      resolvedTimer.timerType === "countdown" &&
      !isTimerLive(resolvedTimer)
    ) {
      return formatTime12Hour(resolvedTimer.countdownTime || "00:00");
    }
    // No number yet — timers may still be syncing. Render nothing rather than
    // the 0 that an absent value used to collapse into.
    if (liveRemaining === null) return "";
    return formatTime(liveRemaining, resolvedTimer.showMinutesOnly);
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
