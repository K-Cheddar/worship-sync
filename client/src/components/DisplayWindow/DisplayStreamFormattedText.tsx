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
  const formattedTextTimeline = useRef<GSAPTimeline | null>(null);
  const prevFormattedTextTimeline = useRef<GSAPTimeline | null>(null);

  const formattedTextText = formattedTextDisplayInfo?.text?.trim() || "";
  const prevFormattedTextText = prevFormattedTextDisplayInfo?.text?.trim() || "";

  useGSAP(
    () => {
      if (!formattedTextRef.current || !shouldAnimate || !formattedTextText) return;

      formattedTextTimeline.current?.clear();
      const el = formattedTextRef.current;
      gsap.set(el, { opacity: 0 });
      formattedTextTimeline.current = gsap.timeline().fromTo(
        el,
        { opacity: 0 },
        { opacity: 1, duration: 0.35, ease: "power1.inOut" }
      );
    },
    {
      scope: formattedTextRef,
      dependencies: [formattedTextDisplayInfo, shouldAnimate],
    }
  );

  useGSAP(
    () => {
      if (!prevFormattedTextRef.current || !shouldAnimate || !prevFormattedTextText) return;

      prevFormattedTextTimeline.current?.clear();

      if (prevFormattedTextDisplayInfo?.text?.trim()) {
        prevFormattedTextTimeline.current = gsap.timeline().fromTo(
          prevFormattedTextRef.current,
          { opacity: 1 },
          { opacity: 0, duration: 0.35, ease: "power1.inOut" }
        );
      }
    },
    {
      scope: prevFormattedTextRef,
      dependencies: [prevFormattedTextDisplayInfo, shouldAnimate],
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
      {formattedTextText && (
        <div
          ref={formattedTextRef}
          className="w-fit absolute flex flex-col mx-auto left-0 right-0 max-w-[65%] bottom-[5%] rounded-[2%/8%] whitespace-pre-line"
          style={{
            ...generateFormattedTextStyles(width, formattedTextDisplayInfo),
          }}
        >
          <p className="formatted-text-text">
            {renderContent(formattedTextText)}
          </p>
        </div>
      )}

      {prevFormattedTextText && (
        <div
          ref={prevFormattedTextRef}
          className="w-fit absolute flex flex-col mx-auto left-0 right-0 max-w-[65%] bottom-[5%] rounded-[2%/8%] whitespace-pre-line"
          style={{
            ...generateFormattedTextStyles(width, prevFormattedTextDisplayInfo),
          }}
        >
          <p className="prev-formatted-text-text">
            {renderContent(prevFormattedTextText)}
          </p>
        </div>
      )}
    </>
  );
};

export default DisplayStreamFormattedText;
