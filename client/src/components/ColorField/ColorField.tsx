import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ChurchBrandColor } from "../../api/authTypes";
import { OverlayFormatting } from "../../types";
import PopoverPanel from "../PopOver/PopoverPanel";
import Button from "../Button/Button";
import { HexAlphaColorPicker, HexColorInput, HexColorPicker } from "react-colorful";
import cn from "classnames";
import { GlobalInfoContext } from "../../context/globalInfo";
import { getChurchBrandColorLabel } from "../../utils/churchBranding";
import { contrastingInkForFill } from "../../utils/richTextColorContrast";
import {
  addRecentColor,
  COMMON_COLOR_SWATCHES,
  readRecentColors,
} from "../../utils/recentColors";

const RECENT_COLOR_PERSIST_MS = 300;

interface ColorFieldProps {
  className?: string;
  label: string;
  /** When true, the visible label is visually hidden but kept for assistive tech. */
  hideLabel?: boolean;
  labelKey?: string;
  value: string;
  onChange: (value: string) => void;
  /** Use an opaque hex picker when the stored field accepts solid colors only. */
  alpha?: boolean;
  defaultColor?: string;
  formatting?: OverlayFormatting;
  /**
   * When set, the picker updates local UI immediately but defers `onChange` to the parent
   * until the user pauses (reduces re-renders while dragging the color surface).
   */
  debounceParentCommitMs?: number;
  /** Called when the color popover opens or closes (e.g. to commit an “empty” slot). */
  onPopoverOpenChange?: (open: boolean) => void;
}

const getContrastingTextColor = (hex: string) => contrastingInkForFill(hex);

type ChurchBrandColorSwatchesProps = {
  colors: ChurchBrandColor[];
  onSelect: (value: string) => void;
};

export const ChurchBrandColorSwatches: React.FC<
  ChurchBrandColorSwatchesProps
> = ({ colors, onSelect }) => {
  if (colors.length === 0) {
    return null;
  }

  const hasSecondColumn = colors.length > 3;

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-300">
        Brand colors
      </p>
      <div
        className={cn(
          "grid gap-2",
          hasSecondColumn ? "w-[18rem] grid-cols-2" : "w-36 grid-cols-1",
        )}
      >
        {colors.map((color, index) => (
          <Button
            key={`${color.value}-${index}`}
            variant="tertiary"
            className="h-auto min-h-0 items-center justify-between gap-2 border px-2 py-2 text-left"
            style={{
              backgroundColor: color.value,
              borderColor: getContrastingTextColor(color.value),
              color: getContrastingTextColor(color.value),
            }}
            onClick={() => onSelect(color.value)}
          >
            <span className="truncate">
              {getChurchBrandColorLabel(color, index)}
            </span>
            <span className="font-mono text-xs uppercase">{color.value}</span>
          </Button>
        ))}
      </div>
    </div>
  );
};

type ColorSwatchRowProps = {
  colors: readonly string[];
  onSelect: (value: string) => void;
};

const ColorSwatchRow: React.FC<ColorSwatchRowProps> = ({
  colors,
  onSelect,
}) => (
  <div className="flex flex-wrap gap-1.5">
    {colors.map((swatch) => (
      <Button
        key={swatch}
        variant="tertiary"
        aria-label={`Color ${swatch}`}
        padding="p-0"
        className="size-6 aspect-square shrink-0 min-h-0 max-md:min-h-0 border-2"
        style={{
          backgroundColor: swatch,
          borderColor: getContrastingTextColor(swatch),
        }}
        onClick={() => onSelect(swatch)}
      />
    ))}
  </div>
);

type RecentColorSwatchesProps = {
  colors: string[];
  onSelectRecent: (value: string) => void;
  onSelectCommon: (value: string) => void;
};

export const RecentColorSwatches: React.FC<RecentColorSwatchesProps> = ({
  colors,
  onSelectRecent,
  onSelectCommon,
}) => {
  return (
    <div className="space-y-2">
      {colors.length > 0 && (
        <ColorSwatchRow colors={colors} onSelect={onSelectRecent} />
      )}
      <ColorSwatchRow colors={COMMON_COLOR_SWATCHES} onSelect={onSelectCommon} />
    </div>
  );
};

type BrandAwareColorPickerProps = {
  color: string;
  onChange: (value: string) => void;
  colors: ChurchBrandColor[];
  alpha?: boolean;
  hexInputLabel?: string;
  onHexInputBlur?: () => void;
};

export const BrandAwareColorPicker: React.FC<BrandAwareColorPickerProps> = ({
  color,
  onChange,
  colors,
  alpha = false,
  hexInputLabel,
  onHexInputBlur,
}) => {
  const PickerComponent = alpha ? HexAlphaColorPicker : HexColorPicker;
  const inputProps = alpha ? { alpha: true } : {};
  const [recentColors, setRecentColors] = useState(readRecentColors);
  const lastColorRef = useRef(color);
  const shouldPersistRef = useRef(false);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    lastColorRef.current = color;
  }, [color]);

  // Persist after the user pauses, and flush on unmount. Relying only on
  // unmount misses updates when Radix Presence reopens before exit finishes.
  useEffect(() => {
    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      if (shouldPersistRef.current) {
        addRecentColor(lastColorRef.current);
      }
    };
  }, []);

  const clearPersistTimer = () => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
  };

  const applyColor = (next: string, persist: boolean) => {
    lastColorRef.current = next;
    shouldPersistRef.current = persist;
    onChange(next);
    clearPersistTimer();
    if (!persist) {
      return;
    }
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      setRecentColors(addRecentColor(next));
    }, RECENT_COLOR_PERSIST_MS);
  };

  const handlePickerChange = (next: string) => {
    applyColor(next, true);
  };

  const handlePresetSelect = (next: string) => {
    applyColor(next, false);
  };

  return (
    <div className="rounded-md bg-slate-700/30 p-2">
      <div className="flex flex-wrap items-start gap-4">
        <div
          className={cn(
            "min-w-[220px] flex-1",
            colors.length > 0 && "border-r border-white/15 pr-4",
          )}
        >
          <div className="[&_.react-colorful]:h-[11.25rem] [&_.react-colorful]:w-full [&_.react-colorful]:rounded-md [&_.react-colorful]:border [&_.react-colorful]:border-white/15 [&_.react-colorful__hue]:mt-2 [&_.react-colorful__alpha]:mt-2">
            <PickerComponent color={color} onChange={handlePickerChange} />
          </div>
          <HexColorInput
            color={color}
            prefixed
            onChange={handlePickerChange}
            onBlur={onHexInputBlur}
            className="mt-3 h-9 w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 text-sm font-medium text-neutral-100 placeholder:text-neutral-400"
            {...inputProps}
            aria-label={hexInputLabel}
          />
        </div>
        {colors.length > 0 && (
          <div className="w-fit shrink-0 pl-1">
            <ChurchBrandColorSwatches
              colors={colors}
              onSelect={handlePresetSelect}
            />
          </div>
        )}
      </div>
      <div className="mt-3 border-t border-white/15 pt-3">
        <RecentColorSwatches
          colors={recentColors}
          onSelectRecent={handlePickerChange}
          onSelectCommon={handlePresetSelect}
        />
      </div>
    </div>
  );
};

type CompactColorPickerProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  alpha?: boolean;
  /** Show a rainbow trigger when the caller has no explicit color override. */
  showUnset?: boolean;
  className?: string;
  /** Keep the picker draft local and commit the latest value after this delay. */
  debounceParentCommitMs?: number;
  /** Receives immediate local updates without notifying the parent. */
  onPreviewChange?: (value: string) => void;
  /** Cancel a pending draft and restore the controlled value. */
  resetSignal?: number;
};

export const CompactColorPicker: React.FC<CompactColorPickerProps> = ({
  label,
  value,
  onChange,
  alpha = false,
  showUnset = false,
  className,
  debounceParentCommitMs,
  onPreviewChange,
  resetSignal = 0,
}) => {
  const globalInfo = useContext(GlobalInfoContext);
  const brandColors = globalInfo?.churchBranding.colors || [];
  const [draftColor, setDraftColor] = useState(value);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingColorRef = useRef<string | null>(null);
  const controlledValueRef = useRef(value);
  const resetSignalRef = useRef(resetSignal);
  const onChangeRef = useRef(onChange);
  const onPreviewChangeRef = useRef(onPreviewChange);
  onChangeRef.current = onChange;
  onPreviewChangeRef.current = onPreviewChange;

  const clearCommitTimer = useCallback(() => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const controlledValueChanged = controlledValueRef.current !== value;
    const resetRequested = resetSignalRef.current !== resetSignal;
    if (!controlledValueChanged && !resetRequested) return;

    controlledValueRef.current = value;
    resetSignalRef.current = resetSignal;
    clearCommitTimer();
    pendingColorRef.current = null;
    setDraftColor(value);
    onPreviewChangeRef.current?.(value);
  }, [clearCommitTimer, resetSignal, value]);

  useEffect(() => () => {
    clearCommitTimer();
    const pendingColor = pendingColorRef.current;
    pendingColorRef.current = null;
    if (pendingColor !== null) onChangeRef.current(pendingColor);
  }, [clearCommitTimer]);

  const handleColorChange = (next: string) => {
    onPreviewChangeRef.current?.(next);
    if (!debounceParentCommitMs) {
      onChangeRef.current(next);
      return;
    }

    setDraftColor(next);
    pendingColorRef.current = next;
    clearCommitTimer();
    commitTimerRef.current = setTimeout(() => {
      commitTimerRef.current = null;
      pendingColorRef.current = null;
      onChangeRef.current(next);
    }, debounceParentCommitMs);
  };

  const commitPendingColor = () => {
    const pendingColor = pendingColorRef.current;
    if (pendingColor === null) return;
    clearCommitTimer();
    pendingColorRef.current = null;
    onChangeRef.current(pendingColor);
  };

  const effectiveColor = debounceParentCommitMs ? draftColor : value;
  const contrastColor = getContrastingTextColor(effectiveColor);

  return (
    <PopoverPanel
      align="start"
      onOpenChange={(open) => {
        if (!open) commitPendingColor();
      }}
      contentClassName="w-[min(28rem,calc(100vw-2rem))]"
      bodyClassName="px-3 pb-3"
      TriggeringButton={
        <Button
          type="button"
          variant="tertiary"
          aria-label={label}
          title={label}
          padding="p-0"
          className={cn(
            "size-7 min-h-0 shrink-0 rounded-full border-2",
            className,
          )}
          style={showUnset
            ? {
              backgroundImage: "conic-gradient(from 45deg, #ef4444, #eab308, #22c55e, #3b82f6, #8b5cf6, #ec4899, #ef4444)",
              borderColor: "#d1d5db",
            }
            : { backgroundColor: effectiveColor, borderColor: contrastColor }}
        />
      }
    >
      <BrandAwareColorPicker
        color={effectiveColor}
        onChange={handleColorChange}
        onHexInputBlur={commitPendingColor}
        colors={brandColors}
        alpha={alpha}
        hexInputLabel={`${label} hex`}
      />
    </PopoverPanel>
  );
};

const ColorField: React.FC<ColorFieldProps> = ({
  className,
  label,
  hideLabel = false,
  labelKey,
  value,
  onChange,
  alpha = true,
  defaultColor = "#ffffff",
  formatting,
  debounceParentCommitMs,
  onPopoverOpenChange,
}) => {
  const globalInfo = useContext(GlobalInfoContext);
  const base = value || defaultColor;
  const [draft, setDraft] = useState(base);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const parentCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    setDraft(base);
  }, [base]);

  useEffect(() => {
    return () => {
      if (parentCommitTimerRef.current) {
        clearTimeout(parentCommitTimerRef.current);
        parentCommitTimerRef.current = null;
        onChangeRef.current(draftRef.current);
      }
    };
  }, []);

  const val = debounceParentCommitMs ? draft : base;
  const brandColors = globalInfo?.churchBranding.colors || [];

  const handleColorChange = (next: string) => {
    if (!debounceParentCommitMs) {
      onChange(next);
      return;
    }
    setDraft(next);
    if (parentCommitTimerRef.current) {
      clearTimeout(parentCommitTimerRef.current);
    }
    parentCommitTimerRef.current = setTimeout(() => {
      parentCommitTimerRef.current = null;
      onChange(next);
    }, debounceParentCommitMs);
  };
  return (
    <div className={cn("flex w-full min-w-0 flex-col items-stretch gap-1", className)}>
      <label
        className={cn(
          "block w-full p-0 text-left text-sm font-semibold text-white whitespace-nowrap",
          hideLabel && "sr-only",
        )}
      >
        {labelKey && formatting
          ? `${formatting[labelKey as keyof OverlayFormatting] as string} ${label}`
          : label}
        :
      </label>
      <PopoverPanel
        onOpenChange={onPopoverOpenChange}
        TriggeringButton={
          <Button
            variant="tertiary"
            className="w-full h-6 border-2"
            style={{
              backgroundColor: val,
              borderColor: getContrastingTextColor(val),
              color: getContrastingTextColor(val),
            }}
          >
            {val}
          </Button>
        }
      >
        <BrandAwareColorPicker
          color={val}
          onChange={handleColorChange}
          colors={brandColors}
          alpha={alpha}
        />
      </PopoverPanel>
    </div>
  );
};

export default ColorField;
