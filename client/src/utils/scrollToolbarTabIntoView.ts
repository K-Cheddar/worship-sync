/** Scroll a toolbar tab into view, centering it horizontally in its scrollport. */
export const scrollToolbarTabIntoViewIfNeeded = (
  el: HTMLButtonElement | HTMLAnchorElement | null | undefined,
) => {
  if (!el) return;
  if (!(el as HTMLElement).offsetParent) return;
  el.scrollIntoView({
    behavior: "smooth",
    block: "nearest",
    inline: "center",
  });
};
