import { CSSProperties, useRef } from "react";
import { FormattedTextDisplayInfo } from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import "./DisplayWindow.scss";
import VerseDisplay from "./VerseDisplay";

type DisplayStreamFormattedTextProps = {
  width: number;
  formattedTextDisplayInfo?: FormattedTextDisplayInfo;
  prevFormattedTextDisplayInfo?: FormattedTextDisplayInfo;
  shouldAnimate?: boolean;
  isPrev?: boolean;
};

const generateFormattedTextStyles = (
  width: number,
  displayInfo?: FormattedTextDisplayInfo,
): CSSProperties =>
  ({
    "--formatted-text-background-color":
      displayInfo?.backgroundColor || "#eb8934",
    "--formatted-text-text-color": displayInfo?.textColor || "#ffffff",
    "--formatted-text-font-size": `${
      (displayInfo?.fontSize || 1.5) * (width / 100)
    }vw`,
    "--formatted-text-padding": displayInfo?.text
      ? `${displayInfo?.paddingY}% ${displayInfo?.paddingX}%`
      : "0",
    "--formatted-text-align": displayInfo?.align || "center",
    "--formatted-text-font-weight": displayInfo?.isBold ? "bold" : "normal",
    "--formatted-text-font-style": displayInfo?.isItalic ? "italic" : "normal",
  } as CSSProperties);

const DisplayStreamFormattedText = ({
  width,
  shouldAnimate = false,
  formattedTextDisplayInfo,
  prevFormattedTextDisplayInfo,
  isPrev = false,
}: DisplayStreamFormattedTextProps) => {
  const formattedTextRef = useRef<HTMLDivElement | null>(null);
  const prevFormattedTextRef = useRef<HTMLDivElement | null>(null);
  const formattedTextTimeline = useRef<GSAPTimeline | null>();
  const prevFormattedTextTimeline = useRef<GSAPTimeline | null>();

  useGSAP(
    () => {
      if (!formattedTextRef.current || !shouldAnimate) return;

      formattedTextTimeline.current?.clear();

      if (formattedTextDisplayInfo?.text?.trim()) {
        formattedTextTimeline.current = gsap.timeline().fromTo(
          formattedTextRef.current,
          {
            opacity: 0,
          },
          { opacity: 1, duration: 0.35, ease: "power1.inOut" },
        );
      }
    },
    {
      scope: formattedTextRef,
      dependencies: [formattedTextDisplayInfo, isPrev],
    },
  );

  useGSAP(
    () => {
      if (!prevFormattedTextRef.current || !shouldAnimate) return;

      prevFormattedTextTimeline.current?.clear();

      if (prevFormattedTextDisplayInfo?.text?.trim()) {
        prevFormattedTextTimeline.current = gsap.timeline().fromTo(
          prevFormattedTextRef.current,
          {
            opacity: 1,
          },
          { opacity: 0, duration: 0.35, ease: "power1.inOut" },
        );
      }
    },
    {
      scope: prevFormattedTextRef,
      dependencies: [prevFormattedTextDisplayInfo],
    },
  );

  const renderContent = (text: string) => {
    if (text.includes("\u200B")) {
      return <VerseDisplay words={text} className="text-yellow-400" />;
    }

    return text;
  };

  return (
    <>
      <div
        ref={formattedTextRef}
        className="formatted-text-container"
        style={generateFormattedTextStyles(width, formattedTextDisplayInfo)}
      >
        {formattedTextDisplayInfo?.text && (
          <p className="formatted-text-text">
            {renderContent(formattedTextDisplayInfo.text)}
          </p>
        )}
      </div>

      <div
        ref={prevFormattedTextRef}
        className="prev-formatted-text-container"
        style={generateFormattedTextStyles(width, prevFormattedTextDisplayInfo)}
      >
        {prevFormattedTextDisplayInfo?.text && (
          <p className="prev-formatted-text-text">
            {renderContent(prevFormattedTextDisplayInfo.text)}
          </p>
        )}
      </div>
    </>
  );
};

export default DisplayStreamFormattedText;
