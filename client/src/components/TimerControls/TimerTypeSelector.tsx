import React from "react";
import RadioButton from "../RadioButton/RadioButton";

interface TimerTypeSelectorProps {
  timerType: "timer" | "countdown";
  onTypeChange: (type: "timer" | "countdown") => void;
  className?: string;
}

const TimerTypeSelector: React.FC<TimerTypeSelectorProps> = ({
  timerType,
  onTypeChange,
  className = "",
}) => {
  return (
    <div className={`flex gap-4 items-center ${className}`}>
      <RadioButton
        label="Timer"
        value={timerType === "timer"}
        onChange={() => onTypeChange("timer")}
      />
      <RadioButton
        label="Countdown"
        value={timerType === "countdown"}
        onChange={() => onTypeChange("countdown")}
      />
    </div>
  );
};

export default TimerTypeSelector;
