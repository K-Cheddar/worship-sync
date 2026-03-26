import Button from "../../../components/Button/Button";
import {
  Plus,
  Minus,
  Maximize2,
  ALargeSmall,
  SunMedium,
  Baseline,
  Timer,
  BookOpen,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Bold,
  Italic,
  Eraser,
} from "lucide-react";
import Input from "../../../components/Input/Input";
import { useEffect, useState, useCallback, useRef, useContext } from "react";
import { useDispatch, useSelector } from "../../../hooks";
import { useLocation } from "react-router-dom";
import {
  updateBoxProperties,
  updateItemTimerColor,
  updateBibleFontMode,
} from "../../../utils/formatter";
import {
  setItemFormatting,
  updateArrangements,
  updateBibleInfo,
  updateSlides,
} from "../../../store/itemSlice";
import Toggle from "../../../components/Toggle/Toggle";
import { BibleFontMode, ItemState } from "../../../types";
import PopOver from "../../../components/PopOver/PopOver";
import Icon from "../../../components/Icon/Icon";
import { HexColorPicker, HexColorInput } from "react-colorful";
import { updateTimerColor } from "../../../store/timersSlice";
import RadioButton from "../../../components/RadioButton/RadioButton";
import { iconColorMap } from "../../../utils/itemTypeMaps";
import { formatFree, formatSong } from "../../../utils/overflow";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { DEFAULT_FONT_PX, FONT_SIZE_BUTTON_STEP } from "../../../constants";

const MIN_FONT_PX = 25;
const MAX_FONT_PX = 500;

function clampFontSize(n: number): number {
  return Math.round(Math.max(MIN_FONT_PX, Math.min(MAX_FONT_PX, n)));
}

const SlideEditTools = ({ className }: { className?: string }) => {
  const location = useLocation();
  const dispatch = useDispatch();
  const [fontSize, setFontSize] = useState<number | string>(DEFAULT_FONT_PX);
  const [brightness, setBrightness] = useState(50);
  const [shouldKeepAspectRatio, setShouldKeepAspectRatio] = useState(false);
  const [fontColor, setFontColor] = useState("#ffffff");
  const [timerColor, setTimerColor] = useState("#ffffff");
  const [alignment, setAlignment] = useState<"left" | "center" | "right">(
    "left"
  );
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isCleaningNewlines, setIsCleaningNewlines] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fontSizeDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const fontSizeInputRef = useRef<string | number>("");
  const { hostId } = useContext(GlobalInfoContext) || {};

  const item = useSelector((state) => state.undoable.present.item);
  const { slides, selectedSlide, selectedBox, timerInfo, type } = item;
  const { timers } = useSelector((state) => state.timers);

  const timer = timers.find((t) => t.id === timerInfo?.id);

  const slide = slides[selectedSlide];

  useEffect(() => {
    const fSize = slide?.boxes?.[selectedBox]?.fontSize ?? DEFAULT_FONT_PX;
    setFontSize(fSize);
    fontSizeInputRef.current = fSize;
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

  const runWithFormatting = useCallback(
    (fn: () => void) => {
      dispatch(setItemFormatting(true));
      setTimeout(() => {
        try {
          fn();
        } finally {
          dispatch(setItemFormatting(false));
        }
      }, 0);
    },
    [dispatch]
  );

  const applyFontSize = useCallback(
    (val: number) => {
      const clamped = clampFontSize(val);
      setFontSize(clamped);
      fontSizeInputRef.current = clamped;
      runWithFormatting(() => {
        const updatedItem = updateBoxProperties({
          updatedProperties: { fontSize: clamped },
          item,
          shouldFormatItem: true,
        });
        updateItem(updatedItem);
      });
    },
    [item, runWithFormatting, updateItem]
  );

  const _updateFontSize = (val: number) => {
    const clamped = clampFontSize(val);
    setFontSize(clamped);
    fontSizeInputRef.current = clamped;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => applyFontSize(clamped), 250);
  };

  const commitFontSizeFromInput = useCallback(() => {
    const inputVal = fontSizeInputRef.current;
    const raw =
      typeof inputVal === "string"
        ? parseInt(inputVal.trim(), 10)
        : inputVal;
    const fallback =
      slide?.boxes?.[selectedBox]?.fontSize ?? DEFAULT_FONT_PX;
    const val =
      Number.isNaN(raw) ||
        inputVal === "" ||
        (typeof inputVal === "string" && inputVal.trim() === "")
        ? fallback
        : raw;
    const clamped = clampFontSize(val);
    setFontSize(clamped);
    fontSizeInputRef.current = clamped;
    applyFontSize(clamped);
  }, [slide, selectedBox, applyFontSize]);

  const handleFontSizeBlur = () => {
    if (fontSizeDebounceRef.current) {
      clearTimeout(fontSizeDebounceRef.current);
      fontSizeDebounceRef.current = null;
    }
    commitFontSizeFromInput();
  };

  const handleFontSizeChange = (val: string) => {
    setFontSize(val);
    fontSizeInputRef.current = val;
    if (fontSizeDebounceRef.current) clearTimeout(fontSizeDebounceRef.current);
    fontSizeDebounceRef.current = setTimeout(commitFontSizeFromInput, 1000);
  };

  const _updateBrightness = (val: number) => {
    const _val = Math.max(Math.min(val, 100), 10);
    setBrightness(_val);
    const updatedItem = updateBoxProperties({
      updatedProperties: { brightness: _val },
      item,
      shouldUpdateBgOnly: true,
      shouldApplyToAll: true,
      shouldSkipTitleSlide: false,
    });
    updateItem(updatedItem);
  };

  const _updateKeepAspectRatio = (val: boolean) => {
    setShouldKeepAspectRatio(val);
    const updatedItem = updateBoxProperties({
      updatedProperties: { shouldKeepAspectRatio: val },
      item,
      shouldUpdateBgOnly: true,
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

      const updatedItem = updateBoxProperties({
        updatedProperties: { fontColor: val },
        item,
        shouldApplyToAll: true,
      });
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
    runWithFormatting(() => {
      const updatedItem = updateBoxProperties({
        updatedProperties: { isBold: !isBold },
        item,
        shouldFormatItem: true,
        shouldApplyToAll: true,
      });
      updateItem(updatedItem);
    });
  };

  const _updateIsItalic = () => {
    setIsItalic(!isItalic);
    runWithFormatting(() => {
      const updatedItem = updateBoxProperties({
        updatedProperties: { isItalic: !isItalic },
        item,
        shouldFormatItem: true,
        shouldApplyToAll: true,
      });
      updateItem(updatedItem);
    });
  };

  const _updateAlignment = (align: "left" | "center" | "right") => {
    setAlignment(align);
    runWithFormatting(() => {
      const updatedItem = updateBoxProperties({
        updatedProperties: { align },
        item,
        shouldApplyToAll: true,
        shouldFormatItem: true,
      });
      updateItem(updatedItem);
    });
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
    const updatedItem = updateBibleFontMode({
      fontMode: mode,
      item,
    });
    updateItem(updatedItem);
  };

  const removeExtraNewlines = (text: string): string =>
    text.trim().replace(/\n{2,}/g, "\n");

  const handleRemoveExtraNewlines = () => {
    const arrangement = item.arrangements[item.selectedArrangement];
    if (!arrangement?.formattedLyrics?.length) return;

    setIsCleaningNewlines(true);
    const updatedFormattedLyrics = arrangement.formattedLyrics.map((section) =>
      typeof section.words === "string"
        ? { ...section, words: removeExtraNewlines(section.words) }
        : section
    );
    const updatedArrangements = item.arrangements.map((arr, i) =>
      i === item.selectedArrangement
        ? { ...arr, formattedLyrics: updatedFormattedLyrics }
        : arr
    );
    const itemWithCleanedLyrics: ItemState = {
      ...item,
      arrangements: updatedArrangements,
    };
    const formattedItem = formatSong(itemWithCleanedLyrics);
    runWithFormatting(() => {
      try {
        updateItem(formattedItem);
      } finally {
        setIsCleaningNewlines(false);
      }
    });
  };

  if (!location.pathname.includes("controller/item") || !slide) {
    return null;
  }

  const canChangeAspectRatio = item.type === "free" || item.type === "image";

  const controls = (
    <>
      <div className="flex gap-1 items-center flex-wrap justify-center">
        <Icon svg={ALargeSmall} className="border-b border-black" />
        <Button
          svg={Minus}
          variant="tertiary"
          onClick={() => {
            const num =
              typeof fontSize === "number"
                ? fontSize
                : parseInt(String(fontSize), 10) || DEFAULT_FONT_PX;
            _updateFontSize(num - FONT_SIZE_BUTTON_STEP);
          }}
        />
        <Input
          label="Font Size"
          type="text"
          inputMode="numeric"
          value={
            typeof fontSize === "string" ? fontSize : String(fontSize)
          }
          onChange={(val) => handleFontSizeChange(val as string)}
          onBlur={handleFontSizeBlur}
          className="w-10 max-md:w-12"
          inputTextSize="text-xs"
          hideLabel
          data-ignore-undo="true"
        />
        <Button
          svg={Plus}
          variant="tertiary"
          onClick={() => {
            const num =
              typeof fontSize === "number"
                ? fontSize
                : parseInt(String(fontSize), 10) || DEFAULT_FONT_PX;
            _updateFontSize(num + FONT_SIZE_BUTTON_STEP);
          }}
        />

        <PopOver
          TriggeringButton={
            <Button
              variant="tertiary"
              className="border-b-2"
              svg={Baseline}
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
          svg={Bold}
          onClick={() => _updateIsBold()}
        />
        <Button
          variant={isItalic ? "secondary" : "tertiary"}
          svg={Italic}
          onClick={() => _updateIsItalic()}
        />

        <div className="flex gap-1 items-center">
          <Button
            variant={alignment === "left" ? "secondary" : "tertiary"}
            svg={AlignLeft}
            onClick={() => _updateAlignment("left")}
          />
          <Button
            variant={alignment === "center" ? "secondary" : "tertiary"}
            svg={AlignCenter}
            onClick={() => _updateAlignment("center")}
          />
          <Button
            variant={alignment === "right" ? "secondary" : "tertiary"}
            svg={AlignRight}
            onClick={() => _updateAlignment("right")}
          />
        </div>
      </div>

      <div className="flex gap-1 items-center lg:border-l-2 lg:pl-2 max-lg:border-t-2 max-lg:pt-4">
        {type === "timer" && (
          <PopOver
            TriggeringButton={
              <Button
                variant="tertiary"
                className="border-b-2"
                svg={Timer}
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
                runWithFormatting(() => {
                  const updatedItem = formatFree({
                    ...item,
                    slides: slides.map((s, index) =>
                      index === selectedSlide ? { ...s, overflow: "fit" } : s
                    ),
                  });
                  updateItem(updatedItem);
                });
              }}
            />
            <RadioButton
              className="text-xs"
              label="Separate"
              value={slide.overflow === "separate"}
              onChange={() => {
                runWithFormatting(() => {
                  const updatedItem = formatFree({
                    ...item,
                    slides: slides.map((s, index) =>
                      index === selectedSlide
                        ? { ...s, overflow: "separate" }
                        : s
                    ),
                  });
                  updateItem(updatedItem);
                });
              }}
            />
          </>
        )}
        {type === "bible" && (
          <>
            <Icon color={iconColorMap.get("bible")} svg={BookOpen} />
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
        className={
          "flex gap-1 items-center lg:border-l-2 lg:pl-2 max-lg:border-t-2 max-lg:pt-4 lg:border-r-2 lg:pr-2 max-lg:border-b-2 max-lg:pb-4"
        }
      >
        <Icon size="xl" svg={SunMedium} color="#fbbf24" />
        <Button
          svg={Minus}
          variant="tertiary"
          onClick={() => _updateBrightness(brightness - 10)}
        />
        <Input
          label="Brightness"
          type="number"
          value={brightness}
          onChange={(val) => _updateBrightness(val as number)}
          className="w-14 md:w-10"
          inputTextSize="text-xs"
          hideLabel
          data-ignore-undo="true"
          max={100}
          min={1}
        />
        <Button
          svg={Plus}
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
      {type === "song" && (
        <Button
          svg={Eraser}
          variant="tertiary"
          onClick={handleRemoveExtraNewlines}
          title="Remove extra newlines from all slides"
          isLoading={isCleaningNewlines}
          disabled={isCleaningNewlines}
        >
          Clean Newlines
        </Button>
      )}
      <Button svg={ALargeSmall} iconSize="lg" className="invisible" />
    </>
  );

  return (
    <div className={`flex gap-2 items-center ${className || ""}`}>
      {/* leaving this outer div in case more tools are added */}

      <div className="max-lg:hidden flex gap-2 items-center">{controls}</div>
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

export default SlideEditTools;
