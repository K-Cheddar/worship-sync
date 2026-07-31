import React, { useContext, useEffect, useRef, useState } from "react";
import type { ChurchBrandColor } from "../../api/authTypes";
import { OverlayFormatting } from "../../types";
import PopOver from "../PopOver/PopOver";
import Button from "../Button/Button";
import { HexAlphaColorPicker, HexColorInput, HexColorPicker } from "react-colorful";
import cn from "classnames";
import { GlobalInfoContext } from "../../context/globalInfo";
import { getChurchBrandColorLabel } from "../../utils/churchBranding";
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

const getContrastingTextColor = (hex: string) => {
  // Remove '#' if present
  hex = hex.replace(/^#/, "");

  // Expand shorthand (e.g. #abc → #aabbcc)
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }

  // Parse RGB values
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  // Calculate luminance using the WCAG formula
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

  // Return black for light backgrounds, white for dark
  return luminance > 128 ? "#000000" : "#FFFFFF";
};

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
        className="size-6 aspect-square shrink-0 min-h-0 max-md:min-h-0 border border-white/25"
        style={{ backgroundColor: swatch }}
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
};

export const BrandAwareColorPicker: React.FC<BrandAwareColorPickerProps> = ({
  color,
  onChange,
  colors,
  alpha = false,
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
      <div className="flex items-start gap-4">
        <div
          className={cn(
            "min-w-[220px]",
            colors.length > 0 && "border-r border-white/15 pr-4",
          )}
        >
          <div className="[&_.react-colorful]:h-[180px] [&_.react-colorful]:w-full [&_.react-colorful]:rounded-md [&_.react-colorful]:border [&_.react-colorful]:border-white/15 [&_.react-colorful__hue]:mt-2 [&_.react-colorful__alpha]:mt-2">
            <PickerComponent color={color} onChange={handlePickerChange} />
          </div>
          <HexColorInput
            color={color}
            prefixed
            onChange={handlePickerChange}
            className="mt-3 h-9 w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 text-sm font-medium text-neutral-100 placeholder:text-neutral-400"
            {...inputProps}
          />
        </div>
        {colors.length > 0 && (
          <div className="w-fit pl-1">
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

const ColorField: React.FC<ColorFieldProps> = ({
  className,
  label,
  hideLabel = false,
  labelKey,
  value,
  onChange,
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
      <PopOver
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
          alpha
        />
      </PopOver>
    </div>
  );
};

export default ColorField;
