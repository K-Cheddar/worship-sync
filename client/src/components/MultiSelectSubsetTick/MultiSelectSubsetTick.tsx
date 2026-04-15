import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import cn from "classnames";

const EXIT_MS = 200;

export type MultiSelectSubsetTickProps = {
  /** Parent mode: drives mount + enter, and exit + delayed unmount when false. */
  modeActive: boolean;
  /** Whether this row/tile is in the selected subset. */
  isSelected: boolean;
  /** Position, z-index, and frame size (e.g. `absolute left-1 top-1 z-30 size-6`). */
  frameClassName: string;
  /** Lucide Check `className` (include size). */
  checkClassName?: string;
};

/**
 * Subset-selection affordance: top-corner circle, cyan + check when selected.
 * Shared by media library tiles and item-slide background-target mode.
 */
export default function MultiSelectSubsetTick({
  modeActive,
  isSelected,
  frameClassName,
  checkClassName = "size-3 shrink-0 stroke-[2.75]",
}: MultiSelectSubsetTickProps) {
  const [mounted, setMounted] = useState(modeActive);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (modeActive) {
      setEntered(false);
      setMounted(true);
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setEntered(true));
      });
      return () => {
        cancelAnimationFrame(raf1);
        if (raf2) cancelAnimationFrame(raf2);
      };
    }

    setEntered(false);
    const t = window.setTimeout(() => setMounted(false), EXIT_MS);
    return () => window.clearTimeout(t);
  }, [modeActive]);

  if (!mounted) return null;

  return (
    <span
      className={cn(
        frameClassName,
        "pointer-events-none flex items-center justify-center rounded-full border-2 shadow-[0_1px_2px_rgba(0,0,0,0.45)]",
        "transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
        entered ? "scale-100 opacity-100" : "scale-[0.85] opacity-0",
        isSelected
          ? "border-white bg-cyan-400 text-white"
          : "border-white/90 bg-black/50",
      )}
      aria-hidden
    >
      {isSelected ? (
        <Check
          className={checkClassName}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        />
      ) : null}
    </span>
  );
}
