import { CSSProperties, forwardRef, MutableRefObject, useRef } from "react";
import { BibleDisplayInfo } from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import "./DisplayWindow.scss";

type DisplayStreamBibleProps = {
  width: number;
  bibleDisplayInfo?: BibleDisplayInfo;
  prevBibleDisplayInfo?: BibleDisplayInfo;
  shouldAnimate?: boolean;
};

const DisplayStreamBible = forwardRef<HTMLDivElement, DisplayStreamBibleProps>(
  (
    {
      width,
      shouldAnimate = false,
      bibleDisplayInfo,
      prevBibleDisplayInfo,
    }: DisplayStreamBibleProps,
    containerRef
  ) => {
    const bibleRef = useRef<HTMLDivElement | null>(null);
    const prevBibleRef = useRef<HTMLDivElement | null>(null);
    const bibleTimeline = useRef<GSAPTimeline | null>();
    const prevBibleTimeline = useRef<GSAPTimeline | null>();

    useGSAP(
      () => {
        if (
          !bibleRef.current ||
          !(containerRef as MutableRefObject<HTMLDivElement>)?.current ||
          !shouldAnimate
        )
          return;

        bibleTimeline.current?.clear();

        const innerElements = [".bible-info-title", ".bible-info-text"];
        const targets = [bibleRef.current, ...innerElements];

        if (prevBibleDisplayInfo?.title?.trim()) {
          bibleTimeline.current = gsap.timeline().fromTo(
            targets,
            {
              opacity: 0,
              yPercent: 0,
            },
            { opacity: 1, duration: 0.35, ease: "power1.inOut" }
          );
        } else {
          bibleTimeline.current = gsap.timeline();

          // Only animate if there is bible info
          if (
            bibleDisplayInfo?.title?.trim() ||
            bibleDisplayInfo?.text?.trim()
          ) {
            bibleTimeline.current.fromTo(
              targets,
              { yPercent: 120, opacity: 0 },
              {
                yPercent: 0,
                opacity: 1,
                duration: 1.5,
                ease: "power1.inOut",
              }
            );
          }
        }
      },
      { scope: bibleRef, dependencies: [bibleDisplayInfo] }
    );

    useGSAP(
      () => {
        if (!prevBibleRef.current || !shouldAnimate) return;

        prevBibleTimeline.current?.clear();

        const innerElements = [
          ".prev-bible-info-title",
          ".prev-bible-info-text",
        ];
        const targets = [prevBibleRef.current, ...innerElements];

        if (bibleDisplayInfo?.title) {
          prevBibleTimeline.current = gsap.timeline().fromTo(
            targets,
            {
              opacity: 1,
              yPercent: 0,
            },
            { opacity: 0, duration: 0.35, ease: "power1.inOut" }
          );
        } else {
          prevBibleTimeline.current = gsap.timeline().fromTo(
            targets,
            { yPercent: 0, opacity: 1 },
            {
              yPercent: 120,
              opacity: 0,
              duration: 1.5,
              ease: "power1.inOut",
            }
          );
        }
      },
      { scope: prevBibleRef, dependencies: [prevBibleDisplayInfo] }
    );

    return (
      <>
        <div
          ref={bibleRef}
          className="bible-info-container"
          style={
            {
              "--bible-info-title-size": `${width / 58}vw`,
              "--bible-info-text-size": `${width / 55}vw`,
            } as CSSProperties
          }
        >
          {bibleDisplayInfo?.title?.trim() && (
            <p className="bible-info-title">{bibleDisplayInfo.title}</p>
          )}
          {bibleDisplayInfo?.text?.trim() && (
            <p className="bible-info-text">{bibleDisplayInfo.text}</p>
          )}
        </div>

        <div
          ref={prevBibleRef}
          className="prev-bible-info-container"
          style={
            {
              "--bible-info-title-size": `${width / 58}vw`,
              "--bible-info-text-size": `${width / 55}vw`,
            } as CSSProperties
          }
        >
          {prevBibleDisplayInfo?.title?.trim() && (
            <p className="prev-bible-info-title">
              {prevBibleDisplayInfo.title}
            </p>
          )}
          {prevBibleDisplayInfo?.text?.trim() && (
            <p className="prev-bible-info-text">{prevBibleDisplayInfo.text}</p>
          )}
        </div>
      </>
    );
  }
);

export default DisplayStreamBible;
