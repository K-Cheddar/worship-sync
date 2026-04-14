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
import { cn } from "../../utils/cnHelper";
import {
  INLINE_EDIT_CONFIRM_ICON_COLOR,
  handleInlineTextInputKeyDown,
} from "../../utils/inlineEdit";

type ArrangementProps = {
  arrangement: Arrangment;
  setLocalArrangements: React.Dispatch<React.SetStateAction<Arrangment[]>>;
  localArrangements: Arrangment[];
  setSelectedArrangement: (arrangementId?: string | null) => void;
  index: number;
  isSelected: boolean;
};

const Arrangement = ({
  arrangement,
  setLocalArrangements,
  localArrangements,
  setSelectedArrangement,
  index,
  isSelected,
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
    const targetIndex = copiedArrangements.findIndex(({ id }) => id === arrangement.id);
    const resolvedIndex = targetIndex !== -1 ? targetIndex : index;
    if (!copiedArrangements[resolvedIndex]) {
      setIsEditMode(false);
      return;
    }
    const updatedArrangement = { ...arrangement, name: value };
    copiedArrangements[resolvedIndex] = updatedArrangement;
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
        className={cn(
          "flex flex-col items-stretch rounded-md border-2 p-1 transition-colors",
          isSelected
            ? "border-cyan-400 bg-cyan-950/25 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.45)]"
            : "border-black/25 bg-gray-900 hover:border-white/30",
        )}
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
                formattedLyrics: arrangement.formattedLyrics.map((section) => ({
                  ...section,
                })),
                songOrder: arrangement.songOrder.map((section) => ({
                  ...section,
                })),
                slides: arrangement.slides.map((slide) => ({
                  ...slide,
                  boxes: slide.boxes.map((box) => ({ ...box })),
                })),
              };
              copiedArrangements.push(newArrangement);
              setLocalArrangements(copiedArrangements);
              setSelectedArrangement(newArrangement.id);
            }}
          />
          {index !== 0 && (
            <Button
              svg={Trash2}
              variant="tertiary"
              onClick={() => {
                const copiedArrangements = [...localArrangements].filter(
                  (item, i) =>
                    arrangement.id ? item.id !== arrangement.id : i !== index
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
            autoFocus
            onFocus={(event) => {
              event.currentTarget.select();
            }}
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
            className={`mt-1 w-full justify-center rounded-b-sm px-2 py-1 ${isSelected ? "text-cyan-200" : ""
              }`}
            onClick={() => setSelectedArrangement(arrangement.id)}
          >
            <p className="min-w-0 text-center wrap-break-word whitespace-normal max-h-12 overflow-hidden w-full">{arrangement.name}</p>
          </Button>
        )}
      </li>
    </>
  );
};

export default Arrangement;
