import { CSSProperties, forwardRef, useRef } from "react";
import { OverlayInfo } from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import "./DisplayWindow.scss";

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
    containerRef,
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
                    "xPercent",
                  ) as number;
                  containerOpacity.current = gsap.getProperty(
                    participantOverlayRef.current,
                    "opacity",
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
              "-=2.25",
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
                    "xPercent",
                  ) as number;
                  containerOpacity.current = gsap.getProperty(
                    participantOverlayRef.current,
                    "opacity",
                  ) as number;
                }
              },
            });
        }
      },
      {
        scope: participantOverlayRef,
        dependencies: [participantOverlayInfo, prevParticipantOverlayInfo],
      },
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
                    "xPercent",
                  ) as number;
                  containerOpacity.current = gsap.getProperty(
                    prevParticipantOverlayRef.current,
                    "opacity",
                  ) as number;
                }
              },
            });
        }
      },
      {
        scope: prevParticipantOverlayRef,
        dependencies: [prevParticipantOverlayInfo],
      },
    );

    return (
      <>
        <div
          ref={participantOverlayRef}
          className="overlay-participant-info-container"
          style={
            {
              "--overlay-participant-info-border-width": `${width / 71.4}vw`,
              "--overlay-participant-info-name-size": `${width / 31.3}vw`,
              "--overlay-participant-info-title-size": `${width / 41.2}vw`,
              "--overlay-participant-info-event-size": `${width / 50}vw`,
              "--overlay-participant-info-left": shouldAnimate ? 0 : "2.5%",
              "--overlay-participant-info-padding":
                participantOverlayInfo.name ||
                participantOverlayInfo.title ||
                participantOverlayInfo.event
                  ? "0 2.5% 1% 2.5%"
                  : "0",
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
              "--overlay-participant-info-border-width": `${width / 71.4}vw`,
              "--overlay-participant-info-name-size": `${width / 31.3}vw`,
              "--overlay-participant-info-title-size": `${width / 41.2}vw`,
              "--overlay-participant-info-event-size": `${width / 50}vw`,
              "--overlay-participant-info-left": shouldAnimate ? 0 : "2.5%",
              "--overlay-participant-info-padding":
                prevParticipantOverlayInfo.name ||
                prevParticipantOverlayInfo.title ||
                prevParticipantOverlayInfo.event
                  ? "0 2.5% 1% 2.5%"
                  : "0",
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
  },
);

export default DisplayParticipantOverlay;
