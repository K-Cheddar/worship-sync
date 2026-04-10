import { useCallback, useLayoutEffect, useRef } from "react";

type UseLoadMoreOnScrollOptions = {
  scrollRef: React.RefObject<HTMLElement | null>;
  /** When false, listeners are removed (e.g. wrong tab or nothing left to load). */
  enabled: boolean;
  /** Total items available; used to cap increments. */
  totalAvailable: number;
  /** How many items to add each time the bottom / short-list rule fires. */
  batchSize: number;
  setShownCount: React.Dispatch<React.SetStateAction<number>>;
  /** Distance from bottom of scroll container (px) to trigger load. */
  thresholdPx?: number;
  /**
   * Current number of items shown — include in the effect deps so we re-attach
   * after each batch when the list still fits the viewport without scrolling.
   */
  shownCount: number;
  /** Bumps the effect when the scroll container may mount late (e.g. tab or search). */
  rescheduleKey?: string;
};

/**
 * Increments `shownCount` when the user scrolls near the bottom of `scrollRef`,
 * or when the list is shorter than the viewport (no scrollbar yet) so
 * IntersectionObserver-based “load more” would never fire.
 */
export function useLoadMoreOnScroll({
  scrollRef,
  enabled,
  totalAvailable,
  batchSize,
  setShownCount,
  thresholdPx = 100,
  shownCount,
  rescheduleKey = "",
}: UseLoadMoreOnScrollOptions) {
  const totalRef = useRef(totalAvailable);
  totalRef.current = totalAvailable;

  const tryLoad = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !enabled) return;

    setShownCount((prev) => {
      const max = totalRef.current;
      if (prev >= max) return prev;

      const { scrollTop, clientHeight, scrollHeight } = el;
      const fromBottom = scrollHeight - scrollTop - clientHeight;
      const listFitsWithoutScroll = scrollHeight <= clientHeight + 2;
      if (listFitsWithoutScroll || fromBottom <= thresholdPx) {
        return Math.min(prev + batchSize, max);
      }
      return prev;
    });
  }, [batchSize, enabled, scrollRef, setShownCount, thresholdPx]);

  useLayoutEffect(() => {
    if (!enabled) return;

    const attach = () => {
      const el = scrollRef.current;
      if (!el) return undefined;

      const onScroll = () => tryLoad();
      const ro = new ResizeObserver(() => tryLoad());

      el.addEventListener("scroll", onScroll, { passive: true });
      ro.observe(el);
      tryLoad();

      return () => {
        el.removeEventListener("scroll", onScroll);
        ro.disconnect();
      };
    };

    let cleanup = attach();
    const timeoutId =
      cleanup === undefined
        ? window.setTimeout(() => {
            cleanup = attach();
          }, 0)
        : undefined;

    return () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      cleanup?.();
    };
  }, [enabled, tryLoad, totalAvailable, shownCount, scrollRef, rescheduleKey]);
}
