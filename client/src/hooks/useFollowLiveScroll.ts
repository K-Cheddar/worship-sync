import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";

const PROGRAMMATIC_SCROLL_SUPPRESS_MS = 300;
const POINTER_SCROLL_INTENT_MS = 1_000;

type FollowLiveScrollOptions = {
  itemId: string | null;
  enabled?: boolean;
  containerRef: RefObject<HTMLElement | null>;
  getItem: (container: HTMLElement, itemId: string) => HTMLElement | null;
  scrollToItem: (item: HTMLElement, container: HTMLElement) => void;
};

type ScrollInputEvent = { target: EventTarget | null };

/**
 * Keeps a scroll container on its live item until the viewer scrolls away.
 * Scroll suppression follows the public service page's smooth-scroll and
 * browser-anchoring behavior, while callers own the surface-specific scroll.
 */
const useFollowLiveScroll = ({
  itemId,
  enabled = true,
  containerRef,
  getItem,
  scrollToItem,
}: FollowLiveScrollOptions) => {
  const [isFollowingLive, setIsFollowingLive] = useState(true);
  const followedItemIdRef = useRef<string | null>(null);
  const suppressPauseUntilRef = useRef(0);
  const pointerScrollIntentUntilRef = useRef(0);
  const pendingFollowCleanupRef = useRef<(() => void) | null>(null);
  const isInsideScrollContainer = useCallback((target: EventTarget | null) => {
    const container = containerRef.current;
    return Boolean(container && target instanceof Node && container.contains(target));
  }, [containerRef]);

  const followItem = useCallback((targetId: string) => {
    const container = containerRef.current;
    if (!container) return;
    pendingFollowCleanupRef.current?.();

    // Double rAF gives section expansion and the resulting layout a chance to
    // settle. Keep watching mutations too, so a delayed row is not lost.
    let outerFrame = 0;
    let innerFrame = 0;
    let observer: MutationObserver | undefined;
    let cancelled = false;
    const cleanup = () => {
      cancelled = true;
      window.cancelAnimationFrame(outerFrame);
      window.cancelAnimationFrame(innerFrame);
      observer?.disconnect();
      if (pendingFollowCleanupRef.current === cleanup) {
        pendingFollowCleanupRef.current = null;
      }
    };
    pendingFollowCleanupRef.current = cleanup;
    const scrollWhenReady = () => {
      if (cancelled || containerRef.current !== container) return;
      const item = getItem(container, targetId);
      if (!item) return;
      cleanup();
      suppressPauseUntilRef.current = Date.now() + PROGRAMMATIC_SCROLL_SUPPRESS_MS;
      scrollToItem(item, container);
    };

    observer = new MutationObserver(scrollWhenReady);
    observer.observe(container, { childList: true, subtree: true });
    outerFrame = window.requestAnimationFrame(() => {
      innerFrame = window.requestAnimationFrame(scrollWhenReady);
    });

    return cleanup;
  }, [containerRef, getItem, scrollToItem]);

  useEffect(() => () => pendingFollowCleanupRef.current?.(), []);

  useEffect(() => {
    if (!itemId) {
      followedItemIdRef.current = null;
      return undefined;
    }
    if (!enabled) {
      // Switching into or out of edit mode should not jump back to the item
      // that was live when editing began. Future item changes still follow.
      followedItemIdRef.current = itemId;
      return undefined;
    }
    if (!isFollowingLive || followedItemIdRef.current === itemId) {
      return undefined;
    }

    followedItemIdRef.current = itemId;
    return followItem(itemId);
  }, [enabled, followItem, isFollowingLive, itemId]);

  const pauseLiveFollow = useCallback((event?: ScrollInputEvent) => {
    if (event && !isInsideScrollContainer(event.target)) return;
    pendingFollowCleanupRef.current?.();
    setIsFollowingLive(false);
  }, [isInsideScrollContainer]);

  const handleScroll = useCallback((event?: ScrollInputEvent) => {
    if (event && event.target !== containerRef.current) return;
    if (Date.now() < suppressPauseUntilRef.current) {
      // Extend suppression for the full duration of a smooth scroll.
      suppressPauseUntilRef.current = Date.now() + PROGRAMMATIC_SCROLL_SUPPRESS_MS;
      return;
    }
    // Browser scroll anchoring can move the list on a live-row update. Pause
    // only when pointer activity indicates the operator intended to scroll.
    if (Date.now() >= pointerScrollIntentUntilRef.current) return;
    pointerScrollIntentUntilRef.current = 0;
    pauseLiveFollow();
  }, [containerRef, pauseLiveFollow]);

  const notePointerScrollIntent = useCallback((event?: ScrollInputEvent) => {
    if (event && !isInsideScrollContainer(event.target)) return;
    pointerScrollIntentUntilRef.current = Date.now() + POINTER_SCROLL_INTENT_MS;
  }, [isInsideScrollContainer]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (!isInsideScrollContainer(event.target)) return;
    if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)) {
      pauseLiveFollow();
    }
  }, [isInsideScrollContainer, pauseLiveFollow]);

  const resumeFollowing = useCallback(() => {
    if (!itemId || !enabled) return;
    followedItemIdRef.current = itemId;
    setIsFollowingLive(true);
    followItem(itemId);
  }, [enabled, followItem, itemId]);

  return {
    isFollowingLive,
    pauseLiveFollow,
    handleScroll,
    notePointerScrollIntent,
    handleKeyDown,
    resumeFollowing,
  };
};

export default useFollowLiveScroll;
