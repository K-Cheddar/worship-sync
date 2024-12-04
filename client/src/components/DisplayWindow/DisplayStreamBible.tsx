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
          !shouldAnimate
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
            .set(targets, { yPercent: 120 });

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
        if (!prevBibleRef.current || !shouldAnimate) return;

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
              yPercent: 120,
              duration: 1,
              ease: "power1.inOut",
            });
        }
      },
      { scope: prevBibleRef, dependencies: [prevBibleDisplayInfo] }
    );

    return (
      <>
        <li
          ref={bibleRef}
          className="bible-info-container"
          style={
            {
              "--bible-info-title-size": `${width / 58}vw`,
              "--bible-info-text-size": `${width / 55}vw`,
              "--bible-info-text-shadow-size-p": `${width / 66}px`,
              "--bible-info-text-shadow-size-n": `-${width / 66}px`,
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
              "--bible-info-title-size": `${width / 58}vw`,
              "--bible-info-text-size": `${width / 55}vw`,
              "--bible-info-text-shadow-size-p": `${width / 66}px`,
              "--bible-info-text-shadow-size-n": `-${width / 66}px`,
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
    );
  }
);

export default DisplayStreamBible;
