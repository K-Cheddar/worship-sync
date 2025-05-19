import { Box, DisplayType, TimerInfo } from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { useRef } from "react";
import cn from "classnames";
import TimerDisplay from "../TimerDisplay/TimerDisplay";

type DisplayBoxProps = {
  prevBox?: Box;
  box: Box;
  width: number;
  displayType?: DisplayType;
  showBackground: boolean;
  fontAdjustment: number;
  index: number;
  shouldAnimate?: boolean;
  isPrev?: boolean;
  time?: number;
  shouldPlayVideo?: boolean;
  timerInfo?: TimerInfo;
};

const DisplayBox = ({
  prevBox,
  box,
  width,
  displayType,
  showBackground,
  fontAdjustment,
  index,
  shouldAnimate,
  shouldPlayVideo,
  isPrev,
  time,
  timerInfo,
}: DisplayBoxProps) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const boxTimeline = useRef<GSAPTimeline>();
  const shouldShowBackground = showBackground && box.background;
  // This should be done outside the boxes to keep it playing when slides change. In that case maybe only one video per item.
  // const isVideoBg = box.background?.endsWith("?type=video");
  // const videoUrl = box.background?.split('.png')[0]

  useGSAP(
    () => {
      if (!boxRef.current || !shouldAnimate) return;

      boxTimeline.current?.clear();

      const skipTextAnimation = prevBox && prevBox.words === box.words;
      const skipBackgroundAnimation =
        prevBox && prevBox.background === box.background;
      const textDuration = skipTextAnimation ? 0 : 0.35;
      const backgroundDuration = skipBackgroundAnimation ? 0 : 0.5;

      // if ((prevBox && prevBox.words !== box.words)) {
      //   targets.push('.display-box-text')
      // }
      // if ((prevBox && prevBox.background !== box.background)) {
      //   targets.push('.display-box-background')
      // }

      if (isPrev) {
        boxTimeline.current = gsap.timeline();

        if (!skipBackgroundAnimation && shouldShowBackground) {
          boxTimeline.current.set(".display-box-background", { opacity: 1 });
        }
        boxTimeline.current.fromTo(
          ".display-box-text",
          { opacity: 1 },
          {
            opacity: 0,
            duration: textDuration,
            ease: "power1.inOut",
          }
        );

        if (shouldShowBackground) {
          boxTimeline.current.to(
            ".display-box-background",
            { opacity: 0, duration: backgroundDuration, ease: "power1.inOut" },
            `-=${textDuration}`
          );
        }
      } else {
        boxTimeline.current = gsap.timeline();

        if (!skipBackgroundAnimation && shouldShowBackground) {
          boxTimeline.current.set(".display-box-background", { opacity: 0 });
        }
        boxTimeline.current.fromTo(
          ".display-box-text",
          { opacity: 0 },
          {
            opacity: 1,
            duration: textDuration,
            ease: "power1.inOut",
          }
        );

        if (shouldShowBackground) {
          boxTimeline.current.to(
            ".display-box-background",
            { opacity: 1, duration: backgroundDuration, ease: "power1.inOut" },
            `-=${textDuration}`
          );
        }
      }
    },
    { scope: boxRef, dependencies: [box, time] }
  );

  const bFontSize = box.fontSize;
  const bWords = box.words || "";
  const words = bWords;
  const fontSizeValue = bFontSize ? bFontSize / fontAdjustment : 1;
  const tSS = fontSizeValue / (width > 20 ? 32 : 10); // text shadow size
  const fOS = fontSizeValue / (width > 20 ? 32 : 114); // font outline size
  const boxWidth = `calc(${box.width}% - ${
    box.sideMargin ? box.sideMargin * 2 : 0
  }%)`;
  // % margin is calculated based on the width so we get the percentage of top and bottom margin, then multiply by the width of the container
  const boxHeight = `calc(${box.height}% - (${width}vw * (${
    box.topMargin || 0
  } + ${box.topMargin || 0}) / 100) )`;
  const marginLeft = `${box.sideMargin}%`;
  const marginRight = `${box.sideMargin}%`;
  const marginTop = `${box.topMargin}%`;
  const marginBottom = `${box.topMargin}%`;
  const boxTop = `${box.y || 0}%`;
  const boxLeft = `${box.x || 0}%`;
  const textStyles = {
    textShadow: `${tSS}vw ${tSS}vw ${tSS}vw #000, ${tSS}vw ${tSS}vw ${tSS}vw #000`,
    WebkitTextStroke: `${fOS}vw #000`,
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
      {shouldShowBackground && (
        <img
          className={cn(
            "display-box-background",
            box.shouldKeepAspectRatio && "object-contain"
          )}
          src={box.background}
          alt={box.label}
        />
      )}
      <p className="display-box-text h-full" style={textStyles}>
        {renderContent()}
      </p>
    </div>
  );
};

export default DisplayBox;
