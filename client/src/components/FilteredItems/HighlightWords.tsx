import { useMemo } from "react";
import cn from "classnames";
import {
  punctuationRegex,
  levenshteinDistance,
} from "../../utils/generalUtils";

type HighlightWordsProps = {
  string: string;
  searchValue: string;
  className?: string;
  highlightWordColor?: string;
  nonHighlightWordColor?: string;
  allowPartial?: boolean;
  /** Keep lyric line breaks instead of flattening into one paragraph. */
  preserveLineBreaks?: boolean;
};

const HighlightWords = ({
  string,
  searchValue,
  className,
  highlightWordColor = "text-orange-400",
  nonHighlightWordColor = "text-gray-300",
  allowPartial = false,
  preserveLineBreaks = false,
}: HighlightWordsProps) => {
  const searchWords = useMemo(
    () =>
      searchValue
        .toLowerCase()
        .replace(punctuationRegex, "")
        .split(" ")
        .filter((e) => e.trim()),
    [searchValue],
  );

  const words = useMemo(() => {
    if (preserveLineBreaks) {
      return [];
    }
    return string.replaceAll("\n", " ").split(" ");
  }, [string, preserveLineBreaks]);

  const lines = useMemo(() => {
    if (!preserveLineBreaks) {
      return [];
    }
    return string.split(/\r?\n/);
  }, [string, preserveLineBreaks]);

  const getHighlightClass = (word: string, index: number) => {
    const cleanWord = word.replace(punctuationRegex, "").toLowerCase();

    // Check for exact matches first
    const exactMatch = searchWords.some((term) => cleanWord === term);
    if (exactMatch) {
      return `${highlightWordColor} font-semibold`;
    }

    // Check for fuzzy matches (up to 2 character differences)
    const fuzzyMatch = searchWords.some((term) => {
      if (term.length <= 2) return false; // Skip fuzzy matching for very short terms
      const distance = levenshteinDistance(cleanWord, term);
      return (
        distance <= 2 &&
        distance / Math.max(cleanWord.length, term.length) < 0.3
      );
    });
    if (fuzzyMatch) {
      return `${highlightWordColor} font-medium opacity-80`;
    }

    // Check for partial matches (only for last term if allowed)
    if (allowPartial && index === searchWords.length - 1) {
      const partialMatch = searchWords.some((term) => cleanWord.includes(term));
      if (partialMatch) {
        return `${highlightWordColor} font-medium opacity-60`;
      }
    }

    return nonHighlightWordColor;
  };

  const renderWord = (word: string, index: number) => {
    const highlightClass = getHighlightClass(word, index);
    const isHighlighted = highlightClass.includes(highlightWordColor);

    return (
      <span
        key={`${index}-${word}`}
        className={cn(
          highlightClass,
          isHighlighted && "transition-colors duration-200",
          "hover:opacity-80",
        )}
      >
        {word}
      </span>
    );
  };

  if (preserveLineBreaks) {
    return (
      <div className={cn("flex flex-col gap-1", className)}>
        {lines.map((line, lineIndex) =>
          line.trim() === "" ? (
            <div key={`blank-${lineIndex}`} className="h-3" aria-hidden />
          ) : (
            <p
              key={`line-${lineIndex}`}
              className="flex flex-wrap gap-[0.25rem]"
            >
              {line.split(" ").filter(Boolean).map((word, wordIndex) =>
                renderWord(word, wordIndex),
              )}
            </p>
          ),
        )}
      </div>
    );
  }

  return (
    <p className={cn("flex gap-[0.25rem] flex-wrap", className)}>
      {words.map((word, i) => renderWord(word, i))}
    </p>
  );
};

export default HighlightWords;
