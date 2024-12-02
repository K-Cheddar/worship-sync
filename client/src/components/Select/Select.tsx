import { ComponentPropsWithoutRef } from "react";
import { Option } from "../../types";
import "./Select.scss";
import cn from "classnames";

type SelectProps = {
  options: Option[];
  className?: string;
  value: string;
  onChange: (value: string) => void;
  label?: string;
  labelProps?: ComponentPropsWithoutRef<"label">;
  hideLabel?: boolean;
};

const Select = ({
  options,
  value,
  onChange,
  label,
  labelProps,
  hideLabel = false,
  className,
  ...rest
}: SelectProps) => {
  const { className: labelClassName, ...labelRest } = labelProps || {};

  return (
    <span className={className}>
      {label && (
        <label
          className={cn(
            "p-1 font-semibold",
            labelProps?.className,
            hideLabel && "sr-only"
          )}
          {...labelRest}
        >
          {label}:
        </label>
      )}
      <select
        className="rounded px-2 py-1 cursor-pointer select text-black"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      >
        {options.map((option) => (
          <option
            className="hover:bg-green-100"
            key={option.value}
            value={option.value}
          >
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
};

export default Select;
