import React from "react";
import { OverlayFormatting } from "../../types";
import Select, { SelectProps } from "../Select/Select";

// Extend SelectProps with StyleEditor-specific fields
interface SelectFieldProps extends SelectProps {
  labelKey?: string;
  formatting?: OverlayFormatting;
}

const SelectField: React.FC<SelectFieldProps> = ({
  label,
  labelKey,
  formatting,
  ...rest
}) => (
  <Select
    label={
      labelKey && formatting
        ? `${formatting[labelKey as keyof OverlayFormatting] as string} ${label}`
        : label
    }
    className="w-28"
    selectClassName="w-full"
    {...rest}
  />
);

export default SelectField;
