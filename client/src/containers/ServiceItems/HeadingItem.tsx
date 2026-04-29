import {
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import { ServiceItem as ServiceItemType } from "../../types";
import Button from "../../components/Button/Button";
import cn from "classnames";
import { getOutlineRowSelectionState } from "../../utils/outlineRowSelection";

type HeadingItemProps = {
  item: ServiceItemType;
  index: number;
  selectedItemListId: string;
  insertPointIndex: number;
  selectedListIds: Set<string>;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onItemClick: (listId: string, e: React.MouseEvent) => void;
  /** When false, heading cannot be reordered, renamed, or deleted (view-only access). */
  canMutateOutline?: boolean;
};

const HeadingItem = ({
  item,
  index,
  selectedItemListId,
  insertPointIndex,
  selectedListIds,
  isCollapsed,
  onToggleCollapse,
  onItemClick,
  canMutateOutline = true,
}: HeadingItemProps) => {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({
      id: item.listId,
      disabled: !canMutateOutline,
    });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const { isSelected, isInsertPoint } = getOutlineRowSelectionState(
    item.listId,
    index,
    selectedListIds,
    selectedItemListId,
    insertPointIndex
  );

  return (
    <li
      ref={setNodeRef}
      id={`service-item-${item.listId}`}
      data-list-id={item.listId}
      style={style}
      onClick={(e) => onItemClick(item.listId, e)}
      className={cn(
        "flex items-center gap-1 border-b-2 overflow-hidden pr-6",
        "bg-black/40 border-t border-white/20 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]",
        isSelected && "ring-1 ring-inset ring-cyan-500/30",
        isSelected ? "border-l-cyan-500" : "border-transparent",
        isSelected && "border-b-cyan-500",
        !isSelected && isInsertPoint && "border-b-white",
        !isSelected && !isInsertPoint && "border-b-transparent",
      )}
    >
      <div className="flex-1 min-w-0 flex items-center gap-1">
        <Button
          variant="tertiary"
          svg={isCollapsed ? ChevronRight : ChevronDown}
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse();
          }}
          title={isCollapsed ? "Expand" : "Collapse"}
          iconSize="sm"
        />
        <p
          {...(canMutateOutline ? attributes : {})}
          {...(canMutateOutline ? listeners : {})}
          title={item.name}
          className={cn(
            "line-clamp-3 min-w-0 flex-1 wrap-break-word px-2 py-2 text-center text-[11px] font-semibold text-white",
            canMutateOutline && "cursor-grab active:cursor-grabbing",
          )}
        >
          {item.name}
        </p>
      </div>
    </li>
  );
};

export default HeadingItem;
