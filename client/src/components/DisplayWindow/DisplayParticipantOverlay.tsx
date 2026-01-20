import { forwardRef, useRef } from "react";
import { OverlayInfo } from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { defaultParticipantOverlayStyles } from "./defaultOverlayStyles";
import SharedOverlay from "./SharedOverlay";

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
    const overlayTimeline = useRef<GSAPTimeline | null>(null);
    const prevOverlayTimeline = useRef<GSAPTimeline | null>(null);
    const containerXPercent = useRef(0);
    const containerOpacity = useRef(1);

    const currentStyles = {
      ...defaultParticipantOverlayStyles,
      ...participantOverlayInfo.formatting,
    };

    const prevStyles = {
      ...defaultParticipantOverlayStyles,
      ...prevParticipantOverlayInfo.formatting,
    };

    // Get participant data for children
    const participantData = [
      participantOverlayInfo.name,
      participantOverlayInfo.title,
      participantOverlayInfo.event,
    ].filter((item): item is string => Boolean(item));

    const prevParticipantData = [
      prevParticipantOverlayInfo.name,
      prevParticipantOverlayInfo.title,
      prevParticipantOverlayInfo.event,
    ].filter((item): item is string => Boolean(item));

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
        if (participantData.length > 0) {
          overlayTimeline.current = gsap
            .timeline()
            .to(participantOverlayRef.current, {
              xPercent: currentStyles.left,
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
        // Handle both callback refs and object refs
        const containerElement = typeof containerRef === 'function' 
          ? null // Callback refs don't have .current, but the ref is valid if function exists
          : (containerRef as React.MutableRefObject<HTMLDivElement>)?.current;
        
        if (
          !prevParticipantOverlayRef.current ||
          !shouldAnimate ||
          (typeof containerRef !== 'function' && !containerElement)
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

        if (prevParticipantData.length > 0) {
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

    const needsPadding = participantData.length > 0;
    const prevNeedsPadding = prevParticipantData.length > 0;

    return (
      <>
        <SharedOverlay
          ref={participantOverlayRef}
          width={width}
          styles={currentStyles}
          overlayInfo={participantOverlayInfo}
          needsPadding={needsPadding}
          overlayType="participant"
        />
        <SharedOverlay
          ref={prevParticipantOverlayRef}
          width={width}
          styles={prevStyles}
          overlayInfo={prevParticipantOverlayInfo}
          needsPadding={prevNeedsPadding}
          isPrev={true}
          overlayType="participant"
        />
      </>
    );
  }
);

export default DisplayParticipantOverlay;
