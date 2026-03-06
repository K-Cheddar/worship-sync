import { forwardRef, useRef } from "react";
import { BibleDisplayInfo } from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import VerseDisplay from "./VerseDisplay";

type DisplayStreamBibleProps = {
  width: number;
  bibleDisplayInfo?: BibleDisplayInfo;
  prevBibleDisplayInfo?: BibleDisplayInfo;
  shouldAnimate?: boolean;
};

const DURATION = 0.35;

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
    const bibleTimeline = useRef<GSAPTimeline | null>(null);
    const prevBibleTimeline = useRef<GSAPTimeline | null>(null);

    useGSAP(
      () => {
        if (!bibleRef.current || !shouldAnimate) return;

        bibleTimeline.current?.clear();
        const el = bibleRef.current;
        gsap.set(el, { opacity: 0 });
        bibleTimeline.current = gsap.timeline().fromTo(
          el,
          { opacity: 0 },
          { opacity: 1, duration: DURATION, ease: "power1.inOut" }
        );
      },
      { scope: bibleRef, dependencies: [bibleDisplayInfo, shouldAnimate] }
    );

    useGSAP(
      () => {
        if (!prevBibleRef.current || !shouldAnimate) return;

        prevBibleTimeline.current?.clear();
        prevBibleTimeline.current = gsap.timeline().fromTo(
          prevBibleRef.current,
          { opacity: 1 },
          { opacity: 0, duration: DURATION, ease: "power1.inOut" }
        );
      },
      { scope: prevBibleRef, dependencies: [prevBibleDisplayInfo, shouldAnimate] }
    );

    const renderContent = (text: string) => {
      if (text.includes("\u200B")) {
        return <VerseDisplay words={text} className="text-yellow-400" />;
      }

      return text;
    };

    return (
      <>
        <div
          ref={bibleRef}
          className="w-[70%] absolute flex flex-col mx-[15%] bottom-[5%]"
        >
          {bibleDisplayInfo?.title?.trim() && (
            <p
              className="bible-info-title bg-green-700 w-fit"
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
              className="bible-info-text bg-gray-800/95"
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

        <div
          ref={prevBibleRef}
          className="w-[70%] absolute flex flex-col mx-[15%] bottom-[5%]"
        >
          {prevBibleDisplayInfo?.title?.trim() && (
            <p
              className="prev-bible-info-title bg-green-700 w-fit"
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
              className="prev-bible-info-text bg-gray-800/95"
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
