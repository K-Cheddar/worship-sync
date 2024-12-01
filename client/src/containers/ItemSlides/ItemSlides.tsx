import { ReactComponent as AddSVG } from "../../assets/icons/add.svg";
import { ReactComponent as ZoomInSVG } from "../../assets/icons/zoom-in.svg";
import Button from "../../components/Button/Button";
import { ReactComponent as ZoomOutSVG } from "../../assets/icons/zoom-out.svg";
import { ReactComponent as DeleteSVG } from "../../assets/icons/delete.svg";
import "./ItemSlides.scss";
import {
  removeSlide,
  setSelectedSlide,
  updateSlides,
} from "../../store/itemSlice";
import { increaseSlides, decreaseSlides } from "../../store/preferencesSlice";
import { useSelector } from "../../hooks";
import { useDispatch } from "../../hooks";
import {
  updateBibleDisplayInfo,
  updatePresentation,
} from "../../store/presentationSlice";
import { createNewSlide } from "../../utils/slideCreation";
import { addSlide as addSlideAction } from "../../store/itemSlice";
import ItemSlide from "./ItemSlide";
import { DndContext, useDroppable, DragEndEvent } from "@dnd-kit/core";

import { useSensors } from "../../utils/dndUtils";

import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { useEffect } from "react";

export const sizeMap: Map<
  number,
  { width: number; cols: string; hSize: string }
> = new Map([
  [7, { width: 7, cols: "grid-cols-7", hSize: "text-xs" }],
  [6, { width: 8.25, cols: "grid-cols-6", hSize: "text-xs" }],
  [5, { width: 10, cols: "grid-cols-5", hSize: "text-xs" }],
  [4, { width: 12.5, cols: "grid-cols-4", hSize: "text-sm" }],
  [3, { width: 16.75, cols: "grid-cols-3", hSize: "text-base" }],
  [2, { width: 25, cols: "grid-cols-2", hSize: "text-base" }],
  [1, { width: 52, cols: "grid-cols-1", hSize: "text-base" }],
]);

const ItemSlides = () => {
  const {
    arrangements,
    selectedArrangement,
    selectedSlide,
    type,
    name,
    slides: __slides,
    isLoading,
  } = useSelector((state) => state.undoable.present.item);
  const arrangement = arrangements[selectedArrangement];
  const _slides = arrangement?.slides || __slides || [];
  const slides = isLoading ? [] : _slides;
  const size = useSelector((state) => state.preferences.slidesPerRow);
  const dispatch = useDispatch();

  const sensors = useSensors();

  const { setNodeRef } = useDroppable({
    id: "item-slides-list",
  });

  useEffect(() => {
    const slideElement = document.getElementById(`item-slide-${selectedSlide}`);
    const parentElement = document.getElementById("item-slides-container");
    if (slideElement && parentElement) {
      // TODO check if slide is visible before scrolling
      // const { top, left, bottom, right } = slideElement.getBoundingClientRect();
      // if (
      //   top < window.innerHeight &&
      //   left < window.innerWidth &&
      //   bottom > 0 &&
      //   right > 0
      // ) {
      //   return;
      // }
      slideElement.focus();
      slideElement.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [selectedSlide]);

  const selectSlide = (index: number) => {
    dispatch(setSelectedSlide(index));
    if (type === "bible") {
      const title =
        index > 0
          ? slides[index].boxes[2]?.words || ""
          : slides[index].boxes[1]?.words || "";
      const text = index > 0 ? slides[index].boxes[1]?.words || "" : "";
      dispatch(
        updateBibleDisplayInfo({
          title,
          text,
        })
      );
    } else {
      dispatch(updateBibleDisplayInfo({ title: "", text: "" }));
    }
    dispatch(
      updatePresentation({
        slide: slides[index],
        type,
        name,
      })
    );
  };

  const addSlide = () => {
    const slide = createNewSlide({
      type: "Section",
      fontSize: 2.5,
      words: [""],
    });
    dispatch(addSlideAction({ slide }));
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { over, active } = event;
    if (!over || !active) return;

    const { id: overId } = over;
    const { id: activeId } = active;
    const updatedSlides = [...slides];
    const newIndex = updatedSlides.findIndex((slide) => slide.id === overId);
    const oldIndex = updatedSlides.findIndex((slide) => slide.id === activeId);
    const element = slides[oldIndex];
    updatedSlides.splice(oldIndex, 1);
    updatedSlides.splice(newIndex, 0, element);
    dispatch(updateSlides({ slides: updatedSlides }));
  };

  const advanceSlide = () => {
    const nextSlide = Math.min(selectedSlide + 1, slides.length - 1);
    selectSlide(nextSlide);
  };

  const previousSlide = () => {
    const nextSlide = Math.max(selectedSlide - 1, 0);
    selectSlide(nextSlide);
  };

  if (!arrangement && !slides.length && type !== "free") return null;

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex w-full px-2 bg-slate-900 h-6 mb-2 gap-1">
        <Button
          variant="tertiary"
          svg={ZoomOutSVG}
          onClick={() => dispatch(increaseSlides())}
        />
        <Button
          variant="tertiary"
          svg={ZoomInSVG}
          onClick={() => dispatch(decreaseSlides())}
        />
        {type === "free" && (
          <>
            <Button
              variant="tertiary"
              className="ml-auto"
              svg={AddSVG}
              onClick={() => addSlide()}
            />
            <Button
              variant="tertiary"
              svg={DeleteSVG}
              onClick={() => {
                dispatch(removeSlide({ index: selectedSlide }));
              }}
            />
          </>
        )}
      </div>
      <ul
        ref={setNodeRef}
        tabIndex={0}
        id="item-slides-container"
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "ArrowRight") {
            e.preventDefault();
            advanceSlide();
          }
          if ((e.key === " " && e.shiftKey) || e.key === "ArrowLeft") {
            e.preventDefault();
            previousSlide();
          }
        }}
        className={`item-slides-container ${sizeMap.get(size)?.cols}`}
      >
        <SortableContext
          items={slides.map((slide) => slide.id || "")}
          strategy={rectSortingStrategy}
        >
          {slides.map((slide, index) => (
            <ItemSlide
              key={slide.id}
              slide={slide}
              index={index}
              selectSlide={selectSlide}
              selectedSlide={selectedSlide}
              size={size}
              itemType={type}
            />
          ))}
        </SortableContext>
      </ul>
    </DndContext>
  );
};

export default ItemSlides;
