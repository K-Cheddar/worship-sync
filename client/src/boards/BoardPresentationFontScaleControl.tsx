import cn from "classnames";
import { useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import Button from "../components/Button/Button";
import {
  BOARD_PRESENTATION_FONT_SCALE_STEP,
  DEFAULT_BOARD_PRESENTATION_FONT_SCALE,
  MAX_BOARD_PRESENTATION_FONT_SCALE,
  MIN_BOARD_PRESENTATION_FONT_SCALE,
  normalizeBoardPresentationFontScale,
} from "./boardUtils";

/**
 * Coalesce a burst of clicks into a single persist. Rapid clicks accumulate on a
 * synchronous ref (so five taps move five steps, never one), and only the final
 * size is written — avoiding a stack of racing requests whose out-of-order
 * responses could snap the size back.
 */
const PERSIST_DEBOUNCE_MS = 250;

type BoardPresentationFontScaleControlProps = {
  /** Current scale (1 = 100%). The parent stays the source of truth across reopen/sync. */
  value: number;
  onChange: (scale: number) => void;
  disabled?: boolean;
  /**
   * `compact` tightens spacing and drops the Reset button for dense toolbars
   * (e.g. the transmit panel's board tile); `default` keeps the full control
   * used in the board controller's tools panel.
   */
  size?: "default" | "compact";
  className?: string;
};

/**
 * Decrease / readout / increase (+ optional Reset) control for a board's
 * presentation text size. Shared by the board controller tools panel and the
 * transmit panel so both apply identical bounds, accumulate rapid clicks
 * correctly, and stay in step with external updates.
 */
const BoardPresentationFontScaleControl = ({
  value,
  onChange,
  disabled = false,
  size = "default",
  className,
}: BoardPresentationFontScaleControlProps) => {
  const isCompact = size === "compact";

  // Local optimistic value so a fast burst of clicks moves immediately without
  // waiting for the parent (or a network round-trip) to echo each step back.
  const [localValue, setLocalValue] = useState(value);
  const localRef = useRef(value);
  // The value we last handed to onChange, so we can tell our own echo apart from
  // a genuine external change (initial load, live sync, another operator).
  const lastSentRef = useRef(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (value !== lastSentRef.current) {
      localRef.current = value;
      lastSentRef.current = value;
      setLocalValue(value);
    }
  }, [value]);

  useEffect(() => {
    // Flush a still-pending write on unmount so a trailing change isn't dropped.
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        if (localRef.current !== lastSentRef.current) {
          lastSentRef.current = localRef.current;
          onChangeRef.current(localRef.current);
        }
      }
    };
  }, []);

  const applyScale = (next: number) => {
    const clamped = normalizeBoardPresentationFontScale(next);
    if (clamped === localRef.current) return;

    localRef.current = clamped;
    setLocalValue(clamped);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      lastSentRef.current = clamped;
      onChangeRef.current(clamped);
    }, PERSIST_DEBOUNCE_MS);
  };

  const atMin = localValue <= MIN_BOARD_PRESENTATION_FONT_SCALE;
  const atMax = localValue >= MAX_BOARD_PRESENTATION_FONT_SCALE;
  const atDefault = localValue === DEFAULT_BOARD_PRESENTATION_FONT_SCALE;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border border-gray-600 bg-gray-900/60",
        isCompact ? "px-2 py-1" : "px-3 py-2",
        className,
      )}
      role="group"
      aria-label="Presentation text size"
    >
      <Button
        variant="tertiary"
        svg={Minus}
        padding={isCompact ? "p-1.5" : "p-2"}
        className="min-h-0!"
        aria-label="Decrease presentation text size"
        onClick={() =>
          applyScale(localRef.current - BOARD_PRESENTATION_FONT_SCALE_STEP)
        }
        disabled={disabled || atMin}
      />
      <span
        className={cn(
          "text-center font-semibold text-white",
          isCompact ? "min-w-10 text-xs" : "min-w-14 text-sm",
        )}
      >
        {Math.round(localValue * 100)}%
      </span>
      <Button
        variant="tertiary"
        svg={Plus}
        padding={isCompact ? "p-1.5" : "p-2"}
        className="min-h-0!"
        aria-label="Increase presentation text size"
        onClick={() =>
          applyScale(localRef.current + BOARD_PRESENTATION_FONT_SCALE_STEP)
        }
        disabled={disabled || atMax}
      />
      {!isCompact && (
        <Button
          variant="tertiary"
          padding="px-3 py-2"
          className="min-h-0!"
          aria-label="Reset presentation text size"
          onClick={() => applyScale(DEFAULT_BOARD_PRESENTATION_FONT_SCALE)}
          disabled={disabled || atDefault}
        >
          Reset
        </Button>
      )}
    </div>
  );
};

export default BoardPresentationFontScaleControl;
