import { forwardRef, useRef } from "react";
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

    return (
      <>
        <div
          ref={participantOverlayRef}
          className="overlay-participant-info-container"
          style={{
            width:
              typeof currentStyles.width === "number"
                ? `${currentStyles.width}%`
                : currentStyles.width,
            backgroundColor: currentStyles.backgroundColor,
            borderColor: currentStyles.borderColor,
            borderStyle: currentStyles.borderType || "solid",
            borderLeftWidth: getBorderWidth({
              width,
              borderWidth: currentStyles.borderLeftWidth,
            }),
            borderLeftColor: currentStyles.borderLeftColor,
            borderRightWidth: getBorderWidth({
              width,
              borderWidth: currentStyles.borderRightWidth,
            }),
            borderRightColor: currentStyles.borderRightColor,
            borderTopWidth: getBorderWidth({
              width,
              borderWidth: currentStyles.borderTopWidth,
            }),
            borderTopColor: currentStyles.borderTopColor,
            borderBottomWidth: getBorderWidth({
              width,
              borderWidth: currentStyles.borderBottomWidth,
            }),
            borderTopLeftRadius: currentStyles.borderRadiusTopLeft,
            borderBottomLeftRadius: currentStyles.borderRadiusBottomLeft,
            borderTopRightRadius: currentStyles.borderRadiusTopRight,
            borderBottomRightRadius: currentStyles.borderRadiusBottomRight,
            paddingTop: needsPadding ? `${currentStyles.paddingTop}%` : 0,
            paddingBottom: needsPadding ? `${currentStyles.paddingBottom}%` : 0,
            paddingLeft: needsPadding ? `${currentStyles.paddingLeft}%` : 0,
            paddingRight: needsPadding ? `${currentStyles.paddingRight}%` : 0,
            maxWidth: `${currentStyles.maxWidth}%`,
            bottom: `${currentStyles.bottom}%`,
            left: currentStyles.left ? `${currentStyles.left}%` : undefined,
            display: currentStyles.display || "flex",
            flexDirection: currentStyles.flexDirection || "column",
            gap: `${currentStyles.gap}%`,
            alignItems: currentStyles.alignItems,
          }}
        >
          {participantOverlayInfo.name && (
            <p
              className="overlay-participant-info-name"
              style={{
                fontSize: getFontSize({
                  width,
                  fontSize: currentStyles.child1FontSize,
                }),
                color: currentStyles.child1FontColor,
                fontWeight: currentStyles.child1FontWeight,
                fontStyle: currentStyles.child1FontStyle,
                textAlign: currentStyles.child1TextAlign,
                width:
                  typeof currentStyles.child1Width === "number"
                    ? `${currentStyles.child1Width}%`
                    : currentStyles.child1Width,
              }}
            >
              {participantOverlayInfo.name}
            </p>
          )}
          {participantOverlayInfo.title && (
            <p
              className="overlay-participant-info-title"
              style={{
                fontSize: getFontSize({
                  width,
                  fontSize: currentStyles.child2FontSize,
                }),
                fontStyle: currentStyles.child2FontStyle,
                color: currentStyles.child2FontColor,
                fontWeight: currentStyles.child2FontWeight,
                textAlign: currentStyles.child2TextAlign,
                width:
                  typeof currentStyles.child2Width === "number"
                    ? `${currentStyles.child2Width}%`
                    : currentStyles.child2Width,
              }}
            >
              {participantOverlayInfo.title}
            </p>
          )}
          {participantOverlayInfo.event && (
            <p
              className="overlay-participant-info-event"
              style={{
                fontSize: getFontSize({
                  width,
                  fontSize: currentStyles.child3FontSize,
                }),
                color: currentStyles.child3FontColor,
                fontWeight: currentStyles.child3FontWeight,
                fontStyle: currentStyles.child3FontStyle,
                textAlign: currentStyles.child3TextAlign,
                width:
                  typeof currentStyles.child3Width === "number"
                    ? `${currentStyles.child3Width}%`
                    : currentStyles.child3Width,
              }}
            >
              {participantOverlayInfo.event}
            </p>
          )}
        </div>
        <div
          ref={prevParticipantOverlayRef}
          className="overlay-participant-info-container"
          style={{
            position: "absolute",
            overflow: "hidden",
            width:
              typeof prevStyles.width === "number"
                ? `${prevStyles.width}%`
                : prevStyles.width,
            backgroundColor: prevStyles.backgroundColor,
            borderColor: prevStyles.borderColor,
            borderStyle: prevStyles.borderType || "solid",
            borderLeftWidth: `${getBorderWidth({ width, borderWidth: prevStyles.borderLeftWidth })}px`,
            borderLeftColor: prevStyles.borderLeftColor,
            borderRightWidth: `${getBorderWidth({ width, borderWidth: prevStyles.borderRightWidth })}px`,
            borderRightColor: prevStyles.borderRightColor,
            borderTopWidth: `${getBorderWidth({ width, borderWidth: prevStyles.borderTopWidth })}px`,
            borderTopColor: prevStyles.borderTopColor,
            borderBottomWidth: `${getBorderWidth({ width, borderWidth: prevStyles.borderBottomWidth })}px`,
            borderTopLeftRadius: prevStyles.borderRadiusTopLeft,
            borderBottomLeftRadius: prevStyles.borderRadiusBottomLeft,
            borderTopRightRadius: prevStyles.borderRadiusTopRight,
            borderBottomRightRadius: prevStyles.borderRadiusBottomRight,
            paddingTop: prevNeedsPadding ? `${prevStyles.paddingTop}%` : 0,
            paddingBottom: prevNeedsPadding
              ? `${prevStyles.paddingBottom}%`
              : 0,
            paddingLeft: prevNeedsPadding ? `${prevStyles.paddingLeft}%` : 0,
            paddingRight: prevNeedsPadding ? `${prevStyles.paddingRight}%` : 0,
            maxWidth: `${prevStyles.maxWidth}%`,
            bottom: `${prevStyles.bottom}%`,
            left: prevStyles.left ? `${prevStyles.left}%` : undefined,
            display: prevStyles.display || "flex",
            flexDirection: prevStyles.flexDirection || "column",
            alignItems: prevStyles.alignItems,
            gap: `${prevStyles.gap}%`,
          }}
        >
          {prevParticipantOverlayInfo.name && (
            <p
              className="prev-overlay-participant-info-name"
              style={{
                fontSize: getFontSize({
                  width,
                  fontSize: prevStyles.child1FontSize,
                }),
                color: prevStyles.child1FontColor,
                fontWeight: prevStyles.child1FontWeight,
                fontStyle: prevStyles.child1FontStyle,
                textAlign: prevStyles.child1TextAlign,
                width:
                  typeof prevStyles.child1Width === "number"
                    ? `${prevStyles.child1Width}%`
                    : prevStyles.child1Width,
              }}
            >
              {prevParticipantOverlayInfo.name}
            </p>
          )}
          {prevParticipantOverlayInfo.title && (
            <p
              className="prev-overlay-participant-info-title"
              style={{
                fontSize: getFontSize({
                  width,
                  fontSize: prevStyles.child2FontSize,
                }),
                fontStyle: prevStyles.child2FontStyle,
                color: prevStyles.child2FontColor,
                fontWeight: prevStyles.child2FontWeight,
                textAlign: prevStyles.child2TextAlign,
                width:
                  typeof prevStyles.child2Width === "number"
                    ? `${prevStyles.child2Width}%`
                    : prevStyles.child2Width,
              }}
            >
              {prevParticipantOverlayInfo.title}
            </p>
          )}
          {prevParticipantOverlayInfo.event && (
            <p
              className="prev-overlay-participant-info-event"
              style={{
                fontSize: getFontSize({
                  width,
                  fontSize: prevStyles.child3FontSize,
                }),
                color: prevStyles.child3FontColor,
                fontWeight: prevStyles.child3FontWeight,
                fontStyle: prevStyles.child3FontStyle,
                textAlign: prevStyles.child3TextAlign,
                width:
                  typeof prevStyles.child3Width === "number"
                    ? `${prevStyles.child3Width}%`
                    : prevStyles.child3Width,
              }}
            >
              {prevParticipantOverlayInfo.event}
            </p>
          )}
        </div>
      </>
    );
  }
);

export default DisplayParticipantOverlay;
