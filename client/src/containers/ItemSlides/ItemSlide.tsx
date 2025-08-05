import DisplayWindow from "../../components/DisplayWindow/DisplayWindow";
import "./ItemSlides.scss";

import { itemSectionBgColorMap } from "../../utils/slideColorMap";
import { ItemSlide as ItemSlideType, TimerInfo } from "../../types";
import { sizeMap } from "./ItemSlides";
import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import cn from "classnames";

type ItemSlideProps = {
  slide: ItemSlideType;
  index: number;
  selectSlide: (index: number) => void;
  selectedSlide: number;
  size: number;
  itemType: string;
  isMobile: boolean;
  timerInfo?: TimerInfo;
  draggedSection: string | null;
  isTransmitting: boolean;
  isStreamFormat: boolean;
  getBibleInfo: (index: number) => { title: string; text: string };
};

const ItemSlide = ({
  isTransmitting,
  slide,
  index,
  selectSlide,
  selectedSlide,
  size,
  itemType,
  isMobile,
  timerInfo,
  draggedSection,
  isStreamFormat,
  getBibleInfo,
}: ItemSlideProps) => {
  const width =
    (isMobile ? sizeMap.get(size)?.mobileWidth : sizeMap.get(size)?.width) ||
    12;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: slide.id || "",
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isFree = itemType === "free";

  // Check if this slide is in the same section as the dragged slide
  const sectionMatch = slide.name?.match(/Section (\d+)/);
  const isInDraggedSection = sectionMatch && sectionMatch[1] === draggedSection;

  // Apply transform to all slides in the same section while preserving the dragged slide's animation
  const sectionStyle =
    isInDraggedSection && !isDragging
      ? {
          transform: CSS.Transform.toString(transform),
          transition,
          opacity: 0.5,
        }
      : undefined;

  return (
    <li
      ref={setNodeRef}
      style={(() => {
        const borderStyle = {
          "--border-width": sizeMap.get(size)?.borderWidth,
        } as React.CSSProperties;
        if (!isFree) {
          return borderStyle;
        }
        if (isDragging) {
          return { ...style, ...borderStyle };
        }
        if (isInDraggedSection) {
          return sectionStyle;
        }
        return borderStyle;
      })()}
      {...(isFree && attributes)}
      {...(isFree && listeners)}
      key={slide.id}
      className={cn(
        "item-slide",
        selectedSlide === index && !isTransmitting && "border-gray-300",
        selectedSlide === index && isTransmitting && "border-green-500",
        selectedSlide !== index && "border-transparent",
        isInDraggedSection && "z-10"
      )}
      onClick={() => selectSlide(index)}
      id={`item-slide-${index}`}
    >
      <h4
        className={cn(
          "rounded-t-md truncate px-2 text-center flex",
          sizeMap.get(size)?.hSize,
          itemSectionBgColorMap.get(slide.type)
        )}
        style={{ width: `${width}vw` }}
      >
        {slide.name?.split(/\u200B(.*?)\u200B/).map((part, index) => {
          // Even indices are regular text, odd indices are special parts
          if (index % 2 === 1) {
            return (
              <span key={index} className="text-gray-400">
                {part}
              </span>
            );
          }
          if (part.trim()) {
            return (
              <span className="flex-1" key={index}>
                {part}
              </span>
            );
          }
          return null;
        })}
      </h4>
      <DisplayWindow
        showBorder
        boxes={
          isStreamFormat && (itemType === "free" || itemType === "bible")
            ? []
            : slide.boxes
        }
        width={width}
        displayType={isStreamFormat ? "stream" : "slide"}
        timerInfo={timerInfo}
        bibleDisplayInfo={
          itemType === "bible" ? getBibleInfo(index) : undefined
        }
        formattedTextDisplayInfo={
          itemType === "free"
            ? {
                text: slide.boxes[1]?.words?.trim() || "",
                backgroundColor:
                  slide.formattedTextDisplayInfo?.backgroundColor || "#eb8934",
                textColor:
                  slide.formattedTextDisplayInfo?.textColor || "#ffffff",
                fontSize: slide.formattedTextDisplayInfo?.fontSize || 1.5,
                paddingX: slide.formattedTextDisplayInfo?.paddingX || 2,
                paddingY: slide.formattedTextDisplayInfo?.paddingY || 1,
                isBold: slide.formattedTextDisplayInfo?.isBold || false,
                isItalic: slide.formattedTextDisplayInfo?.isItalic || false,
                align: slide.formattedTextDisplayInfo?.align || "left",
              }
            : undefined
        }
      />
    </li>
  );
};

export default ItemSlide;
