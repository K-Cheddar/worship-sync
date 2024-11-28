import Button from "../../components/Button/Button";
import { ReactComponent as SendSVG } from "../../assets/icons/send.svg";
import { verseType } from "../../types";

type BibleVersesListProps = {
  isLoading: boolean;
  bibleType: "internal" | "external";
  hasExternalVerses: boolean;
  verses: verseType[];
  startVerse: number;
  endVerse: number;
  sendVerse: (verse: verseType) => void;
  canTransmit: boolean;
};

const BibleVersesList = ({
  isLoading,
  bibleType,
  hasExternalVerses,
  verses,
  startVerse,
  endVerse,
  canTransmit,
  sendVerse,
}: BibleVersesListProps) => {
  return (
    <ul className={`bible-verses-list ${isLoading ? "opacity-60" : ""}`}>
      {bibleType === "external" && !hasExternalVerses && (
        <section className="flex flex-col gap-2 items-center">
          <h3 className="text-2xl font-semibold">External Version Selected</h3>
          <p className="text-base">
            {isLoading
              ? "Loading verses..."
              : "Please click the button above to get this chapter from Bible Gateway."}
          </p>
        </section>
      )}
      {verses
        .filter(({ index }) => index >= startVerse && index <= endVerse)
        .map((verse, index) => {
          const bg = index % 2 === 0 ? "bg-slate-600" : "bg-slate-800";
          return verse.text?.trim() ? (
            <li key={verse.index} className={`${bg} flex gap-2 px-2`}>
              <span className="text-lg text-yellow-300">{verse.name}</span>
              <span className="text-base mr-auto">{verse.text}</span>
              <Button
                color={canTransmit ? "#22c55e" : "gray"}
                padding="px-1"
                variant="tertiary"
                className="text-sm"
                svg={SendSVG}
                onClick={() => sendVerse(verse)}
                disabled={!canTransmit}
              >
                Send
              </Button>
            </li>
          ) : null;
        })}
    </ul>
  );
};

export default BibleVersesList;
