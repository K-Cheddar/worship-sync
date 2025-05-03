import { useRef, HTMLProps } from "react";
import { Option } from "../../types";
import "./Select.scss";
import cn from "classnames";
import generateRandomId from "../../utils/generateRandomId";

type SelectProps = Omit<HTMLProps<HTMLSelectElement>, "onChange"> & {
  className?: string;
  value: string | number;
  label?: string;
  textColor?: string;
  hideLabel?: boolean;
  onChange: (value: string) => void;
  labelClassName?: string;
  options: Option[];
  selectClassName?: string;
};

const Select = ({
  className,
  value,
  onChange,
  label,
  hideLabel = false,
  labelClassName,
  options,
  selectClassName,
  textColor = "text-black",
  id,
  ...rest
}: SelectProps) => {
  const selectRef = useRef<HTMLSelectElement>(null);
  const selectId = id || generateRandomId();

  return (
    <div className={cn("select-container", className)}>
      <label
        htmlFor={selectId}
        className={cn(
          "p-1 font-semibold",
          hideLabel && "sr-only",
          labelClassName
        )}
      >
        {label}:
      </label>
      <select
        ref={selectRef}
        id={selectId}
        className={cn(`select`, selectClassName, textColor)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
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
