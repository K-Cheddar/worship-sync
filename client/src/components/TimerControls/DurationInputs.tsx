import React from "react";
import TimePicker from "../TimePicker/TimePicker";
import type { TimePickerLabelLayout } from "../TimePicker/types";

interface DurationInputsProps {
  duration: number;
  onDurationChange: (duration: number) => void;
  className?: string;
  disabled?: boolean;
  labelLayout?: TimePickerLabelLayout;
}

const DurationInputs: React.FC<DurationInputsProps> = ({
  duration,
  onDurationChange,
  className = "",
  disabled = false,
  labelLayout,
}) => {
  return (
    <TimePicker
      value={duration}
      onChange={(val) => onDurationChange(Number(val))}
      variant="timer"
      label="hh:mm:ss"
      disabled={disabled}
      className={className}
      labelLayout={labelLayout}
    />
  );
};

export default DurationInputs;
