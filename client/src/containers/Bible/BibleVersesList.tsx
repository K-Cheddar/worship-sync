import Button from "../../components/Button/Button";
import { BookOpen, Send } from "lucide-react";
import { verseType } from "../../types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { keepElementInView } from "../../utils/generalUtils";
import cn from "classnames";

type BibleVersesListProps = {
  isLoading: boolean;
  verses: verseType[];
  startVerse: number;
  endVerse: number;
  sendVerse: (verse: verseType) => void;
  canTransmit: boolean;
};

const BibleVersesList = ({
  isLoading,
  verses,
  startVerse,
  endVerse,
  canTransmit,
  sendVerse,
}: BibleVersesListProps) => {
  const [selection, setSelection] = useState<{ index: number; shouldCenter: boolean }>({ index: -1, shouldCenter: false });
  const selectedVerse = selection.index;

  const renderableVerses = useMemo(
    () =>
      verses.filter(
        ({ index, text }) =>
          index >= startVerse && index <= endVerse && Boolean(text?.trim())
      ),
    [verses, startVerse, endVerse]
  );

  const hasRenderableVerses = renderableVerses.length > 0;

  const showEmpty = !isLoading && !hasRenderableVerses;

  useEffect(() => {
    if (selection.index < 0) return;
    const verseElement = document.getElementById(
      `bible-verse-${selection.index}`
    );
    const parentElement = document.getElementById("bible-verses-list");
    if (verseElement && parentElement) {
      keepElementInView({
        child: verseElement,
        parent: parentElement,
        ...(selection.shouldCenter
          ? { shouldScrollToCenter: true, keepNextInView: true }
          : { scrollOnlyIntoView: true }),
      });
    }
  }, [selection]);

  const advanceVerse = useCallback(() => {
    const selectedPosition = renderableVerses.findIndex(
      ({ index }) => index === selectedVerse
    );
    const nextPosition = selectedPosition < 0 ? 0 : selectedPosition + 1;
    const nextVerse = renderableVerses[nextPosition];
    if (nextVerse) {
      sendVerse(nextVerse);
      setSelection({ index: nextVerse.index, shouldCenter: true });
    }
  }, [selectedVerse, renderableVerses, sendVerse]);

  const previousVerse = useCallback(() => {
    const selectedPosition = renderableVerses.findIndex(
      ({ index }) => index === selectedVerse
    );
    const previousPosition = selectedPosition < 0 ? 0 : selectedPosition - 1;
    const prevVerse = renderableVerses[previousPosition];
    if (prevVerse) {
      sendVerse(prevVerse);
      setSelection({ index: prevVerse.index, shouldCenter: true });
    }
  }, [selectedVerse, renderableVerses, sendVerse]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTyping =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (isTyping || !canTransmit) return;
      if (e.key === " " && e.shiftKey) {
        e.preventDefault();
        previousVerse();
      } else if (e.key === " ") {
        e.preventDefault();
        advanceVerse();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [advanceVerse, previousVerse, canTransmit]);

  return (
    <div className="relative flex flex-1 flex-col min-h-0 w-full">
      {isLoading && (
        <p className="text-xl font-semibold absolute top-0 left-0 w-full h-full flex items-center justify-center z-10 pointer-events-none">
          Loading verses...
        </p>
      )}
      {showEmpty && (
        <div
          className="flex flex-1 min-h-48 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-gray-600 bg-gray-800/40 px-4 py-8 text-center"
          role="status"
          aria-live="polite"
        >
          <BookOpen
            className="h-10 w-10 text-gray-500 shrink-0"
            aria-hidden
          />
          <p className="text-lg font-semibold text-gray-300">No verses here</p>
          <p className="text-sm text-gray-500 max-w-sm">
            Try another chapter or verse range.
          </p>
        </div>
      )}
      {!showEmpty && (
        <ul
          id="bible-verses-list"
          className={cn(
            "scrollbar-variable overflow-y-auto flex flex-col gap-1 py-2 rounded-md w-full flex-1 min-h-0",
            isLoading && "opacity-30"
          )}
        >
          {renderableVerses.map((verse) => {
            const bg = verse.index % 2 === 0 ? "bg-gray-600" : "bg-gray-800";
            return (
              <li
                key={verse.index}
                id={`bible-verse-${verse.index}`}
                className={`${bg} flex gap-2 p-1 border ${
                  selectedVerse === verse.index
                    ? "border-cyan-400"
                    : "border-transparent"
                }`}
              >
                <span className="text-lg text-yellow-300">{verse.name}</span>
                <span className="text-sm mr-auto">{verse.text}</span>
                <Button
                  color={canTransmit ? "#22c55e" : "gray"}
                  padding="px-1 h-full"
                  variant="tertiary"
                  className="text-sm"
                  svg={Send}
                  onClick={() => {
                    setSelection({ index: verse.index, shouldCenter: false });
                    sendVerse(verse);
                  }}
                  disabled={!canTransmit}
                >
                  Send
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default BibleVersesList;
