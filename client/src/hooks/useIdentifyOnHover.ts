import { useCallback, useEffect, useRef } from "react";

/**
 * Hover-intent timing for the display "identify" glow, modelled on tooltip
 * behaviour (cf. Radix `delayDuration` + `skipDelayDuration`):
 *
 * - Cold: hovering a row waits {@link HOVER_INTENT_DELAY_MS} before glowing, so
 *   quickly sweeping the menu never flashes the glow across physical screens.
 * - Warm (a glow has shown): hovering another row glows instantly.
 * - On leave the glow hides but stays "warm" for {@link WARM_COOLDOWN_MS}, so
 *   moving between rows is instant; after the cooldown (or {@link cancel}) it
 *   goes cold again.
 *
 * Closing the menu must be authoritative: identify shows are async and
 * fire-and-forget, so one dispatched late (a focus/mouse event during teardown,
 * or IPC reordering) could otherwise resurrect the glow over live output after
 * close. {@link cancel} bumps a monotonic generation; the main process rejects
 * any show whose generation is below the current floor, so stale shows are
 * dropped regardless of timing.
 */
const HOVER_INTENT_DELAY_MS = 400;
const WARM_COOLDOWN_MS = 300;

// Shared across menus (only one is interacted with at a time). Restarts at 0 on
// renderer reload, which the main process mirrors by resetting its floor.
let identifyGeneration = 0;

type IdentifyHoverHandlers = {
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
};

type UseIdentifyOnHoverArgs = {
  /** Soft, debounced hide for row leave (cancelled if an adjacent row shows). */
  hide?: () => void;
  /** Authoritative hide + generation bump for menu close / unmount. */
  cancel?: (generation: number) => void;
};

export const useIdentifyOnHover = ({ hide, cancel }: UseIdentifyOnHoverArgs) => {
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warm = useRef(false);

  const clearEnter = useCallback(() => {
    if (enterTimer.current) {
      clearTimeout(enterTimer.current);
      enterTimer.current = null;
    }
  }, []);

  const clearCooldown = useCallback(() => {
    if (cooldownTimer.current) {
      clearTimeout(cooldownTimer.current);
      cooldownTimer.current = null;
    }
  }, []);

  /**
   * End the identify session authoritatively: cancel pending timers, go cold,
   * and bump the generation so the main process drops any in-flight show.
   */
  const cancelSession = useCallback(() => {
    clearEnter();
    clearCooldown();
    warm.current = false;
    identifyGeneration += 1;
    cancel?.(identifyGeneration);
  }, [clearEnter, clearCooldown, cancel]);

  // On unmount no onOpenChange fires, so cancel the session here too.
  useEffect(() => () => cancelSession(), [cancelSession]);

  /**
   * Build the hover/focus handlers for a single row. `show` triggers the glow
   * for that row and must forward the supplied generation to the identify IPC.
   */
  const getHandlers = useCallback(
    (show: (generation: number) => void): IdentifyHoverHandlers => {
      const enter = () => {
        clearEnter();
        clearCooldown();
        if (warm.current) {
          show(identifyGeneration);
          return;
        }
        enterTimer.current = setTimeout(() => {
          enterTimer.current = null;
          warm.current = true;
          show(identifyGeneration);
        }, HOVER_INTENT_DELAY_MS);
      };
      const leave = () => {
        clearEnter();
        hide?.();
        // Stay warm briefly so the next row glows instantly, then cool down.
        clearCooldown();
        cooldownTimer.current = setTimeout(() => {
          cooldownTimer.current = null;
          warm.current = false;
        }, WARM_COOLDOWN_MS);
      };
      return {
        onMouseEnter: enter,
        onMouseLeave: leave,
        onFocus: enter,
        onBlur: leave,
      };
    },
    [hide, clearEnter, clearCooldown],
  );

  return { getHandlers, cancel: cancelSession };
};
