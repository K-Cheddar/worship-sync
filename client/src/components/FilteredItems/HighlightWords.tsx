import { useMemo, type ReactNode } from "react";
import cn from "classnames";
import { getSearchHighlightRanges } from "../../utils/songSearchUtils";

type HighlightWordsProps = {
  string: string;
  searchValue: string;
  className?: string;
  highlightWordColor?: string;
  nonHighlightWordColor?: string;
  /** Retained for callers; partial matching now follows shared retrieval rules. */
  allowPartial?: boolean;
  preserveLineBreaks?: boolean;
};

const HighlightWords = ({
  string,
  searchValue,
  className,
  highlightWordColor = "text-orange-400",
  nonHighlightWordColor = "text-gray-300",
  preserveLineBreaks = false,
}: HighlightWordsProps) => {
  const text = preserveLineBreaks ? string : string.replace(/\r?\n/g, " ");
  const ranges = useMemo(
    () => getSearchHighlightRanges(text, searchValue),
    [text, searchValue],
  );
  let rangeIndex = 0;
  const renderPart = (start: number, end: number, quality?: number) => (
    <span
      key={start}
      className={cn(
        quality ? highlightWordColor : nonHighlightWordColor,
        quality && (quality === 1 ? "font-semibold" : "font-medium opacity-80"),
      )}
    >
      {text.slice(start, end)}
    </span>
  );
  const parts = [...text.matchAll(/\s+|\S+/g)].flatMap<ReactNode>((match) => {
    if (/^\s+$/.test(match[0])) return [match[0]];
    let start = match.index!;
    const end = start + match[0].length;
    const spans = [];
    while (rangeIndex < ranges.length && ranges[rangeIndex].start < end) {
      const range = ranges[rangeIndex++];
      if (start < range.start) spans.push(renderPart(start, range.start));
      spans.push(renderPart(range.start, range.end, range.quality));
      start = range.end;
    }
    if (start < end) spans.push(renderPart(start, end));
    return spans;
  });
  return (
    <p
      className={cn(
        nonHighlightWordColor,
        preserveLineBreaks && "whitespace-pre-wrap",
        className,
      )}
    >
      {parts}
    </p>
  );
};

export default HighlightWords;
