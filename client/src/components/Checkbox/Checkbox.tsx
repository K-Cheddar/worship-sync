import { useId, type AriaAttributes, type ReactNode } from "react";
import { Checkbox as UICheckbox } from "@/components/ui/Checkbox";
import Label from "@/components/ui/Label";
import { cn } from "@/utils/cnHelper";

export type CheckboxProps = AriaAttributes & {
  label?: ReactNode;
  checked: boolean | "indeterminate";
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  labelClassName?: string;
  hideLabel?: boolean;
};

const Checkbox = ({
  label,
  checked,
  onCheckedChange,
  disabled,
  id: idProp,
  className,
  labelClassName,
  hideLabel = false,
  ...ariaProps
}: CheckboxProps) => {
  const generatedId = useId();
  const id = idProp || generatedId;

  const control = (
    <UICheckbox
      id={id}
      checked={checked}
      onCheckedChange={(next) => onCheckedChange(next === true)}
      disabled={disabled}
      {...ariaProps}
    />
  );

  if (!label) {
    return <div className={className}>{control}</div>;
  }

  return (
    <Label
      htmlFor={id}
      className={cn(
        "flex min-w-0 items-center gap-2 font-normal text-gray-100 max-md:min-h-[2rem] max-md:gap-3",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
        className,
      )}
    >
      {control}
      <span
        className={cn(
          "min-w-0 flex-1 max-md:flex max-md:min-h-[2rem] max-md:items-center",
          hideLabel && "sr-only",
          disabled && "opacity-50",
          labelClassName,
        )}
      >
        {label}
      </span>
    </Label>
  );
};

export default Checkbox;
