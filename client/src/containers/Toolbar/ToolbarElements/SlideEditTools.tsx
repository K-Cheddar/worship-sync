import Button from "../../../components/Button/Button";
import { ReactComponent as AddSVG } from "../../../assets/icons/add.svg";
import { ReactComponent as MinusSVG } from "../../../assets/icons/remove.svg";
import { ReactComponent as ExpandSVG } from "../../../assets/icons/expand.svg";
import Input from "../../../components/Input/Input";
import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "../../../hooks";
import { useLocation } from "react-router-dom";
import {
  updateFontSize,
  updateBrightness,
  updateKeepAspectRatio,
} from "../../../utils/formatter";
import { updateArrangements, updateSlides } from "../../../store/itemSlice";
import Toggle from "../../../components/Toggle/Toggle";
import { ItemState } from "../../../types";
import PopOver from "../../../components/PopOver/PopOver";

const SlideEditTools = () => {
  const location = useLocation();
  const dispatch = useDispatch();
  const [fontSize, setFontSize] = useState(24);
  const [brightness, setBrightness] = useState(50);
  const [shouldKeepAspectRatio, setShouldKeepAspectRatio] = useState(false);

  const item = useSelector((state) => state.undoable.present.item);
  const { slides, selectedSlide } = item;

  const slide = slides[selectedSlide];

  useEffect(() => {
    const fSize = (slide?.boxes?.[1]?.fontSize || 2.5) * 10;
    setFontSize(fSize);
    setBrightness(slide?.boxes?.[0]?.brightness || 100);
    setShouldKeepAspectRatio(slide?.boxes?.[0]?.shouldKeepAspectRatio || false);
  }, [slide]);

  const updateItem = (updatedItem: ItemState) => {
    dispatch(updateSlides({ slides: updatedItem.slides }));
    if (updatedItem.arrangements.length > 0) {
      dispatch(updateArrangements({ arrangements: updatedItem.arrangements }));
    }
  };

  const _updateFontSize = (val: number) => {
    const _val = Math.max(Math.min(val, 48), 1);
    setFontSize(_val);
    const fSize = _val / 10;
    const updatedItem = updateFontSize({ fontSize: fSize, item });
    updateItem(updatedItem);
  };

  const _updateBrightness = (val: number) => {
    const _val = Math.max(Math.min(val, 100), 1);
    setBrightness(_val);
    const updatedItem = updateBrightness({ brightness: _val, item });
    updateItem(updatedItem);
  };

  const _updateKeepAspectRatio = (val: boolean) => {
    setShouldKeepAspectRatio(val);
    const updatedItem = updateKeepAspectRatio({
      shouldKeepAspectRatio: val,
      item,
    });
    updateItem(updatedItem);
  };

  if (!location.pathname.includes("controller/item") || !slide) {
    return null;
  }

  const canChangeAspectRatio = ~(item.type === "free" || item.type === "image");

  const controls = (
    <>
      <div className="flex gap-1 items-center">
        <p className="text-sm font-semibold">Font Size:</p>
        <Button
          svg={MinusSVG}
          variant="tertiary"
          onClick={() => _updateFontSize(fontSize - 1)}
        />
        <Input
          label="Font Size"
          type="number"
          value={fontSize}
          onChange={(val) => _updateFontSize(val as number)}
          className="w-10"
          hideLabel
          data-ignore-undo="true"
        />
        <Button
          svg={AddSVG}
          variant="tertiary"
          onClick={() => _updateFontSize(fontSize + 1)}
        />
      </div>
      <div
        className={`flex gap-1 items-center lg:border-l-2 lg:pl-2 max-lg:border-t-2 max-lg:pt-4 ${
          canChangeAspectRatio
            ? "lg:border-r-2 lg:pr-2 max-lg:border-b-2 max-lg:pb-4"
            : ""
        }`}
      >
        <p className="text-sm font-semibold">Brightness:</p>
        <Button
          svg={MinusSVG}
          variant="tertiary"
          onClick={() => _updateBrightness(brightness - 10)}
        />
        <Input
          label="Brightness"
          type="number"
          value={brightness}
          onChange={(val) => _updateBrightness(val as number)}
          className="w-10"
          hideLabel
          data-ignore-undo="true"
          max={100}
          min={1}
        />
        <Button
          svg={AddSVG}
          variant="tertiary"
          onClick={() => _updateBrightness(brightness + 10)}
        />
      </div>
      {canChangeAspectRatio && (
        <Toggle
          label="Keep Aspect Ratio"
          value={shouldKeepAspectRatio}
          onChange={(val) => _updateKeepAspectRatio(val)}
        />
      )}
    </>
  );

  return (
    <div className="flex gap-2 items-center">
      {/* leaving this outer div in case more tools are added */}

      <div className="max-lg:hidden flex gap-2 items-center">{controls}</div>
      <PopOver
        TriggeringButton={
          <Button className="lg:hidden" variant="tertiary" svg={ExpandSVG}>
            Tools
          </Button>
        }
      >
        <div className="flex flex-col gap-4 items-center p-4">{controls}</div>
      </PopOver>
    </div>
  );
};

export default SlideEditTools;
