import { memo } from "react";
import type { FormattedSection, ItemSlideType, TimerInfo } from "../../types";
import { itemSectionBgColorMap } from "../../utils/slideColorMap";
import { getFreeSectionDisplayName, getFreeSectionNumber } from "../../utils/freeSectionNames";
import { cn } from "../../utils/cnHelper";
import LocalVideoInputSlideBadge from "../../components/LocalVideoInputSlideBadge/LocalVideoInputSlideBadge";
import StaticSlideThumbnail from "./StaticSlideThumbnail";

type ContinuousStaticItemSlideProps = {
  slide: ItemSlideType;
  index: number;
  itemType: string;
  isStreamFormat: boolean;
  timerInfo?: TimerInfo;
  formattedSections?: FormattedSection[];
  isLive: boolean;
  onSlideGridClick: (event: React.MouseEvent, index: number) => void;
  slideDomId: string;
  bibleInfo?: { title: string; text: string };
  hSize?: string;
  borderWidth?: string;
  thumbnailScaleFactor?: number;
};

const ContinuousStaticItemSlide = ({
  slide,
  index,
  itemType,
  isStreamFormat,
  timerInfo,
  formattedSections = [],
  isLive,
  onSlideGridClick,
  slideDomId,
  bibleInfo,
  hSize = "text-xs",
  borderWidth = "1px",
  thumbnailScaleFactor = 0,
}: ContinuousStaticItemSlideProps) => {
  const freeSectionNumber =
    itemType === "free" ? getFreeSectionNumber(slide) : null;
  const displayName =
    itemType === "free"
      ? getFreeSectionDisplayName(slide, formattedSections)
      : slide.name;
  return (
    <li
      id={slideDomId}
      role="button"
      tabIndex={0}
      aria-label={displayName || `Slide ${index + 1}`}
      className={cn(
        "relative w-full cursor-pointer select-none rounded-lg border border-transparent transition-[background-color,box-shadow] duration-150 ease-out hover:bg-white/12 hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.28)]",
      )}
      style={{ borderWidth }}
      onClick={(event) => onSlideGridClick(event, index)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSlideGridClick(event as unknown as React.MouseEvent, index);
        }
      }}
    >
      <h4
        className={cn(
          "rounded-t-md px-2 text-center flex w-full items-center gap-1",
          hSize,
          itemSectionBgColorMap.get(slide.type),
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          {(displayName || (freeSectionNumber == null ? "" : `Section ${freeSectionNumber}`))
            ?.split(/\u200B(.*?)\u200B/)
            .map((part, partIndex) => {
              if (partIndex % 2 === 1) {
                return (
                  <span key={partIndex} className="text-gray-400">
                    {part}
                  </span>
                );
              }
              if (part.trim()) {
                return (
                  <span className="flex-1" key={partIndex}>
                    {part}
                  </span>
                );
              }
              return null;
            })}
        </span>
        {isLive ? (
          <span className="pointer-events-none rounded bg-green-500 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow">
            Live
          </span>
        ) : null}
      </h4>
      <StaticSlideThumbnail
        slide={slide}
        itemType={itemType}
        isStreamFormat={isStreamFormat}
        timerInfo={timerInfo}
        scaleFactor={thumbnailScaleFactor}
        bibleInfo={bibleInfo}
      />
      {slide.mediaSource?.kind === "local-video-input" ? (
        <LocalVideoInputSlideBadge
          label={slide.mediaSource.label}
          captureKind={slide.mediaSource.captureKind}
        />
      ) : null}
    </li>
  );
};

export default memo(ContinuousStaticItemSlide);
