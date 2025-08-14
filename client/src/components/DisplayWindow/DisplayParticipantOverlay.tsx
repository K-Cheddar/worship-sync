import { CSSProperties, forwardRef, useRef } from "react";
import { OverlayInfo } from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { defaultParticipantOverlayStyles } from "./defaultOverlayStyles";
import "./DisplayWindow.scss";
import { getBorderWidth, getFontSize } from "./utils";

type DisplayParticipantOverlayProps = {
  width: number;
  participantOverlayInfo?: OverlayInfo;
  prevParticipantOverlayInfo?: OverlayInfo;
  shouldAnimate?: boolean;
};

const DisplayParticipantOverlay = forwardRef<
  HTMLDivElement,
  DisplayParticipantOverlayProps
>(
  (
    {
      width,
      participantOverlayInfo = {},
      prevParticipantOverlayInfo = {},
      shouldAnimate = false,
    },
    containerRef
  ) => {
    const participantOverlayRef = useRef<HTMLDivElement | null>(null);
    const prevParticipantOverlayRef = useRef<HTMLDivElement | null>(null);
    const overlayTimeline = useRef<GSAPTimeline | null>();
    const prevOverlayTimeline = useRef<GSAPTimeline | null>();
    const containerXPercent = useRef(0);
    const containerOpacity = useRef(1);

    useGSAP(
      () => {
        if (!participantOverlayRef.current || !shouldAnimate) return;

        overlayTimeline.current?.clear();

        const innerElements = [
          ".overlay-participant-info-name",
          ".overlay-participant-info-title",
          ".overlay-participant-info-event",
        ];
        const targets = [participantOverlayRef.current, ...innerElements];

        overlayTimeline.current = gsap
          .timeline()
          .set(targets, { xPercent: -105, opacity: 0 });

        // Only animate if there is overlay info
        if (
          participantOverlayInfo.name ||
          participantOverlayInfo.title ||
          participantOverlayInfo.event
        ) {
          overlayTimeline.current = gsap
            .timeline()
            .to(participantOverlayRef.current, {
              xPercent: 10,
              duration: 2.5,
              ease: "power1.out",
              opacity: 1,
              onUpdate: () => {
                if (participantOverlayRef.current) {
                  containerXPercent.current = gsap.getProperty(
                    participantOverlayRef.current,
                    "xPercent"
                  ) as number;
                  containerOpacity.current = gsap.getProperty(
                    participantOverlayRef.current,
                    "opacity"
                  ) as number;
                }
              },
            })
            .to(
              innerElements,
              {
                xPercent: 0,
                opacity: 1,
                duration: 2.5,
                ease: "power1.out",
                stagger: 0.5,
              },
              "-=2.25"
            )
            .to(participantOverlayRef.current, {
              xPercent: -105,
              duration: 2.5,
              opacity: 0,
              ease: "none",
              delay: participantOverlayInfo.duration,
              onUpdate: () => {
                if (participantOverlayRef.current) {
                  containerXPercent.current = gsap.getProperty(
                    participantOverlayRef.current,
                    "xPercent"
                  ) as number;
                  containerOpacity.current = gsap.getProperty(
                    participantOverlayRef.current,
                    "opacity"
                  ) as number;
                }
              },
            });
        }
      },
      {
        scope: participantOverlayRef,
        dependencies: [participantOverlayInfo, prevParticipantOverlayInfo],
      }
    );

    useGSAP(
      () => {
        if (
          !prevParticipantOverlayRef.current ||
          !shouldAnimate ||
          !(containerRef as React.MutableRefObject<HTMLDivElement>)?.current
        )
          return;

        prevOverlayTimeline.current?.clear();

        // Set previous overlay to match current animation state
        prevOverlayTimeline.current = gsap
          .timeline()
          .set(prevParticipantOverlayRef.current, {
            xPercent: containerXPercent.current,
            opacity: containerOpacity.current,
          });

        if (
          prevParticipantOverlayInfo.name ||
          prevParticipantOverlayInfo.title ||
          prevParticipantOverlayInfo.event
        ) {
          prevOverlayTimeline.current = gsap
            .timeline()
            .to(prevParticipantOverlayRef.current, {
              xPercent: -105,
              opacity: 0,
              duration: 1.5,
              ease: "power1.out",
              onUpdate: () => {
                if (prevParticipantOverlayRef.current) {
                  containerXPercent.current = gsap.getProperty(
                    prevParticipantOverlayRef.current,
                    "xPercent"
                  ) as number;
                  containerOpacity.current = gsap.getProperty(
                    prevParticipantOverlayRef.current,
                    "opacity"
                  ) as number;
                }
              },
            });
        }
      },
      {
        scope: prevParticipantOverlayRef,
        dependencies: [prevParticipantOverlayInfo],
      }
    );

    // Merge default styles with custom formatting
    const currentStyles = {
      ...defaultParticipantOverlayStyles,
      ...participantOverlayInfo.formatting,
    };

    const prevStyles = {
      ...defaultParticipantOverlayStyles,
      ...prevParticipantOverlayInfo.formatting,
    };

    const needsPadding =
      participantOverlayInfo.name ||
      participantOverlayInfo.title ||
      participantOverlayInfo.event;

    const prevNeedsPadding =
      prevParticipantOverlayInfo.name ||
      prevParticipantOverlayInfo.title ||
      prevParticipantOverlayInfo.event;

    console.log({ currentStyles, prevStyles });

    return (
      <>
        <div
          ref={participantOverlayRef}
          className="overlay-participant-info-container"
          style={
            {
              "--overlay-participant-info-padding-top": needsPadding
                ? `${currentStyles.paddingTop}%`
                : "0",
              "--overlay-participant-info-padding-bottom": needsPadding
                ? `${currentStyles.paddingBottom}%`
                : "0",
              "--overlay-participant-info-padding-left": needsPadding
                ? `${currentStyles.paddingLeft}%`
                : "0",
              "--overlay-participant-info-padding-right": needsPadding
                ? `${currentStyles.paddingRight}%`
                : "0",
              "--overlay-participant-width":
                typeof currentStyles.width === "number"
                  ? `${currentStyles.width}%`
                  : currentStyles.width,
              "--overlay-participant-bg-color": currentStyles.backgroundColor,
              "--overlay-participant-border-color": currentStyles.borderColor,
              "--overlay-participant-border-type": currentStyles.borderType,
              "--overlay-participant-border-left-width": getBorderWidth({
                width,
                borderWidth: currentStyles.borderLeftWidth,
              }),
              "--overlay-participant-border-radius-top-right":
                currentStyles.borderRadiusTopRight,
              "--overlay-participant-border-radius-bottom-right":
                currentStyles.borderRadiusBottomRight,
              "--overlay-participant-border-radius-top-left":
                currentStyles.borderRadiusTopLeft,
              "--overlay-participant-border-radius-bottom-left":
                currentStyles.borderRadiusBottomLeft,
              "--overlay-participant-max-width": `${currentStyles.maxWidth}%`,
              "--overlay-participant-bottom": `${currentStyles.bottom}%`,
              "--overlay-participant-left": `${currentStyles.left}%`,
              "--overlay-participant-child1-font-size": getFontSize({
                width,
                fontSize: currentStyles.child1FontSize,
              }),
              "--overlay-participant-child2-font-size": getFontSize({
                width,
                fontSize: currentStyles.child2FontSize,
              }),
              "--overlay-participant-child3-font-size": getFontSize({
                width,
                fontSize: currentStyles.child3FontSize,
              }),
              "--overlay-participant-child1-font-color":
                currentStyles.child1FontColor,
              "--overlay-participant-child2-font-color":
                currentStyles.child2FontColor,
              "--overlay-participant-child3-font-color":
                currentStyles.child3FontColor,
              "--overlay-participant-child1-font-weight":
                currentStyles.child1FontWeight,
              "--overlay-participant-child2-font-weight":
                currentStyles.child2FontWeight,
              "--overlay-participant-child3-font-weight":
                currentStyles.child3FontWeight,
              "--overlay-participant-child1-font-style":
                currentStyles.child1FontStyle,
              "--overlay-participant-child2-font-style":
                currentStyles.child2FontStyle,
              "--overlay-participant-child3-font-style":
                currentStyles.child3FontStyle,
              "--overlay-participant-child1-text-align":
                currentStyles.child1TextAlign,
              "--overlay-participant-child2-text-align":
                currentStyles.child2TextAlign,
              "--overlay-participant-child3-text-align":
                currentStyles.child3TextAlign,
              "--overlay-participant-child1-width":
                typeof currentStyles.child1Width === "number"
                  ? `${currentStyles.child1Width}%`
                  : currentStyles.child1Width,
              "--overlay-participant-child2-width":
                typeof currentStyles.child2Width === "number"
                  ? `${currentStyles.child2Width}%`
                  : currentStyles.child2Width,
              "--overlay-participant-child3-width":
                typeof currentStyles.child3Width === "number"
                  ? `${currentStyles.child3Width}%`
                  : currentStyles.child3Width,
              "--overlay-participant-display": currentStyles.display,
              "--overlay-participant-flex-direction":
                currentStyles.flexDirection,
              "--overlay-participant-gap": `${currentStyles.gap}%`,
              "--overlay-participant-align-items": currentStyles.alignItems,
            } as CSSProperties
          }
        >
          {participantOverlayInfo.name && (
            <p className="overlay-participant-info-name">
              {participantOverlayInfo.name}
            </p>
          )}
          {participantOverlayInfo.title && (
            <p className="overlay-participant-info-title">
              {participantOverlayInfo.title}
            </p>
          )}
          {participantOverlayInfo.event && (
            <p className="overlay-participant-info-event">
              {participantOverlayInfo.event}
            </p>
          )}
        </div>
        <div
          ref={prevParticipantOverlayRef}
          className="overlay-participant-info-container"
          style={
            {
              "--overlay-participant-info-padding-top": prevNeedsPadding
                ? `${prevStyles.paddingTop}%`
                : "0",
              "--overlay-participant-info-padding-bottom": prevNeedsPadding
                ? `${prevStyles.paddingBottom}%`
                : "0",
              "--overlay-participant-info-padding-left": prevNeedsPadding
                ? `${prevStyles.paddingLeft}%`
                : "0",
              "--overlay-participant-info-padding-right": prevNeedsPadding
                ? `${prevStyles.paddingRight}%`
                : "0",
              // Default style CSS variables (can be overridden by formatting)
              "--overlay-participant-width":
                typeof prevStyles.width === "number"
                  ? `${prevStyles.width}%`
                  : prevStyles.width,
              "--overlay-participant-bg-color": prevStyles.backgroundColor,
              "--overlay-participant-border-color": prevStyles.borderColor,
              "--overlay-participant-border-type": prevStyles.borderType,
              "--overlay-participant-border-left-width": `${prevStyles.borderLeftWidth}px`,
              "--overlay-participant-border-radius-top-right":
                prevStyles.borderRadiusTopRight,
              "--overlay-participant-border-radius-bottom-right":
                prevStyles.borderRadiusBottomRight,
              "--overlay-participant-border-radius-top-left":
                prevStyles.borderRadiusTopLeft,
              "--overlay-participant-border-radius-bottom-left":
                prevStyles.borderRadiusBottomLeft,
              "--overlay-participant-max-width": `${prevStyles.maxWidth}%`,
              "--overlay-participant-bottom": `${prevStyles.bottom}%`,
              "--overlay-participant-left": `${prevStyles.left}%`,
              "--overlay-participant-child1-font-size": getFontSize({
                width,
                fontSize: prevStyles.child1FontSize,
              }),
              "--overlay-participant-child2-font-size": getFontSize({
                width,
                fontSize: prevStyles.child2FontSize,
              }),
              "--overlay-participant-child3-font-size": getFontSize({
                width,
                fontSize: prevStyles.child3FontSize,
              }),
              "--overlay-participant-child1-font-color":
                prevStyles.child1FontColor,
              "--overlay-participant-child2-font-color":
                prevStyles.child2FontColor,
              "--overlay-participant-child3-font-color":
                prevStyles.child3FontColor,
              "--overlay-participant-child1-font-weight":
                prevStyles.child1FontWeight,
              "--overlay-participant-child2-font-weight":
                prevStyles.child2FontWeight,
              "--overlay-participant-child3-font-weight":
                prevStyles.child3FontWeight,
              "--overlay-participant-child1-font-style":
                prevStyles.child1FontStyle,
              "--overlay-participant-child1-text-align":
                prevStyles.child1TextAlign,
              "--overlay-participant-child2-text-align":
                prevStyles.child2TextAlign,
              "--overlay-participant-child3-text-align":
                prevStyles.child3TextAlign,
              "--overlay-participant-child1-width":
                typeof prevStyles.child1Width === "number"
                  ? `${prevStyles.child1Width}%`
                  : prevStyles.child1Width,
              "--overlay-participant-child2-width":
                typeof prevStyles.child2Width === "number"
                  ? `${prevStyles.child2Width}%`
                  : prevStyles.child2Width,
              "--overlay-participant-child3-width":
                typeof prevStyles.child3Width === "number"
                  ? `${prevStyles.child3Width}%`
                  : prevStyles.child3Width,
              "--overlay-participant-display": prevStyles.display,
              "--overlay-participant-flex-direction": prevStyles.flexDirection,
              "--overlay-participant-align-items": prevStyles.alignItems,
              "--overlay-participant-gap": `${prevStyles.gap}%`,
            } as CSSProperties
          }
        >
          {prevParticipantOverlayInfo.name && (
            <p className="prev-overlay-participant-info-name">
              {prevParticipantOverlayInfo.name}
            </p>
          )}
          {prevParticipantOverlayInfo.title && (
            <p className="prev-overlay-participant-info-title">
              {prevParticipantOverlayInfo.title}
            </p>
          )}
          {prevParticipantOverlayInfo.event && (
            <p className="prev-overlay-participant-info-event">
              {prevParticipantOverlayInfo.event}
            </p>
          )}
        </div>
      </>
    );
  }
);

export default DisplayParticipantOverlay;
