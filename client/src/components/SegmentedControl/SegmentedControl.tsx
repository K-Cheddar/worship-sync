import type { ReactNode } from "react";
import Button from "../Button/Button";
import { cn } from "@/utils/cnHelper";

export type SegmentedControlOption<T extends string> = {
  value: T;
  label: ReactNode;
};

export type SegmentedControlVariant =
  | "admin"
  | "publicDark"
  | "publicLight"
  | "compact"
  | "muted";

type SegmentedControlProps<T extends string> = {
  options: SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  variant?: SegmentedControlVariant;
  className?: string;
  /** Stretch segments evenly across the row — useful on narrow public/mobile screens. */
  fullWidth?: boolean;
};

const shellClassNames: Record<SegmentedControlVariant, string> = {
  admin: "inline-flex rounded-lg border border-gray-700 bg-gray-900 p-0.5",
  publicDark: "inline-flex rounded-lg border border-stone-700 bg-stone-900 p-0.5",
  publicLight: "inline-flex rounded-lg border border-gray-200 bg-gray-100 p-0.5",
  compact: "inline-flex flex-wrap gap-1",
  muted: "inline-flex rounded-md border border-stone-700 bg-stone-900/80 p-0.5",
};

const itemClassNames: Record<
  SegmentedControlVariant,
  { base: string; selected: string; unselected: string }
> = {
  admin: {
    base: "rounded-md px-3 py-1.5 text-sm font-medium",
    selected: "bg-cyan-600 text-white",
    unselected: "text-gray-300 hover:text-white",
  },
  publicDark: {
    base: "rounded-md px-3 py-1.5 text-sm font-medium",
    selected: "bg-amber-500/20 text-amber-100",
    unselected: "text-stone-300 hover:text-white",
  },
  publicLight: {
    base: "rounded-md px-3 py-1.5 text-sm font-medium",
    selected: "bg-white text-gray-900 shadow-sm",
    unselected: "text-gray-500 hover:text-gray-900",
  },
  compact: {
    base: "rounded px-2 py-1 text-xs font-medium",
    selected: "bg-cyan-600 text-white",
    unselected: "bg-gray-700 text-gray-200 hover:bg-gray-600",
  },
  muted: {
    base: "rounded-md px-3 py-1 text-xs font-semibold",
    selected: "bg-cyan-500/20 text-cyan-200 ring-1 ring-cyan-400/50",
    unselected: "text-stone-400 hover:text-stone-200",
  },
};

const SegmentedControl = <T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  variant = "admin",
  className,
  fullWidth = false,
}: SegmentedControlProps<T>) => {
  const styles = itemClassNames[variant];

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        shellClassNames[variant],
        fullWidth && "flex w-full max-w-full gap-1",
        className,
      )}
    >
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <Button
            key={option.value}
            type="button"
            variant="tertiary"
            isSelected={selected}
            padding="p-0"
            aria-pressed={selected}
            className={cn(
              styles.base,
              fullWidth &&
              "min-w-0 flex-1 basis-0 px-2 text-center text-xs sm:px-3 sm:text-sm",
              selected ? styles.selected : styles.unselected,
            )}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
};

export default SegmentedControl;
