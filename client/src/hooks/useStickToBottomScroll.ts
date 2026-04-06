import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/** Pixels from the bottom to treat as "at bottom" for follow-latest behavior. */
const BOTTOM_THRESHOLD_PX = 48;

function isNearBottom(el: HTMLElement): boolean {
  const distance =
    el.scrollHeight - el.scrollTop - el.clientHeight;
  return distance <= BOTTOM_THRESHOLD_PX;
}

export type UseStickToBottomScrollOptions = {
  /** Changes when content updates in a way that should scroll if pinned (e.g. post ids + revs). */
  scrollTrigger: unknown;
  /** When this changes (e.g. board or session), re-enable following and jump to bottom. */
  resetKey?: string;
};

/**
 * Chat-style scroll: follow new content while the user is at the bottom; pause when they scroll up;
 * resume following when they scroll back to the bottom.
 */
export function useStickToBottomScroll({
  scrollTrigger,
  resetKey,
}: UseStickToBottomScrollOptions) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setPinnedToBottom(isNearBottom(el));
  }, []);

  useLayoutEffect(() => {
    if (resetKey === undefined) return;
    setPinnedToBottom(true);
  }, [resetKey]);

  useLayoutEffect(() => {
    if (!pinnedToBottom) return;
    endRef.current?.scrollIntoView?.({ behavior: "auto", block: "end" });
  }, [scrollTrigger, pinnedToBottom, resetKey]);

  return { scrollRef, endRef, onScroll };
}
