import React from "react";
import { OverlayFormatting } from "../../types";
import Input from "../Input/Input";
import Select from "../Select/Select";

export type MeasurementType =
  | "fit-content"
  | "percent"
  | "auto"
  | "unset"
  | "number";

interface MeasurementFieldProps {
  label: string;
  labelKey?: string;
  value: MeasurementType;
  onChange: (value: MeasurementType) => void;
  formatting?: OverlayFormatting;
  property?: "dimension" | "spacing";
}

const MeasurementField: React.FC<MeasurementFieldProps> = ({
  label,
  labelKey,
  value,
  onChange,
  formatting,
  property = "dimension",
}) => {
  const [type, setType] = React.useState<MeasurementType>(() => {
    if (typeof value === "number") {
      return "percent";
    } else {
      return value;
    }
  });

  const handleTypeChange = (newType: MeasurementType) => {
    setType(newType);
    onChange(newType);
  };

  const handleValueChange = (newValue: string | number) => {
    onChange(newValue as MeasurementType);
  };

  return (
    <div className="w-full">
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
          onChange={(value) => handleTypeChange(value as MeasurementType)}
          options={[
            { label: "Percent", value: "percent" },
            { label: "Auto", value: "auto" },
            { label: "Unset", value: "unset" },
            ...(property === "dimension"
              ? [{ label: "Fit Content", value: "fit-content" }]
              : []),
          ]}
          className="w-28"
          selectClassName="w-full"
        />
        {type === "percent" && (
          <Input
            hideLabel
            type="number"
            value={typeof value === "number" ? value : 0}
            onChange={(value) => handleValueChange(value as MeasurementType)}
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

export default MeasurementField;
