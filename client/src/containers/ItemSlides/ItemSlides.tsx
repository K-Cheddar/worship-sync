import { Plus, ZoomIn, ZoomOut, Trash2, Copy } from "lucide-react";
import Button from "../../components/Button/Button";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import {
  removeSlide,
  setSelectedSlide,
  updateSlides,
} from "../../store/itemSlice";
import {
  increaseSlides,
  decreaseSlides,
  setSlides,
  increaseSlidesMobile,
  decreaseSlidesMobile,
  setSlidesMobile,
  setMonitorTimerId,
} from "../../store/preferencesSlice";
import { useSelector } from "../../hooks";
import { useDispatch } from "../../hooks";
import {
  updateBibleDisplayInfo,
  updateFormattedTextDisplayInfo,
  updateMonitor,
  updateProjector,
  updateStream,
} from "../../store/presentationSlice";
import { createNewSlide } from "../../utils/slideCreation";
import { addSlide as addSlideAction } from "../../store/itemSlice";
import ItemSlide from "./ItemSlide";
import {
  DndContext,
  useDroppable,
  DragEndEvent,
  DragStartEvent,
} from "@dnd-kit/core";

import { useSensors } from "../../utils/dndUtils";

import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { keepElementInView } from "../../utils/generalUtils";
import { RootState } from "../../store/store";
import generateRandomId from "../../utils/generateRandomId";
import { useLocation } from "react-router-dom";
import { GlobalInfoContext } from "../../context/globalInfo";
import { cn } from "../../utils/cnHelper";
import { updateTimer } from "../../store/timersSlice";

export type SizeMap = Map<
  number,
  {
    width: number;
    mobileWidth: number;
    borderWidth: string;
    hSize: string;
    cols: string;
  }
>;

const ItemSlides = () => {
  const {
    arrangements,
    selectedArrangement,
    selectedSlide,
    type,
    name,
    slides: __slides,
    isLoading,
    _id,
    shouldSendTo,
    isEditMode,
  } = useSelector((state: RootState) => state.undoable.present.item);

  const {
    isMonitorTransmitting,
    isProjectorTransmitting,
    isStreamTransmitting,
  } = useSelector((state) => state.presentation);

  const isTransmitting =
    (shouldSendTo.monitor && isMonitorTransmitting) ||
    (shouldSendTo.projector && isProjectorTransmitting) ||
    (shouldSendTo.stream && isStreamTransmitting);

  const timers = useSelector((state: RootState) => state.timers.timers);
  const timerInfo = timers.find((timer) => timer.id === _id);

  const arrangement = arrangements[selectedArrangement];

  const slides = useMemo(() => {
    const _slides = arrangement?.slides || __slides || [];
    return isLoading ? [] : _slides;
  }, [isLoading, __slides, arrangement?.slides]);

  const { slidesPerRow, slidesPerRowMobile, shouldShowStreamFormat } =
    useSelector((state: RootState) => state.undoable.present.preferences);

  const { isMobile } = useContext(ControllerInfoContext) || {};
  const { access } = useContext(GlobalInfoContext) || {};

  const canEdit = access === "full" || (access === "music" && type === "song");
  const isMusic = useMemo(() => access === "music", [access]);

  const _size = isMobile ? slidesPerRowMobile : slidesPerRow;
  const size = type === "timer" ? Math.min(_size, 3) : _size;

  const sizeMap: SizeMap = useMemo(
    () =>
      new Map([
        [
          7,
          {
            width: isMusic ? 11 : 7,
            mobileWidth: isMusic ? 12 : 11,
            cols: "grid-cols-7",
            hSize: "text-xs",
            borderWidth: "clamp(0.2rem, 0.2vw, 0.4rem)",
          },
        ],
        [
          6,
          {
            width: isMusic ? 13 : 8.25,
            mobileWidth: isMusic ? 14 : 13,
            cols: "grid-cols-6",
            hSize: isMusic ? "text-sm" : "text-xs",
            borderWidth: "clamp(0.25rem, 0.25vw, 0.5rem)",
          },
        ],
        [
          5,
          {
            width: isMusic ? 15.5 : 10,
            mobileWidth: isMusic ? 17 : 15,
            cols: "grid-cols-5",
            hSize: isMusic ? "text-sm" : "text-xs",
            borderWidth: "clamp(0.25rem, 0.25vw, 0.5rem)",
          },
        ],
        [
          4,
          {
            width: isMusic ? 20 : 12.75,
            mobileWidth: isMusic ? 21 : 19,
            cols: "grid-cols-4",
            hSize: "text-sm",
            borderWidth: "clamp(0.25rem, 0.25vw, 0.5rem)",
          },
        ],
        [
          3,
          {
            width: isMusic ? 26 : 17,
            mobileWidth: isMusic ? 28 : 26,
            cols: "grid-cols-3",
            hSize: "text-base",
            borderWidth: "clamp(0.3rem, 0.35vw, 0.7rem)",
          },
        ],
        [
          2,
          {
            width: isMusic ? 39 : 26,
            mobileWidth: isMusic ? 42 : 40,
            cols: "grid-cols-2",
            hSize: "text-base",
            borderWidth: "clamp(0.35rem, 0.45vw, 0.9rem)",
          },
        ],
        [
          1,
          {
            width: isMusic ? 78 : 52.25,
            mobileWidth: isMusic ? 84 : 80,
            cols: "grid-cols-1",
            hSize: "text-base",
            borderWidth: "clamp(0.4rem, 0.5vw, 1rem)",
          },
        ],
      ]),
    [isMusic]
  );

  const debounceTime = useRef(0);

  const dispatch = useDispatch();
  const location = useLocation();

  const [debouncedSlides, setDebouncedSlides] = useState(slides);
  const [draggedSection, setDraggedSection] = useState<string | null>(null);

  const hasSlides = slides.length > 0;

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSlides(slides);
    }, debounceTime.current);

    return () => clearTimeout(timeout);
  }, [slides]);

  const getBibleInfo = useCallback(
    (index: number) => {
      const slide = slides[index];

      if (!slide) return { title: "", text: "" };

      const titleSlideText = slides[0].boxes[1]?.words?.trim();
      const slideText = slide.boxes[1]?.words?.trim();

      const title = (slideText ? titleSlideText : "") || "";
      const text = index > 0 ? slideText || "" : "";
      return { title, text };
    },
    [slides]
  );

  const selectSlide = useCallback(
    (index: number) => {
      dispatch(setSelectedSlide(index));
      const slide = slides[index];

      if (shouldSendTo.stream) {
        if (type === "bible") {
          const { title, text } = getBibleInfo(index);
          dispatch(
            updateBibleDisplayInfo({
              title,
              text,
            })
          );
        } else {
          dispatch(updateBibleDisplayInfo({ title: "", text: "" }));
        }

        if (type === "free") {
          dispatch(
            updateFormattedTextDisplayInfo({
              text: slide.boxes[1]?.words || "",
              backgroundColor:
                slide.formattedTextDisplayInfo?.backgroundColor || "#eb8934",
              textColor: slide.formattedTextDisplayInfo?.textColor || "#ffffff",
              fontSize: slide.formattedTextDisplayInfo?.fontSize || 1.5,
              paddingX: slide.formattedTextDisplayInfo?.paddingX || 2,
              paddingY: slide.formattedTextDisplayInfo?.paddingY || 1,
              isBold: slide.formattedTextDisplayInfo?.isBold || false,
              isItalic: slide.formattedTextDisplayInfo?.isItalic || false,
              align: slide.formattedTextDisplayInfo?.align || "left",
            })
          );
        } else {
          dispatch(
            updateFormattedTextDisplayInfo({
              text: "",
            })
          );
        }

        if (type !== "free" && type !== "bible") {
          dispatch(
            updateStream({
              slide,
              type,
              name,
              timerId: timerInfo?.id,
            })
          );
        }
      }

      if (shouldSendTo.projector) {
        dispatch(
          updateProjector({
            slide,
            type,
            name,
            timerId: timerInfo?.id,
          })
        );
      }

      if (type === "timer") {
        dispatch(setMonitorTimerId(timerInfo?.id || null));
      }

      if (shouldSendTo.monitor) {
        dispatch(
          updateMonitor({
            slide,
            type,
            name,
            timerId: timerInfo?.id,
          })
        );
      }
    },
    [
      dispatch,
      shouldSendTo.stream,
      shouldSendTo.projector,
      shouldSendTo.monitor,
      type,
      name,
      timerInfo?.id,
      getBibleInfo,
      slides,
    ]
  );

  const advanceSlide = useCallback(() => {
    const nextSlide = Math.min(selectedSlide + 1, slides.length - 1);
    selectSlide(nextSlide);
  }, [selectedSlide, slides, selectSlide]);

  const previousSlide = useCallback(() => {
    const nextSlide = Math.max(selectedSlide - 1, 0);
    selectSlide(nextSlide);
  }, [selectedSlide, selectSlide]);

  // Automatically switch to slide 1 (wrap up slide) when timer reaches 0
  useEffect(() => {
    if (
      type === "timer" &&
      timerInfo &&
      timerInfo.remainingTime === 0 &&
      timerInfo.status === "stopped" &&
      slides.length > 1 &&
      selectedSlide === 0
    ) {
      dispatch(
        updateTimer({
          id: timerInfo.id,
          timerInfo: { ...timerInfo, status: "stopped" },
        })
      );
      selectSlide(1);
    }
  }, [type, timerInfo, slides.length, selectedSlide, selectSlide, dispatch]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTyping =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;
      if (!location.pathname.includes("item") || isEditMode || isTyping) return;
      if (e.key === " ") {
        e.preventDefault();
        advanceSlide();
      }
      if (e.key === " " && e.shiftKey) {
        e.preventDefault();
        previousSlide();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [advanceSlide, previousSlide, isEditMode, location.pathname]);

  useEffect(() => {
    let timeout: NodeJS.Timeout | null = null;

    if (isLoading) {
      if (timeout) {
        clearTimeout(timeout);
      }
      setDebouncedSlides([]);
      debounceTime.current = 0;
    } else {
      timeout = setTimeout(() => {
        debounceTime.current = 150;
      }, 250);
    }

    return () => {
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [isLoading]);

  const sensors = useSensors();

  const { setNodeRef } = useDroppable({
    id: "item-slides-list",
  });

  useEffect(() => {
    if (isMobile) {
      dispatch(setSlidesMobile(slidesPerRowMobile));
    } else {
      dispatch(setSlides(slidesPerRow));
    }
    // Only run if isMobile change
    // eslint-disable-next-line
  }, [isMobile, dispatch]);

  useEffect(() => {
    const slideElement = document.getElementById(`item-slide-${selectedSlide}`);
    const parentElement = document.getElementById("item-slides-container");
    if (slideElement && parentElement) {
      keepElementInView({ child: slideElement, parent: parentElement });
    }
  }, [selectedSlide, isMobile]);

  const addSlide = () => {
    // Find the highest section number among existing slides
    const sectionNumbers = slides
      .map((slide) => {
        const match = slide.name.match(/Section (\d+)/);
        return match ? parseInt(match[1]) : null;
      })
      .filter((n) => n !== null) as number[];
    const maxSection =
      sectionNumbers.length > 0 ? Math.max(...sectionNumbers) : 0;
    const newSectionNum = maxSection + 1;
    const slide = createNewSlide({
      type: "Section",
      fontSize: 2.5,
      words: [""],
      name: `Section ${newSectionNum}`,
      overflow: "separate",
    });
    dispatch(addSlideAction({ slide }));
  };

  const copySlide = () => {
    if (selectedSlide === -1 || !slides[selectedSlide]) return;

    // Find the highest section number among existing slides
    const sectionNumbers = slides
      .map((slide) => {
        const match = slide.name.match(/Section (\d+)/);
        return match ? parseInt(match[1]) : null;
      })
      .filter((n) => n !== null) as number[];
    const maxSection =
      sectionNumbers.length > 0 ? Math.max(...sectionNumbers) : 0;
    const newSectionNum = maxSection + 1;

    const slideToCopy = slides[selectedSlide];
    const newSlide = {
      ...slideToCopy,
      id: generateRandomId(), // Generate a temporary ID
      name: `Section ${newSectionNum}`,
    };

    dispatch(addSlideAction({ slide: newSlide }));
  };

  const onDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const draggedSlide = slides.find((slide) => slide.id === active.id);
    if (draggedSlide) {
      const sectionMatch = draggedSlide.name.match(/Section (\d+)/);
      if (sectionMatch) {
        setDraggedSection(sectionMatch[1]);
      }
    }
  };

  const onDragEnd = (event: DragEndEvent) => {
    setDraggedSection(null);
    const { over, active } = event;
    if (!over || !active) return;

    const { id: overId } = over;
    const { id: activeId } = active;
    const updatedSlides = [...slides];

    // Find the dragged slide and its section
    const draggedSlide = slides.find((slide) => slide.id === activeId);
    if (!draggedSlide) return;

    // Extract section number from the dragged slide's name
    const sectionMatch = draggedSlide.name.match(/Section (\d+)/);
    if (!sectionMatch) return;
    const sectionNum = sectionMatch[1];

    // Find all slides in the same section
    const sectionSlides = slides.filter((slide) =>
      slide.name.includes(`Section ${sectionNum}`)
    );

    // Find the target position
    const targetSlide = slides.find((slide) => slide.id === overId);
    if (!targetSlide) return;

    // Get the target index
    const targetIndex = slides.findIndex((slide) => slide.id === overId);

    // Check if target position is within another section
    const targetSectionMatch = targetSlide.name.match(/Section (\d+)/);
    if (targetSectionMatch) {
      const targetSectionNum = targetSectionMatch[1];
      if (targetSectionNum !== sectionNum) {
        // Find the boundaries of the target section
        const targetSectionStart = slides.findIndex((slide) =>
          slide.name.includes(`Section ${targetSectionNum}`)
        );
        const targetSectionEnd = slides.findIndex(
          (slide, index) =>
            index > targetSectionStart &&
            !slide.name.includes(`Section ${targetSectionNum}`)
        );

        // If target is within another section, adjust the target index to be before or after that section
        if (
          targetIndex > targetSectionStart &&
          targetIndex < targetSectionEnd
        ) {
          // If we're closer to the start of the target section, place before it
          if (
            targetIndex - targetSectionStart <
            targetSectionEnd - targetIndex
          ) {
            return; // Don't allow dropping in the middle of another section
          } else {
            return; // Don't allow dropping in the middle of another section
          }
        }
      }
    }

    // Get the indices of the first and last slides in the section
    const firstSectionIndex = slides.findIndex((slide) =>
      slide.name.includes(`Section ${sectionNum}`)
    );

    // Remove all slides in the section
    updatedSlides.splice(firstSectionIndex, sectionSlides.length);

    // Insert the section slides at the target position
    updatedSlides.splice(targetIndex, 0, ...sectionSlides);

    setDebouncedSlides(updatedSlides);
    dispatch(updateSlides({ slides: updatedSlides }));
  };

  // if (!arrangement && !hasSlides && type !== "free") return null;

  return (
    <ErrorBoundary>
      <DndContext
        sensors={sensors}
        onDragEnd={canEdit ? onDragEnd : undefined}
        onDragStart={canEdit ? onDragStart : undefined}
      >
        <div className="flex w-full px-2 bg-gray-900 mb-2 gap-1">
          <Button
            variant="tertiary"
            svg={ZoomOut}
            onClick={() => {
              if (isMobile) {
                dispatch(increaseSlidesMobile());
                if (type === "timer") {
                  dispatch(setSlidesMobile(size + 1));
                }
              } else {
                dispatch(increaseSlides());
                if (type === "timer") {
                  dispatch(setSlides(size + 1));
                }
              }
            }}
          />
          <Button
            variant="tertiary"
            svg={ZoomIn}
            onClick={() => {
              if (isMobile) {
                dispatch(decreaseSlidesMobile());
                if (type === "timer") {
                  dispatch(setSlidesMobile(size - 1));
                }
              } else {
                dispatch(decreaseSlides());
                if (type === "timer") {
                  dispatch(setSlides(size - 1));
                }
              }
            }}
          />
          {type === "free" && canEdit && (
            <>
              <Button
                variant="tertiary"
                className="ml-auto"
                svg={Plus}
                onClick={() => addSlide()}
              />
              <Button variant="tertiary" svg={Copy} onClick={copySlide} />
              <Button
                variant="tertiary"
                svg={Trash2}
                onClick={() => dispatch(removeSlide({ index: selectedSlide }))}
              />
            </>
          )}
        </div>
        {hasSlides ? (
          <ul
            ref={setNodeRef}
            tabIndex={0}
            id="item-slides-container"
            className={cn(
              "scrollbar-variable max-h-full px-2 overflow-y-auto grid pb-2 focus-visible:outline-none",
              sizeMap.get(size)?.cols
            )}
          >
            <SortableContext
              items={slides.map((slide) => slide.id || "")}
              strategy={rectSortingStrategy}
            >
              {debouncedSlides.map((slide, index) => (
                <ItemSlide
                  isTransmitting={isTransmitting}
                  timerInfo={timerInfo}
                  key={slide.id}
                  slide={slide}
                  index={index}
                  selectSlide={selectSlide}
                  selectedSlide={selectedSlide}
                  size={size}
                  itemType={type}
                  isMobile={isMobile || false}
                  draggedSection={draggedSection}
                  isStreamFormat={shouldShowStreamFormat}
                  getBibleInfo={getBibleInfo}
                  sizeMap={sizeMap}
                />
              ))}
            </SortableContext>
          </ul>
        ) : (
          <div className="flex w-full items-center justify-center h-6 mb-2 gap-1">
            <p className="text-gray-300">No slides for selected item</p>
          </div>
        )}
      </DndContext>
    </ErrorBoundary>
  );
};

export default ItemSlides;
