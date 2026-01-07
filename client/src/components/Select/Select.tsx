import { Option } from "../../types";
import cn from "classnames";
import { useId } from "react";
import {
  Select as RadixSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/Select";

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
  backgroundColor?: string;
  chevronColor?: string;
  contentBackgroundColor?: string;
  contentTextColor?: string;
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
  backgroundColor = "bg-white",
  chevronColor,
  contentBackgroundColor,
  contentTextColor,
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
      <RadixSelect
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        {...rest}
      >
        <SelectTrigger
          id={id}
          className={cn(backgroundColor, selectClassName, textColor)}
          chevronColor={chevronColor}
        >
          <SelectValue placeholder="Select..." />
        </SelectTrigger>
        <SelectContent
          contentBackgroundColor={contentBackgroundColor}
          contentTextColor={contentTextColor}
        >
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </RadixSelect>
    </div>
  );
};

export default Select;
