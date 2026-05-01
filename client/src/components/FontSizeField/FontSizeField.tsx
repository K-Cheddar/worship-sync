import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { ChevronDown } from "lucide-react";
import Input from "../Input/Input";
import Button from "../Button/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/DropdownMenu";
import { cn } from "@/utils/cnHelper";

const FONT_PRESET_MENU_ALIGN_OFFSET_PX = -6;

type Props = {
  label?: string;
  labelClassName?: string;
  className?: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  /** Step between generated preset values. Defaults to 5. */
  step?: number;
  defaultValue?: number;
};

function generatePresets(min: number, max: number, step: number): number[] {
  const presets: number[] = [];
  for (let v = min; v <= max; v += step) {
    presets.push(v);
  }
  return presets;
}

function nearestPreset(value: number, presets: number[]): number {
  let best = presets[0] ?? value;
  let bestDist = Infinity;
  for (const p of presets) {
    const d = Math.abs(p - value);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

export default function FontSizeField({
  label,
  labelClassName,
  className,
  value,
  onChange,
  min,
  max,
  step = 5,
  defaultValue,
}: Props) {
  const [inputVal, setInputVal] = useState(String(value));
  const listScrollRef = useRef<HTMLDivElement>(null);
  const lastCommittedRef = useRef(value);
  const presets = useMemo(() => generatePresets(min, max, step), [min, max, step]);
  const highlight = nearestPreset(value, presets);

  // Sync input when value changes from outside (not from our own commits)
  useEffect(() => {
    if (value !== lastCommittedRef.current) {
      setInputVal(String(value));
      lastCommittedRef.current = value;
    }
  }, [value]);

  const handleInputChange = useCallback((val: string | number | boolean) => {
    setInputVal(String(val));
  }, []);

  const handleBlur = useCallback(() => {
    const n = parseInt(inputVal, 10);
    if (!isNaN(n)) {
      const clamped = Math.round(Math.max(min, Math.min(max, n)));
      onChange(clamped);
      setInputVal(String(clamped));
      lastCommittedRef.current = clamped;
    } else {
      setInputVal(String(value));
    }
  }, [inputVal, min, max, onChange, value]);

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) return;
    requestAnimationFrame(() => {
      listScrollRef.current
        ?.querySelector<HTMLElement>('[data-preset-selected="true"]')
        ?.scrollIntoView({ block: "center", behavior: "auto" });
    });
  }, []);

  const handlePresetSelect = useCallback(
    (px: number) => {
      onChange(px);
      setInputVal(String(px));
      lastCommittedRef.current = px;
    },
    [onChange],
  );

  return (
    <Input
      label={label}
      labelClassName={labelClassName}
      className={cn(
        className,
        "[&:has([data-state=open])_input]:rounded-t-md [&:has([data-state=open])_input]:rounded-b-none",
      )}
      type="text"
      inputMode="numeric"
      value={inputVal}
      onChange={handleInputChange}
      onBlur={handleBlur}
      min={min}
      max={max}
      numericArrowStep={1}
      numericArrowEmptyBase={defaultValue ?? min}
      endAdornment={
        <DropdownMenu modal={false} onOpenChange={handleOpenChange}>
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
            className="box-border flex max-h-[min(18rem,55vh)] w-20 max-w-20 min-w-0 flex-col overflow-hidden rounded-b-md rounded-t-none border border-neutral-700 border-t-neutral-600 bg-neutral-900 p-0 text-neutral-100 shadow-none"
          >
            <div
              ref={listScrollRef}
              className="scrollbar-portal min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-1"
            >
              {presets.map((px) => {
                const isSelected = px === highlight;
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
}
