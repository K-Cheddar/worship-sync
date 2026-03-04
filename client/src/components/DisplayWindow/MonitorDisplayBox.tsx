import { useRef } from "react";
import { Box } from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { DEFAULT_FONT_PX } from "../../constants";
import VerseDisplay from "./VerseDisplay";

type MonitorDisplayBoxProps = {
  box: Box;
  prevBox?: Box;
  isPrev?: boolean;
  shouldAnimate?: boolean;
  /** 'next' = slide up, 'prev' = slide down, 'jump' = fade. Defaults to 'next'. */
  transitionDirection?: "next" | "prev" | "jump";
};

const MonitorDisplayBox = ({
  box,
  prevBox,
  isPrev,
  shouldAnimate,
  transitionDirection = "next",
}: MonitorDisplayBoxProps) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const boxTimeline = useRef<GSAPTimeline | null>(null);

  const fontSizeInPx = box.monitorFontSizePx ?? (box.fontSize ?? DEFAULT_FONT_PX);
  const textStyles = {
    textAlign: box.align || "center",
    lineHeight: 1.25,
    fontWeight: box.isBold ? "bold" : "normal",
    fontStyle: box.isItalic ? "italic" : "normal",
  };
  const words = (box.words || "").trim().replace(/\n{2,}/g, "\n");

  const renderContent = () => {
    if (words.includes("\u200B")) {
      return <VerseDisplay words={words} className="text-gray-400" />;
    }
    return words;
  };

  useGSAP(
    () => {
      if (!boxRef.current || !shouldAnimate) return;

      boxTimeline.current?.clear();

      const textDuration = 0.5;

      boxTimeline.current = gsap.timeline();

      const dir = transitionDirection;

      if (dir === "jump") {
        // Non-adjacent: fade
        if (isPrev) {
          boxTimeline.current.fromTo(
            ".monitor-display-box-text",
            { opacity: 1 },
            {
              opacity: 0,
              duration: textDuration,
              ease: "power1.inOut",
            }
          );
        } else {
          boxTimeline.current.fromTo(
            ".monitor-display-box-text",
            { opacity: 0 },
            {
              opacity: 1,
              duration: textDuration,
              ease: "power1.inOut",
            }
          );
        }
        return;
      }

      const textEl = boxRef.current.querySelector(".monitor-display-box-text");

      if (dir === "prev") {
        // Adjacent previous: slide down (outgoing goes down, incoming from above)
        const startY = isPrev ? 0 : -100;
        if (textEl) gsap.set(textEl, { opacity: 1, yPercent: startY });
        if (isPrev) {
          boxTimeline.current.fromTo(
            ".monitor-display-box-text",
            { yPercent: 0 },
            {
              yPercent: 100,
              duration: textDuration,
              ease: "power1.inOut",
            }
          );
        } else {
          boxTimeline.current.fromTo(
            ".monitor-display-box-text",
            { yPercent: -100 },
            {
              yPercent: 0,
              duration: textDuration,
              ease: "power1.inOut",
            }
          );
        }
        return;
      }

      // next: slide up (outgoing up, incoming from below)
      const startY = isPrev ? 0 : 100;
      if (textEl) gsap.set(textEl, { opacity: 1, yPercent: startY });
      if (isPrev) {
        boxTimeline.current.fromTo(
          ".monitor-display-box-text",
          { yPercent: 0 },
          {
            yPercent: -100,
            duration: textDuration,
            ease: "power1.inOut",
          }
        );
      } else {
        boxTimeline.current.fromTo(
          ".monitor-display-box-text",
          { yPercent: 100 },
          {
            yPercent: 0,
            duration: textDuration,
            ease: "power1.inOut",
          }
        );
      }
    },
    {
      scope: boxRef,
      dependencies: [box, isPrev, shouldAnimate, transitionDirection],
    }
  );

  return (
    <div
      key={box.id}
      ref={boxRef}
      className="absolute leading-tight h-full w-full"
      style={{
        pointerEvents: "none",
        fontSize: `${fontSizeInPx}px`,
        color: box.fontColor,
        filter: `brightness(${box.brightness}%)`,
      }}
    >
      <p
        className="monitor-display-box-text h-full w-full bg-transparent absolute overflow-hidden whitespace-pre-line"
        style={textStyles}
      >
        {renderContent()}
      </p>
    </div>
  );
};

export default MonitorDisplayBox;
