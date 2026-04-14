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
  ChevronDown,
} from "lucide-react";
import Input from "../../../components/Input/Input";
import {
  useEffect,
  useState,
  useCallback,
  useRef,
  useContext,
  useMemo,
  memo,
  type CSSProperties,
  type MutableRefObject,
} from "react";
import { useDispatch, useSelector } from "../../../hooks";
import { useLocation } from "react-router-dom";
import {
  updateBoxProperties,
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
import { Slider } from "../../../components/ui/Slider";
import { updateTimerColor } from "../../../store/timersSlice";
import RadioButton, {
  RadioGroup,
} from "../../../components/RadioButton/RadioButton";
import { iconColorMap } from "../../../utils/itemTypeMaps";
import { formatFree } from "../../../utils/overflow";
import { GlobalInfoContext } from "../../../context/globalInfo";
import {
  DEFAULT_FONT_PX,
  FONT_SIZE_BUTTON_STEP,
  FONT_SIZE_PRESETS,
} from "../../../constants";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/DropdownMenu";
import {
  cleanItemNewlines,
  itemHasCleanableNewlines,
} from "../../../utils/itemNewlineCleanup";
import { BrandAwareColorPicker } from "../../../components/ColorField/ColorField";
import { cn } from "../../../utils/cnHelper";

const MIN_FONT_PX = 25;
const MAX_FONT_PX = 500;
/** Radix aligns the menu to the chevron trigger; Input places it at `right-1.5` (6px) inset from the field edge. Negative offset shifts the menu toward the end (right) to match the input box. */
const FONT_PRESET_MENU_ALIGN_OFFSET_PX = -6;

function clampFontSize(n: number): number {
  return Math.round(Math.max(MIN_FONT_PX, Math.min(MAX_FONT_PX, n)));
}

function nearestPresetFontSize(px: number): number {
  const clamped = clampFontSize(px);
  let best = FONT_SIZE_PRESETS[0]!;
  let bestDist = Infinity;
  for (const p of FONT_SIZE_PRESETS) {
    const d = Math.abs(p - clamped);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

type SlideToolbarFontSizeFieldProps = {
  value: number | string;
  fontPresetHighlight: number;
  scrollbarWidth: string;
  fontSizeDebounceRef: MutableRefObject<NodeJS.Timeout | null>;
  onChange: (val: string) => void;
  onBlur: () => void;
  onPresetSelect: (px: number) => void;
};

/** Isolated state for preset menu open/scroll so opening the menu does not re-render all of SlideEditTools. */
const SlideToolbarFontSizeField = memo(function SlideToolbarFontSizeField({
  value,
  fontPresetHighlight,
  scrollbarWidth,
  fontSizeDebounceRef,
  onChange,
  onBlur,
  onPresetSelect,
}: SlideToolbarFontSizeFieldProps) {
  const fontPresetListScrollRef = useRef<HTMLDivElement>(null);

  /** No React state on open — avoids re-rendering this tree when the menu opens (Radix sets `data-state` on the trigger). */
  const handleFontPresetMenuOpenChange = useCallback((open: boolean) => {
    if (!open) return;
    requestAnimationFrame(() => {
      fontPresetListScrollRef.current
        ?.querySelector<HTMLElement>("[data-preset-selected=\"true\"]")
        ?.scrollIntoView({ block: "center", behavior: "auto" });
    });
  }, []);

  const handlePresetSelect = useCallback(
    (px: number) => {
      if (fontSizeDebounceRef.current) {
        clearTimeout(fontSizeDebounceRef.current);
        fontSizeDebounceRef.current = null;
      }
      onPresetSelect(px);
    },
    [fontSizeDebounceRef, onPresetSelect],
  );

  return (
    <Input
      label="Font Size"
      type="text"
      inputMode="numeric"
      value={typeof value === "string" ? value : String(value)}
      onChange={(val) => onChange(val as string)}
      onBlur={onBlur}
      className={cn(
        "w-20 shrink-0 max-md:w-24",
        "[&:has([data-state=open])_input]:rounded-t-md [&:has([data-state=open])_input]:rounded-b-none",
      )}
      inputTextSize="text-sm"
      hideLabel
      data-ignore-undo="true"
      min={MIN_FONT_PX}
      max={MAX_FONT_PX}
      numericArrowStep={FONT_SIZE_BUTTON_STEP}
      numericArrowEmptyBase={DEFAULT_FONT_PX}
      endAdornment={
        <DropdownMenu
          modal={false}
          onOpenChange={handleFontPresetMenuOpenChange}
        >
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="tertiary"
              className="inline-flex h-7 w-7 min-h-0 max-md:min-h-0 shrink-0 items-center justify-center"
              padding="p-0.5"
              svg={ChevronDown}
              iconSize="sm"
              aria-label="Font size presets"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={0}
            alignOffset={FONT_PRESET_MENU_ALIGN_OFFSET_PX}
            className="box-border flex max-h-[min(18rem,55vh)] w-20 max-w-20 min-w-0 flex-col overflow-hidden rounded-b-md rounded-t-none border border-neutral-700 border-t-neutral-600 bg-neutral-900 p-0 text-neutral-100 shadow-none max-md:w-24 max-md:max-w-24"
          >
            <div
              ref={fontPresetListScrollRef}
              className="scrollbar-portal min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-1"
              style={
                {
                  "--scrollbar-width": scrollbarWidth,
                } as CSSProperties
              }
            >
              {FONT_SIZE_PRESETS.map((px) => {
                const isSelected = px === fontPresetHighlight;
                return (
                  <DropdownMenuItem
                    key={px}
                    data-preset-selected={isSelected || undefined}
                    className={cn(
                      "justify-center px-1.5 py-1 text-xs tabular-nums",
                      isSelected
                        ? "bg-cyan-950/70 font-medium text-cyan-50 ring-1 ring-cyan-500/35 ring-inset hover:bg-cyan-950/80 focus:bg-cyan-950/80 data-highlighted:bg-cyan-950/80 data-highlighted:text-cyan-50"
                        : "text-neutral-100 hover:bg-neutral-800 hover:text-neutral-100 focus:bg-neutral-800 focus:text-neutral-100 data-highlighted:bg-neutral-800 data-highlighted:text-neutral-100",
                    )}
                    onSelect={() => handlePresetSelect(px)}
                  >
                    {px}
                  </DropdownMenuItem>
                );
              })}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    />
  );
});

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
  const globalInfo = useContext(GlobalInfoContext);
  const { hostId } = globalInfo || {};
  const brandColors = globalInfo?.churchBranding.colors || [];

  const item = useSelector((state) => state.undoable.present.item);
  const scrollbarWidth = useSelector(
    (state) =>
      state.undoable.present.preferences?.scrollbarWidth ?? "thin"
  );
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
      dispatch(
        updateSlides({
          slides: updatedItem.slides,
          formattedSections: updatedItem.formattedSections,
        })
      );
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

      if (timerInfo?.id) {
        dispatch(updateTimerColor({ id: timerInfo?.id, color: val, hostId }));
      }
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

  const handleRemoveExtraNewlines = useCallback(() => {
    if (!itemHasCleanableNewlines(item)) return;
    setIsCleaningNewlines(true);
    runWithFormatting(() => {
      try {
        updateItem(cleanItemNewlines(item));
      } finally {
        setIsCleaningNewlines(false);
      }
    });
  }, [item, runWithFormatting, updateItem]);

  const currentFontPx = useMemo(() => {
    const raw =
      typeof fontSize === "number"
        ? fontSize
        : parseInt(String(fontSize).trim(), 10);
    if (Number.isFinite(raw)) return clampFontSize(raw);
    return slide?.boxes?.[selectedBox]?.fontSize ?? DEFAULT_FONT_PX;
  }, [fontSize, slide, selectedBox]);

  const fontPresetHighlight = useMemo(
    () => nearestPresetFontSize(currentFontPx),
    [currentFontPx]
  );

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
        <SlideToolbarFontSizeField
          value={fontSize}
          fontPresetHighlight={fontPresetHighlight}
          scrollbarWidth={scrollbarWidth}
          fontSizeDebounceRef={fontSizeDebounceRef}
          onChange={handleFontSizeChange}
          onBlur={handleFontSizeBlur}
          onPresetSelect={applyFontSize}
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
          <BrandAwareColorPicker
            color={fontColor}
            onChange={_updateFontColor}
            colors={brandColors}
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
            <BrandAwareColorPicker
              color={timerColor}
              onChange={_updateTimerColor}
              colors={brandColors}
            />
          </PopOver>
        )}
        {type === "free" && (
          <>
            <p className="text-sm font-semibold">Overflow:</p>
            <RadioGroup
              value={slide.overflow === "fit" ? "fit" : "separate"}
              onValueChange={(v) => {
                const overflow = v as "fit" | "separate";
                runWithFormatting(() => {
                  const updatedItem = formatFree({
                    ...item,
                    slides: slides.map((s, index) =>
                      index === selectedSlide ? { ...s, overflow } : s
                    ),
                  });
                  updateItem(updatedItem);
                });
              }}
              className="flex flex-wrap items-center gap-1"
            >
              <RadioButton
                className="text-xs"
                optionValue="fit"
                label="Fit"
              />
              <RadioButton
                className="text-xs"
                optionValue="separate"
                label="Separate"
              />
            </RadioGroup>
          </>
        )}
        {type === "bible" && (
          <>
            <Icon color={iconColorMap.get("bible")} svg={BookOpen} />
            <p className="text-sm font-semibold">Mode:</p>
            <RadioGroup
              value={item.bibleInfo?.fontMode ?? "fit"}
              onValueChange={(v) =>
                _updateBibleFontMode(v as BibleFontMode)
              }
              className="flex flex-wrap items-center gap-1"
            >
              <RadioButton className="text-xs" optionValue="fit" label="Fit" />
              <RadioButton
                className="text-xs"
                optionValue="separate"
                label="Separate"
              />
              <RadioButton
                className="text-xs"
                optionValue="multiple"
                label="Multiple"
              />
            </RadioGroup>
          </>
        )}
      </div>

      <div
        className={
          "flex gap-1 items-center lg:border-l-2 lg:pl-2 max-lg:border-t-2 max-lg:pt-4 lg:border-r-2 lg:pr-2 max-lg:border-b-2 max-lg:pb-4"
        }
      >
        <Icon size="xl" svg={SunMedium} color="#fbbf24" />
        <Slider
          className="w-24 shrink-0 md:w-28"
          value={[brightness]}
          min={10}
          max={100}
          step={1}
          onValueChange={(v: number[]) =>
            _updateBrightness(v[0] ?? brightness)
          }
          aria-label="Background brightness"
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
          min={10}
        />
      </div>
      {canChangeAspectRatio && (
        <Toggle
          label="Keep Aspect Ratio"
          value={shouldKeepAspectRatio}
          onChange={(val) => _updateKeepAspectRatio(val)}
        />
      )}
      {(type === "song" || type === "free") && (
        <Button
          svg={Eraser}
          variant="tertiary"
          onClick={handleRemoveExtraNewlines}
          title="Remove extra newlines from all slides"
          isLoading={isCleaningNewlines}
          disabled={isCleaningNewlines}
        >
          Remove Blank Lines
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
