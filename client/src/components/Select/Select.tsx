import { Option } from "../../types";
import cn from "classnames";
import { useId } from "react";

export type SelectProps = {
  options: Option[];
  className?: string;
  value: string;
  onChange: (value: string) => void;
  label?: string;
  labelClassName?: string;
  labelFontSize?: string;
  hideLabel?: boolean;
  selectClassName?: string;
  textColor?: string;
  disabled?: boolean;
  id?: string;
};

const Select = ({
  options,
  value,
  onChange,
  label,
  hideLabel = false,
  className,
  labelClassName,
  labelFontSize = "text-sm",
  selectClassName,
  textColor = "text-black",
  disabled = false,
  id: idProp,
  ...rest
}: SelectProps) => {
  const generatedId = useId();
  const id = idProp || generatedId;
  return (
    <div className={className}>
      {label && (
        <label
          className={cn(
            "p-1 font-semibold",
            hideLabel && "sr-only",
            labelClassName,
            labelFontSize
          )}
          htmlFor={id}
        >
          {label}:
        </label>
      )}
      <select
        className={cn(
          "rounded px-2 py-0.5 cursor-pointer",
          selectClassName,
          textColor
        )}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
        disabled={disabled}
        id={id}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
};

export default Select;
