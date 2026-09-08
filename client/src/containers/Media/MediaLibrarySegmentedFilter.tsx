import type { LucideIcon } from "lucide-react";
import { cn } from "@/utils/cnHelper";

export type MediaLibrarySegmentedFilterOption<T extends string> = {
  value: T;
  label: string;
  icon: LucideIcon;
};

type MediaLibrarySegmentedFilterProps<T extends string> = {
  value: T;
  onChange: (next: T) => void;
  options: readonly MediaLibrarySegmentedFilterOption<T>[];
  ariaLabel: string;
  className?: string;
  /** Stretch options across the row so the control stays tappable on a narrow toolbar. */
  fullWidth?: boolean;
};

const MediaLibrarySegmentedFilter = <T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
  fullWidth = false,
}: MediaLibrarySegmentedFilterProps<T>) => (
  <div
    role="group"
    aria-label={ariaLabel}
    className={cn(
      "items-center gap-0.5 rounded-lg border border-gray-700/80 bg-black/30 p-0.5",
      fullWidth ? "flex w-full min-w-0 flex-1" : "inline-flex shrink-0",
      className,
    )}
  >
    {options.map(({ value: optionValue, label, icon: Icon }) => {
      const selected = value === optionValue;
      return (
        <button
          key={optionValue}
          type="button"
          aria-pressed={selected}
          title={label}
          onClick={() => onChange(optionValue)}
          className={cn(
            "inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 transition-colors sm:h-9 sm:px-2.5",
            "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cyan-500/70",
            fullWidth && "min-w-0 flex-1 px-1.5",
            selected
              ? "border border-cyan-600/90 bg-cyan-950/45 text-white shadow-sm"
              : "border border-transparent text-gray-400 hover:bg-gray-700/35 hover:text-gray-100",
          )}
        >
          <Icon className="size-3.5 shrink-0 sm:size-4" aria-hidden />
          <span className="text-xs font-semibold sm:text-sm">{label}</span>
        </button>
      );
    })}
  </div>
);

export default MediaLibrarySegmentedFilter;
