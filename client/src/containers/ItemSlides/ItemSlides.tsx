import { ListChecks, Plus, ZoomIn, ZoomOut, Trash2, Copy } from "lucide-react";
import Button from "../../components/Button/Button";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import {
  clearBackgroundTargetSelection,
  clearBackgroundTargetSlideIdsOnly,
  removeSlide,
  setBackgroundTargetSlideIds,
  setBackgroundTargetRangeAnchorId,
  setMobileBackgroundTargetSelectMode,
  setSelectedSlide,
  toggleBackgroundTargetSlideId,
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
import { useDispatch, useSelector } from "../../hooks";
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
import ItemSlidesSkeleton from "./ItemSlidesSkeleton";
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
import { DEFAULT_FONT_PX } from "../../constants";
import { ensureSlidesHaveMonitorBandFormatting } from "../../utils/overflow";
import { inclusiveRangeIndicesFromAnchor } from "../../utils/backgroundTargetResolution";

type SizeConfig = {
  borderWidth: string;
  hSize: string;
  cols: string;
};

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
    backgroundTargetSlideIds: backgroundTargetSlideIdsRaw,
    backgroundTargetRangeAnchorId,
    mobileBackgroundTargetSelectMode: mobileBgSelectModeRaw,
  } = useSelector((state: RootState) => state.undoable.present.item);

  const backgroundTargetSlideIds = backgroundTargetSlideIdsRaw ?? [];
  const mobileBackgroundTargetSelectMode = mobileBgSelectModeRaw ?? false;

  const { projectorInfo, monitorInfo, streamInfo } = useSelector(
    (state: RootState) => state.presentation
  );

  const timers = useSelector((state: RootState) => state.timers.timers);
  const timerInfo = timers.find((timer) => timer.id === _id);

  const arrangement = arrangements[selectedArrangement];

  const slides = useMemo(() => {
    const _slides = arrangement?.slides || __slides || [];
    return isLoading ? [] : _slides;
  }, [isLoading, __slides, arrangement?.slides]);

  const {
    slidesPerRow,
    slidesPerRowMobile,
    shouldShowStreamFormat,
    monitorSettings: { showNextSlide: monitorShowNextSlide },
  } = useSelector((state: RootState) => state.undoable.present.preferences);

  const { isMobile } = useContext(ControllerInfoContext) || {};
  const { access } = useContext(GlobalInfoContext) || {};

  const canEdit = access === "full" || (access === "music" && type === "song");
  const isMusic = useMemo(() => access === "music", [access]);
  const shouldPrepareFreeMonitorSlides =
    type === "free" && shouldSendTo.monitor && monitorShowNextSlide;

  const monitorReadySlides = useMemo(() => {
    return shouldPrepareFreeMonitorSlides
      ? ensureSlidesHaveMonitorBandFormatting(slides)
      : slides;
  }, [slides, shouldPrepareFreeMonitorSlides]);

  /** Slide ids currently on outputs for this item (last pushed payload per surface). */
  const liveSlideIds = useMemo(() => {
    const ids = new Set<string>();
    if (shouldSendTo.projector && projectorInfo.slide?.id) {
      ids.add(projectorInfo.slide.id);
    }
    if (shouldSendTo.monitor) {
      const mid = monitorInfo.slide?.id;
      const monitorItemId = monitorInfo.itemId;
      if (mid && (!monitorItemId || monitorItemId === _id)) {
        ids.add(mid);
      }
    }
    if (
      shouldSendTo.stream &&
      type !== "bible" &&
      type !== "free" &&
      streamInfo.slide?.id
    ) {
      ids.add(streamInfo.slide.id);
    }
    return ids;
  }, [
    _id,
    shouldSendTo.projector,
    shouldSendTo.monitor,
    shouldSendTo.stream,
    type,
    projectorInfo.slide?.id,
    monitorInfo.slide?.id,
    monitorInfo.itemId,
    streamInfo.slide?.id,
  ]);

  const _size = isMobile ? slidesPerRowMobile : slidesPerRow;
  const size = type === "timer" ? Math.min(_size, 3) : _size;

  const sizeConfig: SizeConfig = useMemo(() => {
    const configs: Record<number, SizeConfig> = {
      7: {
        cols: "grid-cols-7",
        hSize: "text-xs",
        borderWidth: "clamp(0.2rem, 0.2vw, 0.4rem)",
      },
      6: {
        cols: "grid-cols-6",
        hSize: isMusic ? "text-sm" : "text-xs",
        borderWidth: "clamp(0.25rem, 0.25vw, 0.5rem)",
      },
      5: {
        cols: "grid-cols-5",
        hSize: isMusic ? "text-sm" : "text-xs",
        borderWidth: "clamp(0.25rem, 0.25vw, 0.5rem)",
      },
      4: {
        cols: "grid-cols-4",
        hSize: "text-sm",
        borderWidth: "clamp(0.25rem, 0.25vw, 0.5rem)",
      },
      3: {
        cols: "grid-cols-3",
        hSize: "text-base",
        borderWidth: "clamp(0.3rem, 0.35vw, 0.7rem)",
      },
      2: {
        cols: "grid-cols-2",
        hSize: "text-base",
        borderWidth: "clamp(0.35rem, 0.45vw, 0.9rem)",
      },
      1: {
        cols: "grid-cols-1",
        hSize: "text-base",
        borderWidth: "clamp(0.4rem, 0.5vw, 1rem)",
      },
    };
    return configs[size] || configs[7];
  }, [size, isMusic]);

  const slidesListClassName = useMemo(
    () =>
      cn(
        "scrollbar-variable max-h-full px-2 overflow-y-auto grid pb-2 focus-visible:outline-none",
        sizeConfig.cols,
      ),
    [sizeConfig.cols],
  );

  const debounceTime = useRef(0);

  const dispatch = useDispatch();
  const location = useLocation();

  /** Latest selected slide; read in selectSlide before dispatch so transitionDirection uses the prior index. */
  const selectedSlideRef = useRef(selectedSlide);
  selectedSlideRef.current = selectedSlide;

  const [debouncedSlides, setDebouncedSlides] = useState(slides);
  const [draggedSection, setDraggedSection] = useState<string | null>(null);

  const hasSlides = slides.length > 0;
  /** Avoid one paint with an empty list after load: debounced state clears while loading and syncs in an effect. */
  const slidesToRender =
    hasSlides && debouncedSlides.length === 0 ? slides : debouncedSlides;

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
      dispatch(setBackgroundTargetRangeAnchorId(slides[index]?.id ?? null));
      const prevSelected = selectedSlideRef.current;
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
        let transitionDirection: "next" | "prev" | "jump";
        if (index === prevSelected + 1) transitionDirection = "next";
        else if (index === prevSelected - 1) transitionDirection = "prev";
        else transitionDirection = "jump";
        const monitorSlide = monitorReadySlides[index] ?? slide;
        const canShowNextSlide =
          (type === "song" || type === "bible" || type === "free") &&
          monitorShowNextSlide &&
          index + 1 < slides.length &&
          (slide?.boxes ?? []).every(
            (box, i) => i === 0 || box.height <= 55
          );
        const nextSlideSlide = canShowNextSlide
          ? monitorReadySlides[index + 1] ?? slides[index + 1]
          : null;
        const nextSlideForMonitor = nextSlideSlide
          ? {
            ...nextSlideSlide,
            boxes: nextSlideSlide.monitorNextBandBoxes ?? nextSlideSlide.boxes,
          }
          : undefined;
        // Only use band-formatted boxes when using next-slide layout; single-slide uses DisplayBox at 1080p
        const slideForMonitor = {
          ...monitorSlide,
          boxes:
            nextSlideForMonitor != null
              ? monitorSlide.monitorCurrentBandBoxes ?? monitorSlide.boxes
              : monitorSlide.boxes,
        };
        dispatch(
          updateMonitor({
            slide: slideForMonitor,
            type,
            name,
            timerId: timerInfo?.id,
            itemId: _id,
            nextSlide: nextSlideForMonitor,
            transitionDirection,
            bibleInfoBox:
              type === "bible" && nextSlideForMonitor
                ? slide.boxes?.[2] ?? null
                : undefined,
          })
        );
      }
    },
    [
      dispatch,
      shouldSendTo.stream,
      shouldSendTo.projector,
      shouldSendTo.monitor,
      monitorShowNextSlide,
      type,
      name,
      timerInfo?.id,
      getBibleInfo,
      slides,
      _id,
      monitorReadySlides,
    ]
  );

  const onSlideGridClick = useCallback(
    (e: React.MouseEvent, index: number) => {
      if (!canEdit) {
        selectSlide(index);
        return;
      }
      if (mobileBackgroundTargetSelectMode) {
        e.preventDefault();
        const id = slides[index]?.id;
        if (id) dispatch(toggleBackgroundTargetSlideId(id));
        return;
      }
      if (e.shiftKey) {
        e.preventDefault();
        const indices = inclusiveRangeIndicesFromAnchor(
          slides,
          backgroundTargetRangeAnchorId ?? null,
          index,
          selectedSlide,
        );
        dispatch(
          setBackgroundTargetSlideIds(
            indices.map((i) => slides[i]?.id).filter(Boolean) as string[],
          ),
        );
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const id = slides[index]?.id;
        if (id) dispatch(toggleBackgroundTargetSlideId(id));
        return;
      }
      // Plain click: focus one slide and drop background subset selection.
      if (backgroundTargetSlideIds.length > 0) {
        dispatch(clearBackgroundTargetSelection());
      }
      selectSlide(index);
    },
    [
      canEdit,
      mobileBackgroundTargetSelectMode,
      slides,
      backgroundTargetRangeAnchorId,
      selectedSlide,
      backgroundTargetSlideIds.length,
      dispatch,
      selectSlide,
    ],
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
    const parentElement = document.getElementById("item-slides-container");
    if (!parentElement) return;
    const runScroll = () => {
      const slideElement = document.getElementById(`item-slide-${selectedSlide}`);
      if (slideElement && parentElement) {
        keepElementInView({
          child: slideElement,
          parent: parentElement,
          shouldScrollToCenter: true,
        });
      }
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(runScroll);
    });
  }, [selectedSlide, isMobile, slidesToRender.length]);

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
      fontSize: DEFAULT_FONT_PX,
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

  return (
    <ErrorBoundary>
      <DndContext
        sensors={sensors}
        onDragEnd={canEdit ? onDragEnd : undefined}
        onDragStart={canEdit ? onDragStart : undefined}
      >
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-homepage-canvas">
          <div className="mb-2 flex w-full shrink-0 flex-col border-b border-white/20 bg-black/60">
            <div className="flex gap-1 px-2">
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
                    onClick={() =>
                      dispatch(removeSlide({ index: selectedSlide }))
                    }
                  />
                </>
              )}
              {canEdit && hasSlides && (
                <Button
                  variant="tertiary"
                  className={cn(
                    type === "free" ? "" : "ml-auto",
                    mobileBackgroundTargetSelectMode && "bg-white/15",
                  )}
                  svg={ListChecks}
                  title={
                    mobileBackgroundTargetSelectMode
                      ? "Exit slide selection mode"
                      : "Select slides for background targets"
                  }
                  onClick={() => {
                    if (mobileBackgroundTargetSelectMode) {
                      dispatch(clearBackgroundTargetSelection());
                    } else {
                      dispatch(setMobileBackgroundTargetSelectMode(true));
                    }
                  }}
                >
                  {isMobile ? "Select" : "Select slides"}
                </Button>
              )}
            </div>
            {canEdit && hasSlides && (
              <div
                className={cn(
                  "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
                  mobileBackgroundTargetSelectMode
                    ? "grid-rows-[1fr]"
                    : "grid-rows-[0fr]",
                )}
              >
                <div
                  className="min-h-0 overflow-hidden"
                  inert={mobileBackgroundTargetSelectMode ? undefined : true}
                >
                  <div className="flex items-center justify-between gap-2 border-t border-white/10 px-2 py-1.5">
                    <span className="text-xs text-gray-400">
                      {backgroundTargetSlideIds.length} slide
                      {backgroundTargetSlideIds.length === 1 ? "" : "s"}{" "}
                      selected
                    </span>
                    <span className="flex shrink-0 gap-1">
                      <Button
                        variant="tertiary"
                        className="min-h-7 h-7 px-2 text-xs"
                        onClick={() =>
                          dispatch(clearBackgroundTargetSlideIdsOnly())
                        }
                      >
                        Clear
                      </Button>
                      <Button
                        variant="tertiary"
                        className="min-h-7 h-7 px-2 text-xs"
                        onClick={() =>
                          dispatch(clearBackgroundTargetSelection())
                        }
                      >
                        Done
                      </Button>
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
          {isLoading ? (
            <ItemSlidesSkeleton
              className={slidesListClassName}
              placeholderCount={Math.min(size * 2, 16)}
            />
          ) : hasSlides ? (
            <ul
              ref={setNodeRef}
              tabIndex={0}
              id="item-slides-container"
              className={slidesListClassName}
            >
              <SortableContext
                items={slides.map((slide) => slide.id || "")}
                strategy={rectSortingStrategy}
              >
                {slidesToRender.map((slide, index) => (
                  <ItemSlide
                    timerInfo={timerInfo}
                    key={slide.id}
                    slide={slide}
                    index={index}
                    selectSlide={selectSlide}
                    isSelected={index === selectedSlide}
                    isLive={liveSlideIds.has(slide.id)}
                    size={size}
                    itemType={type}
                    isMobile={isMobile || false}
                    draggedSection={draggedSection}
                    isStreamFormat={shouldShowStreamFormat}
                    getBibleInfo={getBibleInfo}
                    borderWidth={sizeConfig.borderWidth}
                    hSize={sizeConfig.hSize}
                    canEdit={canEdit}
                    isBackgroundTargetSelected={backgroundTargetSlideIds.includes(
                      slide.id,
                    )}
                    onSlideGridClick={onSlideGridClick}
                  />
                ))}
              </SortableContext>
            </ul>
          ) : (
            <div className="flex w-full items-center justify-center h-6 mb-2 gap-1 shrink-0">
              <p className="text-gray-300">No slides for selected item</p>
            </div>
          )}
        </div>
      </DndContext>
    </ErrorBoundary>
  );
};

export default ItemSlides;
