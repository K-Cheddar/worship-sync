import { useEffect, useRef, useState } from "react";
import { cn } from "@/utils/cnHelper";

export type LastUpdatedBylineProps = {
  updatedBy?: string;
  updatedAt?: string;
  className?: string;
};

const LAST_UPDATED_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  dateStyle: "short",
});
const LAST_UPDATED_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeStyle: "short",
});

function formatUpdatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${LAST_UPDATED_DATE_FORMATTER.format(d)}: ${LAST_UPDATED_TIME_FORMATTER.format(d)}`;
}

/**
 * Muted one-line summary for when a Pouch-backed doc was last saved.
 */
export function LastUpdatedByline({
  updatedBy,
  updatedAt,
  className,
}: LastUpdatedBylineProps) {
  const paragraphRef = useRef<HTMLParagraphElement | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const by = updatedBy?.trim();
  const at = updatedAt?.trim();

  let lastUpdatedText: string | null = null;
  if (by && at) {
    lastUpdatedText = `Updated ${formatUpdatedAt(at)} · ${by}`;
  } else if (at) {
    lastUpdatedText = `Updated ${formatUpdatedAt(at)}`;
  }

  useEffect(() => {
    setIsExpanded(false);
  }, [lastUpdatedText]);

  useEffect(() => {
    if (!lastUpdatedText) return undefined;
    if (isExpanded) return undefined;

    const checkTruncation = () => {
      const el = paragraphRef.current;
      if (!el) return;
      setIsTruncated(el.scrollWidth > el.clientWidth);
    };

    checkTruncation();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", checkTruncation);
      return () => {
        window.removeEventListener("resize", checkTruncation);
      };
    }

    const resizeObserver = new ResizeObserver(checkTruncation);
    if (paragraphRef.current) {
      resizeObserver.observe(paragraphRef.current);
    }
    window.addEventListener("resize", checkTruncation);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", checkTruncation);
    };
  }, [isExpanded, lastUpdatedText]);

  if (!lastUpdatedText) return null;

  const bylineClassName = cn(
    "w-full text-left text-xs text-gray-400 tabular-nums",
    isExpanded ? "whitespace-normal break-words" : "truncate",
    className,
  );

  return (
    <p
      ref={paragraphRef}
      className={bylineClassName}
      title={!isExpanded && isTruncated ? lastUpdatedText : undefined}
      onClick={isTruncated ? () => setIsExpanded((prev) => !prev) : undefined}
      role={isTruncated ? "button" : undefined}
      tabIndex={isTruncated ? 0 : undefined}
      onKeyDown={
        isTruncated
          ? (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setIsExpanded((prev) => !prev);
            }
          }
          : undefined
      }
      aria-expanded={isTruncated ? isExpanded : undefined}
      aria-label={isTruncated ? "Toggle full last updated text" : undefined}
    >
      {lastUpdatedText}
    </p>
  );
}
