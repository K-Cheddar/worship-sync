import Toggle from "../../components/Toggle/Toggle";
import { LayoutGrid } from "lucide-react";
import cn from "classnames";
import MediaTypeFilter from "./MediaTypeFilter";

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
      "mx-2 flex flex-wrap items-center gap-3 bg-black/60 px-2 py-2",
      className,
    )}
  >
    <Toggle
      label="Show all"
      icon={LayoutGrid}
      value={showAll}
      onChange={onShowAllChange}
    />
    <MediaTypeFilter value={typeFilter} onChange={onTypeFilterChange} />
  </div>
);

export default MediaLibraryToolbar;
