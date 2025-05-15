import { useSelector } from "react-redux";
import { TimerInfo } from "../../types";
import { RootState } from "../../store/store";

interface TimerDisplayProps {
  timerInfo?: TimerInfo;
  words: string;
}

const TimerDisplay = ({ timerInfo, words }: TimerDisplayProps) => {
  const timer = useSelector((state: RootState) =>
    state.timers.timers.find((t) => t.id === timerInfo?.id)
  );

  if (!timerInfo) return <>{words.replace("{{timer}}", "")}</>;

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours === 0) {
      return [
        minutes.toString().padStart(2, "0"),
        secs.toString().padStart(2, "0"),
      ].join(":");
    }

    return [
      hours.toString().padStart(2, "0"),
      minutes.toString().padStart(2, "0"),
      secs.toString().padStart(2, "0"),
    ].join(":");
  };

  const formatTime12Hour = (timeString: string) => {
    const [hours, minutes] = timeString.split(":");
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? "PM" : "AM";
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

  const getDisplayTime = () => {
    if (timerInfo.timerType === "countdown" && timerInfo.status !== "running") {
      return formatTime12Hour(timerInfo.countdownTime || "00:00");
    }
    return formatTime(timer?.remainingTime || 0);
  };

  const parts = words.split("{{timer}}");

  return (
    <>
      {parts.map((part, index) => (
        <span key={index}>
          {part}
          {index < parts.length - 1 && (
            <span className="inline-block">{getDisplayTime()}</span>
          )}
        </span>
      ))}
    </>
  );
};

export default TimerDisplay;
