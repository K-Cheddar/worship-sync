import { useLayoutEffect, useRef, useState } from "react";
import cn from "classnames";

const COLLAPSED_MAX_CLASS = "max-h-48";
/** Bottom fade height; matches previous overlay so “Show more” lines up. */
const COLLAPSED_FADE_HEIGHT = "3.5rem";
/** Caps expanded body height so long posts scroll inside this region. */
const EXPANDED_BODY_CLASS =
  "max-h-[100vh] min-h-0 overflow-y-auto overflow-x-hidden pr-0.5 touch-pan-y";

const collapsedBottomFadeMaskStyle = {
  WebkitMaskImage: `linear-gradient(to bottom, black 0%, black calc(100% - ${COLLAPSED_FADE_HEIGHT}), transparent 100%)`,
  maskImage: `linear-gradient(to bottom, black 0%, black calc(100% - ${COLLAPSED_FADE_HEIGHT}), transparent 100%)`,
} as const;

type BoardPostMessageProps = {
  text: string;
  isMine: boolean;
  /** Moderator list uses gray card colors; attendee view uses stone/amber. */
  tone?: "attendee" | "moderator";
};

export const BoardPostMessage = ({
  text,
  isMine,
  tone = "attendee",
}: BoardPostMessageProps) => {
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

  const isModeratorTone = tone === "moderator";

  const textClass = isModeratorTone
    ? "whitespace-pre-wrap text-base leading-relaxed text-gray-100"
    : cn(
        "whitespace-pre-wrap text-base leading-relaxed sm:text-lg",
        isMine ? "text-amber-50/95" : "text-stone-100",
      );

  const showCollapsedFade = !expanded && showToggle;

  let showMoreButtonClass = "text-amber-400/95";
  if (isModeratorTone) {
    showMoreButtonClass = "text-amber-300/95";
  } else if (isMine) {
    showMoreButtonClass = "text-amber-200/95";
  }

  return (
    <div className="mt-3">
      <div
        ref={bodyRef}
        className={cn(
          textClass,
          expanded
            ? EXPANDED_BODY_CLASS
            : `${COLLAPSED_MAX_CLASS} overflow-hidden`,
        )}
        style={{
          ...(expanded
            ? { WebkitOverflowScrolling: "touch" as const }
            : {}),
          ...(showCollapsedFade ? collapsedBottomFadeMaskStyle : {}),
        }}
      >
        {text}
      </div>
      {showToggle && (
        <button
          type="button"
          className={cn(
            "mt-2 rounded-sm text-sm font-semibold underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-amber-500/50",
            showMoreButtonClass,
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
