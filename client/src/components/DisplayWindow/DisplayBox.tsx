import { Box, DisplayType } from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { useRef } from "react";

type DisplayBoxProps = {
  prevBox?: Box;
  box: Box;
  width: number;
  displayType?: DisplayType;
  showBackground: boolean;
  isStream: boolean;
  fontAdjustment: number;
  onChange?: Function;
  index: number;
  shouldAnimate?: boolean;
  isPrev?: boolean;
  time?: number;
};

const DisplayBox = ({
  prevBox,
  box,
  width,
  displayType,
  showBackground,
  isStream,
  fontAdjustment,
  onChange,
  index,
  shouldAnimate,
  isPrev,
  time,
}: DisplayBoxProps) => {
  const boxRef = useRef<HTMLLIElement>(null);
  const boxTimeline = useRef<GSAPTimeline>();
  const shouldShowBackground = showBackground && box.background;

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

        if (!skipTextAnimation) {
          boxTimeline.current.set(".display-box-text", { opacity: 1 });
        }
        if (!skipBackgroundAnimation && shouldShowBackground) {
          boxTimeline.current.set(".display-box-background", { opacity: 1 });
        }
        boxTimeline.current.to(".display-box-text", {
          opacity: 0,
          duration: textDuration,
          ease: "power1.inOut",
        });

        if (shouldShowBackground) {
          boxTimeline.current.to(
            ".display-box-background",
            { opacity: 0, duration: backgroundDuration, ease: "power1.inOut" },
            `-=${textDuration}`
          );
        }
      } else {
        boxTimeline.current = gsap.timeline();

        if (!skipTextAnimation) {
          boxTimeline.current.set(".display-box-text", { opacity: 0 });
        }
        if (!skipBackgroundAnimation && shouldShowBackground) {
          boxTimeline.current.set(".display-box-background", { opacity: 0 });
        }
        boxTimeline.current.to(".display-box-text", {
          opacity: 1,
          duration: textDuration,
          ease: "power1.inOut",
        });

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

  const bFontSize = isStream ? 1 : box.fontSize;
  const bWords = box.words || "";
  const words = isStream ? bWords.trim() : bWords;
  const fontSizeValue = bFontSize ? bFontSize / fontAdjustment : 1;
  const tSS = fontSizeValue / (width > 20 ? 32 : 10); // text shadow size
  const fOS = fontSizeValue / (width > 20 ? 32 : 114); // font outline size
  const textStyles = {
    textShadow: `${tSS}vw ${tSS}vw ${tSS}vw #000, ${tSS}vw ${tSS}vw ${tSS}vw #000`,
    WebkitTextStroke: `${fOS}vw #000`,
    textAlign: box.align || "center",
    lineHeight: 1.25,
  };
  return (
    <li
      key={box.id}
      ref={boxRef}
      className="absolute leading-tight"
      style={{
        width: `calc(${box.width}% - ${
          box.sideMargin ? box.sideMargin * 2 : 0
        }%)`,
        // % margin is calculated based on the width so we get the percentage of top and bottom margin, then multiply by the width of the container
        height: `calc(${box.height}% - (${width}vw * (${box.topMargin || 0} + ${
          box.topMargin || 0
        }) / 100) )`,
        pointerEvents: box.isLocked ? "none" : "all",
        fontSize: `${fontSizeValue}vw`,
        marginTop: `${box.topMargin}%`,
        marginBottom: `${box.topMargin}%`,
        marginLeft: `${box.sideMargin}%`,
        marginRight: `${box.sideMargin}%`,
      }}
    >
      {shouldShowBackground && (
        <img
          className="display-box-background"
          src={box.background}
          alt={box.label}
        />
      )}
      {isStream && box.background && (
        <div className="h-full w-full absolute bg-transparent" />
      )}
      {typeof onChange !== "function" && (
        <p
          className={`display-box-text ${
            isStream ? "h-fit bottom-0 text-center" : "h-full"
          }`}
          style={textStyles}
        >
          {words}
        </p>
      )}
      {typeof onChange === "function" && (
        <textarea
          className="h-full w-full bg-transparent absolute resize-none overflow-hidden"
          id={`display-box-text-${index}`}
          value={words}
          style={textStyles}
          onChange={(e) => {
            e.preventDefault();
            onChange({
              index,
              value: e.target.value,
              box,
              cursorPosition: e.target.selectionStart,
            });
          }}
        />
      )}
    </li>
  );
};

export default DisplayBox;
