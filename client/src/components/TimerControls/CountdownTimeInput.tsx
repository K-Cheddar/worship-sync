import React from "react";
import TimePicker from "../TimePicker/TimePicker";

interface CountdownTimeInputProps {
  countdownTime: string;
  onTimeChange: (time: string) => void;
  className?: string;
}

const CountdownTimeInput: React.FC<CountdownTimeInputProps> = ({
  countdownTime,
  onTimeChange,
  className = "",
}) => {
  return (
    <TimePicker
      label="Countdown To"
      value={countdownTime}
      onChange={(val) => onTimeChange(val as string)}
    />
  );
};

export default CountdownTimeInput;
