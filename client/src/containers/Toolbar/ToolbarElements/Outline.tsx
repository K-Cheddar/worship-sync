import Button from "../../../components/Button/Button";
import { Trash2, SquarePen, ListCheck, Copy, Check } from "lucide-react";
import { ItemList } from "../../../types";
import Input from "../../../components/Input/Input";
import DeleteModal from "../../../components/Modal/DeleteModal";
import { useEffect, useState } from "react";
import {
  INLINE_EDIT_CONFIRM_ICON_COLOR,
  handleInlineTextInputKeyDown,
} from "../../../utils/inlineEdit";
import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import cn from "classnames";

type ServiceProps = {
  list: ItemList;
  deleteList?: (_id: string) => void;
  updateList: (list: ItemList) => void;
  copyList: (list: ItemList) => Promise<void>;
  selectList: (_id: string) => void;
  setActiveList: (_id: string) => void;
  isSelected: boolean;
  isActive: boolean;
  canEdit: boolean;
  /** Disable drag reorder (e.g. view-only overlay controller). */
  disableDrag?: boolean;
  /** Service-column popover list styling (vs toolbar popover). */
  panel?: boolean;
};

const Service = ({
  list,
  deleteList,
  updateList,
  selectList,
  copyList,
  setActiveList,
  isSelected,
  isActive,
  canEdit,
  disableDrag = false,
  panel = false,
}: ServiceProps) => {
  const [name, setName] = useState<string>(list.name);
  const [isCopying, setIsCopying] = useState(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
  const nameRowClass = cn(
    "flex min-w-0 flex-1 items-center gap-2 mr-2 pl-2 max-w-64 max-lg:max-w-48",
  );
  const nameClasses = cn(
    "min-w-0 flex-1 truncate",
    panel ? "text-sm" : "text-base",
    isSelected && "font-bold",
  );

  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({
      id: list._id,
      disabled: isEditing || disableDrag,
    });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  useEffect(() => {
    if (!isEditing) {
      setName(list.name);
    }
  }, [list.name, isEditing]);

  const handleConfirmEdit = () => {
    setIsEditing(false);
    updateList({ ...list, name });
  };

  const handleCancelEdit = () => {
    setName(list.name);
    setIsEditing(false);
  };

  return (
    <>
      <DeleteModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={() => {
          deleteList && deleteList(list._id);
          setShowDeleteModal(false);
        }}
        itemName={list.name}
        title="Delete Outline"
        message="Are you sure you want to delete the outline"
      />
      <li
        className={cn(
          "group relative flex min-w-0 items-center gap-1 rounded-md border-2 border-transparent p-1",
          isSelected && "ring-1 ring-inset ring-cyan-500/30",
        )}
        {...attributes}
        {...listeners}
        style={style}
        ref={setNodeRef}
      >
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 z-0 rounded-md transition-colors duration-150 ease-out",
            isSelected
              ? "bg-cyan-500/12 group-hover:bg-cyan-500/18 group-active:bg-cyan-500/24"
              : cn(
                "bg-transparent",
                panel
                  ? "group-hover:bg-gray-700/90"
                  : "group-hover:bg-gray-800",
              ),
          )}
        />
        {!isEditing && (
          <div className={cn(nameRowClass, "relative z-10")}>
            <Button
              variant="tertiary"
              onClick={() => selectList(list._id)}
              className={nameClasses}
            >
              {list.name}
            </Button>
            {isActive && (
              <span
                className="shrink-0 rounded bg-orange-500/25 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-orange-200/95"
                title="This outline is active for presentation"
              >
                Active
              </span>
            )}
          </div>
        )}
        {isEditing && (
          <div className={cn(nameRowClass, "relative z-10 min-w-0 flex-1")}>
            <Input
              className={cn(nameClasses, "w-full min-w-0")}
              label="Edit List Name"
              data-ignore-undo="true"
              hideLabel
              value={name}
              onChange={(val) => setName(val as string)}
              onKeyDown={(e) =>
                handleInlineTextInputKeyDown(e, {
                  onSave: handleConfirmEdit,
                  onCancel: handleCancelEdit,
                })
              }
            />
          </div>
        )}
        {canEdit && (
          <span className="relative z-10 flex shrink-0 items-center gap-0.5">
            <Button
              svg={isEditing ? Check : SquarePen}
              variant="tertiary"
              color={isEditing ? INLINE_EDIT_CONFIRM_ICON_COLOR : undefined}
              onClick={() => {
                if (isEditing) {
                  handleConfirmEdit();
                } else {
                  setName(list.name);
                  setIsEditing(true);
                }
              }}
            />
            {copyList && (
              <Button
                svg={Copy}
                variant="tertiary"
                onClick={async () => {
                  setIsCopying(true);
                  await copyList(list);
                  setIsCopying(false);
                }}
                isLoading={isCopying}
              />
            )}
            <Button
              svg={ListCheck}
              variant="tertiary"
              onClick={() => setActiveList(list._id)}
              title={isActive ? "This outline is active" : "Set as active outline"}
              color={isActive ? "#f97316" : undefined}
            />
            <Button
              variant="tertiary"
              color={deleteList ? "red" : "gray"}
              disabled={!deleteList}
              svg={Trash2}
              onClick={() => setShowDeleteModal(true)}
            />
          </span>
        )}
      </li>
    </>
  );
};

export default Service;
