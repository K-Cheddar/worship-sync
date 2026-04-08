import React from "react";
import RadioButton from "../RadioButton/RadioButton";

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
    <div className={`flex gap-4 items-center border-b-2 pt-2 pb-4 border-gray-600 w-full justify-center ${className}`}>
      <RadioButton
        label="Timer"
        value={timerType === "timer"}
        onChange={() => onTypeChange("timer")}
        disabled={disabled}
      />
      <RadioButton
        label="Countdown"
        value={timerType === "countdown"}
        onChange={() => onTypeChange("countdown")}
        disabled={disabled}
      />
    </div>
  );
};

export default TimerTypeSelector;
