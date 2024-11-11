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

export const sizeMap: Map<
  number,
  { width: number; cols: string; hSize: string }
> = new Map([
  [5, { width: 9.75, cols: "grid-cols-5", hSize: "text-xs" }],
  [4, { width: 12.25, cols: "grid-cols-4", hSize: "text-sm" }],
  [3, { width: 16.5, cols: "grid-cols-3", hSize: "text-base" }],
]);

const ItemSlides = () => {
  const {
    arrangements,
    selectedArrangement,
    selectedSlide,
    type,
    name,
    slides: _slides,
  } = useSelector((state) => state.undoable.present.item);
  const arrangement = arrangements[selectedArrangement];
  const slides = _slides || arrangement?.slides || [];
  const size = useSelector((state) => state.preferences.slidesPerRow);
  const dispatch = useDispatch();

  const sensors = useSensors();

  const { setNodeRef } = useDroppable({
    id: "item-slides-list",
  });

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
    dispatch(addSlideAction(slide));
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
    dispatch(updateSlides(updatedSlides));
  };

  if (!arrangement && !slides.length && type !== "free") return null;

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex w-full px-2 bg-slate-900 h-6 my-2 gap-1">
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
              onClick={() => dispatch(removeSlide(selectedSlide))}
            />
          </>
        )}
      </div>
      <ul
        ref={setNodeRef}
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
