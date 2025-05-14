import React from "react";
import Button from "../Button/Button";
import { ReactComponent as PlaySVG } from "../../assets/icons/play.svg";
import { ReactComponent as PauseSVG } from "../../assets/icons/pause.svg";
import { ReactComponent as StopSVG } from "../../assets/icons/stop.svg";
import { TimerStatus } from "../../types";

interface TimerControlButtonsProps {
  status: TimerStatus;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  className?: string;
}

const TimerControlButtons: React.FC<TimerControlButtonsProps> = ({
  status,
  onPlay,
  onPause,
  onStop,
  className = "",
}) => {
  return (
    <div className={`flex gap-2 items-center px-2 ${className}`}>
      <Button
        variant="tertiary"
        svg={PlaySVG}
        onClick={onPlay}
        disabled={status === "running"}
        title="Play"
        color="#48bb78"
        className="timer-control-btn play"
      />
      <Button
        variant="tertiary"
        svg={PauseSVG}
        onClick={onPause}
        disabled={status !== "running"}
        title="Pause"
        color="#ecc94b"
        className="timer-control-btn pause"
      />
      <Button
        variant="tertiary"
        svg={StopSVG}
        onClick={onStop}
        disabled={status === "stopped"}
        title="Stop"
        color="#f56565"
        className="timer-control-btn stop"
      />
    </div>
  );
};

export default TimerControlButtons;
