import React from "react";
import Input from "../Input/Input";

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
    <div className={`flex gap-2 ${className}`}>
      <Input
        type="time"
        label="Countdown To"
        className="flex gap-1 items-center"
        labelClassName="w-48"
        value={countdownTime}
        onChange={(val) => onTimeChange(val as string)}
      />
    </div>
  );
};

export default CountdownTimeInput;
