import { Hand } from "lucide-react";
import { cn } from "@/utils/cnHelper";

export const WANTS_THIS_LABEL = "Wants this";

/** Icon-only indicator for tight spaces (e.g. assignment popover). */
export const WantsThisIcon = ({ className }: { className?: string }) => (
  <span
    title={WANTS_THIS_LABEL}
    aria-label={WANTS_THIS_LABEL}
    className={cn(
      "inline-flex shrink-0 items-center rounded-full bg-amber-400/15 p-1 text-amber-200",
      className,
    )}
  >
    <Hand className="h-3 w-3" aria-hidden />
  </span>
);

/** Full label for wider surfaces (e.g. members panel). */
export const WantsThisBadge = ({ className }: { className?: string }) => (
  <span
    className={cn(
      "inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200",
      className,
    )}
  >
    <Hand className="h-3 w-3" aria-hidden />
    {WANTS_THIS_LABEL}
  </span>
);
