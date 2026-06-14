import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { type ComponentProps } from "react";
import Button from "../../../components/Button/Button";
import EntityRow from "./EntityRow";

type SortablePositionRowProps = ComponentProps<typeof EntityRow> & {
  id: string;
};

/** EntityRow wrapped with a drag handle for reordering within a team. */
const SortablePositionRow = ({ id, ...rowProps }: SortablePositionRowProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const dragHandle = (
    <Button
      ref={setActivatorNodeRef}
      type="button"
      variant="tertiary"
      className="shrink-0 touch-none"
      padding="px-1 py-1"
      svg={GripVertical}
      aria-label={`Drag to reorder ${rowProps.title}`}
      {...attributes}
      {...listeners}
    />
  );

  return (
    <EntityRow
      {...rowProps}
      rowRef={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : undefined,
      }}
      dragHandle={dragHandle}
    />
  );
};

export default SortablePositionRow;
