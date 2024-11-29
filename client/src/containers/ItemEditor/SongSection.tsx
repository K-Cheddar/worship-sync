import Button from "../../components/Button/Button";
import { ReactComponent as DeleteSVG } from "../../assets/icons/delete.svg";
import { itemSectionBorderColorMap } from "../../utils/slideColorMap";
import { SongOrder } from "../../types";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type SongSectionProps = {
  songOrder: SongOrder[];
  setSongOrder: (songOrder: SongOrder[]) => void;
  name: string;
  index: number;
  id: string;
};

const SongSection = ({
  name,
  index,
  setSongOrder,
  songOrder,
  id,
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
    <li
      className={`flex items-center px-2 h-7 bg-black rounded-lg hover:bg-gray-800 cursor-pointer border-b-4 ${itemSectionBorderColorMap.get(
        name.split(" ")[0]
      )}`}
      {...attributes}
      {...listeners}
      style={style}
      ref={setNodeRef}
    >
      <p className="pr-1 text-base">{name}</p>
      <Button
        className="ml-auto"
        variant="tertiary"
        color="#dc2626"
        svg={DeleteSVG}
        onClick={() => {
          const copiedSongOrder = [...songOrder];
          copiedSongOrder.splice(index, 1);
          setSongOrder(copiedSongOrder);
        }}
      />
    </li>
  );
};

export default SongSection;
