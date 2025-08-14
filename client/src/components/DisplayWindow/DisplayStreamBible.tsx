import { forwardRef, MutableRefObject, useRef } from "react";
import { BibleDisplayInfo } from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import "./DisplayWindow.scss";
import VerseDisplay from "./VerseDisplay";

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

    const renderContent = (text: string) => {
      if (text.includes("\u200B")) {
        return <VerseDisplay words={text} className="text-yellow-400" />;
      }

      return text;
    };

    return (
      <>
        <div ref={bibleRef} className="bible-info-container">
          {bibleDisplayInfo?.title?.trim() && (
            <p
              className="bible-info-title"
              style={{
                borderTopLeftRadius: "5% 20%",
                borderTopRightRadius: "5% 20%",
                padding: "0.5% 4% 0.5%",
                fontSize: `${width / 58}vw`,
              }}
            >
              {bibleDisplayInfo.title}
            </p>
          )}
          {bibleDisplayInfo?.text?.trim() && (
            <p
              className="bible-info-text"
              style={{
                padding: "1.5% 2.5%",
                borderTopRightRadius: "2.5% 20%",
                borderBottomRightRadius: "2.5% 20%",
                borderBottomLeftRadius: "2.5% 20%",
                fontSize: `${width / 55}vw`,
              }}
            >
              {renderContent(bibleDisplayInfo.text)}
            </p>
          )}
        </div>

        <div ref={prevBibleRef} className="prev-bible-info-container">
          {prevBibleDisplayInfo?.title?.trim() && (
            <p
              className="prev-bible-info-title"
              style={{
                borderTopLeftRadius: "5% 20%",
                borderTopRightRadius: "5% 20%",
                padding: "0.5% 4% 0.5%",
                fontSize: `${width / 58}vw`,
              }}
            >
              {prevBibleDisplayInfo.title}
            </p>
          )}
          {prevBibleDisplayInfo?.text?.trim() && (
            <p
              className="prev-bible-info-text"
              style={{
                padding: "1.5% 2.5%",
                borderTopRightRadius: "2.5% 20%",
                borderBottomRightRadius: "2.5% 20%",
                borderBottomLeftRadius: "2.5% 20%",
                fontSize: `${width / 55}vw`,
              }}
            >
              {renderContent(prevBibleDisplayInfo.text)}
            </p>
          )}
        </div>
      </>
    );
  }
);

export default DisplayStreamBible;
