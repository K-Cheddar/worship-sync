import { useId, ReactNode } from "react";
import { Switch } from "../ui/Switch";
import { cn } from "../../utils/cnHelper";
import { LucideIcon } from "lucide-react";

type ToggleProps = {
  label?: string | ReactNode;
  value: boolean;
  onChange: (value: boolean) => void;
  className?: string;
  id?: string;
  color?: string;
  icon?: LucideIcon;
};

const Toggle = ({
  label,
  value,
  onChange,
  className,
  id: idProp,
  color,
  icon: Icon,
}: ToggleProps) => {
  const generatedId = useId();
  const id = idProp || generatedId;
  return (
    <div
      className={cn(
        "flex gap-1 relative items-center cursor-pointer",
        className
      )}
    >
      {label && (
        <label className="text-sm font-semibold cursor-pointer" htmlFor={id}>
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
