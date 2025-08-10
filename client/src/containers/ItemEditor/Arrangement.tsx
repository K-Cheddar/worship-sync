import { Arrangment } from "../../types";
import { ReactComponent as EditSVG } from "../../assets/icons/edit.svg";
import { ReactComponent as CheckSVG } from "../../assets/icons/check.svg";
import { ReactComponent as DeleteSVG } from "../../assets/icons/delete.svg";
import { ReactComponent as CopySVG } from "../../assets/icons/copy.svg";
import { ReactComponent as CloseSVG } from "../../assets/icons/close.svg";
import { useState } from "react";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import generateRandomId from "../../utils/generateRandomId";

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

  return (
    <>
      <li
        key={arrangement.name}
        className={"flex flex-col items-center rounded-md bg-gray-900 border border-transparent hover:border-gray-500 p-1"}
      >
        <div className="flex justify-end w-full px-2 bg-black h-6 rounded-t-sm">
          {isEditMode && (
            <Button svg={CloseSVG} onClick={() => setIsEditMode(false)} />
          )}
          <Button
            svg={isEditMode ? CheckSVG : EditSVG}
            onClick={() => {
              if (isEditMode) {
                const copiedArrangements = [...localArrangements];
                const index = copiedArrangements.findIndex(
                  ({ name }) => name === arrangement.name,
                );
                const updatedArrangement = { ...arrangement, name: value };
                copiedArrangements[index] = updatedArrangement;
                setLocalArrangements(copiedArrangements);
                setIsEditMode(false);
              } else {
                setIsEditMode(true);
              }
            }}
            variant="tertiary"
          />
          <Button
            svg={CopySVG}
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
              svg={DeleteSVG}
              variant="tertiary"
              onClick={() => {
                const copiedArrangements = [...localArrangements].filter(
                  (_, i) => i !== index,
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
          />
        ) : (
          <Button
            variant="tertiary"
            wrap
            className="px-2 py-1 text-base flex justify-center w-full break-words rounded-b-sm"
            onClick={() => setSelectedArrangement()}
          >
            {arrangement.name}
          </Button>
        )}
      </li>
    </>
  );
};

export default Arrangement;
