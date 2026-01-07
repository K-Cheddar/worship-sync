import Button from "../../../components/Button/Button";
import { Trash2, SquarePen, ListCheck, Copy, Check } from "lucide-react";
import { ItemList } from "../../../types";
import Input from "../../../components/Input/Input";
import DeleteModal from "../../../components/Modal/DeleteModal";
import { useState } from "react";
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
}: ServiceProps) => {
  const [name, setName] = useState<string>(list.name);
  const [isCopying, setIsCopying] = useState(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
  const nameClasses =
    "text-base flex-1 mr-2 pl-2 max-w-64 max-lg:max-w-48 truncate";

  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({
      id: list._id,
      disabled: isEditing,
    });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
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
          "p-1 hover:bg-gray-800 rounded-md flex gap-1 items-center border-2",
          isSelected && "bg-gray-800",
          isActive ? "border-cyan-500" : "border-transparent"
        )}
        {...attributes}
        {...listeners}
        style={style}
        ref={setNodeRef}
      >
        {!isEditing && (
          <Button
            variant="tertiary"
            onClick={() => selectList(list._id)}
            className={nameClasses}
          >
            {list.name}
          </Button>
        )}
        {isEditing && (
          <Input
            className={nameClasses}
            label="Edit List Name"
            data-ignore-undo="true"
            hideLabel
            value={name}
            onChange={(val) => setName(val as string)}
          />
        )}
        {canEdit && (
          <>
            <Button
              svg={isEditing ? Check : SquarePen}
              variant="tertiary"
              onClick={() => {
                if (isEditing) {
                  setIsEditing(false);
                  updateList({ ...list, name });
                } else {
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
              title="Set Active"
              color={isActive ? "#06b6d4" : undefined}
            />
            <Button
              variant="tertiary"
              color={deleteList ? "red" : "gray"}
              disabled={!deleteList}
              svg={Trash2}
              onClick={() => setShowDeleteModal(true)}
            />
          </>
        )}
      </li>
    </>
  );
};

export default Service;
