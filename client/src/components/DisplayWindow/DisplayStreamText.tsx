import { Box, TimerInfo } from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { useRef } from "react";
import TimerDisplay from "../TimerDisplay/TimerDisplay";

type DisplayStreamTextProps = {
  prevBox?: Box;
  box: Box;
  width: number;
  isPrev?: boolean;
  time?: number;
  fontAdjustment: number;
  timerInfo?: TimerInfo;
};

const DisplayStreamText = ({
  prevBox,
  box,
  width,
  isPrev,
  time,
  fontAdjustment,
  timerInfo,
}: DisplayStreamTextProps) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const boxTimeline = useRef<GSAPTimeline>();

  useGSAP(
    () => {
      if (!boxRef.current) return;

      boxTimeline.current?.clear();

      const skipTextAnimation = prevBox && prevBox.words === box.words;
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
  const fontSizeValue = bFontSize ? bFontSize / fontAdjustment : 1;
  const tSS = fontSizeValue / (width > 20 ? 32 : 10); // text shadow size
  const _fOS = fontSizeValue / (width > 20 ? 32 : 114); // font outline size
  const fOS = _fOS / 2;
  const boxWidth = "70%";
  // % margin is calculated based on the width so we get the percentage of top and bottom margin, then multiply by the width of the container
  const boxHeight = "fit";
  const marginLeft = "15%";
  const marginRight = "15%";
  const marginTop = "auto";
  const marginBottom = "7.5%";
  const boxTop = "92.5%";
  const boxLeft = "unset";
  const textStyles = {
    textShadow: `${tSS}vw ${tSS}vw ${tSS}vw #000, ${tSS}vw ${tSS}vw ${tSS}vw #000`,
    WebkitTextStroke: `${fOS}vw #000`,
    textAlign: box.align || "center",
    lineHeight: 1.25,
  };

  const renderContent = () => {
    if (words.includes("{{timer}}") && timerInfo) {
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
        pointerEvents: box.isLocked ? "none" : "all",
        fontSize: `${fontSizeValue}vw`,
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
        className={`display-box-text h-fit bottom-0 text-center`}
        style={textStyles}
      >
        {renderContent()}
      </p>
    </div>
  );
};

export default DisplayStreamText;
