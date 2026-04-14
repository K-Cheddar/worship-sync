import { forwardRef } from "react";

import { cn } from "../../utils/cnHelper";
import { overlayRowUnselectedClass } from "./overlayRowStyles";

const ROW_COUNT = 5;

type OverlaysListSkeletonProps = {
  /** When true, only the main text column is shown (matches view-only overlay rows). */
  readOnly?: boolean;
};

/**
 * Placeholder rows while the overlay list for the current outline is loading.
 * Mirrors {@link Overlay}: horizontal row, flex-1 text column (type-specific line counts), Trash + Send.
 */
const OverlaysListSkeleton = forwardRef<
  HTMLUListElement,
  OverlaysListSkeletonProps
>(function OverlaysListSkeleton({ readOnly = false }, ref) {
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading overlays list"
    >
      <ul
        ref={ref}
        id="overlays-list"
        className="scrollbar-variable flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden pr-2"
      >
        {Array.from({ length: ROW_COUNT }, (_, i) => (
          <li
            key={i}
            className={cn(
              "flex w-full items-center overflow-clip rounded-md leading-3 border-l-4 transition-colors",
              overlayRowUnselectedClass,
              "border-l-gray-500",
            )}
          >
            <div
              className={cn(
                "flex min-h-0 min-w-0 flex-1 flex-col gap-1 px-2 py-1.5 text-center",
                i % 4 === 2 && "justify-center",
              )}
            >
              {i % 4 === 0 || i % 4 === 3 ? (
                <>
                  {/* participant: name (text-base), title (text-sm italic), event (text-sm) */}
                  <div className="mx-auto h-4 w-[78%] max-w-[min(100%,18rem)] animate-pulse rounded-sm bg-white/10" />
                  <div className="mx-auto h-3 w-[64%] max-w-[min(100%,15rem)] animate-pulse rounded-sm bg-white/8" />
                  <div className="mx-auto h-3 w-[48%] max-w-[min(100%,12rem)] animate-pulse rounded-sm bg-white/10" />
                </>
              ) : i % 4 === 1 ? (
                <>
                  {/* stick-to-bottom: heading + subHeading */}
                  <div className="mx-auto h-3 w-[72%] max-w-[min(100%,16rem)] animate-pulse rounded-sm bg-white/10" />
                  <div className="mx-auto h-3 w-[55%] max-w-[min(100%,13rem)] animate-pulse rounded-sm bg-white/10" />
                </>
              ) : (
                <>
                  {/* qr-code / image / empty placeholder: single primary line */}
                  <div className="mx-auto h-3 w-[58%] max-w-[min(100%,14rem)] animate-pulse rounded-sm bg-white/10" />
                </>
              )}
            </div>
            {!readOnly && (
              <>
                <div
                  className="flex shrink-0 items-center self-stretch px-2 py-1"
                  aria-hidden
                >
                  <div className="size-4 animate-pulse rounded-sm bg-white/10" />
                </div>
                <div
                  className="flex shrink-0 items-center self-stretch px-4 py-1"
                  aria-hidden
                >
                  <div className="h-3.5 w-9 animate-pulse rounded-sm bg-white/10" />
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
});

export default OverlaysListSkeleton;
