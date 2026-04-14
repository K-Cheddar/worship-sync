import { CircleCheck, Circle } from "lucide-react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import Icon from "../Icon/Icon";
import { cn } from "@/utils/cnHelper";
import { useId, type HTMLAttributes } from "react";

export { RadioGroup } from "@/components/ui/RadioGroup";

export type RadioButtonProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "onChange"
> & {
  /** Unique value for this option within the surrounding `RadioGroup`. */
  optionValue: string;
  label: string;
  className?: string;
  textSize?: string;
  labelClassName?: string;
  disabled?: boolean;
  id?: string;
};

const RadioButton = ({
  optionValue,
  label,
  className = "",
  textSize = "text-sm",
  labelClassName = "",
  disabled = false,
  id: idProp,
  ...rest
}: RadioButtonProps) => {
  const generatedId = useId();
  const itemId = idProp || generatedId;

  return (
    <div
      className={cn(
        "group/radio-row relative inline-flex min-w-0 max-w-full items-center gap-3 md:gap-2",
        textSize,
        className,
        disabled && "opacity-50"
      )}
      {...rest}
    >
      <label
        className={cn(
          "min-w-0 flex-1 font-semibold leading-snug transition-colors duration-150 ease-out",
          !disabled &&
            "cursor-pointer group-hover/radio-row:text-white",
          disabled && "cursor-not-allowed",
          labelClassName
        )}
        htmlFor={itemId}
      >
        {label}:
      </label>
      <RadioGroupPrimitive.Item
        value={optionValue}
        disabled={disabled}
        id={itemId}
        className={cn(
          "group relative size-5 shrink-0 rounded-full outline-none",
          "ring-1 ring-inset ring-white/20 transition-[background-color,box-shadow] duration-150 ease-out",
          "enabled:hover:bg-white/15 enabled:hover:ring-white/45",
          "data-[state=checked]:ring-cyan-400/50",
          "enabled:data-[state=checked]:hover:bg-cyan-400/15 enabled:data-[state=checked]:hover:ring-cyan-300/55",
          "focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900",
          disabled ? "cursor-not-allowed" : "cursor-pointer"
        )}
      >
        <Icon
          svg={Circle}
          color="#e5e7eb"
          overrideSmallMobile
          className="pointer-events-none absolute inset-0 group-data-[state=checked]:opacity-0"
        />
        <RadioGroupPrimitive.Indicator className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Icon
            svg={CircleCheck}
            color="#67e8f9"
            overrideSmallMobile
            className="shrink-0"
          />
        </RadioGroupPrimitive.Indicator>
      </RadioGroupPrimitive.Item>
    </div>
  );
};

export default RadioButton;
