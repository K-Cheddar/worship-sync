import Toggle from "../../components/Toggle/Toggle";
import { LayoutGrid } from "lucide-react";
import cn from "classnames";
import MediaOriginFilter from "./MediaOriginFilter";
import MediaTypeFilter, { type MediaTypeFilterValue } from "./MediaTypeFilter";
import type { MediaOriginFilterValue } from "./mediaLibraryOrigin";

type MediaLibraryToolbarProps = {
  className?: string;
  showAll: boolean;
  onShowAllChange: (next: boolean) => void;
  typeFilter: MediaTypeFilterValue;
  onTypeFilterChange: (v: MediaTypeFilterValue) => void;
  originFilter: MediaOriginFilterValue;
  onOriginFilterChange: (v: MediaOriginFilterValue) => void;
};

const MediaLibraryToolbar = ({
  className,
  showAll,
  onShowAllChange,
  typeFilter,
  onTypeFilterChange,
  originFilter,
  onOriginFilterChange,
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
    <MediaOriginFilter
      value={originFilter}
      onChange={onOriginFilterChange}
      className="w-40 shrink-0"
    />
  </div>
);

export default MediaLibraryToolbar;
