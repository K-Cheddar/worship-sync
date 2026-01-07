import Button from "../../components/Button/Button";
import { Trash2 } from "lucide-react";
import { itemSectionBorderColorMap } from "../../utils/slideColorMap";
import { SongOrder } from "../../types";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import cn from "classnames";

type SongSectionProps = {
  songOrder: SongOrder[];
  setSongOrder: (songOrder: SongOrder[]) => void;
  name: string;
  index: number;
  id: string;
  selectedIndex: number;
  setSelectedIndex: (index: number) => void;
};

const SongSection = ({
  name,
  index,
  setSongOrder,
  songOrder,
  id,
  selectedIndex,
  setSelectedIndex,
}: SongSectionProps) => {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({
      id,
    });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <>
      <li
        id={`song-section-${index}`}
        className={cn(
          "flex items-center px-2 max-lg:py-2 lg:py-1 bg-black rounded-lg hover:bg-gray-800 cursor-pointer border-b-4",
          itemSectionBorderColorMap.get(name.split(" ")[0])
        )}
        {...attributes}
        {...listeners}
        style={style}
        ref={setNodeRef}
        onClick={() => setSelectedIndex(index)}
      >
        <p className="pr-1 text-base">{name}</p>
        <Button
          className="ml-auto"
          variant="tertiary"
          color="#dc2626"
          svg={Trash2}
          onClick={() => {
            const copiedSongOrder = [...songOrder];
            copiedSongOrder.splice(index, 1);
            setSongOrder(copiedSongOrder);
          }}
        />
      </li>
      {selectedIndex === index && (
        <li className="w-full border-b-2 border-white" />
      )}
    </>
  );
};

export default SongSection;
