import { Image, Library, Video, type LucideIcon } from "lucide-react";
import { cn } from "@/utils/cnHelper";

export type MediaTypeFilterValue = "all" | "image" | "video";

type MediaTypeFilterProps = {
  value: MediaTypeFilterValue;
  onChange: (next: MediaTypeFilterValue) => void;
  className?: string;
};

const OPTIONS: {
  value: MediaTypeFilterValue;
  label: string;
  icon: LucideIcon;
}[] = [
    { value: "all", label: "All", icon: Library },
    { value: "image", label: "Images", icon: Image },
    { value: "video", label: "Videos", icon: Video },
  ];

const MediaTypeFilter = ({ value, onChange, className }: MediaTypeFilterProps) => (
  <div
    role="group"
    aria-label="Filter by media type"
    className={cn(
      "inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-gray-700/80 bg-black/30 p-0.5",
      className,
    )}
  >
    {OPTIONS.map(({ value: optionValue, label, icon: Icon }) => {
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

export default MediaTypeFilter;
