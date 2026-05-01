import { useEffect, useMemo, useRef, useState } from "react";
import { Box, TimerInfo } from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import cn from "classnames";
import TimerDisplay from "./TimerDisplay";
import VerseDisplay from "./VerseDisplay";
import NowDisplay from "./NowDisplay";
import {
  REFERENCE_WIDTH,
  REFERENCE_HEIGHT,
  DEFAULT_FONT_PX,
} from "../../constants";
import { useCachedMediaUrl } from "../../hooks/useCachedMediaUrl";

const DISPLAY_IMAGE_CACHE_SWAP_DEFER_MS = 650;

const hasDynamicDisplayText = (words?: string) =>
  Boolean(words?.includes("{{timer}}") || words?.includes("\u200C"));

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
  referenceWidth?: number;
  referenceHeight?: number;
  scaleFactor?: number;
  brightness?: number;
  isSimpleFont?: boolean;
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
  brightness,
  isSimpleFont,
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
  const rawImage = isVideoBg ? videoPlaceholderImage : background;
  const image = useCachedMediaUrl(rawImage);
  const [displayImage, setDisplayImage] = useState(image);
  const displayImageBoxIdRef = useRef(box.id);
  const displayRawImageRef = useRef(rawImage);
  const targetCurrentImgOpacity = shouldImageBeHidden ? 0 : 1;
  const skipTextAnimation =
    prevBox &&
    prevBox.words?.trim() === box.words?.trim() &&
    !hasDynamicDisplayText(box.words) &&
    !hasDynamicDisplayText(prevBox.words);
  const skipBackgroundAnimation =
    (prevBox && prevBox.background === background) || shouldImageBeHidden;
  const initialBackgroundOpacity = !shouldAnimate
    ? undefined
    : isPrev || skipBackgroundAnimation
      ? targetCurrentImgOpacity
      : 0;
  const initialTextOpacity = !shouldAnimate
    ? undefined
    : isPrev || skipTextAnimation
      ? 1
      : 0;

  useEffect(() => {
    if (
      displayImageBoxIdRef.current !== box.id ||
      displayRawImageRef.current !== rawImage
    ) {
      displayImageBoxIdRef.current = box.id;
      displayRawImageRef.current = rawImage;
      setDisplayImage(image);
      return;
    }

    if (displayImage === image) return;

    if (!shouldAnimate) {
      setDisplayImage(image);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setDisplayImage(image);
    }, DISPLAY_IMAGE_CACHE_SWAP_DEFER_MS);

    return () => window.clearTimeout(timeoutId);
  }, [box.id, displayImage, image, rawImage, shouldAnimate]);

  useGSAP(
    () => {
      if (!boxRef.current || !shouldAnimate) return;

      boxTimeline.current?.clear();

      const backgroundDuration = skipBackgroundAnimation ? 0 : 0.5;

      boxTimeline.current = gsap.timeline();

      if (isPrev) {
        boxTimeline.current.addLabel("fadeOut");
        if (!skipBackgroundAnimation && shouldShowBackground) {
          boxTimeline.current.set(".display-box-background", { opacity: 1 });
        }
        if (skipTextAnimation) {
          boxTimeline.current.set(".display-box-text", { opacity: 1 }, "fadeOut");
        } else {
          boxTimeline.current.fromTo(
            ".display-box-text",
            { opacity: 1 },
            { opacity: 0, duration: 0.35, ease: "power1.inOut" },
            "fadeOut"
          );
        }
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
        if (skipTextAnimation) {
          boxTimeline.current.set(".display-box-text", { opacity: 1 }, "fadeIn");
        } else {
          boxTimeline.current.fromTo(
            ".display-box-text",
            { opacity: 0 },
            { opacity: 1, duration: 0.35, ease: "power1.inOut" },
            "fadeIn"
          );
        }
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
    { scope: boxRef, dependencies: [box, shouldImageBeHidden] }
  );

  const bWords = box.words || "";
  const words = bWords;
  const fontSizeInPx = box.fontSize ?? DEFAULT_FONT_PX;

  const tSS = fontSizeInPx / 32;

  const boxWidthPx = (referenceWidth * box.width) / 100;
  const boxHeightPx = (referenceHeight * box.height) / 100;
  const sideMarginPx = box.sideMargin ? (boxWidthPx * box.sideMargin) / 100 : 0;
  const topMarginPx = box.topMargin ? (boxHeightPx * box.topMargin) / 100 : 0;

  const boxWidth = `${boxWidthPx - sideMarginPx * 2}px`;
  const boxHeight = `${boxHeightPx - topMarginPx * 2}px`;
  const marginLeft = `${sideMarginPx}px`;
  const marginRight = `${sideMarginPx}px`;
  const marginTop = `${topMarginPx}px`;
  const marginBottom = `${topMarginPx}px`;
  const boxTop = `${(referenceHeight * (box.y || 0)) / 100}px`;
  const boxLeft = `${(referenceWidth * (box.x || 0)) / 100}px`;
  const textStyles = {
    ...(isSimpleFont ? {} : {
      textShadow: `${tSS}px ${tSS}px ${tSS}px #000, ${tSS}px ${tSS}px ${tSS}px #000`
    }),
    textAlign: box.align || "center",
    lineHeight: 1.25,
    fontWeight: box.isBold ? "bold" : "normal",
    fontStyle: box.isItalic ? "italic" : "normal",
  };

  const renderContent = () => {
    if (words.includes("{{timer}}")) {
      return <TimerDisplay timerInfo={timerInfo} words={words} />;
    }
    if (words.includes("\u200B")) return <VerseDisplay words={words} />;
    if (words.includes("\u200C")) {
      return <NowDisplay words={words} timerInfo={timerInfo} />;
    }
    return words;
  };

  const brightnessValue = brightness ?? box.brightness;

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
        filter: `brightness(${brightnessValue}%)`,
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
          src={displayImage}
          alt={box.label}
          style={{
            opacity: initialBackgroundOpacity,
          }}
        />
      )}
      <p
        className="display-box-text h-full w-full bg-transparent whitespace-pre-line absolute overflow-hidden"
        style={{
          ...textStyles,
          opacity: initialTextOpacity,
        }}
      >
        {renderContent()}
      </p>
    </div>
  );
}

export default DisplayBox;
