import { useState, useRef, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  Pencil,
  Check,
  X,
  Trash2,
} from "lucide-react";
import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import { ServiceItem as ServiceItemType } from "../../types";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
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
  onSaveName: (newName: string) => Promise<void>;
  onDelete: () => void;
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
  onSaveName,
  onDelete,
  onItemClick,
  canMutateOutline = true,
}: HeadingItemProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [localName, setLocalName] = useState(item.name);
  const editWrapperRef = useRef<HTMLDivElement>(null);

  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({
      id: item.listId,
      disabled: isEditing || !canMutateOutline,
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

  useEffect(() => {
    setLocalName(item.name);
  }, [item.name]);

  useEffect(() => {
    if (isEditing && editWrapperRef.current) {
      const input = editWrapperRef.current.querySelector("input");
      input?.focus();
      input?.select();
    }
  }, [isEditing]);

  const handleStartEdit = () => {
    if (!canMutateOutline) return;
    setLocalName(item.name);
    setIsEditing(true);
  };

  const handleConfirm = async () => {
    const trimmed = localName.trim();
    if (trimmed && trimmed !== item.name) {
      await onSaveName(trimmed);
    } else {
      setLocalName(item.name);
    }
    setIsEditing(false);
  };

  const handleDiscard = () => {
    setLocalName(item.name);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleConfirm();
    } else if (e.key === "Escape") {
      handleDiscard();
    }
  };

  return (
    <li
      ref={setNodeRef}
      id={`service-item-${item.listId}`}
      data-list-id={item.listId}
      style={style}
      onClick={(e) => onItemClick(item.listId, e)}
      className={cn(
        "group flex items-center gap-1 border-b-2 border-r-4 overflow-hidden bg-gray-800/50",
        isSelected ? "border-l-cyan-500" : "border-transparent",
        isInsertPoint ? "border-b-white" : "border-b-transparent",
      )}
    >
      <div className="flex-1 min-w-0 flex items-center gap-1">
        {!isEditing ? (
          <>
            <Button
              variant="tertiary"
              svg={isCollapsed ? ChevronRight : ChevronDown}
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapse();
              }}
              className={cn(
                "opacity-0 group-hover:opacity-100 transition-opacity",
              )}
              title={isCollapsed ? "Expand" : "Collapse"}
              iconSize="sm"
            />
            <p
              {...(canMutateOutline ? attributes : {})}
              {...(canMutateOutline ? listeners : {})}
              className={cn(
                "text-xs truncate flex-1 px-1 text-center",
                canMutateOutline && "cursor-grab active:cursor-grabbing",
              )}
            >
              {item.name}
            </p>
            {canMutateOutline && (
              <Button
                variant="tertiary"
                svg={Pencil}
                onClick={(e) => {
                  e.stopPropagation();
                  handleStartEdit();
                }}
                className={cn(
                  "opacity-0 group-hover:opacity-100 transition-opacity",
                )}
                iconSize="sm"
                title="Edit heading name"
              />
            )}
          </>
        ) : (
          <div
            ref={editWrapperRef}
            className="flex-1 min-w-0 flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <Input
              value={localName}
              onChange={(val) => setLocalName(String(val))}
              onKeyDown={handleKeyDown}
              className="flex-1 text-sm py-0.5 min-w-0"
              hideLabel
              data-ignore-undo="true"
            />
            <Button
              variant="tertiary"
              svg={Check}
              onClick={(e) => {
                e.stopPropagation();
                void handleConfirm();
              }}
              className="shrink-0 p-1 min-w-6 text-green-500"
              title="Save"
              iconSize="sm"
            />
            <Button
              variant="tertiary"
              svg={X}
              onClick={(e) => {
                e.stopPropagation();
                handleDiscard();
              }}
              className="shrink-0 p-1 min-w-6"
              title="Discard"
              iconSize="sm"
            />
            <Button
              variant="tertiary"
              svg={Trash2}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="shrink-0 p-1 min-w-6 text-red-500"
              title="Delete heading"
              iconSize="sm"
            />
          </div>
        )}
      </div>
    </li>
  );
};

export default HeadingItem;
