import { Image, Library, Video } from "lucide-react";
import MediaLibrarySegmentedFilter, {
  type MediaLibrarySegmentedFilterOption,
} from "./MediaLibrarySegmentedFilter";

export type MediaTypeFilterValue = "all" | "image" | "video";

type MediaTypeFilterProps = {
  value: MediaTypeFilterValue;
  onChange: (next: MediaTypeFilterValue) => void;
  className?: string;
  fullWidth?: boolean;
};

const OPTIONS: MediaLibrarySegmentedFilterOption<MediaTypeFilterValue>[] = [
  { value: "all", label: "All", icon: Library },
  { value: "image", label: "Images", icon: Image },
  { value: "video", label: "Videos", icon: Video },
];

const MediaTypeFilter = ({
  value,
  onChange,
  className,
  fullWidth,
}: MediaTypeFilterProps) => (
  <MediaLibrarySegmentedFilter
    value={value}
    onChange={onChange}
    options={OPTIONS}
    ariaLabel="Filter by media type"
    className={className}
    fullWidth={fullWidth}
  />
);

export default MediaTypeFilter;
