import { forwardRef, useRef } from "react";
import { OverlayInfo } from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import "./DisplayWindow.scss";

type DisplayImageOverlayProps = {
  width: number;
  imageOverlayInfo?: OverlayInfo;
  shouldAnimate?: boolean;
};

const DisplayImageOverlay = forwardRef<
  HTMLDivElement,
  DisplayImageOverlayProps
>(({ width, imageOverlayInfo = {}, shouldAnimate = false }, containerRef) => {
  const imageOverlayRef = useRef<HTMLDivElement | null>(null);
  const overlayTimeline = useRef<GSAPTimeline | null>();

  useGSAP(
    () => {
      if (
        !imageOverlayRef.current ||
        !(containerRef as React.MutableRefObject<HTMLDivElement>)?.current ||
        !shouldAnimate
      )
        return;

      overlayTimeline.current?.clear();

      overlayTimeline.current = gsap
        .timeline()
        .set(imageOverlayRef.current, { opacity: 0 });

      // Only animate if there is an image set
      if (imageOverlayInfo.imageUrl) {
        overlayTimeline.current
          .to(imageOverlayRef.current, {
            opacity: 1,
            duration: 2.5,
            ease: "power1.out",
          })
          .to(imageOverlayRef.current, {
            opacity: 0,
            duration: 2.5,
            ease: "power1.out",
            delay: imageOverlayInfo.duration,
          });
      }
    },
    { scope: imageOverlayRef, dependencies: [imageOverlayInfo] }
  );

  return (
    <div ref={imageOverlayRef} className="overlay-image-container">
      {imageOverlayInfo.imageUrl && (
        <img
          className="max-w-full max-h-full object-contain"
          src={imageOverlayInfo.imageUrl}
          alt={imageOverlayInfo.name}
        />
      )}
    </div>
  );
});

export default DisplayImageOverlay;
