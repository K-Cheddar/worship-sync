import { useLayoutEffect, useRef, useState } from "react";
import cn from "classnames";

const COLLAPSED_MAX_CLASS = "max-h-48";
/** Caps expanded body; outer flex column + inner flex-1 gives a reliable scroll region. */
const EXPANDED_OUTER_CLASS =
  "flex max-h-[min(70vh,28rem)] min-h-0 flex-col overflow-hidden";

type BoardPostMessageProps = {
  text: string;
  isMine: boolean;
};

export const BoardPostMessage = ({ text, isMine }: BoardPostMessageProps) => {
  const [expanded, setExpanded] = useState(false);
  const [showToggle, setShowToggle] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;

    const updateToggle = () => {
      const node = bodyRef.current;
      if (!node) return;
      if (expanded) {
        setShowToggle(true);
        return;
      }
      setShowToggle(node.scrollHeight > node.clientHeight);
    };

    updateToggle();

    const ro = new ResizeObserver(updateToggle);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, expanded]);

  const textClass = cn(
    "whitespace-pre-wrap text-base leading-relaxed sm:text-lg",
    isMine ? "text-amber-50/95" : "text-stone-100",
  );

  const showCollapsedFade = !expanded && showToggle;

  const collapsedFadeClass = isMine
    ? "bg-gradient-to-t from-amber-950/95 via-amber-950/55 to-transparent"
    : "bg-gradient-to-t from-stone-900/95 via-stone-900/65 to-transparent";

  return (
    <div className={cn("mt-3", expanded && EXPANDED_OUTER_CLASS)}>
      <div
        className={cn(
          "relative",
          expanded && "flex min-h-0 flex-1 flex-col",
        )}
      >
        <div
          ref={bodyRef}
          className={cn(
            textClass,
            "min-h-0",
            expanded
              ? "flex-1 overflow-y-auto overflow-x-hidden pr-0.5 touch-pan-y"
              : `${COLLAPSED_MAX_CLASS} overflow-hidden`,
          )}
          style={
            expanded
              ? { WebkitOverflowScrolling: "touch" as const }
              : undefined
          }
        >
          {text}
        </div>
        {showCollapsedFade && (
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 z-1 h-14",
              collapsedFadeClass,
            )}
            aria-hidden
          />
        )}
      </div>
      {showToggle && (
        <button
          type="button"
          className={cn(
            "mt-2 rounded-sm text-sm font-semibold underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-amber-500/50",
            isMine ? "text-amber-200/95" : "text-amber-400/95",
          )}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
};
