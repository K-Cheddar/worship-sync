import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
  disabled?: boolean;
  /** Stretch segments evenly across the row — useful on narrow public/mobile screens. */
  fullWidth?: boolean;
};

const shellClassNames: Record<SegmentedControlVariant, string> = {
  admin: "inline-flex rounded-lg border border-gray-700 bg-gray-900 p-0.5",
  publicDark: "inline-flex rounded-lg border border-stone-700 bg-stone-900 p-0.5",
  publicLight: "inline-flex rounded-lg border border-gray-200 bg-gray-100 p-0.5",
  // Same toggle shell as admin, denser padding/type for toolbars.
  compact: "inline-flex rounded-md border border-gray-700 bg-gray-900 p-0.5",
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
    unselected: "text-gray-300 hover:text-white",
  },
  muted: {
    base: "rounded-md px-3 py-1 text-xs font-semibold",
    selected: "bg-cyan-500/20 text-cyan-200 ring-1 ring-cyan-400/50",
    unselected: "text-stone-400 hover:text-stone-200",
  },
};

const indicatorClassNames: Record<SegmentedControlVariant, string> = {
  admin: "rounded-md bg-cyan-600",
  compact: "rounded bg-cyan-600",
  publicDark: "rounded-md bg-amber-500/20",
  publicLight: "rounded-md bg-white shadow-sm",
  muted: "rounded-md bg-cyan-500/20 ring-1 ring-cyan-400/50",
};

const SegmentedControl = <T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  variant = "admin",
  className,
  disabled = false,
  fullWidth = false,
}: SegmentedControlProps<T>) => {
  const styles = itemClassNames[variant];
  const shellRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const optionValues = JSON.stringify(options.map((option) => option.value));

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const updateIndicator = () => {
      const selected = shell.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
      if (!selected || !selected.offsetWidth || !selected.offsetHeight) {
        setIndicator(null);
        return;
      }
      const next = { left: selected.offsetLeft, top: selected.offsetTop, width: selected.offsetWidth, height: selected.offsetHeight };
      setIndicator((previous) => previous && previous.left === next.left && previous.top === next.top && previous.width === next.width && previous.height === next.height ? previous : next);
    };
    updateIndicator();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateIndicator);
    observer?.observe(shell);
    shell.querySelectorAll("button").forEach((button) => observer?.observe(button));
    window.addEventListener("resize", updateIndicator);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateIndicator);
    };
  }, [value, optionValues]);

  return (
    <div
      ref={shellRef}
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "relative",
        shellClassNames[variant],
        fullWidth && "flex w-full max-w-full gap-1",
        className,
      )}
    >
      {indicator && (
        <span
          aria-hidden="true"
          data-testid="segmented-control-indicator"
          className={cn("pointer-events-none absolute transition-[left,width] duration-200 ease-out motion-reduce:transition-none", indicatorClassNames[variant])}
          style={indicator}
        />
      )}
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <Button
            key={option.value}
            type="button"
            variant="tertiary"
            isSelected={selected}
            padding="p-0"
            disabled={disabled}
            aria-pressed={selected}
            className={cn(
              "border-2 border-transparent",
              styles.base,
              fullWidth &&
              "min-w-0 flex-1 basis-0 px-2 text-center text-xs sm:px-3 sm:text-sm",
              selected ? styles.selected : styles.unselected,
              selected && indicator && "!bg-transparent !shadow-none !ring-0",
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
