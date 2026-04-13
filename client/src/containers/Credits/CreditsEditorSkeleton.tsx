import { cn } from "../../utils/cnHelper";
import { creditRowUnselectedClass } from "../Overlays/overlayRowStyles";

const EDITOR_ROW_COUNT = 6;
const PREVIEW_BLOCK_COUNT = 4;

type CreditsEditorSkeletonProps = {
  /** When true, omit drag/hide/delete placeholders (matches view-only rows). */
  readOnly?: boolean;
};

/**
 * Placeholder rows while credits load for the current outline.
 * Mirrors {@link Credit}: grip (tertiary padding px-2 py-1), heading Input + TextArea column (gap-1, px-2 py-1.5), eye + trash.
 */
const CreditsEditorSkeleton = ({
  readOnly = false,
}: CreditsEditorSkeletonProps) => (
  <div
    className="flex min-h-0 flex-1 flex-col"
    role="status"
    aria-live="polite"
    aria-busy="true"
    aria-label="Loading credits"
    data-testid="credits-editor-skeleton"
  >
    <ul className="scrollbar-variable flex min-h-0 w-full flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden pr-2">
      {Array.from({ length: EDITOR_ROW_COUNT }, (_, i) => (
        <li
          key={i}
          className={cn(
            "flex w-full items-center overflow-clip leading-3 transition-colors rounded-md",
            creditRowUnselectedClass,
          )}
        >
          {!readOnly && (
            <div
              className="flex shrink-0 items-center self-stretch px-2 py-1"
              aria-hidden
            >
              <div className="size-5 animate-pulse rounded-sm bg-white/10" />
            </div>
          )}
          <div className="flex min-h-0 flex-1 flex-col gap-1 px-2 py-1.5 text-center leading-4">
            {/* Single-line heading field — full width of column, matches Input row height */}
            <div className="h-9 w-full rounded-md border border-white/10 bg-black/30 animate-pulse" />
            {/* Multiline text — matches CreditHistoryTextArea / TextArea (min ~4 lines) */}
            <div className="w-full rounded-md border border-white/10 bg-black/25 px-3 py-1.5">
              <div className="flex flex-col gap-1.5 pt-0.5">
                <div
                  className={cn(
                    "h-3.5 rounded-sm bg-white/10 animate-pulse",
                    "w-[min(100%,18rem)]",
                  )}
                />
                <div className="h-3.5 w-[min(92%,16rem)] rounded-sm bg-white/8 animate-pulse" />
                <div className="h-3.5 w-[min(78%,14rem)] rounded-sm bg-white/10 animate-pulse" />
                <div className="h-3.5 w-[min(64%,11rem)] rounded-sm bg-white/8 animate-pulse" />
              </div>
            </div>
          </div>
          {!readOnly && (
            <>
              <div
                className="flex shrink-0 items-center self-stretch px-2 py-1"
                aria-hidden
              >
                <div className="size-5 animate-pulse rounded-sm bg-white/10" />
              </div>
              <div
                className="flex shrink-0 items-center self-stretch px-2 py-1"
                aria-hidden
              >
                <div className="size-5 animate-pulse rounded-sm bg-white/10" />
              </div>
            </>
          )}
        </li>
      ))}
    </ul>
  </div>
);

export default CreditsEditorSkeleton;

/** Preview column placeholder while credits load (matches {@link Credits} h2 + p sizing). */
export function CreditsPreviewSkeleton() {
  return (
    <ul
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading credits preview"
      data-testid="credits-preview-skeleton"
      className="scrollbar-variable flex h-full max-h-full w-full flex-col gap-[7.5vh] overflow-y-auto overflow-x-hidden pb-[10%] pr-2 text-center text-white"
    >
      {Array.from({ length: PREVIEW_BLOCK_COUNT }, (_, i) => (
        <li
          key={i}
          className="flex flex-col items-center gap-[1.5vh] px-2"
        >
          {/* h2: text-[2.25vw] max-md:text-[3.5vw] font-semibold */}
          <div
            className={cn(
              "max-w-[min(92vw,28rem)] animate-pulse rounded-sm bg-white/12",
              "h-[2.25vw] min-h-5 max-md:h-[3.5vw] max-md:min-h-6",
              "w-[min(72%,20rem)]",
              i % 3 === 1 && "w-[min(58%,16rem)]",
              i % 3 === 2 && "w-[min(64%,18rem)]",
            )}
          />
          {/* p: text-[2vw] max-md:text-[3vw] — block ~3 lines tall */}
          <div className="flex w-full max-w-[min(92vw,32rem)] flex-col items-center gap-[0.6vh]">
            <div className="h-[2vw] max-md:h-[3vw] min-h-3 w-[min(88%,26rem)] animate-pulse rounded-sm bg-white/8" />
            <div className="h-[2vw] max-md:h-[3vw] min-h-3 w-[min(76%,22rem)] animate-pulse rounded-sm bg-white/10" />
            <div className="h-[2vw] max-md:h-[3vw] min-h-3 w-[min(52%,15rem)] animate-pulse rounded-sm bg-white/8" />
          </div>
        </li>
      ))}
    </ul>
  );
}
