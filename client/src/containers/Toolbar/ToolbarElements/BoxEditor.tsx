import Button from "../../../components/Button/Button";
import Input from "../../../components/Input/Input";

import { Maximize2 } from "lucide-react";

import textFull from "../../../assets/images/textbox_full.png";
import textMid from "../../../assets/images/textbox_mid.png";
import textLeftHalf from "../../../assets/images/textbox_leftHalf.png";
import textRightHalf from "../../../assets/images/textbox_rightHalf.png";
import textMatch from "../../../assets/images/textbox_match.png";
import textLowerThird from "../../../assets/images/textbox_lowerThird.png";
import textUpperThird from "../../../assets/images/textbox_upperThird.png";
import textMidThird from "../../../assets/images/textbox_midThird.png";

import { ItemState } from "../../../types";
import { useSelector } from "../../../hooks";
import { useEffect, useMemo, useState } from "react";
import RadioButton from "../../../components/RadioButton/RadioButton";
import PopOver from "../../../components/PopOver/PopOver";
import { updateBoxProperties } from "../../../utils/formatter";

const BoxEditor = ({
  updateItem,
  isMobile,
  className,
}: {
  updateItem: (item: ItemState) => void;
  isMobile: boolean;
  className?: string;
}) => {
  const item = useSelector((state) => state.undoable.present.item);
  const { selectedSlide, selectedBox, slides } = item;

  const boxes = useMemo(() => {
    return slides[selectedSlide]?.boxes || [];
  }, [slides, selectedSlide]);

  const currentBox = useMemo(() => {
    return boxes[selectedBox] || {};
  }, [boxes, selectedBox]);

  const [shouldApplyToAll, setShouldApplyToAll] = useState(
    item.type === "free" ? false : true
  );

  useEffect(() => {
    setShouldApplyToAll(item.type === "free" ? false : true);
  }, [item.type]);

  const updateBoxSize = ({
    width,
    height,
    x,
    y,
  }: {
    width: number;
    height: number;
    x: number;
    y: number;
  }) => {
    const updatedItem = updateBoxProperties({
      updatedProperties: { width, height, x, y },
      item,
      shouldFormatItem: true,
      shouldApplyToAll: shouldApplyToAll,
      isMobile,
    });
    updateItem(updatedItem);
  };

  const handleInputChange = (
    field: "x" | "y" | "width" | "height",
    value: string
  ) => {
    let numValue = parseFloat(value);
    if (field === "x" || field === "y") {
      if (numValue > 100) numValue = 100;
      if (numValue < 0) numValue = 0;
    }
    if (!isNaN(numValue)) {
      updateBoxSize({
        width: currentBox.width || 0,
        height: currentBox.height || 0,
        x: currentBox.x || 0,
        y: currentBox.y || 0,
        [field]: numValue,
      });
    }
  };

  const controls = (
    <>
      <div className="flex flex-wrap gap-2 items-center max-lg:justify-center">
        <Input
          type="number"
          value={currentBox.x || 0}
          onChange={(value) => handleInputChange("x", value.toString())}
          label="X"
          labelClassName="mr-2 max-lg:mb-2"
          min={0}
          max={100}
          inputWidth="w-16"
          inputTextSize="text-xs"
          hideSpinButtons={false}
        />
        <Input
          type="number"
          value={currentBox.y || 0}
          onChange={(value) => handleInputChange("y", value.toString())}
          label="Y"
          labelClassName="mr-2 max-lg:mb-2"
          min={0}
          max={100}
          inputWidth="w-16"
          inputTextSize="text-xs"
          hideSpinButtons={false}
        />
        <Input
          type="number"
          value={currentBox.width}
          onChange={(value) => handleInputChange("width", value.toString())}
          label="Width"
          labelClassName="mr-2 max-lg:mb-2"
          min={0}
          max={100}
          inputWidth="w-16"
          inputTextSize="text-xs"
          hideSpinButtons={false}
        />
        <Input
          type="number"
          value={currentBox.height}
          onChange={(value) => handleInputChange("height", value.toString())}
          label="Height"
          labelClassName="mr-2 max-lg:mb-2"
          min={0}
          max={100}
          inputWidth="w-16"
          inputTextSize="text-xs"
          hideSpinButtons={false}
        />
      </div>
      <div className="flex flex-wrap gap-2 items-center justify-center max-lg:pt-2">
        <Button
          image={textFull}
          variant="tertiary"
          className="w-10"
          padding="p-0"
          onClick={() =>
            updateBoxSize({
              width: 100,
              height: 100,
              x: 0,
              y: 0,
            })
          }
        />
        <Button
          image={textMid}
          variant="tertiary"
          className="w-10"
          padding="p-0"
          onClick={() =>
            updateBoxSize({
              width: 100,
              height: 64,
              x: 0,
              y: 18,
            })
          }
        />
        <Button
          image={textLeftHalf}
          variant="tertiary"
          className="w-10"
          padding="p-0"
          onClick={() =>
            updateBoxSize({
              width: 50,
              height: 100,
              x: 0,
              y: 0,
            })
          }
        />
        <Button
          image={textRightHalf}
          variant="tertiary"
          className="w-10"
          padding="p-0"
          onClick={() =>
            updateBoxSize({
              width: 50,
              height: 100,
              x: 50,
              y: 0,
            })
          }
        />
        <Button
          image={textLowerThird}
          variant="tertiary"
          className="w-10"
          padding="p-0"
          onClick={() =>
            updateBoxSize({
              width: 100,
              height: 35,
              x: 0,
              y: 65,
            })
          }
        />
        <Button
          image={textMidThird}
          variant="tertiary"
          className="w-10"
          padding="p-0"
          onClick={() =>
            updateBoxSize({
              width: 100,
              height: 35,
              x: 0,
              y: 35,
            })
          }
        />
        <Button
          image={textUpperThird}
          variant="tertiary"
          className="w-10"
          padding="p-0"
          onClick={() =>
            updateBoxSize({
              width: 100,
              height: 35,
              x: 0,
              y: 0,
            })
          }
        />
        <Button
          image={textMatch}
          variant="tertiary"
          className="w-10"
          padding="p-0"
          onClick={() =>
            updateBoxSize({
              width: currentBox.width,
              height: currentBox.height,
              x: currentBox.x || 0,
              y: currentBox.y || 0,
            })
          }
        />
      </div>
      <div className="flex gap-2 items-center justify-center max-lg:pt-2">
        <RadioButton
          className="text-xs w-fit"
          label="Apply to selected"
          value={!shouldApplyToAll}
          onChange={() => setShouldApplyToAll(false)}
        />
        <RadioButton
          label="Apply to all"
          className="text-xs w-fit"
          value={shouldApplyToAll}
          onChange={() => setShouldApplyToAll(true)}
        />
      </div>
    </>
  );

  return (
    <div className={`flex gap-2 items-center ${className || ""}`}>
      <div className="max-lg:hidden flex gap-2 items-center flex-wrap py-1">
        {controls}
      </div>
      <PopOver
        TriggeringButton={
          <Button className="lg:hidden" variant="tertiary" svg={Maximize2}>
            Tools
          </Button>
        }
      >
        <div className="flex flex-col gap-4 items-center p-4">{controls}</div>
      </PopOver>
    </div>
  );
};

export default BoxEditor;
