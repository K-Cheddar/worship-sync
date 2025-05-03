import { CSSProperties, forwardRef, useRef } from "react";
import { OverlayInfo } from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import "./DisplayWindow.scss";

type DisplayParticipantOverlayProps = {
  width: number;
  participantOverlayInfo?: OverlayInfo;
  shouldAnimate?: boolean;
};

const DisplayParticipantOverlay = forwardRef<
  HTMLDivElement,
  DisplayParticipantOverlayProps
>(
  (
    { width, participantOverlayInfo = {}, shouldAnimate = false },
    containerRef
  ) => {
    const participantOverlayRef = useRef<HTMLDivElement | null>(null);
    const overlayTimeline = useRef<GSAPTimeline | null>();

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
          participantOverlayInfo.event ||
          participantOverlayInfo.duration
        ) {
          overlayTimeline.current
            .fromTo(
              participantOverlayRef.current,
              {
                xPercent: -105,
                opacity: 0,
              },
              {
                xPercent: 10,
                duration: 2.5,
                ease: "power1.out",
                opacity: 1,
              }
            )
            .fromTo(
              innerElements,
              {
                xPercent: -105,
                opacity: 0,
              },
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
            });
        }
      },
      { scope: participantOverlayRef, dependencies: [participantOverlayInfo] }
    );

    return (
      <div
        ref={participantOverlayRef}
        className="overlay-participant-info-container"
        data-testid="participant-overlay"
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
                ? `0 2.5% 1% 2.5%`
                : "0",
          } as CSSProperties
        }
      >
        <div className="participant-content" data-testid="participant-content">
          <div className="participant-name" data-testid="participant-name">
            {participantOverlayInfo.name}
          </div>
          <div className="participant-title" data-testid="participant-title">
            {participantOverlayInfo.title}
          </div>
        </div>
        {participantOverlayInfo.event && (
          <p className="overlay-participant-info-event">
            {participantOverlayInfo.event}
          </p>
        )}
      </div>
    );
  }
);

export default DisplayParticipantOverlay;
