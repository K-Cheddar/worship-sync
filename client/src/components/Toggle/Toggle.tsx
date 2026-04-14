import { useId, ReactNode } from "react";
import { Switch } from "@/components/ui/Switch";
import { cn } from "@/utils/cnHelper";
import { LucideIcon } from "lucide-react";

type ToggleProps = {
  label?: string | ReactNode;
  value: boolean;
  onChange: (value: boolean) => void;
  className?: string;
  /** Merged onto the text label when `label` is set (e.g. `text-xs`). */
  labelClassName?: string;
  id?: string;
  color?: string;
  icon?: LucideIcon;
};

const Toggle = ({
  label,
  value,
  onChange,
  className,
  labelClassName,
  id: idProp,
  color,
  icon: Icon,
}: ToggleProps) => {
  const generatedId = useId();
  const id = idProp || generatedId;
  return (
    <div
      className={cn(
        "group/toggle relative flex cursor-pointer items-center gap-1",
        className
      )}
    >
      {label && (
        <label
          className={cn(
            "cursor-pointer text-sm font-semibold transition-colors duration-150 ease-out group-hover/toggle:text-white",
            labelClassName
          )}
          htmlFor={id}
        >
          {typeof label === "string" ? `${label}:` : label}
        </label>
      )}
      <Switch
        checked={value}
        onCheckedChange={onChange}
        id={id}
        color={color}
        icon={Icon && <Icon className="w-3 h-3 text-gray-700 dark:text-gray-300" />}
      />
    </div>
  );
};

export default Toggle;
