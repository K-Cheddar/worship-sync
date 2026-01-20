import { Box, TimerInfo } from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { useRef } from "react";
import TimerDisplay from "./TimerDisplay";
import { REFERENCE_WIDTH, REFERENCE_HEIGHT, FONT_SIZE_MULTIPLIER } from "./constants";

type DisplayStreamTextProps = {
  prevBox?: Box;
  box: Box;
  width: number;
  isPrev?: boolean;
  time?: number;
  timerInfo?: TimerInfo;
  referenceWidth?: number; // Reference width for pixel calculations (1920px)
  referenceHeight?: number; // Reference height for pixel calculations (1080px)
};

const DisplayStreamText = ({
  prevBox,
  box,
  width,
  isPrev,
  time,
  timerInfo,
  referenceWidth = REFERENCE_WIDTH,
  referenceHeight = REFERENCE_HEIGHT,
}: DisplayStreamTextProps) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const boxTimeline = useRef<GSAPTimeline>(null);

  useGSAP(
    () => {
      if (!boxRef.current) return;

      boxTimeline.current?.clear();

      const skipTextAnimation = prevBox
        ? prevBox.words?.trim() === box.words?.trim()
        : false;

      const textDuration = skipTextAnimation ? 0 : 0.35;

      if (isPrev) {
        boxTimeline.current = gsap.timeline();

        boxTimeline.current.fromTo(
          ".display-box-text",
          { opacity: 1 },
          {
            opacity: 0,
            duration: textDuration,
            ease: "power1.inOut",
          }
        );
      } else {
        boxTimeline.current = gsap.timeline();
        boxTimeline.current.fromTo(
          ".display-box-text",
          { opacity: 0 },
          {
            opacity: 1,
            duration: textDuration,
            ease: "power1.inOut",
          }
        );
      }
    },
    { scope: boxRef, dependencies: [box, time] }
  );

  const bFontSize = 1.1;
  const bWords = box.words || "";
  const words = bWords.replace(/(\n)+/g, "\n").trim();
  
  // Convert fontSize to pixels using the font size multiplier
  const fontSizeInPx = bFontSize ? bFontSize * FONT_SIZE_MULTIPLIER : FONT_SIZE_MULTIPLIER;
  
  // Text shadow and outline sizes in pixels (will scale with transform)
  const REFERENCE_WIDTH_VW = (REFERENCE_WIDTH / window.innerWidth) * 100;
  const useReferenceWidth = width >= REFERENCE_WIDTH_VW * 0.5;
  const tSS = fontSizeInPx / (useReferenceWidth ? 32 : 10); // text shadow size in px
  const _fOS = fontSizeInPx / (useReferenceWidth ? 32 : 114); // font outline size in px
  const fOS = _fOS / 2;
  
  // Convert all percentage values to pixels based on reference dimensions
  const boxWidthPx = (referenceWidth * 70) / 100; // 70% of reference width
  const marginLeftPx = (referenceWidth * 15) / 100; // 15% of reference width
  const marginRightPx = (referenceWidth * 15) / 100; // 15% of reference width
  const marginBottomPx = (referenceHeight * 7.5) / 100; // 7.5% of reference height
  const boxTopPx = (referenceHeight * 92.5) / 100; // 92.5% of reference height
  
  const boxWidth = `${boxWidthPx}px`;
  const boxHeight = "fit-content";
  const marginLeft = `${marginLeftPx}px`;
  const marginRight = `${marginRightPx}px`;
  const marginTop = "auto";
  const marginBottom = `${marginBottomPx}px`;
  const boxTop = `${boxTopPx}px`;
  const boxLeft = "unset";
  const textStyles = {
    textShadow: `${tSS}px ${tSS}px ${tSS}px #000, ${tSS}px ${tSS}px ${tSS}px #000`,
    WebkitTextStroke: `${fOS}px #000`,
    textAlign: box.align || "center",
    lineHeight: 1.25,
  };

  const renderContent = () => {
    if (words.includes("{{timer}}")) {
      return <TimerDisplay timerInfo={timerInfo} words={words} />;
    }

    return words;
  };
  return (
    <div
      key={box.id}
      ref={boxRef}
      className="absolute leading-tight"
      style={{
        width: boxWidth,
        height: boxHeight,
        pointerEvents: "none",
        fontSize: `${fontSizeInPx}px`,
        marginTop,
        marginBottom,
        marginLeft,
        marginRight,
        color: box.fontColor,
        filter: `brightness(${box.brightness}%)`,
        top: boxTop,
        left: boxLeft,
      }}
    >
      <p
        className="display-box-text h-fit bottom-0 text-center w-full bg-transparent whitespace-pre-line absolute"
        style={textStyles}
      >
        {renderContent()}
      </p>
    </div>
  );
};

export default DisplayStreamText;
