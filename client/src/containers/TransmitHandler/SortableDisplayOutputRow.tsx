import { ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cn } from "../../utils/cnHelper";

type SortableDisplayOutputRowProps = {
  id: string;
  name: string;
  children: ReactNode;
};

/**
 * One draggable display row.
 *
 * The drag listeners sit on the grip alone. Putting them on the row would fight
 * the name field and the toggles inside it, and an operator dragging a display
 * during a service should never risk renaming it by accident.
 */
const SortableDisplayOutputRow = ({
  id,
  name,
  children,
}: SortableDisplayOutputRowProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-start gap-2 rounded-md border border-white/12 bg-black/30 p-3",
        isDragging && "opacity-60",
      )}
    >
      <button
        type="button"
        className="mt-1 shrink-0 cursor-grab text-gray-400 hover:text-white active:cursor-grabbing"
        aria-label={`Reorder ${name}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} aria-hidden />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
};

export default SortableDisplayOutputRow;
