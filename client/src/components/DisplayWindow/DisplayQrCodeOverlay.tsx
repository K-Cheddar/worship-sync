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
        ".overlay-qr-code-info-url",
        ".overlay-qr-code-info-description",
      ];
      // const targets = [qrCodeOverlayRef.current, ...innerElements];

      overlayTimeline.current = gsap
        .timeline()
        .set(qrCodeOverlayRef.current, { opacity: 0 });

      // Only play animate if there is overlay info
      if (qrCodeOverlayInfo.url || qrCodeOverlayInfo.description) {
        overlayTimeline.current
          .set(innerElements, { yPercent: 150 })
          .to(qrCodeOverlayRef.current, {
            opacity: 1,
            duration: 2.5,
            ease: "power1.inOut",
          })
          .to(
            innerElements,
            { yPercent: 0, duration: 2, ease: "power1.inOut" },
            "-=2.0"
          )
          .to(qrCodeOverlayRef.current, {
            opacity: 0,
            duration: 2.5,
            ease: "power1.inOut",
            delay: qrCodeOverlayInfo.duration,
          })
          .to(
            innerElements,
            { yPercent: 150, duration: 2, ease: "power1.inOut" },
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
          "--overlay-qr-code-info-text-shadow-size-p": `${width / 65}px`,
          "--overlay-qr-code-info-text-shadow-size-n": `-${width / 65}px`,
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
