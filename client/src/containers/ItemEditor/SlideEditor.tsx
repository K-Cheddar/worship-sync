import Button from "../../components/Button/Button";
import cn from "classnames";
import { ChevronsUpDown } from "lucide-react";
import { ChevronsDownUp } from "lucide-react";
import { Pencil } from "lucide-react";
import { PencilLine } from "lucide-react";
import { Check } from "lucide-react";
import { X } from "lucide-react";

import Input from "../../components/Input/Input";
import {
  CSSProperties,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { borderColorMap } from "../../utils/itemTypeMaps";
import { itemSectionBgColorMap } from "../../utils/slideColorMap";
import DisplayWindow from "../../components/DisplayWindow/DisplayWindow";
import { useDispatch, useSelector } from "../../hooks";
import {
  setSelectedBox,
  setSelectedSlide,
  setIsEditMode,
  updateArrangements,
  updateSlides,
} from "../../store/itemSlice";
import { setName, updateBoxes } from "../../store/itemSlice";
import { formatBible, formatFree, formatSong } from "../../utils/overflow";
import { Box, ItemSlideType } from "../../types";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { setShouldShowItemEditor } from "../../store/preferencesSlice";
import { RootState } from "../../store/store";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import { AccessType } from "../../context/globalInfo";
import SectionTextEditor from "../../components/SectionTextEditor/SectionTextEditor";
import SlideBoxes from "../../components/SlideBoxes/SlideBoxes";

const SlideEditor = ({ access }: { access?: AccessType }) => {
  const dispatch = useDispatch();

  const item = useSelector((state: RootState) => state.undoable.present.item);
  const {
    name,
    type,
    arrangements,
    selectedArrangement,
    selectedSlide,
    selectedBox,
    slides: __slides,
    isLoading,
  } = item;

  const arrangement = arrangements[selectedArrangement];
  
  const slides = useMemo(() => {
    const _slides = arrangement?.slides || __slides || [];
    return isLoading ? [] : _slides;
  }, [isLoading, __slides, arrangement?.slides]);

  const canEdit = access === "full" || (access === "music" && type === "song");

  const { shouldShowItemEditor, toolbarSection = "settings" } = useSelector(
    (state: RootState) => state.undoable.present.preferences
  );

  const [isEditingName, setIsEditingName] = useState(false);

  const [isBoxLocked, setIsBoxLocked] = useState<boolean[]>([]);

  const numBoxes = useMemo(() => {
    return slides?.[selectedSlide]?.boxes?.length || 0;
  }, [slides, selectedSlide]);

  useEffect(() => {
    setIsBoxLocked(Array(numBoxes).fill(true));
  }, [numBoxes]);

  const [localName, setLocalName] = useState(name || "");

  const { db, isMobile = false } = useContext(ControllerInfoContext) || {};

  const [editorHeight, setEditorHeight] = useState(
    isMobile ? "calc(47.25vw + 60px)" : "23.625vw"
  );

  const [emptySlideHeight, setEmptySlideHeight] = useState(
    isMobile ? "calc(47.25vw + 60px)" : "23.625vw"
  );

  const [cursorPositions, setCursorPositions] = useState<
    Record<number, number>
  >({});

  const reformatTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isReformatting, setIsReformatting] = useState(false);

  useEffect(() => {
    if (!slides?.[selectedSlide] && selectedSlide !== 0) {
      dispatch(setSelectedSlide(Math.max(slides.length - 2, 0)));
    }
  }, [selectedSlide, slides, dispatch]);

  const editorRef = useCallback((node: HTMLDivElement) => {
    if (node) {
      const resizeObserver = new ResizeObserver((entries) => {
        setEditorHeight(`${entries[0].borderBoxSize[0].blockSize}px`);
      });

      resizeObserver.observe(node);
    }
  }, []);

  const emptySlideRef = useCallback((node: HTMLDivElement) => {
    if (node) {
      const resizeObserver = new ResizeObserver((entries) => {
        setEmptySlideHeight(`${entries[0].borderBoxSize[0].blockSize}px`);
      });

      resizeObserver.observe(node);
    }
  }, []);

  useEffect(() => {
    setLocalName(name || "");
  }, [name]);

  useEffect(() => {
    Object.entries(cursorPositions).forEach(([index, position]) => {
      const textBoxElement = document.getElementById(
        `display-editor-box-${index}`
      ) as HTMLTextAreaElement;
      if (textBoxElement && typeof position === "number") {
        textBoxElement.selectionEnd = position;
        textBoxElement.selectionStart = position;
        requestAnimationFrame(() => {
          textBoxElement.scrollTop = 0;
        });
      }
    });
  }, [cursorPositions]);

  const saveName = () => {
    setIsEditingName(false);
    if (db) {
      dispatch(setName({ name: localName }));
    }
  };

  const onChange = ({
    index,
    value,
    box,
    cursorPosition,
    lastKeyPressed,
  }: {
    index: number;
    value: string;
    box: Box;
    cursorPosition?: number;
    lastKeyPressed?: string | null;
  }) => {
    // Prevent editing if user doesn't have edit permissions
    if (!canEdit) {
      return;
    }

    let shouldDeleteCurrentSlide = false;

    if (
      (lastKeyPressed === "Backspace" || lastKeyPressed === "Delete") &&
      !value
    ) {
      shouldDeleteCurrentSlide = true;
    }

    if (typeof cursorPosition === "number") {
      setCursorPositions((prev) => ({ ...prev, [index]: cursorPosition }));
    }

    const newBoxes = boxes.map((b, i) =>
      i === index
        ? {
            ...b,
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            words: type === "bible" ? box.words : value,
          }
        : b
    );

    if (type === "timer") {
      dispatch(updateBoxes({ boxes: newBoxes }));
    }

    const updatedSlides = item.slides.map((slide, index) => {
      if (index === selectedSlide) {
        return { ...slide, boxes: newBoxes };
      }
      return slide;
    });

    if (shouldDeleteCurrentSlide) {
      updatedSlides.splice(selectedSlide, 1);
    }

    const updatedItem = {
      ...item,
      slides: updatedSlides,
    };

    if (type === "bible") {
      const _item = formatBible({
        item: updatedItem,
        mode: item.bibleInfo?.fontMode || "separate",
        isMobile,
      });
      dispatch(updateSlides({ slides: _item.slides }));
    }

    if (type === "free") {
      if (shouldDeleteCurrentSlide) {
        dispatch(updateSlides({ slides: updatedSlides }));
      } else {
        // Get the current section number from the slide name
        const currentSlide = updatedSlides[selectedSlide];
        const currentSectionMatch = currentSlide?.name?.match(/Section (\d+)/);
        const currentSectionNum = currentSectionMatch
          ? parseInt(currentSectionMatch[1])
          : 1;

        // Get all slides in the current section (sorted by slide index to maintain order)
        const currentSectionSlidesWithIndices = updatedSlides
          .map((slide, idx) => ({ slide, idx }))
          .filter(({ slide }) => slide.name?.includes(`Section ${currentSectionNum}`))
          .sort((a, b) => a.idx - b.idx);

        // Find the index of the current slide within the section
        const currentSlideIndexInSection = currentSectionSlidesWithIndices.findIndex(
          ({ idx }) => idx === selectedSlide
        );

        // Safety check: if current slide not found in section, fall back to direct update
        if (currentSlideIndexInSection === -1) {
          const _item = formatFree(
            {
              ...updatedItem,
            },
            isMobile
          );
          dispatch(updateSlides({ slides: _item.slides }));
          return;
        }

        // Build the combined text from all slides in the section
        // Use the same logic as getFormattedSections
        let newWords = "";
        for (let i = 0; i < currentSectionSlidesWithIndices.length; ++i) {
          const { slide } = currentSectionSlidesWithIndices[i];
          const slideBox = slide?.boxes[index];
          const slideWords = i === currentSlideIndexInSection ? value : (slideBox?.words || "");
          
          if (slideWords.trim().length > 0) {
            if (newWords) {
              const alreadyHasNewline = newWords.endsWith("\n");
              const shouldAddNewline = !alreadyHasNewline;
              newWords += shouldAddNewline ? "\n" + slideWords : slideWords;
            } else {
              newWords = slideWords;
            }
          }
        }

        // Update formattedSections with the new combined text
        const formattedSections = item.formattedSections || [];
        const updatedFormattedSections = formattedSections.map((section) => {
          if (section.sectionNum === currentSectionNum) {
            return {
              ...section,
              words: newWords,
            };
          }
          return section;
        });

        // If section doesn't exist, create it
        if (!updatedFormattedSections.find((s) => s.sectionNum === currentSectionNum)) {
          updatedFormattedSections.push({
            sectionNum: currentSectionNum,
            words: newWords,
            slideSpan: currentSectionSlidesWithIndices.length,
          });
        }

        // Now format with updated formattedSections
        const _item = formatFree(
          {
            ...updatedItem,
            formattedSections: updatedFormattedSections,
          },
          isMobile
        );
        dispatch(updateSlides({ 
          slides: _item.slides,
          formattedSections: _item.formattedSections,
        }));
      }
    }

    if (type === "song") {
      const currentArrangement = arrangements[selectedArrangement];
      if (!currentArrangement?.slides) return;

      // Last slide should not be editable
      if (selectedSlide === currentArrangement.slides.length - 1) {
        return;
      }

      // For title slide or boxes excluded from overflow, update directly
      if (box.excludeFromOverflow || selectedSlide === 0) {
        dispatch(updateBoxes({ boxes: newBoxes }));
        return;
      }

      // For overflow slides, update the formatted lyrics
      const formattedLyrics = currentArrangement.formattedLyrics || [];
      const arrangementSlides = currentArrangement.slides;
      const currentSlide = arrangementSlides[selectedSlide];
      
      if (!currentSlide) return;

      // Find the formatted lyric that matches this slide
      const lyricIndex = formattedLyrics.findIndex((lyric) =>
        currentSlide.name.startsWith(lyric.name)
      );

      if (lyricIndex === -1) {
        // If no matching lyric found, just update boxes directly
        dispatch(updateBoxes({ boxes: newBoxes }));
        return;
      }

      const formattedLyric = formattedLyrics[lyricIndex];
      
      // Calculate the range of slides for this section
      const slideIndex = currentSlide.boxes[index]?.slideIndex || 0;
      const start = selectedSlide - slideIndex;
      const end = start + formattedLyric.slideSpan - 1;

      // Build the combined text from all slides in the section
      let newWords = "";
      for (let i = start; i <= end && i < arrangementSlides.length; ++i) {
        if (i === selectedSlide) {
          // Use the new value for the current slide
          const alreadyHasNewline = value.endsWith("\n");
          const shouldAddNewline =
            i < end && !alreadyHasNewline && value.trim().length > 0;
          newWords += shouldAddNewline ? value + "\n" : value;
        } else {
          // Preserve text from other slides in the section
          const slideBox = arrangementSlides[i]?.boxes[index];
          if (slideBox?.words) {
            newWords += slideBox.words;
          }
        }
      }

      if (shouldDeleteCurrentSlide) {
        newWords = newWords.trim();
      }

      if (newWords === "") return;

      // Update the formatted lyrics and reformat
      const updatedArrangements = item.arrangements.map((arr, idx) => {
        if (idx === selectedArrangement) {
          return {
            ...arr,
            formattedLyrics: formattedLyrics.map((lyric, i) =>
              i === lyricIndex ? { ...lyric, words: newWords } : lyric
            ),
          };
        }
        return arr;
      });

      const formattedItem = formatSong(
        {
          ...item,
          arrangements: updatedArrangements,
          selectedArrangement,
        },
        isMobile
      );

      dispatch(updateArrangements({ arrangements: formattedItem.arrangements }));
    }
  };

  const _boxes = useMemo(() => {
    // For songs, always use arrangement slides
    if (type === "song" && arrangement?.slides) {
      return arrangement.slides[selectedSlide]?.boxes || [];
    }
    // For other types, use item slides
    return slides?.[selectedSlide]?.boxes || [];
  }, [type, slides, selectedSlide, arrangement]);

  const boxes = isLoading ? [] : _boxes;

  const canDeleteBox = useCallback(
    (index: number) => {
      if (type === "bible") {
        return selectedSlide > 0 ? index > 2 : index > 1;
      }

      if (type === "song") {
        return index > 1;
      }

      if (type === "free" || type === "timer") {
        return index > 0;
      }

      return false;
    },
    [type, selectedSlide]
  );

  const isEmpty = _boxes.length === 0;

  // Helper function to get all section text
  const getSectionText = useCallback(
    (slide: ItemSlideType | undefined, boxIndex: number): string => {
      if (!slide) return "";

      if (type === "song") {
        const formattedLyrics =
          item.arrangements[item.selectedArrangement]?.formattedLyrics || [];
        const _index = formattedLyrics.findIndex((e) =>
          slide.name.startsWith(e.name)
        );

        if (_index === -1) return slide.boxes[boxIndex]?.words || "";

        // Use the stored words from formattedLyrics
        return formattedLyrics[_index].words || "";
      }

      if (type === "free") {
        const currentSectionMatch = slide.name?.match(/Section (\d+)/);
        const currentSectionNum = currentSectionMatch
          ? parseInt(currentSectionMatch[1])
          : 1;

        const formattedSections = item.formattedSections || [];
        const section = formattedSections.find((s) => s.sectionNum === currentSectionNum);
        
        return section?.words || "";
      }

      // For other types, just return current slide text
      return slide.boxes[boxIndex]?.words || "";
    },
    [type, item]
  );

  // Get current section text for unified editor
  const sectionText = useMemo(() => {
    // For songs, use arrangement slides; for others, use item slides
    const currentSlides = type === "song" && arrangement?.slides ? arrangement.slides : slides;
    const currentSlide = currentSlides?.[selectedSlide];
    return getSectionText(currentSlide, selectedBox);
  }, [type, slides, selectedSlide, selectedBox, getSectionText, arrangement]);

  // Get current section name and color for display
  const { sectionName, sectionColor } = useMemo(() => {
    // For songs, use arrangement slides; for others, use item slides
    const currentSlides = type === "song" && arrangement?.slides ? arrangement.slides : slides;
    const currentSlide = currentSlides?.[selectedSlide];
    if (!currentSlide) {
      return { sectionName: "Editing section text", sectionColor: "bg-gray-500" };
    }

    if (type === "song") {
      // For songs, get the base section name (remove letter suffix like "A", "B", etc.)
      const formattedLyrics =
        item.arrangements[item.selectedArrangement]?.formattedLyrics || [];
      const lyricIndex = formattedLyrics.findIndex((lyric) =>
        currentSlide.name.startsWith(lyric.name)
      );
      let name = "Editing section text";
      if (lyricIndex !== -1) {
        name = formattedLyrics[lyricIndex].name;
      } else {
        // Fallback to slide name without letter suffix
        name = currentSlide.name.replace(/[A-Z]$/, "") || currentSlide.name;
      }
      
      // Extract section type (e.g., "Verse", "Chorus") from name like "Verse 1"
      const sectionType = name.split(" ")[0];
      const bgColor = itemSectionBgColorMap.get(sectionType) || "bg-stone-500";
      
      return { sectionName: name, sectionColor: bgColor };
    }

    if (type === "free") {
      // For free types, show "Section X"
      const sectionMatch = currentSlide.name?.match(/Section (\d+)/);
      const name = sectionMatch ? `Section ${sectionMatch[1]}` : currentSlide.name;
      const bgColor = itemSectionBgColorMap.get("Section") || "bg-stone-500";
      return { sectionName: name, sectionColor: bgColor };
    }

    // For other types, show the slide name with item type color
    const name = currentSlide.name || "Editing section text";
    const itemColor = borderColorMap.get(type) || "border-gray-500";
    // Convert border color to background color (e.g., "border-orange-500" -> "bg-orange-500")
    const bgColor = itemColor.replace("border-", "bg-");
    return { sectionName: name, sectionColor: bgColor };
  }, [type, slides, selectedSlide, arrangement, item]);

  // Handle unified section text changes
  const handleSectionTextChange = useCallback(
    (newText: string, cursorPosition?: number) => {
      if (!canEdit) return;

      // Cursor position is tracked in SectionTextEditor component

      // Optimistic update: Update formattedSections immediately for instant feedback
      // For songs, use arrangement slides; for others, use item slides
      const currentSlides = type === "song" && arrangement?.slides ? arrangement.slides : slides;
      const currentSlide = currentSlides?.[selectedSlide];
      if (!currentSlide) return;

      if (type === "free") {
        const currentSectionMatch = currentSlide.name?.match(/Section (\d+)/);
        const currentSectionNum = currentSectionMatch
          ? parseInt(currentSectionMatch[1])
          : 1;

        const formattedSections = item.formattedSections || [];
        const updatedFormattedSections = formattedSections.map((section) => {
          if (section.sectionNum === currentSectionNum) {
            return {
              ...section,
              words: newText,
            };
          }
          return section;
        });

        if (!updatedFormattedSections.find((s) => s.sectionNum === currentSectionNum)) {
          updatedFormattedSections.push({
            sectionNum: currentSectionNum,
            words: newText,
            slideSpan: 1,
          });
        }

        // Optimistic update - update state immediately
        dispatch(
          updateSlides({
            slides: item.slides, // Keep current slides for now
            formattedSections: updatedFormattedSections,
          })
        );
      }

      // Clear any pending reformatting
      if (reformatTimeoutRef.current) {
        clearTimeout(reformatTimeoutRef.current);
      }

      // Debounce the actual reformatting
      setIsReformatting(true);
      reformatTimeoutRef.current = setTimeout(() => {
        try {
          if (type === "song") {
            const formattedLyrics =
              item.arrangements[item.selectedArrangement]?.formattedLyrics || [];
            const _index = formattedLyrics.findIndex((e) =>
              currentSlide.name.startsWith(e.name)
            );

            if (_index === -1) {
              setIsReformatting(false);
              return;
            }

            const updatedArrangements = item.arrangements.map((arr, idx) => {
              if (idx === item.selectedArrangement) {
                return {
                  ...arr,
                  formattedLyrics: formattedLyrics.map((lyric, i) => {
                    if (i === _index) {
                      return {
                        ...lyric,
                        words: newText,
                      };
                    }
                    return lyric;
                  }),
                };
              }
              return arr;
            });

            const _item = formatSong(
              {
                ...item,
                arrangements: updatedArrangements,
                selectedArrangement,
              },
              isMobile
            );

            dispatch(updateArrangements({ arrangements: _item.arrangements }));
          }

          if (type === "free") {
            const currentSectionMatch = currentSlide.name?.match(/Section (\d+)/);
            const currentSectionNum = currentSectionMatch
              ? parseInt(currentSectionMatch[1])
              : 1;

            const formattedSections = item.formattedSections || [];
            const updatedFormattedSections = formattedSections.map((section) => {
              if (section.sectionNum === currentSectionNum) {
                return {
                  ...section,
                  words: newText,
                };
              }
              return section;
            });

            if (!updatedFormattedSections.find((s) => s.sectionNum === currentSectionNum)) {
              updatedFormattedSections.push({
                sectionNum: currentSectionNum,
                words: newText,
                slideSpan: 1,
              });
            }

            const updatedItem = {
              ...item,
              formattedSections: updatedFormattedSections,
            };

            const _item = formatFree(updatedItem, isMobile);
            dispatch(
              updateSlides({
                slides: _item.slides,
                formattedSections: _item.formattedSections,
              })
            );
          } else {
            // For other types (bible, timer, etc.), update the box words directly
            const updatedSlides = item.slides.map((slide, index) => {
              if (index === selectedSlide) {
                const updatedBoxes = slide.boxes.map((box, boxIndex) => {
                  if (boxIndex === selectedBox) {
                    return {
                      ...box,
                      words: newText,
                    };
                  }
                  return box;
                });
                return {
                  ...slide,
                  boxes: updatedBoxes,
                };
              }
              return slide;
            });
            dispatch(updateSlides({ slides: updatedSlides }));
          }
        } catch (error) {
          console.error("Error reformatting section:", error);
          // Show error toast if available
          // Could use toast context here if needed
        } finally {
          setIsReformatting(false);
        }
      }, 300); // 300ms debounce
    },
    [
      canEdit,
      slides,
      selectedSlide,
      selectedBox,
      type,
      item,
      selectedArrangement,
      arrangement,
      isMobile,
      dispatch,
    ]
  );

  return (
    <ErrorBoundary>
      <div>
        <section className="flex justify-end w-full pr-2 bg-gray-900 mb-1 gap-1 overflow-hidden">
          <span
            className={cn(
              "flex mr-auto px-2 items-center gap-2 border-l-4 flex-1 max-w-[calc(100%-6rem)] max-lg:max-w-[calc(100%-4rem)]",
              borderColorMap.get(type)
            )}
          >
            {isEditingName && (
              <Button
                variant="tertiary"
                svg={X}
                onClick={() => setIsEditingName(false)}
              />
            )}
            <Button
              variant="tertiary"
              disabled={isLoading || !canEdit}
              svg={isEditingName ? Check : Pencil}
              onClick={
                isEditingName ? () => saveName() : () => setIsEditingName(true)
              }
            />
            {!isEditingName && (
              <span className="text-base font-semibold flex-1 truncate flex items-center gap-2 max-w-[calc(100%-2rem)]">
                <h2>{isLoading ? "" : name}</h2>
                {arrangement && (
                  <p className="text-sm">
                    {isLoading ? "" : `(${arrangement?.name})`}
                  </p>
                )}
              </span>
            )}
            {isEditingName && (
              <Input
                hideLabel
                className="text-base font-semibold flex-1 truncate flex items-center gap-2 max-w-[calc(100%-2rem)]"
                value={localName || ""}
                onChange={(val) => setLocalName(val as string)}
                data-ignore-undo="true"
              />
            )}
          </span>
          {type === "song" && (
            <Button
              className="text-sm"
              disabled={isLoading || !canEdit}
              onClick={() => dispatch(setIsEditMode(true))}
              svg={PencilLine}
            >
              {isMobile ? "" : "Edit Lyrics"}
            </Button>
          )}
          <Button
            variant="tertiary"
            padding="p-1"
            svg={shouldShowItemEditor ? ChevronsUpDown : ChevronsDownUp}
            onClick={() =>
              dispatch(setShouldShowItemEditor(!shouldShowItemEditor))
            }
            className="text-xs"
          />
        </section>
        <div
          className={cn(
            "flex transition-all relative max-lg:flex-col gap-2 max-lg:items-center",
            shouldShowItemEditor && "mb-2 z-1",
            !shouldShowItemEditor && "h-0 -z-1"
          )}
          data-show={shouldShowItemEditor}
          style={
            {
              "--slide-editor-height": isMobile
                ? "fit-content"
                : `${isEmpty ? emptySlideHeight : editorHeight}`,
            } as CSSProperties
          }
        >
          {!isEmpty ? (
            <div className="flex flex-col lg:flex-row gap-2 w-full px-2">
              {/* Section Text Editor or Slide Boxes */}
              {toolbarSection === "box-tools" ? (
                <SlideBoxes
                  className="lg:flex-[0_0_30%] w-full max-lg:max-h-[25vh] overflow-y-auto"
                  canEdit={canEdit}
                  canDeleteBox={canDeleteBox}
                  isBoxLocked={isBoxLocked}
                  setIsBoxLocked={setIsBoxLocked}
                />
              ) : (
                <SectionTextEditor
                  value={sectionText}
                  onChange={handleSectionTextChange}
                  disabled={
                    !canEdit ||
                    (type !== "song" && type !== "free") ||
                    ((type === "song" && arrangement?.slides ? arrangement.slides : slides)?.[selectedSlide]?.type === "Blank")
                  }
                  sectionName={sectionName}
                  sectionColor={sectionColor}
                  isReformatting={isReformatting}
                />
              )}
              
                <DisplayWindow
                  className="lg:max-h-[42vh] max-lg:max-h-[30vh]"
                  showBorder
                  boxes={boxes}
                  selectBox={(val) => dispatch(setSelectedBox(val))}
                  ref={editorRef}
                  onChange={(onChangeInfo) => {
                    onChange(onChangeInfo);
                  }}
                  displayType="editor"
                  selectedBox={selectedBox}
                  isBoxLocked={isBoxLocked}
                  disabled={!canEdit}
                  shouldPlayVideo
                />
            </div>
          ) : (
            <p
              id="slide-editor-empty"
              ref={emptySlideRef}
              className="flex items-center justify-center text-gray-300 w-full h-[calc(42vw/(16/9))] max-lg:h-[calc(84vw/(16/9))]"
            >
              No slide selected
            </p>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
};

export default SlideEditor;
