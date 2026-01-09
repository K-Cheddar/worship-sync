import React from "react";
import TimePicker from "../TimePicker/TimePicker";

interface DurationInputsProps {
  duration: number;
  onDurationChange: (duration: number) => void;
  className?: string;
}

const DurationInputs: React.FC<DurationInputsProps> = ({
  duration,
  onDurationChange,
  className = "",
}) => {
  return (
    <TimePicker
      value={duration}
      onChange={(val) => onDurationChange(Number(val))}
      variant="timer"
      label="hh:mm:ss"
    />
  );
};

export default DurationInputs;
