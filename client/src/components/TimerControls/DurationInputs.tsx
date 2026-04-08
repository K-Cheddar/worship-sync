import React from "react";
import TimePicker from "../TimePicker/TimePicker";

interface DurationInputsProps {
  duration: number;
  onDurationChange: (duration: number) => void;
  className?: string;
  disabled?: boolean;
}

const DurationInputs: React.FC<DurationInputsProps> = ({
  duration,
  onDurationChange,
  className = "",
  disabled = false,
}) => {
  return (
    <TimePicker
      value={duration}
      onChange={(val) => onDurationChange(Number(val))}
      variant="timer"
      label="hh:mm:ss"
      disabled={disabled}
      className={className}
    />
  );
};

export default DurationInputs;
