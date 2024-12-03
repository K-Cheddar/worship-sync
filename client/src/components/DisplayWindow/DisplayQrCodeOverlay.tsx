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
  isStream: boolean;
};

const DisplayStreamOverlay = forwardRef<
  HTMLUListElement,
  DisplayStreamOverlayProps
>(
  (
    { width, qrCodeOverlayInfo = {}, shouldAnimate = false, isStream },
    containerRef
  ) => {
    const qrCodeOverlayRef = useRef<HTMLLIElement | null>(null);
    const overlayTimeline = useRef<GSAPTimeline | null>();

    useGSAP(
      () => {
        if (
          !qrCodeOverlayRef.current ||
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
          ".overlay-qr-code-info-url",
          ".overlay-qr-code-info-description",
        ];
        const targets = [qrCodeOverlayRef.current, ...innerElements];

        overlayTimeline.current = gsap
          .timeline()
          .set(targets, { x: -width * 0.75 });

        // Only play animate if there is overlay info
        if (qrCodeOverlayInfo.url || qrCodeOverlayInfo.description) {
          overlayTimeline.current
            .to(qrCodeOverlayRef.current, {
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
              delay: qrCodeOverlayInfo.duration,
            });
        }
      },
      { scope: qrCodeOverlayRef, dependencies: [qrCodeOverlayInfo] }
    );

    return isStream ? (
      <>
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
              "--overlay-qr-code-info-left": shouldAnimate ? 0 : "2.5%",
              "--overlay-qr-code-info-text-shadow-size-p": `${width / 75}px`,
              "--overlay-qr-code-info-text-shadow-size-n": `-${width / 75}px`,
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
      </>
    ) : null;
  }
);

export default DisplayStreamOverlay;
