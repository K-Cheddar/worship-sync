import { cn } from "../../utils/cnHelper";
import Spinner from "../Spinner/Spinner";

type SongListScrollAreaProps = {
  scrollRef: React.RefObject<HTMLUListElement | null>;
  isSearchLoading: boolean;
  isFullyLoaded: boolean;
  children: React.ReactNode;
  /** Classes on the scrollable `<ul>` (width, padding, etc.). */
  ulClassName?: string;
  /** Backdrop over the list while debounced search is catching up (panel layout). */
  overlayClassName?: string;
  /**
   * `panel` — overlay outside the list (import drawer).
   * `embedded` — overlay as first `li` inside the list (library page).
   */
  layout?: "panel" | "embedded";
};

/**
 * Scrollable song list shell: loading overlay, list body, bottom “load more” spinner.
 */
const SongListScrollArea = ({
  scrollRef,
  isSearchLoading,
  isFullyLoaded,
  children,
  ulClassName,
  overlayClassName = "bg-gray-900/35",
  layout = "panel",
}: SongListScrollAreaProps) => {
  const bottomSentinel =
    !isFullyLoaded ? (
      <li
        className="flex w-full items-center justify-center border-t border-white/10 bg-gray-950/25 py-3"
        role="status"
        aria-live="polite"
        aria-label="Loading more items"
      >
        <Spinner
          width="26px"
          borderWidth="3px"
          className="opacity-75"
        />
      </li>
    ) : null;

  if (layout === "embedded") {
    return (
      <ul
        ref={scrollRef}
        className={cn("scrollbar-variable relative overflow-y-auto", ulClassName)}
      >
        {isSearchLoading && (
          <li className="absolute top-0 left-0 z-10 flex h-full w-full items-center justify-center bg-gray-800/35">
            <Spinner />
          </li>
        )}
        {children}
        {bottomSentinel}
      </ul>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {isSearchLoading && (
        <div
          className={cn(
            "pointer-events-none absolute inset-0 z-10 flex items-center justify-center",
            overlayClassName,
          )}
        >
          <Spinner />
        </div>
      )}
      <ul
        ref={scrollRef}
        className={cn(
          "scrollbar-variable flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto",
          ulClassName,
        )}
      >
        {children}
        {bottomSentinel}
      </ul>
    </div>
  );
};

export default SongListScrollArea;
