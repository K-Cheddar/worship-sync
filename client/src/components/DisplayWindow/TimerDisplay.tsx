import { useSelector } from "react-redux";
import { TimerInfo } from "../../types";
import { RootState } from "../../store/store";

interface TimerDisplayProps {
  timerInfo?: TimerInfo;
  words: string;
}

export const formatTime = (
  seconds: number,
  showMinutesOnly?: boolean,
  separateSections = false,
) => {
  const hours = Math.floor(seconds / 3600)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((seconds % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const secs = (seconds % 60).toString().padStart(2, "0");

  if (showMinutesOnly) {
    const totalMinutes = Math.floor(seconds / 60);
    return totalMinutes.toString();
  }

  if (hours === "00" && separateSections) {
    return (
      <>
        <span className="inline-block">{minutes}</span>
        <span className="inline-block">:{secs}</span>
      </>
    );
  }

  if (hours === "00") {
    return [minutes, secs].join(":");
  }

  if (separateSections) {
    return (
      <>
        <span className="inline-block">{hours}</span>
        <span className="inline-block">:{minutes}</span>
        <span className="inline-block">:{secs}</span>
      </>
    );
  }

  return [hours, minutes, secs].join(":");
};

const TimerDisplay = ({ timerInfo, words }: TimerDisplayProps) => {
  const timer = useSelector((state: RootState) =>
    state.timers.timers.find((t) => t.id === timerInfo?.id),
  );

  if (!timerInfo) return <>{words.replace("{{timer}}", "")}</>;

  const parts = words.split("{{timer}}");

  const formatTime12Hour = (timeString: string) => {
    const [hours, minutes] = timeString.split(":");
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? "PM" : "AM";
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

  const getDisplayTime = () => {
    if (timerInfo.timerType === "countdown" && timerInfo.status === "stopped") {
      return formatTime12Hour(timerInfo.countdownTime || "00:00");
    }
    return formatTime(timer?.remainingTime || 0, timerInfo.showMinutesOnly);
  };

  return (
    <>
      {parts.map((part, index) => (
        <span key={index}>
          {part}
          {index < parts.length - 1 && (
            <span
              className="inline-flex flex-wrap"
              style={{ color: timer?.color }}
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
