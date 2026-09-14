type OutlineSelectionScrollListener = () => void;

const listeners = new Set<OutlineSelectionScrollListener>();

/**
 * One-shot, render-only signal: the operator re-clicked the already selected
 * outline item and the continuous slide rail should return to that item's
 * selected slide. Not Redux — this must not persist, undo, or sync.
 */
export const subscribeOutlineSelectionScroll = (
  listener: OutlineSelectionScrollListener,
) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const requestOutlineSelectionScroll = () => {
  listeners.forEach((listener) => listener());
};
