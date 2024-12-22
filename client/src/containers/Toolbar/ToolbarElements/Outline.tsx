import Button from "../../../components/Button/Button";
import { ReactComponent as DeleteSVG } from "../../../assets/icons/delete.svg";
import { ReactComponent as EditSVG } from "../../../assets/icons/edit.svg";
import { ReactComponent as CheckSVG } from "../../../assets/icons/check.svg";
import { ReactComponent as CopySVG } from "../../../assets/icons/copy.svg";
import { ItemList } from "../../../types";
import Input from "../../../components/Input/Input";
import { useState } from "react";
import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";

type ServiceProps = {
  list: ItemList;
  deleteList?: (_id: string) => void;
  updateList: (list: ItemList) => void;
  copyList: (list: ItemList) => void;
  selectList: (_id: string) => void;
  isSelected: boolean;
};

const Service = ({
  list,
  deleteList,
  updateList,
  selectList,
  copyList,
  isSelected,
}: ServiceProps) => {
  const [name, setName] = useState<string>(list.name);
  const [isEditing, setIsEditing] = useState<boolean>(false);
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
    <li
      className={`p-1.5 hover:bg-gray-800 rounded-md flex gap-1 items-center ${
        isSelected ? "bg-gray-900" : ""
      }`}
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
      <Button
        svg={isEditing ? CheckSVG : EditSVG}
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
          svg={CopySVG}
          variant="tertiary"
          onClick={() => copyList(list)}
        />
      )}
      <Button
        variant="tertiary"
        color={deleteList ? "red" : "gray"}
        disabled={!deleteList}
        svg={DeleteSVG}
        onClick={() => deleteList && deleteList(list._id)}
      />
    </li>
  );
};

export default Service;
