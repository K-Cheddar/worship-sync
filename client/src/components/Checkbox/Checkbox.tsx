import { useId, type ReactNode } from "react";
import { Checkbox as UICheckbox } from "@/components/ui/Checkbox";
import Label from "@/components/ui/Label";
import { cn } from "@/utils/cnHelper";

export type CheckboxProps = {
  label?: ReactNode;
  checked: boolean;
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
}: CheckboxProps) => {
  const generatedId = useId();
  const id = idProp || generatedId;

  const control = (
    <UICheckbox
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
    />
  );

  if (!label) {
    return <div className={className}>{control}</div>;
  }

  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      {control}
      <Label
        htmlFor={id}
        className={cn(
          "min-w-0 cursor-pointer font-normal text-gray-100",
          hideLabel && "sr-only",
          disabled && "cursor-not-allowed opacity-50",
          labelClassName,
        )}
      >
        {label}
      </Label>
    </div>
  );
};

export default Checkbox;
