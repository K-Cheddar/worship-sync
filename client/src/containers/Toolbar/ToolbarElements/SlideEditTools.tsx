import Button from "../../../components/Button/Button";
import { ReactComponent as AddSVG } from "../../../assets/icons/add.svg";
import { ReactComponent as MinusSVG } from "../../../assets/icons/remove.svg";
import { ReactComponent as ExpandSVG } from "../../../assets/icons/expand.svg";
import { ReactComponent as TextFieldSVG } from "../../../assets/icons/text-field.svg";
import { ReactComponent as BrightnessSVG } from "../../../assets/icons/brightness.svg";
import { ReactComponent as ColorSVG } from "../../../assets/icons/text-color.svg";
import { ReactComponent as TimerSVG } from "../../../assets/icons/timer.svg";
import { ReactComponent as BibleSVG } from "../../../assets/icons/book.svg";
import { ReactComponent as AlignLeftSVG } from "../../../assets/icons/align-left.svg";
import { ReactComponent as AlignCenterSVG } from "../../../assets/icons/align-center.svg";
import { ReactComponent as AlignRightSVG } from "../../../assets/icons/align-right.svg";
import { ReactComponent as BoldSVG } from "../../../assets/icons/format-bold.svg";
import { ReactComponent as ItalicSVG } from "../../../assets/icons/format-italic.svg";
import Input from "../../../components/Input/Input";
import { useEffect, useState, useCallback, useRef, useContext } from "react";
import { useDispatch, useSelector } from "../../../hooks";
import { useLocation } from "react-router-dom";
import {
  updateFontSize,
  updateBrightness,
  updateKeepAspectRatio,
  updateFontColor,
  updateItemTimerColor,
  updateBibleFontMode,
} from "../../../utils/formatter";
import {
  updateArrangements,
  updateBibleInfo,
  updateSlides,
} from "../../../store/itemSlice";
import Toggle from "../../../components/Toggle/Toggle";
import { BibleFontMode, ItemState } from "../../../types";
import PopOver from "../../../components/PopOver/PopOver";
import Icon from "../../../components/Icon/Icon";
import BoxEditor from "./BoxEditor";
import { HexColorPicker, HexColorInput } from "react-colorful";
import { updateTimerColor } from "../../../store/timersSlice";
import RadioButton from "../../../components/RadioButton/RadioButton";
import { iconColorMap } from "../../../utils/itemTypeMaps";
import { formatFree } from "../../../utils/overflow";
import { GlobalInfoContext } from "../../../context/globalInfo";

const SlideEditTools = ({ className }: { className?: string }) => {
  const location = useLocation();
  const dispatch = useDispatch();
  const [fontSize, setFontSize] = useState(24);
  const [brightness, setBrightness] = useState(50);
  const [shouldKeepAspectRatio, setShouldKeepAspectRatio] = useState(false);
  const [fontColor, setFontColor] = useState("#ffffff");
  const [timerColor, setTimerColor] = useState("#ffffff");
  const [alignment, setAlignment] = useState<"left" | "center" | "right">(
    "left"
  );
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout>();
  const { hostId } = useContext(GlobalInfoContext) || {};

  const item = useSelector((state) => state.undoable.present.item);
  const { slides, selectedSlide, selectedBox, timerInfo, type } = item;
  const { timers } = useSelector((state) => state.timers);

  const timer = timers.find((t) => t.id === timerInfo?.id);

  const slide = slides[selectedSlide];

  useEffect(() => {
    const fSize = (slide?.boxes?.[selectedBox]?.fontSize || 2.5) * 10;
    setFontSize(fSize);
    setBrightness(slide?.boxes?.[0]?.brightness || 100);
    setShouldKeepAspectRatio(slide?.boxes?.[0]?.shouldKeepAspectRatio || false);
    setFontColor(slide?.boxes?.[selectedBox]?.fontColor || "#ffffff");
    setTimerColor(timer?.color || "#ffffff");
    setAlignment(slide?.boxes?.[selectedBox]?.align || "left");
    setIsBold(slide?.boxes?.[selectedBox]?.isBold || false);
    setIsItalic(slide?.boxes?.[selectedBox]?.isItalic || false);
  }, [slide, selectedBox, timer]);

  const updateItem = useCallback(
    (updatedItem: ItemState) => {
      dispatch(updateSlides({ slides: updatedItem.slides }));
      if (updatedItem.arrangements.length > 0) {
        dispatch(
          updateArrangements({ arrangements: updatedItem.arrangements })
        );
      }
      if (updatedItem.bibleInfo) {
        dispatch(updateBibleInfo({ bibleInfo: updatedItem.bibleInfo }));
      }
    },
    [dispatch]
  );

  const _updateFontSize = (val: number) => {
    const _val = Math.round(Math.max(Math.min(val, 150), 1));
    setFontSize(_val);

    // Debounce updateFontSize
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      const fSize = _val / 10;
      const updatedItem = updateFontSize({ fontSize: fSize, item });
      updateItem(updatedItem);
    }, 250);
  };

  const _updateBrightness = (val: number) => {
    const _val = Math.max(Math.min(val, 100), 10);
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

  const _updateFontColor = (val: string) => {
    if (val.includes("NaN")) {
      return;
    }

    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set new timeout
    timeoutRef.current = setTimeout(() => {
      setFontColor(val);

      const updatedItem = updateFontColor({ fontColor: val, item });
      updateItem(updatedItem);
    }, 250);
  };

  const _updateTimerColor = (val: string) => {
    if (val.includes("NaN")) {
      return;
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      setTimerColor(val);

      const updatedItem = updateItemTimerColor({ timerColor: val, item });
      if (timerInfo?.id) {
        dispatch(updateTimerColor({ id: timerInfo?.id, color: val, hostId }));
      }
      updateItem(updatedItem);
    }, 250);
  };

  const _updateIsBold = () => {
    setIsBold(!isBold);
    const updatedSlides = slides.map((s, index) => {
      if (index === selectedSlide) {
        return {
          ...s,
          boxes: s.boxes.map((box, boxIndex) => {
            if (boxIndex === selectedBox) {
              return { ...box, isBold: !isBold };
            }
            return box;
          }),
        };
      }
      return s;
    });
    const updatedItem = { ...item, slides: updatedSlides };
    updateItem(updatedItem);
  };

  const _updateIsItalic = () => {
    setIsItalic(!isItalic);
    const updatedSlides = slides.map((s, index) => {
      if (index === selectedSlide) {
        return {
          ...s,
          boxes: s.boxes.map((box, boxIndex) =>
            boxIndex === selectedBox ? { ...box, isItalic: !isItalic } : box
          ),
        };
      }
      return s;
    });
    const updatedItem = { ...item, slides: updatedSlides };
    updateItem(updatedItem);
  };

  const _updateAlignment = (align: "left" | "center" | "right") => {
    setAlignment(align);
    const updatedSlides = slides.map((s, index) => {
      if (index === selectedSlide) {
        return {
          ...s,
          boxes: s.boxes.map((box, boxIndex) => {
            if (boxIndex === selectedBox) {
              return { ...box, align };
            }
            return box;
          }),
        };
      }
      return s;
    });
    const updatedItem = { ...item, slides: updatedSlides };
    updateItem(updatedItem);
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const _updateBibleFontMode = (mode: BibleFontMode) => {
    const updatedItem = updateBibleFontMode({ fontMode: mode, item });
    updateItem(updatedItem);
  };

  if (!location.pathname.includes("controller/item") || !slide) {
    return null;
  }

  const canChangeAspectRatio = item.type === "free" || item.type === "image";

  const controls = (
    <>
      <div className="flex gap-1 items-center">
        <Icon svg={TextFieldSVG} className="border-b border-black" />
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
          className="w-8 2xl:w-10"
          inputTextSize="text-xs"
          hideLabel
          data-ignore-undo="true"
        />
        <Button
          svg={AddSVG}
          variant="tertiary"
          onClick={() => _updateFontSize(fontSize + 1)}
        />

        <PopOver
          TriggeringButton={
            <Button
              variant="tertiary"
              className="border-b-2"
              svg={ColorSVG}
              style={{ borderColor: fontColor }}
            />
          }
        >
          <HexColorPicker color={fontColor} onChange={_updateFontColor} />
          <HexColorInput
            color={fontColor}
            prefixed
            onChange={_updateFontColor}
            className="text-black w-full mt-2"
          />
        </PopOver>

        <Button
          variant={isBold ? "secondary" : "tertiary"}
          svg={BoldSVG}
          onClick={() => _updateIsBold()}
        />
        <Button
          variant={isItalic ? "secondary" : "tertiary"}
          svg={ItalicSVG}
          onClick={() => _updateIsItalic()}
        />

        <Button
          variant={alignment === "left" ? "secondary" : "tertiary"}
          svg={AlignLeftSVG}
          onClick={() => _updateAlignment("left")}
        />
        <Button
          variant={alignment === "center" ? "secondary" : "tertiary"}
          svg={AlignCenterSVG}
          onClick={() => _updateAlignment("center")}
        />
        <Button
          variant={alignment === "right" ? "secondary" : "tertiary"}
          svg={AlignRightSVG}
          onClick={() => _updateAlignment("right")}
        />
      </div>

      <div className="flex gap-1 items-center lg:border-l-2 lg:pl-2 max-lg:border-t-2 max-lg:pt-4">
        {type === "timer" && (
          <PopOver
            TriggeringButton={
              <Button
                variant="tertiary"
                className="border-b-2"
                svg={TimerSVG}
                style={{ borderColor: timerColor }}
              />
            }
          >
            <HexColorPicker color={timerColor} onChange={_updateTimerColor} />
            <HexColorInput
              color={timerColor}
              prefixed
              onChange={_updateTimerColor}
              className="text-black w-full mt-2"
            />
          </PopOver>
        )}
        {type === "free" && (
          <>
            <p className="text-sm font-semibold">Overflow:</p>
            <RadioButton
              className="text-xs"
              label="Fit"
              value={slide.overflow === "fit"}
              onChange={() => {
                const updatedItem = formatFree({
                  ...item,
                  slides: slides.map((s, index) =>
                    index === selectedSlide ? { ...s, overflow: "fit" } : s
                  ),
                });
                updateItem(updatedItem);
              }}
            />
            <RadioButton
              className="text-xs"
              label="Separate"
              value={slide.overflow === "separate"}
              onChange={() => {
                const updatedItem = formatFree({
                  ...item,
                  slides: slides.map((s, index) =>
                    index === selectedSlide ? { ...s, overflow: "separate" } : s
                  ),
                });
                updateItem(updatedItem);
              }}
            />
          </>
        )}
        {type === "bible" && (
          <>
            <Icon color={iconColorMap.get("bible")} svg={BibleSVG} />
            <p className="text-sm font-semibold">Mode:</p>
            <RadioButton
              className="text-xs"
              onChange={() => _updateBibleFontMode("fit")}
              value={item.bibleInfo?.fontMode === "fit"}
              label="Fit"
            />
            <RadioButton
              className="text-xs"
              onChange={() => _updateBibleFontMode("separate")}
              value={item.bibleInfo?.fontMode === "separate"}
              label="Separate"
            />
            <RadioButton
              className="text-xs"
              onChange={() => _updateBibleFontMode("multiple")}
              value={item.bibleInfo?.fontMode === "multiple"}
              label="Multiple"
            />
          </>
        )}
      </div>

      <div
        className={`flex gap-1 items-center lg:border-l-2 lg:pl-2 max-lg:border-t-2 max-lg:pt-4 lg:border-r-2 lg:pr-2 max-lg:border-b-2 max-lg:pb-4`}
      >
        <Icon size="xl" svg={BrightnessSVG} color="#fbbf24" />
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
          className="w-8 2xl:w-10"
          inputTextSize="text-xs"
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
      <BoxEditor />
      {canChangeAspectRatio && (
        <Toggle
          label="Keep Aspect Ratio"
          value={shouldKeepAspectRatio}
          onChange={(val) => _updateKeepAspectRatio(val)}
        />
      )}
      <Button svg={TextFieldSVG} iconSize="lg" className="invisible" />
    </>
  );

  return (
    <div className={`flex gap-2 items-center ${className || ""}`}>
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
