import { memo } from "react";
import { Trash2 } from "lucide-react";
import Button from "../../components/Button/Button";
import Select from "../../components/Select/Select";
import TextArea from "../../components/TextArea/TextArea";
import { itemSectionBgColorMap } from "../../utils/slideColorMap";
import type {
  FormattedLyrics as FormattedLyricsType,
  Option,
} from "../../types";
import cn from "classnames";

export type LyrcisBoxProps = {
  lyric: FormattedLyricsType;
  index: number;
  selected: boolean;
  justMoved: boolean;
  availableSections: Option[];
  availableSectionsKey: string;
  isMobile: boolean;
  onChangeSectionType: (name: string, index: number) => void;
  onDelete: (index: number) => void;
  onSelect?: (sectionId: string) => void;
  onWordsChange: (index: number, value: string) => void;
};

const LyrcisBox = memo(({
  lyric,
  index,
  selected,
  justMoved,
  availableSections,
  isMobile,
  onChangeSectionType,
  onDelete,
  onSelect,
  onWordsChange,
}: LyrcisBoxProps) => {
  return (
    <li
      id={lyric.id ? `lyric-box-${lyric.id}` : undefined}
      className={cn(
        "text-sm border-4 rounded-lg",
        selected ? "border-cyan-500" : "border-transparent",
        justMoved && "section-track-move"
      )}
    >
      <div
        className={cn(
          "flex font-semibold text-sm rounded-t-md px-1 py-0.5",
          itemSectionBgColorMap.get(lyric.type)
        )}
      >
        <Select
          onChange={(val) => onChangeSectionType(val, index)}
          value={lyric.name}
          options={availableSections}
          backgroundColor="bg-black/40"
          textColor="text-white"
          chevronColor="text-white"
          contentBackgroundColor="bg-gray-900"
          contentTextColor="text-white"
          className="min-w-[50%] max-w-full"
        />
        <Button
          className="ml-auto"
          variant="tertiary"
          svg={Trash2}
          onClick={() => {
            onDelete(index);
          }}
        />
      </div>
      <div
        onClick={() => lyric.id && onSelect && onSelect(lyric.id)}
        className={cn("cursor-pointer")}
      >
        <TextArea
          hideLabel
          className="lg:h-[30vh]"
          data-ignore-undo="true"
          value={lyric.words}
          autoResize={isMobile}
          onChange={(val) => onWordsChange(index, val as string)}
          onFocus={() => lyric.id && onSelect && onSelect(lyric.id)}
        />
      </div>
    </li>
  );
}, (prev, next) => {
  return (
    prev.lyric === next.lyric &&
    prev.index === next.index &&
    prev.selected === next.selected &&
    prev.justMoved === next.justMoved &&
    prev.isMobile === next.isMobile &&
    prev.availableSectionsKey === next.availableSectionsKey
  );
});

export default LyrcisBox;
