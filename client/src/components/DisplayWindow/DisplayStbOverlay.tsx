import { CSSProperties, forwardRef, useRef, useState } from "react";
import { OverlayInfo } from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { defaultStbOverlayStyles } from "./defaultOverlayStyles";
import "./DisplayWindow.scss";
import { getFontSize } from "./utils";

type DisplayStbOverlayProps = {
  width: number;
  stbOverlayInfo?: OverlayInfo;
  prevStbOverlayInfo?: OverlayInfo;
  shouldAnimate?: boolean;
};

const DisplayStbOverlay = forwardRef<HTMLDivElement, DisplayStbOverlayProps>(
  (
    {
      width,
      stbOverlayInfo = {},
      prevStbOverlayInfo = {},
      shouldAnimate = false,
    },
    containerRef
  ) => {
    const stbOverlayRef = useRef<HTMLDivElement | null>(null);
    const prevStbOverlayRef = useRef<HTMLDivElement | null>(null);
    const overlayTimeline = useRef<GSAPTimeline | null>();
    const prevOverlayTimeline = useRef<GSAPTimeline | null>();
    const [yPercent, setYPercent] = useState(120);
    const [opacity, setOpacity] = useState(0);

    useGSAP(
      () => {
        if (!stbOverlayRef.current || !shouldAnimate) return;

        overlayTimeline.current?.clear();

        overlayTimeline.current = gsap
          .timeline()
          .set(stbOverlayRef.current, { yPercent: 120, opacity: 0 });

        // Only play animate if there is overlay info
        if (stbOverlayInfo.heading || stbOverlayInfo.subHeading) {
          overlayTimeline.current
            .to(stbOverlayRef.current, {
              yPercent: 0,
              opacity: 1,
              duration: 1.5,
              ease: "power1.inOut",
              onUpdate: () => {
                setYPercent(
                  stbOverlayRef.current
                    ? (gsap.getProperty(
                        stbOverlayRef.current,
                        "yPercent"
                      ) as number)
                    : 0
                );
                setOpacity(
                  stbOverlayRef.current
                    ? (gsap.getProperty(
                        stbOverlayRef.current,
                        "opacity"
                      ) as number)
                    : 1
                );
              },
            })
            .to(stbOverlayRef.current, {
              yPercent: 120,
              opacity: 0,
              duration: 1.5,
              ease: "power1.inOut",
              delay: stbOverlayInfo.duration,
              onUpdate: () => {
                setYPercent(
                  stbOverlayRef.current
                    ? (gsap.getProperty(
                        stbOverlayRef.current,
                        "yPercent"
                      ) as number)
                    : 0
                );
                setOpacity(
                  stbOverlayRef.current
                    ? (gsap.getProperty(
                        stbOverlayRef.current,
                        "opacity"
                      ) as number)
                    : 1
                );
              },
            });
        }
      },
      {
        scope: stbOverlayRef,
        dependencies: [stbOverlayInfo, prevStbOverlayInfo],
      }
    );

    useGSAP(
      () => {
        if (
          !prevStbOverlayRef.current ||
          !shouldAnimate ||
          !(containerRef as React.MutableRefObject<HTMLDivElement>)?.current
        )
          return;

        prevOverlayTimeline.current?.clear();
        prevOverlayTimeline.current = gsap
          .timeline()
          .set(prevStbOverlayRef.current, { yPercent, opacity });

        if (prevStbOverlayInfo.heading || prevStbOverlayInfo.subHeading) {
          prevOverlayTimeline.current.to(prevStbOverlayRef.current, {
            yPercent: 120,
            opacity: 0,
            duration: 1.5,
            ease: "power1.inOut",
          });
        }
      },
      {
        scope: prevStbOverlayRef,
        dependencies: [prevStbOverlayInfo, yPercent, opacity],
      }
    );

    // Merge default styles with custom formatting
    const currentStyles = {
      ...defaultStbOverlayStyles,
      ...stbOverlayInfo.formatting,
    };

    const prevStyles = {
      ...defaultStbOverlayStyles,
      ...prevStbOverlayInfo.formatting,
    };

    const needsPadding = stbOverlayInfo.heading || stbOverlayInfo.subHeading;

    const prevNeedsPadding =
      prevStbOverlayInfo.heading || prevStbOverlayInfo.subHeading;

    console.log({ currentStyles, prevStyles });

    return (
      <>
        <div
          ref={stbOverlayRef}
          className="overlay-stb-info-container"
          style={
            {
              "--overlay-stb-info-padding-top": needsPadding
                ? `${currentStyles.paddingTop}%`
                : "0",
              "--overlay-stb-info-padding-bottom": needsPadding
                ? `${currentStyles.paddingBottom}%`
                : "0",
              "--overlay-stb-info-padding-left": needsPadding
                ? `${currentStyles.paddingLeft}%`
                : "0",
              "--overlay-stb-info-padding-right": needsPadding
                ? `${currentStyles.paddingRight}%`
                : "0",
              "--overlay-stb-bg-color": currentStyles.backgroundColor,
              "--overlay-stb-border-color": currentStyles.borderColor,
              "--overlay-stb-border-type": currentStyles.borderType,
              "--overlay-stb-min-width": currentStyles.minWidth,
              "--overlay-stb-height":
                typeof currentStyles.height === "number"
                  ? `${currentStyles.height}%`
                  : currentStyles.height,
              "--overlay-stb-bottom": `${currentStyles.bottom}%`,
              "--overlay-stb-left": `${currentStyles.left}%`,
              "--overlay-stb-right": `${currentStyles.right}%`,
              "--overlay-stb-child1-font-size": getFontSize({
                width,
                fontSize: currentStyles.child1FontSize,
              }),
              "--overlay-stb-child2-font-size": getFontSize({
                width,
                fontSize: currentStyles.child2FontSize,
              }),
              "--overlay-stb-child1-font-color": currentStyles.child1FontColor,
              "--overlay-stb-child2-font-color": currentStyles.child2FontColor,
              "--overlay-stb-child1-font-weight":
                currentStyles.child1FontWeight,
              "--overlay-stb-child2-font-weight":
                currentStyles.child2FontWeight,
              "--overlay-stb-child1-font-style": currentStyles.child1FontStyle,
              "--overlay-stb-child2-font-style": currentStyles.child2FontStyle,
              "--overlay-stb-text-align": currentStyles.textAlign,
              "--overlay-stb-display": currentStyles.display,
              "--overlay-stb-flex-direction": currentStyles.flexDirection,
              "--overlay-stb-justify-content": currentStyles.justifyContent,
              "--overlay-stb-align-items": currentStyles.alignItems,
              "--overlay-stb-gap": currentStyles.gap,
            } as CSSProperties
          }
        >
          {stbOverlayInfo.heading && (
            <p className="overlay-stb-info-heading">{stbOverlayInfo.heading}</p>
          )}
          {stbOverlayInfo.subHeading && (
            <p className="overlay-stb-info-subHeading">
              {stbOverlayInfo.subHeading}
            </p>
          )}
        </div>
        <div
          ref={prevStbOverlayRef}
          className="overlay-stb-info-container"
          style={
            {
              "--overlay-stb-info-padding-top": prevNeedsPadding
                ? `${prevStyles.paddingTop}%`
                : "0",
              "--overlay-stb-info-padding-bottom": prevNeedsPadding
                ? `${prevStyles.paddingBottom}%`
                : "0",
              "--overlay-stb-info-padding-left": prevNeedsPadding
                ? `${prevStyles.paddingLeft}%`
                : "0",
              "--overlay-stb-info-padding-right": prevNeedsPadding
                ? `${prevStyles.paddingRight}%`
                : "0",
              "--overlay-stb-bg-color": prevStyles.backgroundColor,
              "--overlay-stb-border-color": prevStyles.borderColor,
              "--overlay-stb-border-type": prevStyles.borderType,
              "--overlay-stb-min-width": prevStyles.minWidth,
              "--overlay-stb-height":
                typeof prevStyles.height === "number"
                  ? `${prevStyles.height}%`
                  : prevStyles.height,
              "--overlay-stb-bottom": `${prevStyles.bottom}%`,
              "--overlay-stb-left": `${prevStyles.left}%`,
              "--overlay-stb-right": `${prevStyles.right}%`,
              "--overlay-stb-child1-font-size": getFontSize({
                width,
                fontSize: prevStyles.child1FontSize,
              }),
              "--overlay-stb-child2-font-size": getFontSize({
                width,
                fontSize: prevStyles.child2FontSize,
              }),
              "--overlay-stb-child1-font-color": prevStyles.child1FontColor,
              "--overlay-stb-child2-font-color": prevStyles.child2FontColor,
              "--overlay-stb-child1-font-weight": prevStyles.child1FontWeight,
              "--overlay-stb-child2-font-weight": prevStyles.child2FontWeight,
              "--overlay-stb-child1-font-style": prevStyles.child1FontStyle,
              "--overlay-stb-child2-font-style": prevStyles.child2FontStyle,
              "--overlay-stb-text-align": prevStyles.textAlign,
              "--overlay-stb-display": prevStyles.display,
              "--overlay-stb-flex-direction": prevStyles.flexDirection,
              "--overlay-stb-justify-content": prevStyles.justifyContent,
              "--overlay-stb-align-items": prevStyles.alignItems,
              "--overlay-stb-gap": prevStyles.gap,
            } as CSSProperties
          }
        >
          {prevStbOverlayInfo.heading && (
            <p className="overlay-stb-info-heading">
              {prevStbOverlayInfo.heading}
            </p>
          )}
          {prevStbOverlayInfo.subHeading && (
            <p className="overlay-stb-info-subHeading">
              {prevStbOverlayInfo.subHeading}
            </p>
          )}
        </div>
      </>
    );
  }
);

export default DisplayStbOverlay;
