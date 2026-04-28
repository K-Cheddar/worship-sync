import { useRef } from "react";
import { BoardPostStreamInfo } from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

const DEFAULT_BG_COLOR = "#32353beb";
const DEFAULT_FONT_SIZE = 1.5;
const FADE_DURATION = 0.5;

type DisplayBoardPostOverlayProps = {
  width: number;
  boardPostStreamInfo?: BoardPostStreamInfo;
  prevBoardPostStreamInfo?: BoardPostStreamInfo;
  shouldAnimate?: boolean;
};

const DisplayBoardPostOverlay = ({
  width,
  boardPostStreamInfo,
  prevBoardPostStreamInfo,
  shouldAnimate = false,
}: DisplayBoardPostOverlayProps) => {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const prevCardRef = useRef<HTMLDivElement | null>(null);
  const cardTimeline = useRef<GSAPTimeline | null>(null);
  const prevCardTimeline = useRef<GSAPTimeline | null>(null);

  const currentText = boardPostStreamInfo?.text?.trim() || "";
  const prevText = prevBoardPostStreamInfo?.text?.trim() || "";

  useGSAP(
    () => {
      if (!cardRef.current || !shouldAnimate || !currentText) return;

      cardTimeline.current?.clear();
      const el = cardRef.current;
      gsap.set(el, { opacity: 0 });
      cardTimeline.current = gsap
        .timeline()
        .fromTo(
          el,
          { opacity: 0 },
          { opacity: 1, duration: FADE_DURATION, ease: "power1.inOut" },
        )
        .to(el, {
          opacity: 0,
          duration: FADE_DURATION,
          delay: boardPostStreamInfo?.duration ?? 0,
          ease: "power1.inOut",
        });
    },
    { scope: cardRef, dependencies: [boardPostStreamInfo, shouldAnimate] },
  );

  useGSAP(
    () => {
      if (!prevCardRef.current || !shouldAnimate || !prevText) return;

      prevCardTimeline.current?.clear();

      if (prevBoardPostStreamInfo?.text?.trim()) {
        prevCardTimeline.current = gsap.timeline().fromTo(
          prevCardRef.current,
          { opacity: 1 },
          { opacity: 0, duration: FADE_DURATION, ease: "power1.inOut" },
        );
      }
    },
    {
      scope: prevCardRef,
      dependencies: [prevBoardPostStreamInfo, shouldAnimate],
    },
  );

  const renderCard = (
    info: BoardPostStreamInfo | undefined,
    ref: React.RefObject<HTMLDivElement | null>,
    text: string,
  ) => {
    if (!text) return null;

    const fontSize = info?.fontSize ?? DEFAULT_FONT_SIZE;
    const bgColor = info?.backgroundColor ?? DEFAULT_BG_COLOR;
    const fontSizeVw = `${fontSize * (width / 100)}vw`;
    const authorFontSizeVw = `${fontSize * 0.75 * (width / 100)}vw`;

    return (
      <div className="absolute bottom-[5%] left-0 flex w-full justify-center px-[2%]">
        <div
          ref={ref}
          className="max-w-[75%] w-fit rounded-[2%/8%] px-[1.5%] py-[1.5%]"
          style={{ backgroundColor: bgColor }}
        >
          <p
            className="mb-[0.5em] font-semibold leading-tight"
            style={{
              fontSize: authorFontSizeVw,
              color: info?.authorHexColor ?? "#e7e5e4",
            }}
          >
            {info?.author}
          </p>
          <p
            className="whitespace-normal font-medium leading-tight text-white"
            style={{ fontSize: fontSizeVw }}
          >
            {text}
          </p>
        </div>
      </div>
    );
  };

  return (
    <>
      {renderCard(boardPostStreamInfo, cardRef, currentText)}
      {renderCard(prevBoardPostStreamInfo, prevCardRef, prevText)}
    </>
  );
};

export default DisplayBoardPostOverlay;
