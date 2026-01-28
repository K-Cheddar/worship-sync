import { Box, TimerInfo } from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { useMemo, useRef } from "react";
import cn from "classnames";
import TimerDisplay from "./TimerDisplay";
import VerseDisplay from "./VerseDisplay";
import NowDisplay from "./NowDisplay";
import { REFERENCE_WIDTH, REFERENCE_HEIGHT, FONT_SIZE_MULTIPLIER } from "../../constants";

type DisplayBoxProps = {
  prevBox?: Box;
  box: Box;
  width: number;
  showBackground: boolean;
  index: number;
  shouldAnimate?: boolean;
  isPrev?: boolean;
  time?: number;
  timerInfo?: TimerInfo;
  activeVideoUrl?: string;
  isWindowVideoLoaded?: boolean;
  referenceWidth?: number; // Reference width for pixel calculations (1920px)
  referenceHeight?: number; // Reference height for pixel calculations (1080px)
  scaleFactor?: number; // Scale factor for adjusting stroke based on display size
};

const DisplayBox = ({
  prevBox,
  box,
  width,
  showBackground,
  index,
  shouldAnimate,
  isPrev,
  time,
  timerInfo,
  activeVideoUrl,
  isWindowVideoLoaded,
  referenceWidth = REFERENCE_WIDTH,
  referenceHeight = REFERENCE_HEIGHT,
  scaleFactor = 1,
}: DisplayBoxProps) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const boxTimeline = useRef<GSAPTimeline | null>(null);
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


  
  // Convert fontSize to pixels using the font size multiplier
  const fontSizeInPx = bFontSize ? bFontSize * FONT_SIZE_MULTIPLIER : FONT_SIZE_MULTIPLIER;
  
  // Text shadow and outline sizes in pixels (will scale with transform)
  const tSS = fontSizeInPx / 32 // text shadow size in px
  const fOS = fontSizeInPx / 128 // font outline size in px
  
  // Convert all percentage values to pixels based on reference dimensions
  const boxWidthPx = (referenceWidth * box.width) / 100;
  const boxHeightPx = (referenceHeight * box.height) / 100;
  const sideMarginPx = box.sideMargin ? (referenceWidth * box.sideMargin) / 100 : 0;
  const topMarginPx = box.topMargin ? (referenceHeight * box.topMargin) / 100 : 0;
  
  const boxWidth = `${boxWidthPx - sideMarginPx * 2}px`;
  const boxHeight = `${boxHeightPx - topMarginPx * 2}px`;
  const marginLeft = `${sideMarginPx}px`;
  const marginRight = `${sideMarginPx}px`;
  const marginTop = `${topMarginPx}px`;
  const marginBottom = `${topMarginPx}px`;
  const boxTop = `${(referenceHeight * (box.y || 0)) / 100}px`;
  const boxLeft = `${(referenceWidth * (box.x || 0)) / 100}px`;
  const textStyles = {
    textShadow: `${tSS}px ${tSS}px ${tSS}px #000, ${tSS}px ${tSS}px ${tSS}px #000`,
    WebkitTextStroke: `${fOS}px #000`,
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

    if (words.includes("\u200C")) {
      return <NowDisplay words={words} timerInfo={timerInfo} />;
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
      {shouldShowBackground && (
        <img
          className={cn(
            "display-box-background h-full w-full absolute",
            box.shouldKeepAspectRatio && "object-contain",
            shouldImageBeHidden ? "opacity-0" : "opacity-100"
          )}
          src={image}
          alt={box.label}
        />
      )}
      <p
        className="display-box-text h-full w-full bg-transparent whitespace-pre-line absolute"
        style={textStyles}
      >
        {renderContent()}
      </p>
    </div>
  );
};

export default DisplayBox;
