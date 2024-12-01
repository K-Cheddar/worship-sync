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
  isStream: boolean;
};

const DisplayStreamBible = forwardRef<
  HTMLUListElement,
  DisplayStreamBibleProps
>(
  (
    {
      width,
      shouldAnimate = false,
      bibleDisplayInfo,
      prevBibleDisplayInfo,
      isStream,
    }: DisplayStreamBibleProps,
    containerRef
  ) => {
    const bibleRef = useRef<HTMLLIElement | null>(null);
    const prevBibleRef = useRef<HTMLLIElement | null>(null);
    const bibleTimeline = useRef<GSAPTimeline | null>();
    const prevBibleTimeline = useRef<GSAPTimeline | null>();

    useGSAP(
      () => {
        if (
          !bibleRef.current ||
          !(containerRef as MutableRefObject<HTMLUListElement>)?.current ||
          !shouldAnimate ||
          !isStream
        )
          return;

        bibleTimeline.current?.clear();

        const innerElements = [".bible-info-title", ".bible-info-text"];
        const targets = [bibleRef.current, ...innerElements];

        if (prevBibleDisplayInfo?.title?.trim()) {
          bibleTimeline.current = gsap
            .timeline()
            .set(targets, {
              opacity: 0,
              yPercent: 0,
            })
            .to(targets, { opacity: 1, duration: 0.35, ease: "power1.inOut" });
        } else {
          bibleTimeline.current = gsap
            .timeline()
            .set(targets, { yPercent: 100 });

          // Only play animate if there is bible info
          if (
            bibleDisplayInfo?.title?.trim() ||
            bibleDisplayInfo?.text?.trim()
          ) {
            bibleTimeline.current.to(targets, {
              yPercent: 0,
              duration: 1,
              ease: "power1.inOut",
            });
          }
        }
      },
      { scope: bibleRef, dependencies: [bibleDisplayInfo] }
    );

    useGSAP(
      () => {
        if (!prevBibleRef.current || !shouldAnimate || !isStream) return;

        prevBibleTimeline.current?.clear();

        const innerElements = [
          ".prev-bible-info-title",
          ".prev-bible-info-text",
        ];
        const targets = [prevBibleRef.current, ...innerElements];

        if (bibleDisplayInfo?.title) {
          prevBibleTimeline.current = gsap
            .timeline()
            .set(targets, {
              opacity: 1,
              yPercent: 0,
            })
            .to(targets, { opacity: 0, duration: 0.35, ease: "power1.inOut" });
        } else {
          prevBibleTimeline.current = gsap
            .timeline()
            .set(targets, { yPercent: 0, opacity: 1 })
            .to(targets, {
              yPercent: 100,
              duration: 1,
              ease: "power1.inOut",
            });
        }
      },
      { scope: prevBibleRef, dependencies: [prevBibleDisplayInfo] }
    );

    return isStream ? (
      <>
        <li
          ref={bibleRef}
          className="bible-info-container"
          style={
            {
              "--bible-info-border-width": `${width / 71.4}vw`,
              "--bible-info-title-size": `${width / 42.3}vw`,
              "--bible-info-text-size": `${width / 38.2}vw`,
            } as CSSProperties
          }
        >
          {bibleDisplayInfo?.title?.trim() && (
            <p className="bible-info-title">{bibleDisplayInfo.title}</p>
          )}
          {bibleDisplayInfo?.text?.trim() && (
            <p className="bible-info-text">{bibleDisplayInfo.text}</p>
          )}
        </li>

        <li
          ref={prevBibleRef}
          className="prev-bible-info-container"
          style={
            {
              "--bible-info-border-width": `${width / 71.4}vw`,
              "--bible-info-title-size": `${width / 42.3}vw`,
              "--bible-info-text-size": `${width / 38.2}vw`,
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
        </li>
      </>
    ) : null;
  }
);

export default DisplayStreamBible;
