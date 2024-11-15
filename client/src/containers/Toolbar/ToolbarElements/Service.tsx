import Button from "../../../components/Button/Button";
import { ReactComponent as DeleteSVG } from "../../../assets/icons/delete.svg";
import { ReactComponent as EditSVG } from "../../../assets/icons/edit.svg";
import { ReactComponent as CheckSVG } from "../../../assets/icons/check.svg";
import { ReactComponent as AddSVG } from "../../../assets/icons/add.svg";
import { ReactComponent as CopySVG } from "../../../assets/icons/copy.svg";
import { ItemList } from "../../../types";
import Input from "../../../components/Input/Input";
import { useState } from "react";

type ServiceProps = {
  list: ItemList;
  deleteList: (_id: string) => void;
  updateList: (list: ItemList) => void;
  addList?: (list: ItemList) => void;
  copyList?: (list: ItemList) => void;
  canBeAdded?: boolean;
  isAllLists?: boolean;
};

const Service = ({
  list,
  deleteList,
  updateList,
  addList,
  canBeAdded,
  isAllLists,
  copyList,
}: ServiceProps) => {
  const [name, setName] = useState<string>(list.name);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  return (
    <li className="p-1.5 hover:bg-gray-800 rounded-md flex gap-1 items-center">
      {!isEditing && <p className="text-lg flex-1">{list.name}</p>}
      {isEditing && (
        <Input
          className="text-lg flex-1"
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
      {addList && (
        <Button
          disabled={!canBeAdded}
          svg={AddSVG}
          variant="tertiary"
          onClick={() => addList(list)}
        />
      )}
      <Button
        variant="tertiary"
        color={`${isAllLists ? "red" : "white"}`}
        svg={DeleteSVG}
        onClick={() => deleteList(list.id)}
      />
    </li>
  );
};

export default Service;
