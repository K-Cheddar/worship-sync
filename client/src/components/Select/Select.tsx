import { Option } from "../../types";
import "./Select.scss";
import cn from "classnames";

type SelectProps = {
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
  ...rest
}: SelectProps) => {
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
        >
          {label}:
        </label>
      )}
      <select
        className={cn(`select`, selectClassName, textColor)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
        disabled={disabled}
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
