import React from "react";
import { OverlayFormatting } from "../../types";
import Input from "../Input/Input";
import Select from "../Select/Select";

type HeightWidthType = "fit-content" | "percent" | "auto" | "unset" | "number";

interface WidthHeightFieldProps {
  label: string;
  labelKey?: string;
  value: HeightWidthType;
  onChange: (value: HeightWidthType) => void;
  formatting?: OverlayFormatting;
}

const WidthHeightField: React.FC<WidthHeightFieldProps> = ({
  label,
  labelKey,
  value,
  onChange,
  formatting,
}) => {
  const [type, setType] = React.useState<HeightWidthType>(value);

  const handleTypeChange = (newType: HeightWidthType) => {
    setType(newType);
    onChange(newType);
  };

  const handleValueChange = (newValue: string | number) => {
    onChange(newValue as HeightWidthType);
  };

  return (
    <div>
      <label className="block text-sm font-medium text-white mb-1">
        {labelKey && formatting
          ? `${formatting[labelKey as keyof OverlayFormatting] as string} ${label}`
          : label}
        :
      </label>
      <div className="flex gap-4">
        <Select
          hideLabel
          value={type}
          onChange={(value) => handleTypeChange(value as HeightWidthType)}
          options={[
            { label: "Fit Content", value: "fit-content" },
            { label: "Percent", value: "percent" },
            { label: "Auto", value: "auto" },
            { label: "Unset", value: "unset" },
          ]}
          className="w-28"
        />
        {type === "percent" && (
          <Input
            hideLabel
            type="number"
            value={typeof value === "number" ? value : 0}
            onChange={(value) => handleValueChange(value as HeightWidthType)}
            placeholder="0"
            endAdornment={<div className="text-gray-500 text-sm">%</div>}
            min={0}
            max={100}
            step={0.5}
            className="w-28"
          />
        )}
      </div>
    </div>
  );
};

export default WidthHeightField;
