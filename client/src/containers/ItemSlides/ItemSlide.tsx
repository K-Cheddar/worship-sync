import DisplayWindow from "../../components/DisplayWindow/DisplayWindow";
import "./ItemSlides.scss";

import { itemSectionBgColorMap } from "../../utils/slideColorMap";
import { ItemSlide as ItemSlideType, TimerInfo } from "../../types";
import { sizeMap } from "./ItemSlides";
import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";

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
};

const ItemSlide = ({
  slide,
  index,
  selectSlide,
  selectedSlide,
  size,
  itemType,
  isMobile,
  timerInfo,
  draggedSection,
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
  const sectionMatch = slide.name.match(/Section (\d+)/);
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
      style={
        isFree
          ? isDragging
            ? style
            : isInDraggedSection
            ? sectionStyle
            : undefined
          : undefined
      }
      {...(isFree && attributes)}
      {...(isFree && listeners)}
      key={slide.id}
      className={`item-slide ${
        selectedSlide === index ? "border-cyan-500" : "border-transparent"
      } ${isInDraggedSection ? "z-10" : ""}`}
      onClick={() => selectSlide(index)}
      id={`item-slide-${index}`}
    >
      <h4
        className={`${
          sizeMap.get(size)?.hSize
        } rounded-t-md truncate px-2 text-center ${itemSectionBgColorMap.get(
          slide.type.split(" ")[0] || slide.name.split(" ")[0]
        )}`}
        style={{ width: `${width}vw` }}
      >
        {slide.name || slide.type}
      </h4>
      <DisplayWindow
        showBorder
        boxes={slide.boxes}
        width={width}
        displayType="slide"
        timerInfo={timerInfo}
      />
    </li>
  );
};

export default ItemSlide;
