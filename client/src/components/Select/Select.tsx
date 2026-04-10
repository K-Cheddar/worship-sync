import { Option } from "../../types";
import cn from "classnames";
import { useId } from "react";
import {
  Select as RadixSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";

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
  /** Skip Radix focus restore to the trigger when the menu closes. */
  suppressCloseAutoFocus?: boolean;
  /** Extra classes for the dropdown panel (for example max height). */
  contentClassName?: string;
  /** Controlled open state (forwarded to Radix Select root). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
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
  textColor = "text-neutral-100",
  backgroundColor = "bg-neutral-900",
  chevronColor,
  contentBackgroundColor,
  contentTextColor,
  disabled = false,
  id: idProp,
  suppressCloseAutoFocus = false,
  contentClassName,
  open,
  onOpenChange,
  ...rest
}: SelectProps) => {
  const generatedId = useId();
  const id = idProp || generatedId;

  // Check if value exists in options, if not use undefined to show placeholder
  const valueExists = options.some((option) => option.value === value);
  const selectValue = valueExists ? value : undefined;

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
        value={selectValue}
        onValueChange={onChange}
        disabled={disabled}
        open={open}
        onOpenChange={onOpenChange}
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
          className={contentClassName}
          contentBackgroundColor={contentBackgroundColor}
          contentTextColor={contentTextColor}
          onCloseAutoFocus={
            suppressCloseAutoFocus ? (e) => e.preventDefault() : undefined
          }
        >
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.className ? (
                <span className={option.className}>{option.label}</span>
              ) : (
                option.label
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </RadixSelect>
    </div>
  );
};

export default Select;
