import DisplayWindow from "../../components/DisplayWindow/DisplayWindow";
import "./ItemSlides.scss";

import { itemSectionBgColorMap } from "../../utils/slideColorMap";
import { ItemSlide as ItemSlideType } from "../../types";
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
};

const ItemSlide = ({
  slide,
  index,
  selectSlide,
  selectedSlide,
  size,
  itemType,
  isMobile,
}: ItemSlideProps) => {
  const width =
    (isMobile ? sizeMap.get(size)?.mobileWidth : sizeMap.get(size)?.width) ||
    12;

  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({
      id: slide.id || "",
    });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isFree = itemType === "free";

  return (
    <li
      ref={setNodeRef}
      style={isFree ? style : undefined}
      {...(isFree && attributes)}
      {...(isFree && listeners)}
      key={slide.id}
      className={`item-slide ${
        selectedSlide === index ? "border-cyan-500" : "border-transparent"
      }`}
      onClick={() => selectSlide(index)}
      id={`item-slide-${index}`}
    >
      <h4
        className={`${
          sizeMap.get(size)?.hSize
        } rounded-t-md truncate px-2 text-center ${itemSectionBgColorMap.get(
          slide.type.split(" ")[0]
        )}`}
        style={{ width: `${width}vw` }}
      >
        {slide.type}
      </h4>
      <DisplayWindow
        showBorder
        boxes={slide.boxes}
        width={width}
        displayType="slide"
      />
    </li>
  );
};

export default ItemSlide;
