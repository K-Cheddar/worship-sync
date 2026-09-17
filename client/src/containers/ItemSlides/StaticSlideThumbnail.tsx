import { memo } from "react";
import type {
  FormattedTextDisplayInfo,
  ItemSlideType,
  TimerInfo,
} from "../../types";
import DisplayBox from "../../components/DisplayWindow/DisplayBox";
import DisplayStreamBible from "../../components/DisplayWindow/DisplayStreamBible";
import DisplayStreamFormattedText from "../../components/DisplayWindow/DisplayStreamFormattedText";
import DisplayStreamText from "../../components/DisplayWindow/DisplayStreamText";
import {
  REFERENCE_HEIGHT,
  REFERENCE_WIDTH,
} from "../../constants";
import { resolveDisplayRenderProfile } from "../../components/DisplayWindow/displayRenderProfile";

type StaticSlideThumbnailProps = {
  slide: ItemSlideType;
  itemType: string;
  isStreamFormat: boolean;
  timerInfo?: TimerInfo;
  bibleInfo?: { title: string; text: string };
  scaleFactor?: number;
};

const getFormattedTextDisplayInfo = (
  slide: ItemSlideType,
  itemType: string,
): FormattedTextDisplayInfo | undefined => {
  if (itemType !== "free") return undefined;

  const stored = slide.formattedTextDisplayInfo;
  return {
    text: stored?.text?.trim() || slide.boxes[1]?.words?.trim() || "",
    backgroundColor: stored?.backgroundColor || "#eb8934",
    textColor: stored?.textColor || "#ffffff",
    fontSize: stored?.fontSize || 1.5,
    paddingX: stored?.paddingX || 2,
    paddingY: stored?.paddingY || 1,
    isBold: stored?.isBold || false,
    isItalic: stored?.isItalic || false,
    align: stored?.align || "left",
  };
};

const StaticSlideThumbnail = ({
  slide,
  itemType,
  isStreamFormat,
  timerInfo,
  bibleInfo,
  scaleFactor = 0,
}: StaticSlideThumbnailProps) => {
  const displayType = isStreamFormat ? "stream" : "slide";
  const profile = resolveDisplayRenderProfile(displayType, slide.boxes);
  const formatted = getFormattedTextDisplayInfo(slide, itemType);
  return (
    <div
      className={`relative aspect-video w-full overflow-hidden overflow-anywhere border border-gray-500 text-white ${
        isStreamFormat ? "bg-transparent" : "bg-black"
      }`}
      style={{ fontFamily: "Inter, sans-serif" }}
      data-testid="static-slide-thumbnail"
    >
      <div
        data-testid="static-slide-reference-canvas"
        style={{
          width: `${REFERENCE_WIDTH}px`,
          height: `${REFERENCE_HEIGHT}px`,
          transform: `translate(-50%, -50%) scale(${scaleFactor})`,
          transformOrigin: "center center",
          position: "absolute",
          top: "50%",
          left: "50%",
          isolation: "isolate",
        }}
      >
        {!isStreamFormat ? (
          slide.boxes.map((box, index) => (
            <DisplayBox
              key={box.id || index}
              box={box}
              width={100}
              showBackground={profile.supportsBackground}
              index={index}
              timerInfo={timerInfo}
              shouldAnimate={false}
              brightness={
                index === 0 ? profile.backgroundBrightness : undefined
              }
              isSimpleFont={profile.isSimpleFont}
            />
          ))
        ) : itemType === "bible" ? (
          bibleInfo?.text ? (
            <DisplayStreamBible
              width={100}
              bibleDisplayInfo={bibleInfo}
              isStatic
            />
          ) : null
        ) : itemType === "free" ? (
          formatted?.text ? (
            <DisplayStreamFormattedText
              width={100}
              formattedTextDisplayInfo={formatted}
              isStatic
            />
          ) : null
        ) : (
          slide.boxes.map((box, index) => (
            <DisplayStreamText
              key={box.id || index}
              box={box}
              width={100}
              timerInfo={timerInfo}
              isStatic
            />
          ))
        )}
      </div>
    </div>
  );
};

export default memo(StaticSlideThumbnail);
