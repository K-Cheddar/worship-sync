import { TimerInfo } from "../../types";

interface NowDisplayProps {
  words: string;
  timerInfo?: TimerInfo;
}

const NowDisplay = ({ words, timerInfo }: NowDisplayProps) => {
  // Split the text by Zero Width Non-Joiner and style "now" with timer color
  const parts = words.split(/\u200C(.*?)\u200C/);
  const timerColor = timerInfo?.color || "#ffffff";

  return (
    <>
      {parts.map((part, index) => {
        // Even indices are regular text, odd indices are "now" text
        if (index % 2 === 1) {
          return (
            <span key={index} style={{ color: timerColor }}>
              {part}
            </span>
          );
        }
        return part;
      })}
    </>
  );
};

export default NowDisplay;
