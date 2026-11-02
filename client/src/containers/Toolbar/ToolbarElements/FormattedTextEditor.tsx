import Button from "../../../components/Button/Button";
import Input from "../../../components/Input/Input";
import { createPortal } from "react-dom";
import { useDispatch, useSelector } from "../../../hooks";
import { applyOwnedContentMutation } from "../../../store/itemSlice";
import {
  flushPendingItemMutations,
  getItemMutationOwner,
  getItemMutationOwnerKey,
  scheduleOwnedItemMutation,
  type PendingItemMutationHandle,
} from "../../../store/deferredItemMutations";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import RadioButton, {
  RadioGroup,
} from "../../../components/RadioButton/RadioButton";
import { PaintBucket } from "lucide-react";
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
import PopoverPanel from "../../../components/PopOver/PopoverPanel";
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

const FormattedTextEditor = ({
  drawerTarget,
}: {
  drawerTarget: HTMLElement | null;
}) => {
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

  const owner = getItemMutationOwner(item);
  const selectedItemSlide = slides[selectedSlide];
  const selectedTargetKey = JSON.stringify([
    owner ? getItemMutationOwnerKey(owner) : null,
    selectedItemSlide?.id ?? null,
    selectedItemSlide?.boxes?.[item.selectedBox]?.id ?? item.selectedBox,
  ]);
  const selectedTargetKeyRef = useRef(selectedTargetKey);
  selectedTargetKeyRef.current = selectedTargetKey;
  const lastTargetKeyRef = useRef(selectedTargetKey);
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const isMountedRef = useRef(true);
  const timeoutRefs = useRef<Partial<Record<"textColor" | "backgroundColor", PendingItemMutationHandle>>>({});
  const timeoutTargetKeysRef = useRef<Partial<Record<"textColor" | "backgroundColor", string>>>({});

  useEffect(() => {
    if (lastTargetKeyRef.current === selectedTargetKey) return;
    lastTargetKeyRef.current = selectedTargetKey;
    for (const field of ["textColor", "backgroundColor"] as const) {
      timeoutRefs.current[field]?.flush();
      timeoutRefs.current[field] = undefined;
      timeoutTargetKeysRef.current[field] = undefined;
    }
  }, [selectedTargetKey]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      flushPendingItemMutations(ownerRef.current);
    };
  }, []);

  const [shouldApplyToAll, setShouldApplyToAll] = useState(true);

  const runUpdate = (
    field: fieldType,
    updatedValue: string | number | boolean,
    shouldApplyAll = shouldApplyToAll,
  ) => {
    const selectedSlide = slides[item.selectedSlide];
    if (!owner || !selectedSlide?.id) return;
    const sectionNum = selectedSlide.name.match(/Section (\d+)/)?.[1];
    dispatch(applyOwnedContentMutation({
      owner,
      mutation: {
        kind: "formattedText",
        slideId: selectedSlide.id,
        targetBoxId: selectedSlide.boxes?.[item.selectedBox]?.id,
        sectionNum: sectionNum ? parseInt(sectionNum, 10) : undefined,
        field,
        value: updatedValue,
        applyToAll: shouldApplyAll,
      },
    }));
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
      const selectedSlide = slides[item.selectedSlide];
      if (!owner || !selectedSlide?.id) return;
      const sectionNum = selectedSlide.name.match(/Section (\d+)/)?.[1];
      const targetKey = selectedTargetKey;
      const pending = timeoutRefs.current[field];
      if (pending) {
        if (timeoutTargetKeysRef.current[field] === targetKey) pending.cancel();
        else pending.flush();
      }
      const targetBoxId = selectedSlide.boxes?.[item.selectedBox]?.id;
      const applyToAll = shouldApplyToAll;
      let handle: PendingItemMutationHandle;
      handle = scheduleOwnedItemMutation(owner, 250, () => {
        if (timeoutRefs.current[field] === handle) {
          timeoutRefs.current[field] = undefined;
          timeoutTargetKeysRef.current[field] = undefined;
        }
        if (
          isMountedRef.current &&
          selectedTargetKeyRef.current === targetKey
        ) {
          setFormattedTextState((current) => ({
            ...current,
            [field]: updatedValue,
          }));
        }
        dispatch(applyOwnedContentMutation({
          owner,
          mutation: {
            kind: "formattedText",
            slideId: selectedSlide.id,
            targetBoxId,
            sectionNum: sectionNum ? parseInt(sectionNum, 10) : undefined,
            field,
            value: updatedValue,
            applyToAll,
          },
        }));
      });
      timeoutRefs.current[field] = handle;
      timeoutTargetKeysRef.current[field] = targetKey;
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

  if (type !== "free" || !drawerTarget) return null;

  const controls = (
    <>
      <section
        data-testid="formatted-text-font-controls"
        className="flex min-w-0 max-w-full flex-wrap items-center gap-1"
      >
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
        <PopoverPanel
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
        </PopoverPanel>
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
      <section
        data-testid="formatted-text-background-controls"
        className="flex min-w-0 max-w-full flex-wrap items-center gap-2 lg:border-l-2 lg:pl-2 max-lg:border-t-2 max-lg:pt-4"
      >
        <PopoverPanel
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
        </PopoverPanel>
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

      <section
        data-testid="formatted-text-scope-controls"
        className="flex min-w-0 max-w-full flex-wrap items-center gap-1"
      >
        <RadioGroup
          value={shouldApplyToAll ? "all" : "selected"}
          onValueChange={(v) => setShouldApplyToAll(v === "all")}
          className="flex flex-wrap items-center gap-1"
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

  return createPortal(
    <div
      data-testid="formatted-text-editor-drawer-controls"
      className={cn("flex min-w-0 flex-col items-start gap-4")}
    >
      {controls}
    </div>,
    drawerTarget,
  );
};

export default FormattedTextEditor;
