import { forwardRef, useRef, useState } from "react";
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

    return (
      <>
        <div
          ref={stbOverlayRef}
          className="overlay-stb-info-container"
          style={{
            backgroundColor: currentStyles.backgroundColor,
            borderColor: currentStyles.borderColor,
            borderStyle: currentStyles.borderType,
            minWidth:
              typeof currentStyles.minWidth === "number"
                ? `${currentStyles.minWidth}%`
                : currentStyles.minWidth,
            height:
              typeof currentStyles.height === "number"
                ? `${currentStyles.height}%`
                : currentStyles.height,
            bottom: `${currentStyles.bottom}%`,
            left: currentStyles.left ? `${currentStyles.left}%` : undefined,
            right: currentStyles.right ? `${currentStyles.right}%` : undefined,
            paddingTop: needsPadding ? `${currentStyles.paddingTop}%` : 0,
            paddingBottom: needsPadding ? `${currentStyles.paddingBottom}%` : 0,
            paddingLeft: needsPadding ? `${currentStyles.paddingLeft}%` : 0,
            paddingRight: needsPadding ? `${currentStyles.paddingRight}%` : 0,
            display: currentStyles.display || "flex",
            flexDirection: currentStyles.flexDirection || "row",
            justifyContent: currentStyles.justifyContent || "flex-start",
            alignItems: currentStyles.alignItems || "center",
            gap: currentStyles.gap,
          }}
        >
          {stbOverlayInfo.heading && (
            <p
              className="overlay-stb-info-heading"
              style={{
                fontSize: getFontSize({
                  width,
                  fontSize: currentStyles.child1FontSize,
                }),
                fontWeight: currentStyles.child1FontWeight,
                fontStyle: currentStyles.child1FontStyle,
                color: currentStyles.child1FontColor,
              }}
            >
              {stbOverlayInfo.heading}
            </p>
          )}
          {stbOverlayInfo.subHeading && (
            <p
              className="overlay-stb-info-subHeading"
              style={{
                fontSize: getFontSize({
                  width,
                  fontSize: currentStyles.child2FontSize,
                }),
                fontWeight: currentStyles.child2FontWeight,
                fontStyle: currentStyles.child2FontStyle,
                color: currentStyles.child2FontColor,
              }}
            >
              {stbOverlayInfo.subHeading}
            </p>
          )}
        </div>
        <div
          ref={prevStbOverlayRef}
          className="overlay-stb-info-container"
          style={{
            backgroundColor: prevStyles.backgroundColor,
            borderColor: prevStyles.borderColor,
            borderStyle: prevStyles.borderType,
            minWidth: prevStyles.minWidth,
            height:
              typeof prevStyles.height === "number"
                ? `${prevStyles.height}%`
                : prevStyles.height,
            bottom: `${prevStyles.bottom}%`,
            left: prevStyles.left ? `${prevStyles.left}%` : undefined,
            right: prevStyles.right ? `${prevStyles.right}%` : undefined,
            paddingTop: prevNeedsPadding ? `${prevStyles.paddingTop}%` : 0,
            paddingBottom: prevNeedsPadding
              ? `${prevStyles.paddingBottom}%`
              : 0,
            paddingLeft: prevNeedsPadding ? `${prevStyles.paddingLeft}%` : 0,
            paddingRight: prevNeedsPadding ? `${prevStyles.paddingRight}%` : 0,
            display: prevStyles.display || "flex",
            flexDirection: prevStyles.flexDirection || "row",
            justifyContent: prevStyles.justifyContent || "flex-start",
            alignItems: prevStyles.alignItems || "center",
            gap: prevStyles.gap,
          }}
        >
          {prevStbOverlayInfo.heading && (
            <p
              className="overlay-stb-info-heading"
              style={{
                fontSize: getFontSize({
                  width,
                  fontSize: prevStyles.child1FontSize,
                }),
                fontWeight: prevStyles.child1FontWeight,
                fontStyle: prevStyles.child1FontStyle,
                color: prevStyles.child1FontColor,
              }}
            >
              {prevStbOverlayInfo.heading}
            </p>
          )}
          {prevStbOverlayInfo.subHeading && (
            <p
              className="prev-overlay-stb-info-subHeading"
              style={{
                fontSize: getFontSize({
                  width,
                  fontSize: prevStyles.child2FontSize,
                }),
                fontWeight: prevStyles.child2FontWeight,
                fontStyle: prevStyles.child2FontStyle,
                color: prevStyles.child2FontColor,
              }}
            >
              {prevStbOverlayInfo.subHeading}
            </p>
          )}
        </div>
      </>
    );
  }
);

export default DisplayStbOverlay;
