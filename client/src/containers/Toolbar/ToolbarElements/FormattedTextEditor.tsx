import Button from "../../../components/Button/Button";
import Input from "../../../components/Input/Input";
import { useDispatch, useSelector } from "../../../hooks";
import { updateSlides } from "../../../store/itemSlice";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import RadioButton, {
  RadioGroup,
} from "../../../components/RadioButton/RadioButton";
import { PaintBucket } from "lucide-react";
import { ChevronsUpDown } from "lucide-react";
import { Image } from "lucide-react";
import { Plus } from "lucide-react";
import { Minus } from "lucide-react";
import { AlignLeft } from "lucide-react";
import { AlignCenter } from "lucide-react";
import { AlignRight } from "lucide-react";
import { ALargeSmall } from "lucide-react";
import { Bold } from "lucide-react";
import { Italic } from "lucide-react";
import { ChevronDown } from "lucide-react";
import PopOver from "../../../components/PopOver/PopOver";
import { updateFormattedTextDisplayInfo } from "../../../utils/formatter";
import cn from "classnames";
import Icon from "../../../components/Icon/Icon";
import { FONT_SIZE_BUTTON_STEP } from "../../../constants";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { BrandAwareColorPicker } from "../../../components/ColorField/ColorField";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/DropdownMenu";

/** Display units are rem×10 (e.g. 15 = 1.5 rem). */
const FORMATTED_TEXT_FONT_PRESETS: readonly number[] = [
  8, 10, 12, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 56, 64, 80, 100,
  120, 150,
];

function nearestFormattedTextPreset(display: number): number {
  let best = FORMATTED_TEXT_FONT_PRESETS[0]!;
  let bestDist = Infinity;
  for (const p of FORMATTED_TEXT_FONT_PRESETS) {
    const d = Math.abs(p - display);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

type fieldType =
  | "paddingX"
  | "paddingY"
  | "fontSize"
  | "textColor"
  | "backgroundColor"
  | "align"
  | "isBold"
  | "isItalic";

const FormattedTextEditor = ({ className }: { className?: string }) => {
  const item = useSelector((state) => state.undoable.present.item);

  const { slides, selectedSlide, type } = item;

  const formattedTextDisplayInfo = useMemo(() => {
    return slides[selectedSlide]?.formattedTextDisplayInfo;
  }, [slides, selectedSlide]);

  const stateFromInfo = () => ({
    backgroundColor: formattedTextDisplayInfo?.backgroundColor || "#eb8934",
    textColor: formattedTextDisplayInfo?.textColor || "#ffffff",
    fontSize: (formattedTextDisplayInfo?.fontSize || 1.5) * 10,
    paddingX: formattedTextDisplayInfo?.paddingX || 2,
    paddingY: formattedTextDisplayInfo?.paddingY || 1,
    align: formattedTextDisplayInfo?.align || "left",
    isBold: formattedTextDisplayInfo?.isBold || false,
    isItalic: formattedTextDisplayInfo?.isItalic || false,
  });

  const [formattedTextState, setFormattedTextState] = useState(stateFromInfo);

  useEffect(() => {
    setFormattedTextState(stateFromInfo());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formattedTextDisplayInfo]);

  const dispatch = useDispatch();
  const globalInfo = useContext(GlobalInfoContext);
  const brandColors = globalInfo?.churchBranding.colors || [];

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [shouldApplyToAll, setShouldApplyToAll] = useState(true);

  const runUpdate = (
    field: fieldType,
    updatedValue: string | number | boolean
  ) => {
    const updatedItem = updateFormattedTextDisplayInfo({
      formattedTextDisplayInfo: {
        ...formattedTextDisplayInfo,
        text: formattedTextDisplayInfo?.text || "",
        [field]: updatedValue,
      },
      item: item,
      shouldApplyToAll: shouldApplyToAll,
    });
    dispatch(updateSlides({ slides: updatedItem.slides }));
  };

  const handleChange = (field: fieldType, value: string) => {
    let updatedValue: string | number | boolean = value;
    let numValue = parseFloat(value);

    if (field === "paddingX" || field === "paddingY") {
      if (numValue > 100) numValue = 100;
      if (numValue < 0) numValue = 0;
      if (isNaN(numValue)) numValue = 0;
      updatedValue = numValue;
    }
    if (field === "fontSize") {
      let numValue = parseFloat(value);
      numValue = Math.round(Math.max(Math.min(numValue, 150), 1));
      updatedValue = numValue / 10;
    }
    if (field === "isBold" || field === "isItalic") {
      updatedValue = value === "true" ? true : false;
    }

    if (field === "textColor" || field === "backgroundColor") {
      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      // Set new timeout
      timeoutRef.current = setTimeout(() => {
        setFormattedTextState({
          ...formattedTextState,
          [field]: updatedValue,
        });
        runUpdate(field, updatedValue);
      }, 250);
    } else if (field === "fontSize") {
      setFormattedTextState({
        ...formattedTextState,
        [field]: numValue,
      });
      runUpdate(field, updatedValue);
    } else {
      runUpdate(field, updatedValue);
      setFormattedTextState({
        ...formattedTextState,
        [field]: updatedValue,
      });
    }
  };

  if (type !== "free")
    return (
      <section className="flex flex-wrap max-lg:pb-4 invisible">
        <Button svg={Image} iconSize="lg" padding="py-1 px-0" className="w-0" />
      </section>
    );

  const controls = (
    <>
      <section className="flex gap-1 items-center">
        <Icon svg={Image} className="border-b border-black" />
        <Button
          svg={Minus}
          variant="tertiary"
          onClick={() =>
            handleChange(
              "fontSize",
              (formattedTextState.fontSize - FONT_SIZE_BUTTON_STEP).toString()
            )
          }
        />
        <Input
          label="Font Size"
          type="text"
          inputMode="numeric"
          value={String(formattedTextState.fontSize)}
          onChange={(val) => handleChange("fontSize", val.toString())}
          className={cn(
            "w-16 shrink-0",
            "[&:has([data-state=open])_input]:rounded-t-md [&:has([data-state=open])_input]:rounded-b-none",
          )}
          inputTextSize="text-xs"
          hideLabel
          data-ignore-undo="true"
          inputClassName="pr-7"
          endAdornment={
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="tertiary"
                  className="inline-flex h-7 w-6 min-h-0 shrink-0 items-center justify-center"
                  padding="p-0.5"
                  svg={ChevronDown}
                  iconSize="sm"
                  aria-label="Font size presets"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                sideOffset={0}
                className="box-border flex max-h-[min(18rem,55vh)] w-16 max-w-16 min-w-0 flex-col overflow-hidden rounded-b-md rounded-t-none border border-neutral-700 border-t-neutral-600 bg-neutral-900 p-0 text-neutral-100 shadow-none"
              >
                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-1">
                  {FORMATTED_TEXT_FONT_PRESETS.map((px) => {
                    const isSelected =
                      px === nearestFormattedTextPreset(formattedTextState.fontSize);
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
                        onSelect={() => handleChange("fontSize", String(px))}
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
        <Button
          svg={Plus}
          variant="tertiary"
          onClick={() =>
            handleChange(
              "fontSize",
              (formattedTextState.fontSize + FONT_SIZE_BUTTON_STEP).toString()
            )
          }
        />
        <PopOver
          TriggeringButton={
            <Button
              variant="tertiary"
              className="border-b-2"
              svg={PaintBucket}
              style={{ borderColor: formattedTextState.textColor }}
            />
          }
        >
          <BrandAwareColorPicker
            color={formattedTextState.textColor}
            onChange={(val) => handleChange("textColor", val)}
            colors={brandColors}
          />
        </PopOver>
        <Button
          variant={formattedTextState.isBold ? "secondary" : "tertiary"}
          svg={Bold}
          onClick={() =>
            handleChange("isBold", formattedTextState.isBold ? "false" : "true")
          }
        />
        <Button
          variant={formattedTextState.isItalic ? "secondary" : "tertiary"}
          svg={Italic}
          onClick={() =>
            handleChange(
              "isItalic",
              formattedTextState.isItalic ? "false" : "true"
            )
          }
        />
        <Button
          variant={
            formattedTextState.align === "left" ? "secondary" : "tertiary"
          }
          svg={AlignLeft}
          onClick={() => handleChange("align", "left")}
        />
        <Button
          variant={
            formattedTextState.align === "center" ? "secondary" : "tertiary"
          }
          svg={AlignCenter}
          onClick={() => handleChange("align", "center")}
        />
        <Button
          variant={
            formattedTextState.align === "right" ? "secondary" : "tertiary"
          }
          svg={AlignRight}
          onClick={() => handleChange("align", "right")}
        />
      </section>
      <section className="flex gap-2 items-center lg:border-l-2 lg:pl-2 max-lg:border-t-2 max-lg:pt-4">
        <PopOver
          TriggeringButton={
            <Button
              variant="tertiary"
              className="border-b-2"
              svg={PaintBucket}
              style={{ borderColor: formattedTextState.backgroundColor }}
            />
          }
        >
          <BrandAwareColorPicker
            color={formattedTextState.backgroundColor}
            onChange={(val) => handleChange("backgroundColor", val)}
            colors={brandColors}
            alpha
          />
        </PopOver>
        <Input
          type="number"
          value={formattedTextState.paddingX}
          inputTextSize="text-xs"
          onChange={(value) => handleChange("paddingX", value.toString())}
          label="Padding X"
          labelLayout="inline"
          labelFontSize="text-xs"
          min={0}
          max={100}
          step={0.5}
          inputWidth="w-12"
          hideSpinButtons={false}
        />
        <Input
          type="number"
          value={formattedTextState.paddingY}
          inputTextSize="text-xs"
          onChange={(value) => handleChange("paddingY", value.toString())}
          label="Padding Y"
          labelLayout="inline"
          labelFontSize="text-xs"
          min={0}
          max={100}
          step={0.5}
          inputWidth="w-12"
          hideSpinButtons={false}
        />
      </section>

      <section className="flex gap-1 items-center">
        <RadioGroup
          value={shouldApplyToAll ? "all" : "selected"}
          onValueChange={(v) => setShouldApplyToAll(v === "all")}
          className="flex gap-1 items-center"
        >
          <RadioButton
            className="text-xs w-fit"
            optionValue="selected"
            label="Apply to selected"
          />
          <RadioButton
            label="Apply to all"
            className="text-xs w-fit"
            optionValue="all"
          />
        </RadioGroup>
        {/* Keep the height the same as other sections */}
        <Button svg={ALargeSmall} iconSize="lg" className="invisible" />
      </section>
    </>
  );

  return (
    <section className={cn("flex gap-1 items-center", className)}>
      <div className="max-lg:hidden flex gap-2 items-center">{controls}</div>
      <PopOver
        TriggeringButton={
          <Button className="lg:hidden" variant="tertiary" svg={ChevronsUpDown}>
            Tools
          </Button>
        }
      >
        <div className="flex flex-col gap-4 items-center p-4">{controls}</div>
      </PopOver>
    </section>
  );
};

export default FormattedTextEditor;
