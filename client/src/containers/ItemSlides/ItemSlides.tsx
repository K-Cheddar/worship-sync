import { ReactComponent as AddSVG } from "../../assets/icons/add.svg";
import { ReactComponent as ZoomInSVG } from "../../assets/icons/zoom-in.svg";
import Button from "../../components/Button/Button";
import { ReactComponent as ZoomOutSVG } from "../../assets/icons/zoom-out.svg";
import { ReactComponent as DeleteSVG } from "../../assets/icons/delete.svg";
import DisplayWindow from "../../components/DisplayWindow/DisplayWindow";
import "./ItemSlides.scss";
import { removeSlide, setSelectedSlide } from "../../store/itemSlice";
import { increaseSlides, decreaseSlides } from "../../store/preferencesSlice";
import { useSelector } from "../../hooks";
import { useDispatch } from "../../hooks";
import { itemSectionBgColorMap } from "../../utils/slideColorMap";
import {
  updateBibleDisplayInfo,
  updatePresentation,
} from "../../store/presentationSlice";
import { createNewSlide } from "../../utils/slideCreation";
import { addSlide as addSlideAction } from "../../store/itemSlice";

const sizeMap: Map<number, { width: number; cols: string; hSize: string }> =
  new Map([
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

  const width = sizeMap.get(size)?.width || 12;

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

  if (!arrangement && !slides.length && type !== "free") return null;

  return (
    <>
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
        <Button
          variant="tertiary"
          className="ml-auto"
          svg={DeleteSVG}
          onClick={() => dispatch(removeSlide(selectedSlide))}
        />
      </div>
      <ul className={`item-slides-container ${sizeMap.get(size)?.cols}`}>
        {slides.map((slide, index) => {
          return (
            <li
              key={slide.id}
              className={`item-slide ${
                selectedSlide === index
                  ? "border-cyan-500"
                  : "border-transparent"
              }`}
              onClick={() => selectSlide(index)}
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
        })}
        {type === "free" && (
          <li className="flex flex-col px-2">
            <Button
              key="lyrics-box-add-section"
              onClick={() => addSlide()}
              variant="tertiary"
              svg={AddSVG}
              iconSize={64}
              className="w-full flex-1 justify-center border border-slate-500 rounded-md"
            />
          </li>
        )}
      </ul>
    </>
  );
};

export default ItemSlides;
