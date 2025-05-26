interface VerseDisplayProps {
  words: string;
  className?: string;
}

const VerseDisplay = ({
  words,
  className = "text-gray-400",
}: VerseDisplayProps) => {
  // Split the text by Zero Width Space and style verse numbers
  const parts = words.split(/\u200B(.*?)\u200B/);
  return (
    <>
      {parts.map((part, index) => {
        // Even indices are regular text, odd indices are verse numbers
        if (index % 2 === 1) {
          return (
            <span key={index} className={className}>
              {part}
            </span>
          );
        }
        return part;
      })}
    </>
  );
};

export default VerseDisplay;
