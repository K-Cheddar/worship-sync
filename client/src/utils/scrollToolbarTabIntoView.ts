const HORIZONTAL_SCROLL_OVERFLOW = new Set(["auto", "scroll", "overlay"]);

const findNearestHorizontalScrollParent = (
  node: HTMLElement,
): HTMLElement | null => {
  let current: HTMLElement | null = node.parentElement;
  while (current) {
    if (current === document.body || current === document.documentElement) {
      return null;
    }
    const { overflowX } = getComputedStyle(current);
    if (
      HORIZONTAL_SCROLL_OVERFLOW.has(overflowX) &&
      current.scrollWidth > current.clientWidth + 1
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
};

/** Scroll a toolbar tab into view, centering it horizontally in its horizontal scroll parent only (not the page). */
export const scrollToolbarTabIntoViewIfNeeded = (
  el: HTMLButtonElement | HTMLAnchorElement | null | undefined,
) => {
  if (!el) return;
  if (!el.offsetParent) return;

  const scrollParent = findNearestHorizontalScrollParent(el);
  if (!scrollParent) return;

  const parentRect = scrollParent.getBoundingClientRect();
  const childRect = el.getBoundingClientRect();

  const childLeftInScrollContent =
    scrollParent.scrollLeft + (childRect.left - parentRect.left);
  const maxScrollLeft = Math.max(
    0,
    scrollParent.scrollWidth - scrollParent.clientWidth,
  );
  const idealScrollLeft =
    childLeftInScrollContent -
    scrollParent.clientWidth / 2 +
    childRect.width / 2;
  const nextScrollLeft = Math.min(maxScrollLeft, Math.max(0, idealScrollLeft));

  if (Math.abs(scrollParent.scrollLeft - nextScrollLeft) < 1) return;

  scrollParent.scrollTo({
    left: nextScrollLeft,
    behavior: "smooth",
  });
};
