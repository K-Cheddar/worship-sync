import { Box, TimerInfo } from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { useMemo, useRef } from "react";
import cn from "classnames";
import TimerDisplay from "./TimerDisplay";
import VerseDisplay from "./VerseDisplay";

type DisplayBoxProps = {
  prevBox?: Box;
  box: Box;
  width: number;
  showBackground: boolean;
  fontAdjustment: number;
  index: number;
  shouldAnimate?: boolean;
  isPrev?: boolean;
  time?: number;
  timerInfo?: TimerInfo;
  activeVideoUrl?: string;
  isWindowVideoLoaded?: boolean;
};

const DisplayBox = ({
  prevBox,
  box,
  width,
  showBackground,
  fontAdjustment,
  index,
  shouldAnimate,
  isPrev,
  time,
  timerInfo,
  activeVideoUrl,
  isWindowVideoLoaded,
}: DisplayBoxProps) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const boxTimeline = useRef<GSAPTimeline>();
  const isVideoBg = box.mediaInfo?.type === "video";
  const videoUrl = box.mediaInfo?.background;
  const shouldImageBeHidden = useMemo(
    () =>
      isVideoBg &&
      videoUrl &&
      videoUrl === activeVideoUrl &&
      isWindowVideoLoaded,
    [isVideoBg, videoUrl, activeVideoUrl, isWindowVideoLoaded]
  );

  const background = box.background;
  const shouldShowBackground = showBackground && background;
  const videoPlaceholderImage = box.mediaInfo?.placeholderImage;
  const image = isVideoBg ? videoPlaceholderImage : background;
  const targetCurrentImgOpacity = shouldImageBeHidden ? 0 : 1;

  useGSAP(
    () => {
      if (!boxRef.current || !shouldAnimate) return;

      boxTimeline.current?.clear();

      const skipTextAnimation =
        prevBox && prevBox.words?.trim() === box.words?.trim();
      const skipBackgroundAnimation =
        (prevBox && prevBox.background === background) || shouldImageBeHidden;
      const textDuration = skipTextAnimation ? 0 : 0.35;
      const backgroundDuration = skipBackgroundAnimation ? 0 : 0.5;

      // if ((prevBox && prevBox.words !== box.words)) {
      //   targets.push('.display-box-text')
      // }
      // if ((prevBox && prevBox.background !== box.background)) {
      //   targets.push('.display-box-background')
      // }

      boxTimeline.current = gsap.timeline();

      if (isPrev) {
        boxTimeline.current.addLabel("fadeOut");
        if (!skipBackgroundAnimation && shouldShowBackground) {
          boxTimeline.current.set(".display-box-background", {
            opacity: 1,
          });
        }
        boxTimeline.current.fromTo(
          ".display-box-text",
          { opacity: 1 },
          {
            opacity: 0,
            duration: textDuration,
            ease: "power1.inOut",
          },
          "fadeOut"
        );

        if (shouldShowBackground) {
          boxTimeline.current.to(
            ".display-box-background",
            { opacity: 0, duration: backgroundDuration, ease: "power1.inOut" },
            "fadeOut"
          );
        }
      } else {
        boxTimeline.current.addLabel("fadeIn");
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
          },
          "fadeIn"
        );

        if (shouldShowBackground) {
          boxTimeline.current.to(
            ".display-box-background",
            {
              opacity: targetCurrentImgOpacity,
              duration: backgroundDuration,
              ease: "power1.inOut",
            },
            "fadeIn"
          );
        }
      }
    },
    { scope: boxRef, dependencies: [box, time, shouldImageBeHidden] }
  );

  const bWords = box.words || "";
  const words = bWords;
  const bFontSize = box.fontSize;
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
    fontWeight: box.isBold ? "bold" : "normal",
    fontStyle: box.isItalic ? "italic" : "normal",
  };

  const renderContent = () => {
    if (words.includes("{{timer}}")) {
      return <TimerDisplay timerInfo={timerInfo} words={words} />;
    }

    if (words.includes("\u200B")) {
      return <VerseDisplay words={words} />;
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
            box.shouldKeepAspectRatio && "object-contain",
            shouldImageBeHidden ? "opacity-0" : "opacity-100"
          )}
          src={image}
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
