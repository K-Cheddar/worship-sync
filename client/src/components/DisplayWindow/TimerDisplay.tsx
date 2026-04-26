import type { ReactNode } from "react";
import { useSelector } from "react-redux";
import { TimerInfo } from "../../types";
import { RootState } from "../../store/store";

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
    state.timers.timers.find((t) => t.id === timerInfo?.id)
  );

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
