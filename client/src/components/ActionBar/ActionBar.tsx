import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "../../utils/cnHelper";
import Button from "../Button/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/DropdownMenu";
import {
  MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS,
  MEDIA_LIBRARY_ACTION_MENU_ITEM_CLASS,
  MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE,
} from "../../containers/Media/mediaLibraryMediaActionUi";

export type ActionBarItem = {
  id: string;
  label: string;
  disabled?: boolean;
  /**
   * Extra className applied to this item's overflow DropdownMenuItem.
   * Use for per-item icon colour overrides (e.g. destructive red icons).
   */
  overflowMenuItemClassName?: string;
  /**
   * Render the inline button. Called with `isMeasure=true` for the hidden
   * measurement clone — in that case add `tabIndex={-1}` and omit onClick /
   * side-effect props. The component handles keys via React.Fragment.
   */
  renderButton: (isMeasure: boolean) => ReactNode;
  /** Called when this item is selected from the overflow dropdown. */
  onOverflowSelect?: () => void;
  /**
   * Custom content rendered inside the overflow DropdownMenuItem.
   * Falls back to `label` when omitted.
   */
  renderOverflowItem?: () => ReactNode;
};

export type ActionBarProps = {
  items: ActionBarItem[];
  /** Extra className applied to the visible row container (flex/nowrap/items-center are always present). */
  className?: string;
  /**
   * Gap between items in px — must match what your buttons render at.
   * Default: 4 (≈ gap-1). Pass 8 for gap-2 contexts.
   */
  gap?: number;
  overflowMenuAlign?: "start" | "end" | "center";
  overflowMenuClassName?: string;
  /** Set to true when rendered inside a stacking context (e.g. a FloatingWindow) to prevent the overflow menu from portalling behind it. */
  disablePortal?: boolean;
};

/**
 * Overflow-aware action bar: fits as many buttons as the container allows
 * inline, and collapses the rest into a "More actions" dropdown.
 *
 * Callers must memoize `items` (useMemo) so the ResizeObserver recalc only
 * fires when items actually change.
 */
const ActionBar = ({
  items,
  className,
  gap = 4,
  overflowMenuAlign = "end",
  overflowMenuClassName,
  disablePortal = false,
}: ActionBarProps) => {
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [inlineCount, setInlineCount] = useState(99);
  const [menuOpen, setMenuOpen] = useState(false);

  const recalc = useCallback(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    const total = items.length;
    if (!row || !measure || total === 0) { setInlineCount(total); return; }
    const wrappers = [...measure.querySelectorAll<HTMLElement>("[data-ab-measure]")];
    const widths = wrappers.map((w) => w.offsetWidth);
    const W = row.clientWidth;
    if (W < 24) { setInlineCount(total); return; }
    const TRIGGER = 44;
    let used = 0;
    let inline = 0;
    for (let i = 0; i < widths.length; i++) {
      const gapPx = inline > 0 ? gap : 0;
      const end = used + gapPx + widths[i];
      const isLast = i === widths.length - 1;
      if (isLast ? end <= W : end + gap + TRIGGER <= W) { inline++; used = end; }
      else break;
    }
    setInlineCount(inline);
  }, [items, gap]);

  useLayoutEffect(() => { recalc(); }, [recalc]);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const ro = new ResizeObserver(() => recalc());
    ro.observe(row);
    return () => ro.disconnect();
  }, [recalc]);

  useLayoutEffect(() => {
    if (items.length === 0) setMenuOpen(false);
  }, [items.length]);

  const inlineItems = items.slice(0, inlineCount);
  const overflowItems = items.slice(inlineCount);

  return (
    <>
      {/* Hidden measure row — offscreen, aria-hidden, pointer-events-none */}
      <div
        ref={measureRef}
        className="pointer-events-none fixed left-[-9999px] top-0 z-[-1] flex flex-nowrap items-center opacity-0"
        style={{ gap }}
        aria-hidden
      >
        {items.map((item) => (
          <span key={item.id} data-ab-measure className="flex">
            {item.renderButton(true)}
          </span>
        ))}
      </div>

      {/* Visible row */}
      <div
        ref={rowRef}
        className={cn("flex flex-nowrap items-center", className)}
        style={{ gap }}
      >
        {inlineItems.map((item) => (
          <span key={item.id} className="contents">
            {item.renderButton(false)}
          </span>
        ))}
        {overflowItems.length > 0 && (
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="tertiary"
                className={cn("shrink-0", MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS)}
                title="More actions"
                aria-label="More actions"
              >
                <MoreHorizontal className={MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE} aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align={overflowMenuAlign}
              className={cn("min-w-40 text-xs", overflowMenuClassName)}
              portal={!disablePortal}
            >
              {overflowItems.map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  variant="default"
                  className={cn(MEDIA_LIBRARY_ACTION_MENU_ITEM_CLASS, item.overflowMenuItemClassName)}
                  disabled={item.disabled}
                  onSelect={() => item.onOverflowSelect?.()}
                >
                  {item.renderOverflowItem
                    ? <span className="flex items-center gap-1.5">{item.renderOverflowItem()}</span>
                    : item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </>
  );
};

export default ActionBar;
