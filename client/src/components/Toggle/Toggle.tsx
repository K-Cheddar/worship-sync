import { useId, ReactNode } from "react";
import { Switch } from "@/components/ui/Switch";
import { cn } from "@/utils/cnHelper";
import { LucideIcon } from "lucide-react";

type ToggleProps = {
  label?: string | ReactNode;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  className?: string;
  /** Merged onto the text label when `label` is set (e.g. `text-xs`). */
  labelClassName?: string;
  /** `stacked`: label row then switch (e.g. form grids). Default keeps label and switch on one row. */
  layout?: "inline" | "stacked";
  id?: string;
  color?: string;
  icon?: LucideIcon;
};

const Toggle = ({
  label,
  value,
  onChange,
  disabled,
  className,
  labelClassName,
  layout = "inline",
  id: idProp,
  color,
  icon: Icon,
}: ToggleProps) => {
  const generatedId = useId();
  const id = idProp || generatedId;
  const isStacked = layout === "stacked";

  const labelEl = label ? (
    <label
      className={cn(
        "text-sm font-semibold transition-colors duration-150 ease-out",
        disabled
          ? "cursor-not-allowed text-gray-500"
          : "cursor-pointer group-hover/toggle:text-white",
        isStacked && "self-start",
        labelClassName,
      )}
      htmlFor={id}
    >
      {typeof label === "string" ? `${label}:` : label}
    </label>
  ) : null;

  const switchEl = (
    <Switch
      checked={value}
      onCheckedChange={onChange}
      disabled={disabled}
      id={id}
      color={color}
      icon={
        Icon && (
          <Icon
            className={cn(
              "h-3 w-3 shrink-0 text-foreground",
              // Dark unchecked thumb is near-white; use page background token for a dark glyph.
              "dark:group-data-[state=unchecked]:text-background",
            )}
          />
        )
      }
    />
  );

  return (
    <div
      className={cn(
        "group/toggle relative flex",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
        isStacked
          ? "min-w-0 w-full flex-col items-stretch gap-1"
          : "items-center gap-1",
        className,
      )}
    >
      {labelEl}
      {isStacked ? (
        <div className="flex justify-end">{switchEl}</div>
      ) : (
        switchEl
      )}
    </div>
  );
};

export default Toggle;
