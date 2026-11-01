import React from "react";
import TimePicker from "../TimePicker/TimePicker";
import type { TimePickerLabelLayout } from "../TimePicker/types";

interface CountdownTimeInputProps {
  countdownTime: string;
  onTimeChange: (time: string) => void;
  className?: string;
  disabled?: boolean;
  labelLayout?: TimePickerLabelLayout;
}

const CountdownTimeInput: React.FC<CountdownTimeInputProps> = ({
  countdownTime,
  onTimeChange,
  className = "",
  disabled = false,
  labelLayout,
}) => {
  return (
    <TimePicker
      label="Countdown To"
      value={countdownTime}
      onChange={(val) => onTimeChange(val as string)}
      disabled={disabled}
      className={className}
      labelLayout={labelLayout}
    />
  );
};

export default CountdownTimeInput;
