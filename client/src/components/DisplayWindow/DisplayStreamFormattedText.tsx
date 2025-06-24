import { CSSProperties, forwardRef, MutableRefObject, useRef } from "react";
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
};

const DisplayStreamFormattedText = forwardRef<
  HTMLDivElement,
  DisplayStreamFormattedTextProps
>(
  (
    {
      width,
      shouldAnimate = false,
      formattedTextDisplayInfo,
      prevFormattedTextDisplayInfo,
    }: DisplayStreamFormattedTextProps,
    containerRef
  ) => {
    const formattedTextRef = useRef<HTMLDivElement | null>(null);
    const prevFormattedTextRef = useRef<HTMLDivElement | null>(null);
    const formattedTextTimeline = useRef<GSAPTimeline | null>();
    const prevFormattedTextTimeline = useRef<GSAPTimeline | null>();

    useGSAP(
      () => {
        if (
          !formattedTextRef.current ||
          !(containerRef as MutableRefObject<HTMLDivElement>)?.current ||
          !shouldAnimate
        )
          return;

        formattedTextTimeline.current?.clear();

        if (formattedTextDisplayInfo?.text?.trim()) {
          formattedTextTimeline.current = gsap.timeline().fromTo(
            formattedTextRef.current,
            {
              opacity: 0,
              yPercent: 0,
            },
            { opacity: 1, duration: 0.35, ease: "power1.inOut" }
          );
        }
      },
      { scope: formattedTextRef, dependencies: [formattedTextDisplayInfo] }
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
              yPercent: 0,
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
          style={
            {
              "--formatted-text-background-color":
                formattedTextDisplayInfo?.backgroundColor || "#eb8934",
              "--formatted-text-text-color":
                formattedTextDisplayInfo?.textColor || "#ffffff",
              "--formatted-text-font-size": `${
                (formattedTextDisplayInfo?.fontSize || 1.5) * (width / 100)
              }vw`,
              "--formatted-text-padding": formattedTextDisplayInfo?.text
                ? `${formattedTextDisplayInfo?.paddingY}% ${formattedTextDisplayInfo?.paddingX}%`
                : "0",
            } as CSSProperties
          }
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
          style={
            {
              "--formatted-text-background-color":
                prevFormattedTextDisplayInfo?.backgroundColor || "#eb8934",
              "--formatted-text-text-color":
                prevFormattedTextDisplayInfo?.textColor || "#ffffff",
              "--formatted-text-font-size": `${
                (prevFormattedTextDisplayInfo?.fontSize || 1.5) * (width / 100)
              }vw`,
              "--formatted-text-padding": prevFormattedTextDisplayInfo?.text
                ? `${prevFormattedTextDisplayInfo?.paddingY}% ${prevFormattedTextDisplayInfo?.paddingX}%`
                : "0",
            } as CSSProperties
          }
        >
          {prevFormattedTextDisplayInfo?.text && (
            <p className="prev-formatted-text-text">
              {renderContent(prevFormattedTextDisplayInfo.text)}
            </p>
          )}
        </div>
      </>
    );
  }
);

export default DisplayStreamFormattedText;
