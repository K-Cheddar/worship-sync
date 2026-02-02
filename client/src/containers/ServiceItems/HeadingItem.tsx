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

type HeadingItemProps = {
  item: ServiceItemType;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onSaveName: (newName: string) => Promise<void>;
  onDelete: () => void;
};

const HeadingItem = ({
  item,
  isCollapsed,
  onToggleCollapse,
  onSaveName,
  onDelete,
}: HeadingItemProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [localName, setLocalName] = useState(item.name);
  const editWrapperRef = useRef<HTMLDivElement>(null);

  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({
      id: item.listId,
      disabled: isEditing,
    });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

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
      style={style}
      className={cn(
        "group flex items-center gap-1 min-h-8 border-b-2 border-slate-600/50 bg-gray-800/50",
      )}
    >

      <div className="flex-1 min-w-0 flex items-center gap-1">
        {!isEditing ? (
          <>
            <Button
              variant="tertiary"
              svg={isCollapsed ? ChevronRight : ChevronDown}
              onClick={onToggleCollapse}
              className={cn(
                "opacity-0 group-hover:opacity-100 transition-opacity",
              )}
              title={isCollapsed ? "Expand" : "Collapse"}
              iconSize="sm"
            />
            <p
              {...attributes}
              {...listeners}
              className="text-xs truncate flex-1 px-1 cursor-grab active:cursor-grabbing text-center"
            >
              {item.name}
            </p>
            <Button
              variant="tertiary"
              svg={Pencil}
              onClick={handleStartEdit}
              className={cn(
                "opacity-0 group-hover:opacity-100 transition-opacity",
              )}
              iconSize="sm"
              title="Edit heading name"
            />
          </>
        ) : (
          <div ref={editWrapperRef} className="flex-1 min-w-0 flex items-center gap-1">
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
              onClick={handleConfirm}
              className="shrink-0 p-1 min-w-6 text-green-500"
              title="Save"
            />
            <Button
              variant="tertiary"
              svg={X}
              onClick={handleDiscard}
              className="shrink-0 p-1 min-w-6"
              title="Discard"
            />
            <Button
              variant="tertiary"
              svg={Trash2}
              onClick={onDelete}
              className="shrink-0 p-1 min-w-6 text-red-500"
              title="Delete heading"
            />
          </div>
        )}
      </div>
    </li>
  );
};

export default HeadingItem;
