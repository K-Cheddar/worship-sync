import { Arrangment } from "../../types";
import { Pencil } from "lucide-react";
import { Check } from "lucide-react";
import { Trash2 } from "lucide-react";
import { Copy } from "lucide-react";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import generateRandomId from "../../utils/generateRandomId";
import {
  INLINE_EDIT_CONFIRM_ICON_COLOR,
  handleInlineTextInputKeyDown,
} from "../../utils/inlineEdit";

type ArrangementProps = {
  arrangement: Arrangment;
  setLocalArrangements: React.Dispatch<React.SetStateAction<Arrangment[]>>;
  localArrangements: Arrangment[];
  setSelectedArrangement: () => void;
  index: number;
};

const Arrangement = ({
  arrangement,
  setLocalArrangements,
  localArrangements,
  setSelectedArrangement,
  index,
}: ArrangementProps) => {
  const [isEditMode, setIsEditMode] = useState(false);
  const [value, setValue] = useState(arrangement.name);

  useEffect(() => {
    if (!isEditMode) {
      setValue(arrangement.name);
    }
  }, [arrangement.name, isEditMode]);

  const handleSave = () => {
    const copiedArrangements = [...localArrangements];
    const targetIndex = copiedArrangements.findIndex(
      ({ name }) => name === arrangement.name
    );
    const updatedArrangement = { ...arrangement, name: value };
    copiedArrangements[targetIndex] = updatedArrangement;
    setLocalArrangements(copiedArrangements);
    setIsEditMode(false);
  };

  const handleCancel = () => {
    setValue(arrangement.name);
    setIsEditMode(false);
  };

  return (
    <>
      <li
        key={arrangement.name}
        className={
          "flex flex-col items-center rounded-md bg-gray-900 border border-transparent hover:border-gray-500 p-1"
        }
      >
        <div className="flex justify-end w-full px-2 bg-black rounded-t-sm">
          {isEditMode && (
            <Button variant="tertiary" svg={X} onClick={handleCancel} />
          )}
          <Button
            svg={isEditMode ? Check : Pencil}
            color={isEditMode ? INLINE_EDIT_CONFIRM_ICON_COLOR : undefined}
            onClick={() => {
              if (isEditMode) {
                handleSave();
              } else {
                setValue(arrangement.name);
                setIsEditMode(true);
              }
            }}
            variant="tertiary"
          />
          <Button
            svg={Copy}
            variant="tertiary"
            onClick={() => {
              const copiedArrangements = [...localArrangements];

              const newArrangement = {
                ...arrangement,
                name: arrangement.name + " copy",
                id: generateRandomId(),
              };
              copiedArrangements.push(newArrangement);
              setLocalArrangements(copiedArrangements);
            }}
          />
          {index !== 0 && (
            <Button
              svg={Trash2}
              variant="tertiary"
              onClick={() => {
                const copiedArrangements = [...localArrangements].filter(
                  (_, i) => i !== index
                );
                setLocalArrangements(copiedArrangements);
              }}
            />
          )}
        </div>
        {isEditMode ? (
          <Input
            value={value}
            onChange={(value) => setValue(value as string)}
            hideLabel
            className="text-sm"
            data-ignore-undo="true"
            onKeyDown={(e) =>
              handleInlineTextInputKeyDown(e, {
                onSave: handleSave,
                onCancel: handleCancel,
              })
            }
          />
        ) : (
          <Button
            variant="tertiary"
            className="px-2 py-1 rounded-b-sm mt-1"
            onClick={() => setSelectedArrangement()}
          >
            <p className="min-w-0 text-center wrap-break-word whitespace-normal max-h-12 overflow-hidden w-full">{arrangement.name}</p>
          </Button>
        )}
      </li>
    </>
  );
};

export default Arrangement;
