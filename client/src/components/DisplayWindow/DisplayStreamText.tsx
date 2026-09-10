import { Box, TimerInfo } from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { useRef } from "react";
import TimerDisplay from "./TimerDisplay";
import { REFERENCE_WIDTH, REFERENCE_HEIGHT } from "../../constants";
import {
  normalizeDisplayWords,
  shouldSkipDisplayTextAnimation,
} from "./utils";

type DisplayStreamTextProps = {
  prevBox?: Box;
  box: Box;
  width: number;
  isPrev?: boolean;
  time?: number;
  timerInfo?: TimerInfo;
  referenceWidth?: number; // Reference width for pixel calculations (1920px)
  referenceHeight?: number; // Reference height for pixel calculations (1080px)
  shouldAnimate?: boolean;
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
  shouldAnimate = false,
}: DisplayStreamTextProps) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const boxTimeline = useRef<GSAPTimeline>(null);
  const skipTextAnimation =
    shouldAnimate &&
    Boolean(prevBox) &&
    shouldSkipDisplayTextAnimation(box.words, prevBox?.words);
  // Hold matching text at 1 — duration-0 fromTo(0→1) still flickers.
  const initialTextOpacity = !shouldAnimate
    ? undefined
    : isPrev || skipTextAnimation
      ? 1
      : 0;

  useGSAP(
    () => {
      if (!boxRef.current || !shouldAnimate) return;

      boxTimeline.current?.clear();
      boxTimeline.current = gsap.timeline();

      if (skipTextAnimation) {
        boxTimeline.current.set(".display-box-text", { opacity: 1 });
        return;
      }

      boxTimeline.current.fromTo(
        ".display-box-text",
        { opacity: isPrev ? 1 : 0 },
        {
          opacity: isPrev ? 0 : 1,
          duration: 0.35,
          ease: "power1.inOut",
        },
      );
    },
    {
      scope: boxRef,
      dependencies: [box, prevBox, time, isPrev, shouldAnimate, skipTextAnimation],
    },
  );

  const words = normalizeDisplayWords(box.words);
  const fontSizeInPx = 50;

  // Text shadow and outline sizes in pixels (will scale with transform)
  const REFERENCE_WIDTH_VW = (REFERENCE_WIDTH / window.innerWidth) * 100;
  const useReferenceWidth = width >= REFERENCE_WIDTH_VW * 0.5;
  const tSS = fontSizeInPx / (useReferenceWidth ? 32 : 10); // text shadow size in px

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
        style={{
          ...textStyles,
          opacity: initialTextOpacity,
        }}
      >
        {renderContent()}
      </p>
    </div>
  );
};

export default DisplayStreamText;
