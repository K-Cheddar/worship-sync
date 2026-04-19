import Button from "../../components/Button/Button";
import { Trash2 } from "lucide-react";
import { itemSectionBgColorMap } from "../../utils/slideColorMap";
import { SongOrder } from "../../types";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import cn from "classnames";
import {
  songOrderSectionSelectedClass,
  songOrderSectionUnselectedClass,
  songOrderSectionLinkedClass,
} from "../../utils/sortableRowStyles";

type SongSectionProps = {
  songOrder: SongOrder[];
  setSongOrder: (songOrder: SongOrder[]) => void;
  name: string;
  index: number;
  id: string;
  selectedIndex: number;
  setSelectedIndex: (index: number) => void;
  linkedSectionName?: string | null;
};

const SongSection = ({
  name,
  index,
  setSongOrder,
  songOrder,
  id,
  selectedIndex,
  setSelectedIndex,
  linkedSectionName,
}: SongSectionProps) => {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({
      id,
    });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const sectionKey = name.split(/\s+/)[0] ?? "";
  const accentBarClass =
    itemSectionBgColorMap.get(sectionKey) ?? "bg-stone-600";

  const isSelected = selectedIndex === index;
  const isLinked = !isSelected && !!linkedSectionName && name === linkedSectionName;

  return (
    <li
      id={`song-section-${index}`}
      className={cn(
        "flex shrink-0 items-stretch overflow-hidden rounded-md border transition-colors",
        isSelected
          ? songOrderSectionSelectedClass
          : isLinked
            ? songOrderSectionLinkedClass
            : songOrderSectionUnselectedClass,
      )}
      {...attributes}
      style={style}
      ref={setNodeRef}
      onClick={() => setSelectedIndex(index)}
    >
      <div
        className={cn(
          "w-1.5 shrink-0 cursor-grab self-stretch touch-none active:cursor-grabbing",
          accentBarClass,
        )}
        aria-hidden
        {...listeners}
      />
      <div className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-1 pl-2 max-lg:py-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-gray-100">
          {name}
        </p>
        <Button
          className="shrink-0"
          variant="tertiary"
          svg={Trash2}
          aria-label={`Remove ${name} from song order`}
          onClick={(event) => {
            event.stopPropagation();
            const copiedSongOrder = [...songOrder];
            copiedSongOrder.splice(index, 1);
            setSongOrder(copiedSongOrder);
          }}
        />
      </div>
    </li>
  );
};

export default SongSection;
