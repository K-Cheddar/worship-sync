import Select from "../../components/Select/Select";
import {
  isMediaOriginFilterValue,
  MEDIA_LIBRARY_ORIGIN_FILTER_OPTIONS,
  type MediaOriginFilterValue,
} from "./mediaLibraryOrigin";

type MediaOriginFilterProps = {
  value: MediaOriginFilterValue;
  onChange: (next: MediaOriginFilterValue) => void;
  className?: string;
};

const MediaOriginFilter = ({
  value,
  onChange,
  className,
}: MediaOriginFilterProps) => (
  <Select
    label="Source"
    hideLabel
    value={value}
    onChange={(next) => {
      if (isMediaOriginFilterValue(next)) onChange(next);
    }}
    options={MEDIA_LIBRARY_ORIGIN_FILTER_OPTIONS}
    className={className}
    selectClassName="h-8 w-full min-w-0 sm:h-9"
    backgroundColor="bg-black/30"
    textColor="text-gray-100"
    contentBackgroundColor="bg-gray-800"
    contentTextColor="text-white"
  />
);

export default MediaOriginFilter;
