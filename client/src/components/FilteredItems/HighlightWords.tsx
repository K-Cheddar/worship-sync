import { useMemo } from "react";
import cn from "classnames";
import { punctuationRegex } from "../../utils/generalUtils";

type HighlightWordsProps = {
  string: string;
  searchValue: string;
  className?: string;
  highlightWordColor?: string;
  nonHighlightWordColor?: string;
  allowPartial?: boolean;
};

const HighlightWords = ({
  string,
  searchValue,
  className,
  highlightWordColor = "text-orange-400",
  nonHighlightWordColor = "text-gray-300",
  allowPartial = false,
}: HighlightWordsProps) => {
  const searchWords = useMemo(
    () =>
      searchValue
        .toLowerCase()
        .replace(punctuationRegex, "")
        .split(" ")
        .filter((e) => e.trim()),
    [searchValue]
  );
  const words = useMemo(
    () => string.replaceAll("\n", " ").split(" "),
    [string]
  );

  return (
    <p className={cn("flex gap-[0.25rem] flex-wrap", className)}>
      {words.map((word, i) => {
        const cleanWord = word.replace(punctuationRegex, "");
        const shouldHighlight = searchWords.some((val, i) => {
          return (
            cleanWord.toLowerCase() === val ||
            (i === searchWords.length - 1 &&
              allowPartial &&
              cleanWord.toLowerCase().includes(val))
          );
        });

        return (
          <span
            key={i}
            className={cn(
              shouldHighlight
                ? `${highlightWordColor} font-semibold`
                : nonHighlightWordColor
            )}
          >
            {word}
          </span>
        );
      })}
    </p>
  );
};

export default HighlightWords;
