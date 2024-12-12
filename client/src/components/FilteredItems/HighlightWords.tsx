import { useMemo } from "react";
import cn from "classnames";
import { punctuationRegex } from "../../utils/generalUtils";

type HighlightWordsProps = {
  string: string;
  searchValue: string;
  className?: string;
  highlightWordColor?: string;
  nonHighlightWordColor?: string;
};

const HighlightWords = ({
  string,
  searchValue,
  className,
  highlightWordColor = "text-orange-400",
  nonHighlightWordColor = "text-gray-300",
}: HighlightWordsProps) => {
  const searchWords = useMemo(
    () =>
      searchValue
        .toLowerCase()
        .split(" ")
        .filter((e) => e.trim()),
    [searchValue]
  );
  const words = useMemo(() => string.split(" "), [string]);

  return (
    <p className={cn("flex gap-1 flex-wrap", className)}>
      {words.map((word, i) => {
        const shouldHighlight = searchWords.some((val, i) => {
          return (
            word.toLowerCase().replace(punctuationRegex, "") === val ||
            (i === searchWords.length - 1 && word.toLowerCase().includes(val))
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
