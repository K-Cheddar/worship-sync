import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";

const PROGRAMMATIC_SCROLL_SUPPRESS_MS = 300;
const POINTER_SCROLL_INTENT_MS = 1_000;

type FollowLiveScrollOptions = {
  itemId: string | null;
  resetKey?: string;
  enabled?: boolean;
  /** Distinguishes an inactive plan tab from edit mode, which must not jump on exit. */
  suspensionReason?: string | null;
  /** Maximum wait for an in-progress section expansion before retrying geometry. */
  settleDelayMs?: number;
  containerRef: RefObject<HTMLElement | null>;
  getItem: (container: HTMLElement, itemId: string) => HTMLElement | null;
  isItemReady?: (item: HTMLElement, container: HTMLElement) => boolean;
  /** Returns false when the item is already positioned and no scroll was needed. */
  scrollToItem: (item: HTMLElement, container: HTMLElement) => boolean | void;
};

type ScrollInputEvent = { target: EventTarget | null };
type FollowTarget = { resetKey: string; itemId: string };
const isAlwaysReady = () => true;

/**
 * Keeps a scroll container on its live item until the viewer scrolls away.
 * Scroll suppression follows the public service page's smooth-scroll and
 * browser-anchoring behavior, while callers own the surface-specific scroll.
 */
const useFollowLiveScroll = ({
  itemId,
  resetKey = "",
  enabled = true,
  suspensionReason,
  settleDelayMs = 0,
  containerRef,
  getItem,
  isItemReady = isAlwaysReady,
  scrollToItem,
}: FollowLiveScrollOptions) => {
  const [isFollowingLive, setIsFollowingLive] = useState(true);
  const currentResetKeyRef = useRef(resetKey);
  const appliedResetKeyRef = useRef(resetKey);
  currentResetKeyRef.current = resetKey;
  const currentItemIdRef = useRef(itemId);
  currentItemIdRef.current = itemId;
  const lastFollowedRef = useRef<FollowTarget | null>(null);
  const pendingTargetRef = useRef<FollowTarget | null>(null);
  const pendingFollowCleanupRef = useRef<(() => void) | null>(null);
  const lastSuspensionReasonRef = useRef<string | null>(null);
  const ignoreItemOnResumeRef = useRef<string | null>(null);
  const reconcileAfterSuspensionRef = useRef(false);
  const suppressPauseUntilRef = useRef(0);
  const pointerScrollIntentUntilRef = useRef(0);
  const effectiveSuspensionReason = suspensionReason === undefined
    ? (enabled ? null : "disabled")
    : suspensionReason;

  const isInsideScrollContainer = useCallback((target: EventTarget | null) => {
    const container = containerRef.current;
    return Boolean(container && target instanceof Node && container.contains(target));
  }, [containerRef]);

  const cancelPendingFollow = useCallback(() => {
    pendingFollowCleanupRef.current?.();
    pendingFollowCleanupRef.current = null;
    pendingTargetRef.current = null;
  }, []);

  const followItem = useCallback((targetId: string, force = false) => {
    const container = containerRef.current;
    if (!container) return;
    cancelPendingFollow();

    const target = { resetKey, itemId: targetId };
    if (!force && lastFollowedRef.current?.resetKey === resetKey
      && lastFollowedRef.current.itemId === targetId) return;
    pendingTargetRef.current = target;

    let outerFrame = 0;
    let innerFrame = 0;
    let settleTimer = 0;
    let observer: MutationObserver | undefined;
    let cancelled = false;
    let listeningForTransition = false;
    const cleanup = () => {
      cancelled = true;
      window.cancelAnimationFrame(outerFrame);
      window.cancelAnimationFrame(innerFrame);
      window.clearTimeout(settleTimer);
      observer?.disconnect();
      container.removeEventListener("transitionend", retryWhenReady);
      if (pendingFollowCleanupRef.current === cleanup) {
        pendingFollowCleanupRef.current = null;
        pendingTargetRef.current = null;
      }
    };
    const requestIsCurrent = () =>
      !cancelled
      && containerRef.current === container
      && currentResetKeyRef.current === target.resetKey
      && currentItemIdRef.current === target.itemId
      && pendingTargetRef.current?.resetKey === target.resetKey
      && pendingTargetRef.current.itemId === target.itemId;
    const retryWhenReady = () => {
      if (!requestIsCurrent()) return;
      const item = getItem(container, targetId);
      if (!item) return;
      if (!isItemReady(item, container)) {
        if (!listeningForTransition) {
          listeningForTransition = true;
          container.addEventListener("transitionend", retryWhenReady);
        }
        if (!settleTimer && settleDelayMs > 0) {
          settleTimer = window.setTimeout(() => {
            settleTimer = 0;
            retryWhenReady();
          }, settleDelayMs);
        }
        return;
      }

      const didScroll = scrollToItem(item, container);
      lastFollowedRef.current = target;
      reconcileAfterSuspensionRef.current = false;
      suppressPauseUntilRef.current = didScroll === false
        ? 0
        : Date.now() + PROGRAMMATIC_SCROLL_SUPPRESS_MS;
      cleanup();
    };

    pendingFollowCleanupRef.current = cleanup;
    observer = new MutationObserver(retryWhenReady);
    observer.observe(container, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ["aria-hidden", "class", "style"],
    });
    outerFrame = window.requestAnimationFrame(() => {
      innerFrame = window.requestAnimationFrame(retryWhenReady);
    });

    return cleanup;
  }, [cancelPendingFollow, containerRef, getItem, isItemReady, resetKey, scrollToItem, settleDelayMs]);

  useEffect(() => () => cancelPendingFollow(), [cancelPendingFollow]);

  useEffect(() => {
    if (appliedResetKeyRef.current === resetKey) return;
    cancelPendingFollow();
    appliedResetKeyRef.current = resetKey;
    lastFollowedRef.current = null;
    ignoreItemOnResumeRef.current = null;
    reconcileAfterSuspensionRef.current = false;
    lastSuspensionReasonRef.current = null;
    setIsFollowingLive(true);
  }, [cancelPendingFollow, resetKey]);

  useEffect(() => {
    if (effectiveSuspensionReason) {
      cancelPendingFollow();
      if (effectiveSuspensionReason === "editing") {
        // Ignore the item that is live when edit mode ends; later advances
        // follow normally, without moving the operator's editing viewport.
        ignoreItemOnResumeRef.current = itemId;
      }
      if (effectiveSuspensionReason === "inactive") {
        reconcileAfterSuspensionRef.current = true;
      }
      lastSuspensionReasonRef.current = effectiveSuspensionReason;
      return undefined;
    }

    const resumedFrom = lastSuspensionReasonRef.current;
    lastSuspensionReasonRef.current = null;
    if (resumedFrom === "editing") {
      ignoreItemOnResumeRef.current = itemId;
      return undefined;
    }
    if (!itemId) {
      lastFollowedRef.current = null;
      return undefined;
    }
    if (!isFollowingLive) return undefined;

    if (ignoreItemOnResumeRef.current === itemId) return undefined;
    ignoreItemOnResumeRef.current = null;

    const pending = pendingTargetRef.current;
    if (pending?.resetKey === resetKey && pending.itemId === itemId) return undefined;
    const needsReconcile = reconcileAfterSuspensionRef.current;
    if (!needsReconcile && lastFollowedRef.current?.resetKey === resetKey
      && lastFollowedRef.current.itemId === itemId) return undefined;

    return followItem(itemId, needsReconcile);
  }, [
    cancelPendingFollow,
    effectiveSuspensionReason,
    followItem,
    isFollowingLive,
    itemId,
    resetKey,
  ]);

  const pauseLiveFollow = useCallback((event?: ScrollInputEvent) => {
    if (effectiveSuspensionReason || (event && !isInsideScrollContainer(event.target))) return;
    cancelPendingFollow();
    setIsFollowingLive(false);
  }, [cancelPendingFollow, effectiveSuspensionReason, isInsideScrollContainer]);

  const handleScroll = useCallback((event?: ScrollInputEvent) => {
    if (effectiveSuspensionReason || (event && event.target !== containerRef.current)) return;
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
  }, [containerRef, effectiveSuspensionReason, pauseLiveFollow]);

  const notePointerScrollIntent = useCallback((event?: ScrollInputEvent) => {
    if (effectiveSuspensionReason || (event && !isInsideScrollContainer(event.target))) return;
    pointerScrollIntentUntilRef.current = Date.now() + POINTER_SCROLL_INTENT_MS;
  }, [effectiveSuspensionReason, isInsideScrollContainer]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (effectiveSuspensionReason || !isInsideScrollContainer(event.target)) return;
    if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)) {
      pauseLiveFollow();
    }
  }, [effectiveSuspensionReason, isInsideScrollContainer, pauseLiveFollow]);

  const resumeFollowing = useCallback(() => {
    if (!itemId || effectiveSuspensionReason) return;
    ignoreItemOnResumeRef.current = null;
    reconcileAfterSuspensionRef.current = false;
    setIsFollowingLive(true);
    followItem(itemId, true);
  }, [effectiveSuspensionReason, followItem, itemId]);

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
