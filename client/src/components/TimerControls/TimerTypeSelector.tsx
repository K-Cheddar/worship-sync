import React from "react";
import RadioButton, { RadioGroup } from "../RadioButton/RadioButton";

interface TimerTypeSelectorProps {
  timerType: "timer" | "countdown";
  onTypeChange: (type: "timer" | "countdown") => void;
  className?: string;
  disabled?: boolean;
}

const TimerTypeSelector: React.FC<TimerTypeSelectorProps> = ({
  timerType,
  onTypeChange,
  className = "",
  disabled = false,
}) => {
  return (
    <RadioGroup
      value={timerType}
      onValueChange={(v) => onTypeChange(v as "timer" | "countdown")}
      className={`flex gap-4 items-center border-b-2 pt-2 pb-4 border-gray-600 w-full justify-center ${className}`}
    >
      <RadioButton optionValue="timer" label="Timer" disabled={disabled} />
      <RadioButton
        optionValue="countdown"
        label="Countdown"
        disabled={disabled}
      />
    </RadioGroup>
  );
};

export default TimerTypeSelector;
