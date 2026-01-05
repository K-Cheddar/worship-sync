import { useId } from "react";
import { Switch } from "../ui/Switch";
import { cn } from "../../utils/cnHelper";

type ToggleProps = {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  className?: string;
  id?: string;
  color?: string;
};

const Toggle = ({
  label,
  value,
  onChange,
  className,
  id: idProp,
  color,
}: ToggleProps) => {
  const generatedId = useId();
  const id = idProp || generatedId;
  return (
    <div
      className={cn(
        "flex gap-1 relative items-center h-4 cursor-pointer",
        className
      )}
    >
      <label className="text-sm font-semibold cursor-pointer" htmlFor={id}>
        {label}:
      </label>
      <Switch
        checked={value}
        onCheckedChange={onChange}
        id={id}
        color={color}
      />
    </div>
  );
};

export default Toggle;
