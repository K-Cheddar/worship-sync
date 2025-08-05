import Button from "../../components/Button/Button";
import { ReactComponent as SendSVG } from "../../assets/icons/send.svg";
import { verseType } from "../../types";
import { useEffect, useState } from "react";
import {
  handleKeyDownTraverse,
  keepElementInView,
} from "../../utils/generalUtils";

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
  const [selectedVerse, setSelectedVerse] = useState<number>(-1);

  useEffect(() => {
    setSelectedVerse(-1);
  }, [startVerse, endVerse]);

  useEffect(() => {
    const verseElement = document.getElementById(
      `bible-verse-${selectedVerse + startVerse}`
    );
    const parentElement = document.getElementById("bible-verses-list");
    if (verseElement && parentElement) {
      keepElementInView({
        child: verseElement,
        parent: parentElement,
        shouldScrollToCenter: true,
        keepNextInView: true,
      });
    }
  }, [selectedVerse, startVerse]);

  const advanceVerse = () => {
    const nextVerseIndex = Math.min(selectedVerse + 1, endVerse);
    if (nextVerseIndex === selectedVerse) return;
    setSelectedVerse(nextVerseIndex);
    const nextVerse = verses[nextVerseIndex + startVerse];
    if (nextVerse) {
      sendVerse(nextVerse);
    }
  };

  const previousVerse = () => {
    const prevVerseIndex = Math.max(selectedVerse - 1, 0);
    if (prevVerseIndex === selectedVerse) return;
    setSelectedVerse(prevVerseIndex);
    const prevVerse = verses[prevVerseIndex + startVerse];
    if (prevVerse) {
      sendVerse(prevVerse);
    }
  };
  return (
    <>
      {isLoading && (
        <p className="text-xl font-semibold absolute top-0 left-0 w-full h-full flex items-center justify-center z-10">
          Loading verses...
        </p>
      )}
      {(verses.length === 0 || verses.every((verse) => !verse.text)) && (
        <p className="text-lg font-semibold absolute top-0 left-0 w-full h-full flex items-center justify-center z-10">
          No verses found
        </p>
      )}
      <ul
        id="bible-verses-list"
        className={`bible-verses-list ${isLoading ? "opacity-30" : ""}`}
        onKeyDown={(e) =>
          handleKeyDownTraverse({
            event: e,
            advance: advanceVerse,
            previous: previousVerse,
          })
        }
      >
        {verses
          .filter(({ index }) => index >= startVerse && index <= endVerse)
          .map((verse, index) => {
            const bg = index % 2 === 0 ? "bg-gray-600" : "bg-gray-800";
            return verse.text?.trim() ? (
              <li
                key={verse.index}
                id={`bible-verse-${verse.index}`}
                className={`${bg} flex gap-2 p-1 border ${
                  selectedVerse === index
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
                  svg={SendSVG}
                  onClick={() => {
                    setSelectedVerse(index);
                    sendVerse(verse);
                  }}
                  disabled={!canTransmit}
                >
                  Send
                </Button>
              </li>
            ) : null;
          })}
      </ul>
    </>
  );
};

export default BibleVersesList;
