import React from "react";
import { OverlayFormatting } from "../../types";
import Input, { InputProps } from "../Input/Input";

// Extend InputProps with StyleEditor-specific fields
interface InputFieldProps extends InputProps {
  labelKey?: string;
  formatting?: OverlayFormatting;
}

const InputField: React.FC<InputFieldProps> = ({
  label,
  labelKey,
  value,
  type = "text",
  formatting,
  ...rest
}) => (
  <Input
    label={
      labelKey && formatting
        ? `${formatting[labelKey as keyof OverlayFormatting] as string} ${label}`
        : label
    }
    type={type}
    value={value || ""}
    className="w-28"
    {...rest}
  />
);

export default InputField;
