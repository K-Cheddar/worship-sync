import Button from "../../../components/Button/Button";
import { ReactComponent as AddSVG } from "../../../assets/icons/add.svg";
import { ReactComponent as MinusSVG } from "../../../assets/icons/remove.svg";
import Input from "../../../components/Input/Input";
import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "../../../hooks";
import { useLocation } from "react-router-dom";
import { updateFontSize } from "../../../utils/formatter";
import { setActiveItem } from "../../../store/itemSlice";

const SlideEditTools = () => {
  const location = useLocation();
  const dispatch = useDispatch();
  const [fontSize, setFontSize] = useState(24);

  const item = useSelector((state) => state.item);
  const { slides, selectedSlide } = item;

  const slide = slides[selectedSlide];

  useEffect(() => {
    const fSize = (slide?.boxes?.[1]?.fontSize || 2.5) * 10;
    setFontSize(fSize);
  }, [slide]);

  const _updateFontSize = (val: number) => {
    const _val = Math.max(Math.min(val, 48), 1);
    setFontSize(_val);
    const fSize = _val / 10;
    console.log(val, _val, fSize);
    const updatedItem = updateFontSize({ fontSize: fSize, item });
    console.log({ updatedItem });
    dispatch(setActiveItem(updatedItem));
  };

  if (!location.pathname.includes("controller/item") || !slide) {
    return null;
  }

  return (
    <div>
      {/* leaving this outer div in case more tools are added */}
      <div className="flex gap-1 items-center">
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
        />
        <Button
          svg={AddSVG}
          variant="tertiary"
          onClick={() => _updateFontSize(fontSize + 1)}
        />
      </div>
    </div>
  );
};

export default SlideEditTools;
