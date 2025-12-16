import { useRef } from "react";
import { FormattedTextDisplayInfo } from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
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
  displayInfo?: FormattedTextDisplayInfo
): React.CSSProperties => ({
  backgroundColor: displayInfo?.backgroundColor || "#eb8934",
  color: displayInfo?.textColor || "#ffffff",
  fontSize: `${(displayInfo?.fontSize || 1.5) * (width / 100)}vw`,
  padding: displayInfo?.text
    ? `${displayInfo?.paddingY}% ${displayInfo?.paddingX}%`
    : 0,
  fontWeight: displayInfo?.isBold ? "bold" : "normal",
  fontStyle: displayInfo?.isItalic ? "italic" : "normal",
  textAlign: displayInfo?.align || "center",
});

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
          { opacity: 1, duration: 0.35, ease: "power1.inOut" }
        );
      }
    },
    {
      scope: formattedTextRef,
      dependencies: [formattedTextDisplayInfo, isPrev],
    }
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
          { opacity: 0, duration: 0.35, ease: "power1.inOut" }
        );
      }
    },
    {
      scope: prevFormattedTextRef,
      dependencies: [prevFormattedTextDisplayInfo],
    }
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
