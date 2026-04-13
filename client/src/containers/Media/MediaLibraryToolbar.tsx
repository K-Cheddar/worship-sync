import Toggle from "../../components/Toggle/Toggle";
import { LayoutGrid } from "lucide-react";
import cn from "classnames";

type MediaLibraryToolbarProps = {
  className?: string;
  showAll: boolean;
  onShowAllChange: (next: boolean) => void;
  typeFilter: "all" | "image" | "video";
  onTypeFilterChange: (v: "all" | "image" | "video") => void;
};

const MediaLibraryToolbar = ({
  className,
  showAll,
  onShowAllChange,
  typeFilter,
  onTypeFilterChange,
}: MediaLibraryToolbarProps) => (
  <div
    className={cn(
      "mx-2 flex flex-wrap items-center gap-3 border-b border-gray-500 bg-black/60 px-2 py-2",
      className,
    )}
  >
    <Toggle
      label="Show all"
      icon={LayoutGrid}
      value={showAll}
      onChange={onShowAllChange}
    />
    <div
      className="flex min-h-9 items-stretch overflow-hidden rounded-md border border-gray-600"
      role="group"
      aria-label="Filter by media type"
    >
      {(
        [
          ["all", "All"],
          ["image", "Images"],
          ["video", "Videos"],
        ] as const
      ).map(([k, lab]) => (
        <button
          key={k}
          type="button"
          className={cn(
            "px-2 py-1 text-xs font-medium sm:text-sm",
            typeFilter === k
              ? "bg-gray-600 text-white"
              : "bg-black/30 text-gray-400 hover:bg-black/50",
          )}
          onClick={() => onTypeFilterChange(k)}
        >
          {lab}
        </button>
      ))}
    </div>
  </div>
);

export default MediaLibraryToolbar;
