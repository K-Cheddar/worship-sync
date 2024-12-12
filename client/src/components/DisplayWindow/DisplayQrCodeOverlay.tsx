import { CSSProperties, forwardRef, useRef } from "react";
import { OverlayInfo } from "../../types";
// @ts-ignore
import { QRCode } from "react-qr-code";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import "./DisplayWindow.scss";

type DisplayStreamOverlayProps = {
  width: number;
  qrCodeOverlayInfo?: OverlayInfo;
  shouldAnimate?: boolean;
};

const DisplayStreamOverlay = forwardRef<
  HTMLUListElement,
  DisplayStreamOverlayProps
>(({ width, qrCodeOverlayInfo = {}, shouldAnimate = false }, containerRef) => {
  const qrCodeOverlayRef = useRef<HTMLLIElement | null>(null);
  const overlayTimeline = useRef<GSAPTimeline | null>();

  useGSAP(
    () => {
      if (
        !qrCodeOverlayRef.current ||
        !(containerRef as React.MutableRefObject<HTMLUListElement>)?.current ||
        !shouldAnimate
      )
        return;

      overlayTimeline.current?.clear();

      const innerElements = [
        // ".overlay-qr-code-info-url",
        ".overlay-qr-code-info-description",
      ];

      overlayTimeline.current = gsap
        .timeline()
        .set(qrCodeOverlayRef.current, { opacity: 0 });

      // Only animate if there is overlay info
      if (qrCodeOverlayInfo.url || qrCodeOverlayInfo.description) {
        overlayTimeline.current
          .set(innerElements, { xPercent: 80, opacity: 0 })
          .to(qrCodeOverlayRef.current, {
            opacity: 1,
            duration: 2.5,
            ease: "power1.out",
          })
          .to(
            innerElements,
            { xPercent: 0, opacity: 1, duration: 2, ease: "power1.out" },
            "-=2.25"
          )
          .to(qrCodeOverlayRef.current, {
            opacity: 0,
            duration: 2.5,
            ease: "power1.out",
            delay: qrCodeOverlayInfo.duration,
          })
          .to(
            innerElements,
            { xPercent: 80, duration: 2, opacity: 0, ease: "power1.out" },
            "-=1.25"
          );
      }
    },
    { scope: qrCodeOverlayRef, dependencies: [qrCodeOverlayInfo] }
  );

  return (
    <li
      ref={qrCodeOverlayRef}
      className="overlay-qr-code-info-container"
      style={
        {
          "--overlay-qr-code-info-description-size": `${width / 40}vw`,
          "--overlay-qr-code-info-url-width": `${width / 10}vw`,
          "--overlay-qr-code-info-gap": `${width / 40}vw`,
          "--overlay-qr-code-info-padding":
            qrCodeOverlayInfo.url && qrCodeOverlayInfo.description
              ? `1% 2.5%`
              : "0",
          "--overlay-qr-code-info-color": qrCodeOverlayInfo.color,
        } as CSSProperties
      }
    >
      {qrCodeOverlayInfo.url && (
        <div className="overlay-qr-code-info-url">
          <QRCode
            style={{ width: "100%", maxWidth: "100%", height: "auto" }}
            value={qrCodeOverlayInfo.url}
          />
        </div>
      )}
      {qrCodeOverlayInfo.description && (
        <p className="overlay-qr-code-info-description">
          {qrCodeOverlayInfo.description}
        </p>
      )}
    </li>
  );
});

export default DisplayStreamOverlay;
