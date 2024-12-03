import { CSSProperties, forwardRef, useRef } from "react";
import { OverlayInfo } from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import "./DisplayWindow.scss";

type DisplayStreamOverlayProps = {
  width: number;
  participantOverlayInfo?: OverlayInfo;
  shouldAnimate?: boolean;
};

const DisplayStreamOverlay = forwardRef<
  HTMLUListElement,
  DisplayStreamOverlayProps
>(
  (
    { width, participantOverlayInfo = {}, shouldAnimate = false },
    containerRef
  ) => {
    const participantOverlayRef = useRef<HTMLLIElement | null>(null);
    const overlayTimeline = useRef<GSAPTimeline | null>();

    useGSAP(
      () => {
        if (
          !participantOverlayRef.current ||
          !(containerRef as React.MutableRefObject<HTMLUListElement>)
            ?.current ||
          !shouldAnimate
        )
          return;
        const width = (containerRef as React.MutableRefObject<HTMLUListElement>)
          .current!.offsetWidth;

        overlayTimeline.current?.clear();

        const innerElements = [
          ".overlay-participant-info-name",
          ".overlay-participant-info-title",
          ".overlay-participant-info-event",
        ];
        const targets = [participantOverlayRef.current, ...innerElements];

        overlayTimeline.current = gsap
          .timeline()
          .set(targets, { x: -width * 0.75 });

        // Only play animate if there is overlay info
        if (
          participantOverlayInfo.name ||
          participantOverlayInfo.title ||
          participantOverlayInfo.event
        ) {
          overlayTimeline.current
            .to(participantOverlayRef.current, {
              x: width * 0.025,
              duration: 1,
              ease: "power1.inOut",
            })
            .to(
              innerElements,
              { x: 0, duration: 1, ease: "power1.inOut", stagger: 0.2 },
              "-=0.75"
            )
            .to(targets, {
              x: -width * 0.75,
              duration: 1,
              ease: "power1.inOut",
              delay: participantOverlayInfo.duration,
            });
        }
      },
      { scope: participantOverlayRef, dependencies: [participantOverlayInfo] }
    );

    return (
      <li
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
                ? `0 2.5% 1% 2.5%`
                : "0",
            "--overlay-participant-info-text-shadow-size-p": `${width / 75}px`,
            "--overlay-participant-info-text-shadow-size-n": `-${width / 75}px`,
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
      </li>
    );
  }
);

export default DisplayStreamOverlay;
