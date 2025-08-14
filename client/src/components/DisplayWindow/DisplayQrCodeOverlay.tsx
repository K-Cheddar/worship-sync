import { forwardRef, useRef } from "react";
import { OverlayInfo } from "../../types";
// @ts-ignore
import { QRCode } from "react-qr-code";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { defaultQrCodeOverlayStyles } from "./defaultOverlayStyles";
import "./DisplayWindow.scss";
import { getFontSize } from "./utils";

type DisplayQRCodeOverlayProps = {
  width: number;
  qrCodeOverlayInfo?: OverlayInfo;
  prevQrCodeOverlayInfo?: OverlayInfo;
  shouldAnimate?: boolean;
};

const DisplayQRCodeOverlay = forwardRef<
  HTMLDivElement,
  DisplayQRCodeOverlayProps
>(
  (
    {
      width,
      qrCodeOverlayInfo = {},
      prevQrCodeOverlayInfo = {},
      shouldAnimate = false,
    },
    containerRef
  ) => {
    const qrCodeOverlayRef = useRef<HTMLDivElement | null>(null);
    const prevQrCodeOverlayRef = useRef<HTMLDivElement | null>(null);
    const overlayTimeline = useRef<GSAPTimeline | null>();
    const prevOverlayTimeline = useRef<GSAPTimeline | null>();
    const opacity = useRef(0);

    useGSAP(
      () => {
        if (
          !qrCodeOverlayRef.current ||
          !(containerRef as React.MutableRefObject<HTMLDivElement>)?.current ||
          !shouldAnimate
        )
          return;

        overlayTimeline.current?.clear();

        const innerElements = [".overlay-qr-code-info-description"];

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
              onUpdate: () => {
                opacity.current = qrCodeOverlayRef.current
                  ? (gsap.getProperty(
                      qrCodeOverlayRef.current,
                      "opacity"
                    ) as number)
                  : 1;
              },
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
              onUpdate: () => {
                opacity.current = qrCodeOverlayRef.current
                  ? (gsap.getProperty(
                      qrCodeOverlayRef.current,
                      "opacity"
                    ) as number)
                  : 1;
              },
            })
            .to(
              innerElements,
              { xPercent: 80, duration: 2, opacity: 0, ease: "power1.out" },
              "-=1.25"
            );
        }
      },
      {
        scope: qrCodeOverlayRef,
        dependencies: [qrCodeOverlayInfo, prevQrCodeOverlayInfo],
      }
    );

    useGSAP(
      () => {
        if (
          !prevQrCodeOverlayRef.current ||
          !shouldAnimate ||
          !(containerRef as React.MutableRefObject<HTMLDivElement>)?.current
        )
          return;

        prevOverlayTimeline.current?.clear();
        prevOverlayTimeline.current = gsap
          .timeline()
          .set(prevQrCodeOverlayRef.current, { opacity: opacity.current });

        if (prevQrCodeOverlayInfo.url || prevQrCodeOverlayInfo.description) {
          prevOverlayTimeline.current.to(prevQrCodeOverlayRef.current, {
            opacity: 0,
            duration: 1.5,
            ease: "power1.out",
          });
        }
      },
      {
        scope: prevQrCodeOverlayRef,
        dependencies: [prevQrCodeOverlayInfo, opacity],
      }
    );

    // Merge default styles with custom formatting
    const currentStyles = {
      ...defaultQrCodeOverlayStyles,
      ...qrCodeOverlayInfo.formatting,
    };

    const prevStyles = {
      ...defaultQrCodeOverlayStyles,
      ...prevQrCodeOverlayInfo.formatting,
    };

    const needsPadding = qrCodeOverlayInfo.url && qrCodeOverlayInfo.description;

    const prevNeedsPadding =
      prevQrCodeOverlayInfo.url && prevQrCodeOverlayInfo.description;

    return (
      <>
        <div
          ref={qrCodeOverlayRef}
          className="overlay-qr-code-info-container"
          style={{
            backgroundColor: currentStyles.backgroundColor,
            color: currentStyles.fontColor,
            borderColor: currentStyles.borderColor,
            borderStyle: currentStyles.borderType,
            borderRadius: currentStyles.borderRadius,
            paddingTop: needsPadding ? `${currentStyles.paddingTop}%` : 0,
            paddingBottom: needsPadding ? `${currentStyles.paddingBottom}%` : 0,
            paddingLeft: needsPadding ? `${currentStyles.paddingLeft}%` : 0,
            paddingRight: needsPadding ? `${currentStyles.paddingRight}%` : 0,
            maxWidth: `${currentStyles.maxWidth}%`,
            height:
              typeof currentStyles.height === "number"
                ? `${currentStyles.height}%`
                : currentStyles.height,
            bottom: `${currentStyles.bottom}%`,
            left: currentStyles.left ? `${currentStyles.left}%` : 0,
            right: currentStyles.right ? `${currentStyles.right}%` : 0,
            display: currentStyles.display,
            flexDirection: currentStyles.flexDirection,
            justifyContent: currentStyles.justifyContent,
            alignItems: currentStyles.alignItems,
            gap: `${currentStyles.gap}%`,
          }}
        >
          {qrCodeOverlayInfo.url && (
            <div
              className="overlay-qr-code-info-url"
              style={{
                width:
                  typeof currentStyles.child1Width === "number"
                    ? `${currentStyles.child1Width}%`
                    : currentStyles.child1Width,
                height:
                  typeof currentStyles.child1Height === "number"
                    ? `${currentStyles.child1Height}%`
                    : currentStyles.child1Height,
              }}
            >
              <QRCode
                style={{ width: "100%", height: "auto" }}
                value={qrCodeOverlayInfo.url}
              />
            </div>
          )}
          {qrCodeOverlayInfo.description && (
            <p
              className="overlay-qr-code-info-description"
              style={{
                fontSize: `${getFontSize({ width, fontSize: currentStyles.fontSize })}`,
                color: currentStyles.fontColor,
                fontWeight: currentStyles.fontWeight || "600",
                fontStyle: currentStyles.fontStyle,
                textAlign: currentStyles.textAlign,
                whiteSpace: "pre-line",
              }}
            >
              {qrCodeOverlayInfo.description}
            </p>
          )}
        </div>
        <div
          ref={prevQrCodeOverlayRef}
          className="overlay-qr-code-info-container"
          style={{
            backgroundColor: prevStyles.backgroundColor,
            color: prevStyles.fontColor,
            borderColor: prevStyles.borderColor,
            borderStyle: prevStyles.borderType,
            borderRadius: prevStyles.borderRadius,
            paddingTop: prevNeedsPadding ? `${prevStyles.paddingTop}%` : 0,
            paddingBottom: prevNeedsPadding
              ? `${prevStyles.paddingBottom}%`
              : 0,
            paddingLeft: prevNeedsPadding ? `${prevStyles.paddingLeft}%` : 0,
            paddingRight: prevNeedsPadding ? `${prevStyles.paddingRight}%` : 0,
            maxWidth: `${prevStyles.maxWidth}%`,
            height:
              typeof prevStyles.height === "number"
                ? `${prevStyles.height}%`
                : prevStyles.height,
            bottom: `${prevStyles.bottom}%`,
            left: prevStyles.left ? `${prevStyles.left}%` : 0,
            right: prevStyles.right ? `${prevStyles.right}%` : 0,
            display: prevStyles.display,
            flexDirection: prevStyles.flexDirection,
            justifyContent: prevStyles.justifyContent,
            alignItems: prevStyles.alignItems,
            gap: `${prevStyles.gap}%`,
          }}
        >
          {prevQrCodeOverlayInfo.url && (
            <div
              className="overlay-qr-code-info-url"
              style={{
                width:
                  typeof prevStyles.child1Width === "number"
                    ? `${prevStyles.child1Width}%`
                    : prevStyles.child1Width,
                height:
                  typeof prevStyles.child1Height === "number"
                    ? `${prevStyles.child1Height}%`
                    : prevStyles.child1Height,
              }}
            >
              <QRCode
                style={{ width: "100%", height: "auto" }}
                value={prevQrCodeOverlayInfo.url}
              />
            </div>
          )}
          {prevQrCodeOverlayInfo.description && (
            <p
              className="overlay-qr-code-info-description"
              style={{
                fontSize: `${getFontSize({ width, fontSize: prevStyles.fontSize })}`,
                color: prevStyles.fontColor,
                fontWeight: prevStyles.fontWeight,
                fontStyle: prevStyles.fontStyle,
                textAlign: prevStyles.textAlign,
              }}
            >
              {prevQrCodeOverlayInfo.description}
            </p>
          )}
        </div>
      </>
    );
  }
);

export default DisplayQRCodeOverlay;
