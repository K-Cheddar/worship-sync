import { CSSProperties, forwardRef, useRef } from "react";
import { OverlayInfo } from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import "./DisplayWindow.scss";

type DisplayStreamOverlayProps = {
  width: number;
  flOverlayInfo?: OverlayInfo;
  shouldAnimate?: boolean;
  isStream: boolean;
};

const DisplayStreamOverlay = forwardRef<
  HTMLUListElement,
  DisplayStreamOverlayProps
>(
  (
    { width, flOverlayInfo = {}, shouldAnimate = false, isStream },
    containerRef
  ) => {
    const floatingOverlayRef = useRef<HTMLLIElement | null>(null);
    const overlayTimeline = useRef<GSAPTimeline | null>();

    useGSAP(
      () => {
        if (
          !floatingOverlayRef.current ||
          !(containerRef as React.MutableRefObject<HTMLUListElement>)
            ?.current ||
          !shouldAnimate ||
          !isStream
        )
          return;
        const width = (containerRef as React.MutableRefObject<HTMLUListElement>)
          .current!.offsetWidth;

        overlayTimeline.current?.clear();

        const innerElements = [
          ".overlay-floating-info-name",
          ".overlay-floating-info-title",
          ".overlay-floating-info-event",
        ];
        const targets = [floatingOverlayRef.current, ...innerElements];

        overlayTimeline.current = gsap
          .timeline()
          .set(targets, { x: -width * 0.75 });

        // Only play animate if there is overlay info
        if (flOverlayInfo.name || flOverlayInfo.title || flOverlayInfo.event) {
          overlayTimeline.current
            .to(floatingOverlayRef.current, {
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
              delay: flOverlayInfo.duration,
            });
        }
      },
      { scope: floatingOverlayRef, dependencies: [flOverlayInfo] }
    );

    if (!flOverlayInfo.name && !flOverlayInfo.title && !flOverlayInfo.event)
      return null;

    return isStream ? (
      <>
        <li
          ref={floatingOverlayRef}
          className="overlay-floating-info-container"
          style={
            {
              "--overlay-floating-info-border-width": `${width / 71.4}vw`,
              "--overlay-floating-info-name-size": `${width / 31.3}vw`,
              "--overlay-floating-info-title-size": `${width / 41.2}vw`,
              "--overlay-floating-info-event-size": `${width / 50}vw`,
            } as CSSProperties
          }
        >
          {flOverlayInfo.name && (
            <p className="overlay-floating-info-name">{flOverlayInfo.name}</p>
          )}
          {flOverlayInfo.title && (
            <p className="overlay-floating-info-title">{flOverlayInfo.title}</p>
          )}
          {flOverlayInfo.event && (
            <p className="overlay-floating-info-event">{flOverlayInfo.event}</p>
          )}
        </li>
      </>
    ) : null;
  }
);

export default DisplayStreamOverlay;
