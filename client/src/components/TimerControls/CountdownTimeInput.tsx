import React from "react";
import TimePicker from "../TimePicker/TimePicker";

interface CountdownTimeInputProps {
  countdownTime: string;
  onTimeChange: (time: string) => void;
  className?: string;
  disabled?: boolean;
}

const CountdownTimeInput: React.FC<CountdownTimeInputProps> = ({
  countdownTime,
  onTimeChange,
  className = "",
  disabled = false,
}) => {
  return (
    <TimePicker
      label="Countdown To"
      value={countdownTime}
      onChange={(val) => onTimeChange(val as string)}
      disabled={disabled}
      className={className}
    />
  );
};

export default CountdownTimeInput;
