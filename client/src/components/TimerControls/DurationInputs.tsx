import React from "react";
import Input from "../Input/Input";

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
    <div className={`flex gap-2 ${className}`}>
      <Input
        label="Hours"
        type="number"
        className="flex gap-1 items-center"
        inputWidth="w-12"
        min={0}
        value={Math.floor(duration / 3600)}
        onChange={(val) => {
          const newDuration =
            Number(val) * 3600 +
            Math.floor((duration % 3600) / 60) * 60 +
            (duration % 60);
          onDurationChange(newDuration);
        }}
      />
      <Input
        label="Minutes"
        type="number"
        className="flex gap-1 items-center"
        inputWidth="w-12"
        min={0}
        max={59}
        value={Math.floor((duration % 3600) / 60)}
        onChange={(val) => {
          const newDuration =
            Math.floor(duration / 3600) * 3600 +
            Number(val) * 60 +
            (duration % 60);
          onDurationChange(newDuration);
        }}
      />
      <Input
        label="Seconds"
        type="number"
        className="flex gap-1 items-center"
        inputWidth="w-12"
        min={0}
        max={59}
        value={duration % 60}
        onChange={(val) => {
          const newDuration =
            Math.floor(duration / 3600) * 3600 +
            Math.floor((duration % 3600) / 60) * 60 +
            Number(val);
          onDurationChange(newDuration);
        }}
      />
    </div>
  );
};

export default DurationInputs;
