import React from "react";
import Button from "../Button/Button";
import { Play, Pause, Square, RotateCw } from "lucide-react";
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
        svg={Play}
        onClick={onPlay}
        disabled={status === "running"}
        title="Play"
        color="#48bb78"
      />
      <Button
        variant="tertiary"
        svg={Pause}
        onClick={onPause}
        disabled={status !== "running"}
        title="Pause"
        color="#ecc94b"
      />
      <Button
        variant="tertiary"
        svg={Square}
        onClick={onStop}
        disabled={status === "stopped"}
        title="Stop"
        color="#f56565"
      />
      <Button
        variant="tertiary"
        title="Reset"
        svg={RotateCw}
        onClick={onStop}
        color="#f59e0b"
      />
    </div>
  );
};

export default TimerControlButtons;
