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
  hideLabel?: boolean;
  selectClassName?: string;
};

const Select = ({
  options,
  value,
  onChange,
  label,
  hideLabel = false,
  className,
  labelClassName,
  selectClassName,
  ...rest
}: SelectProps) => {
  return (
    <div className={className}>
      {label && (
        <label
          className={cn(
            "p-1 font-semibold",
            hideLabel && "sr-only",
            labelClassName
          )}
        >
          {label}:
        </label>
      )}
      <select
        className={cn(
          `rounded px-2 py-1 cursor-pointer select text-black`,
          selectClassName
        )}
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
    </div>
  );
};

export default Select;
