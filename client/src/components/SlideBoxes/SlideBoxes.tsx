import Button from "../Button/Button";
import Icon from "../Icon/Icon";
import { BoxIcon, Lock, Unlock, Trash2, Plus } from "lucide-react";
import { useDispatch, useSelector } from "../../hooks";
import { setSelectedBox, updateBoxes } from "../../store/itemSlice";
import { createBox } from "../../utils/slideCreation";
import { Box } from "../../types";
import cn from "classnames";

interface SlideBoxesProps {
  className?: string;
  canEdit: boolean;
  canDeleteBox: (index: number) => boolean;
  isBoxLocked: boolean[];
  setIsBoxLocked: React.Dispatch<React.SetStateAction<boolean[]>>;
}

const SlideBoxes = ({
  className,
  canEdit,
  canDeleteBox,
  isBoxLocked,
  setIsBoxLocked,
}: SlideBoxesProps) => {
  const dispatch = useDispatch();
  const item = useSelector((state) => state.undoable.present.item);
  const { selectedSlide, selectedBox, slides } = item;

  const boxes = slides?.[selectedSlide]?.boxes || [];
  const isEmpty = boxes.length === 0;

  if (isEmpty) {
    return null;
  }

  return (
    <section
      className={cn(
        "w-full max-lg:max-h-[25vh] overflow-y-auto",
        className
      )}
    >
      <p className="text-center font-semibold border-b-2 border-black text-sm flex items-center gap-1 justify-center pb-1">
        <Icon svg={BoxIcon} color="#93c5fd" />
        Slide Boxes
      </p>
      {boxes.map((box: Box, index: number) => {
        return (
          <span
            key={box.id}
            className={`flex gap-1 bg-gray-600 border-gray-300 ${index !== boxes.length - 1 && "border-b"
              } ${selectedBox === index && "bg-gray-800"}`}
          >
            <Button
              truncate
              className="flex-1 text-xs hover:bg-gray-500"
              variant="none"
              onClick={() => dispatch(setSelectedBox(index))}
            >
              <p>
                {box.label ||
                  box.words?.trim() ||
                  box.background?.replace(
                    /https:\/\/res\.cloudinary\.com\/.+\/.+\/upload\/v.+\/.+\//g,
                    ""
                  )}
              </p>
            </Button>
            <Button
              svg={isBoxLocked[index] ? Lock : Unlock}
              color={isBoxLocked[index] ? "gray" : "green"}
              variant="tertiary"
              disabled={!canEdit}
              onClick={() => {
                setIsBoxLocked((prev) => {
                  const newLocked = [...prev];
                  newLocked[index] = !newLocked[index];
                  return newLocked;
                });
              }}
            />
            {canDeleteBox(index) && canEdit && (
              <Button
                svg={Trash2}
                variant="tertiary"
                color="red"
                onClick={() => {
                  const newBoxes = boxes.filter((b, i) => i !== index);
                  dispatch(updateBoxes({ boxes: newBoxes }));
                  if (newBoxes.length > 0) {
                    if (index > 0 && boxes[index - 1]) {
                      dispatch(setSelectedBox(index - 1));
                    } else {
                      dispatch(setSelectedBox(0));
                    }
                  }
                }}
              />
            )}
          </span>
        );
      })}
      {canEdit && (
        <Button
          className="text-xs w-full justify-center"
          svg={Plus}
          onClick={() => {
            dispatch(
              updateBoxes({
                boxes: [
                  ...boxes,
                  createBox({
                    width: 75,
                    height: 75,
                    x: 12.5,
                    y: 12.5,
                  }),
                ],
              })
            );
            dispatch(setSelectedBox(boxes.length));
          }}
        >
          Add Box
        </Button>
      )}
    </section>
  );
};

export default SlideBoxes;
