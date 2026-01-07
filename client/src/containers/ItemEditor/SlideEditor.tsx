import Button from "../../components/Button/Button";
import cn from "classnames";
import { Lock } from "lucide-react";
import { Unlock } from "lucide-react";
import { ChevronsUpDown } from "lucide-react";
import { ChevronsDownUp } from "lucide-react";
import { Pencil } from "lucide-react";
import { PencilLine } from "lucide-react";
import { Check } from "lucide-react";
import { X } from "lucide-react";
import { BoxIcon } from "lucide-react";
import { Trash2 } from "lucide-react";
import { Plus } from "lucide-react";

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
import { Box } from "../../types";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { setShouldShowItemEditor } from "../../store/preferencesSlice";
import Icon from "../../components/Icon/Icon";
import { createBox } from "../../utils/slideCreation";
import { RootState } from "../../store/store";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import { AccessType } from "../../context/globalInfo";

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
    slides,
    isLoading,
  } = item;

  const canEdit = access === "full" || (access === "music" && type === "song");

  const { shouldShowItemEditor } = useSelector(
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

  const [localName, setLocalName] = useState(name);
  const arrangement = arrangements[selectedArrangement];

  const slideInfoRef = useRef(null);

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
    setLocalName(name);
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
        const _item = formatFree(
          {
            ...updatedItem,
          },
          isMobile
        );
        dispatch(updateSlides({ slides: _item.slides }));
      }
    }

    if (type === "song") {
      // Last slide should not be editable
      if (
        selectedSlide ===
        arrangements[selectedArrangement]?.slides?.length - 1
      ) {
        return;
      }
      if (box.excludeFromOverflow || selectedSlide === 0) {
        dispatch(updateBoxes({ boxes: newBoxes }));
      } else {
        const formattedLyrics =
          item.arrangements[item.selectedArrangement].formattedLyrics;
        const slides = item.arrangements[item.selectedArrangement].slides;
        const _index = formattedLyrics.findIndex((e) =>
          slides[selectedSlide].name.startsWith(e.name)
        );

        const start =
          selectedSlide -
          (slides[selectedSlide]?.boxes[index]?.slideIndex || 0);
        const end = start + formattedLyrics[_index].slideSpan - 1;
        let newWords = "";

        for (let i = start; i <= end; ++i) {
          if (i === selectedSlide) {
            // Check if the current slide already ends with a newline
            const alreadyHasNewline = value.endsWith("\n");

            // Only add newline if:
            // 1. It's not the last slide in the range
            // 2. The slide doesn't already end with a newline
            // 3. The slide has some content (not empty)
            const shouldAddNewline =
              i < end && !alreadyHasNewline && value.trim().length > 0;

            newWords += shouldAddNewline ? value + "\n" : value;
            // newWords += value;
          } else {
            newWords += slides[i].boxes[index].words;
          }
        }
        if (shouldDeleteCurrentSlide) {
          newWords = newWords.trim();
        }

        if (newWords !== "") {
          const updatedArrangements = item.arrangements.map(
            (arrangement, index) => {
              if (index === item.selectedArrangement) {
                return {
                  ...arrangement,
                  formattedLyrics: formattedLyrics.map((lyric, i) => {
                    if (i === _index) {
                      return {
                        ...lyric,
                        words: newWords,
                      };
                    } else {
                      return lyric;
                    }
                  }),
                  slides: updatedSlides,
                };
              } else {
                return arrangement;
              }
            }
          );

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
      }
    }
  };

  const _boxes =
    slides?.[selectedSlide]?.boxes ||
    arrangement?.slides[selectedSlide]?.boxes ||
    [];

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
                value={localName}
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
          ></Button>
        </section>
        <div
          className={cn(
            "flex transition-all relative max-lg:flex-col gap-2 max-lg:items-center",
            shouldShowItemEditor && "mb-2 z-[1]",
            !shouldShowItemEditor && "h-0 -z-[1]"
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
          <section
            className={cn(
              "ml-1 lg:w-[12vw] max-lg:w-[100%]",
              isEmpty && "hidden"
            )}
            ref={slideInfoRef}
          >
            <p className="text-center font-semibold border-b-2 border-black text-sm flex items-center gap-1 justify-center pb-1">
              <Icon svg={BoxIcon} color="#93c5fd" />
              Slide Boxes
            </p>
            {boxes.map((box, index) => {
              return (
                <span
                  key={box.id}
                  className={`flex gap-1 bg-gray-600 border-gray-300 ${
                    index !== boxes.length - 1 && "border-b"
                  } ${selectedBox === index && "bg-gray-800"}`}
                >
                  <Button
                    truncate
                    className="flex-1 text-xs hover:bg-gray-500"
                    variant="none"
                    onClick={() => dispatch(setSelectedBox(index))}
                  >
                    <p>
                      {box.label ||
                        box.words?.trim() ||
                        box.background?.replace(
                          /https:\/\/res\.cloudinary\.com\/.+\/.+\/upload\/v.+\/.+\//g,
                          ""
                        )}
                    </p>
                  </Button>
                  <Button
                    svg={isBoxLocked[index] ? Lock : Unlock}
                    color={isBoxLocked[index] ? "gray" : "green"}
                    variant="tertiary"
                    disabled={!canEdit}
                    onClick={() => {
                      setIsBoxLocked((prev) => {
                        const newLocked = [...prev];
                        newLocked[index] = !newLocked[index];
                        return newLocked;
                      });
                    }}
                  />
                  {canDeleteBox(index) && canEdit && (
                    <Button
                      svg={Trash2}
                      variant="tertiary"
                      color="red"
                      onClick={() => {
                        dispatch(
                          updateBoxes({
                            boxes: boxes.filter((b, i) => i !== index),
                          })
                        );
                        if (boxes[index - 1]) {
                          dispatch(setSelectedBox(index - 1));
                        } else {
                          dispatch(setSelectedBox(boxes.length - 1));
                        }
                      }}
                    />
                  )}
                </span>
              );
            })}
            {canEdit && (
              <Button
                className="text-xs w-full justify-center"
                svg={Plus}
                onClick={() => {
                  dispatch(
                    updateBoxes({
                      boxes: [
                        ...boxes,
                        createBox({
                          width: 75,
                          height: 75,
                          x: 12.5,
                          y: 12.5,
                        }),
                      ],
                    })
                  );
                  dispatch(setSelectedBox(boxes.length));
                }}
              >
                Add Box
              </Button>
            )}
          </section>
          {!isEmpty ? (
            <DisplayWindow
              showBorder
              boxes={boxes}
              selectBox={(val) => dispatch(setSelectedBox(val))}
              ref={editorRef}
              onChange={(onChangeInfo) => {
                onChange(onChangeInfo);
              }}
              width={isMobile ? 80 : 42}
              displayType="editor"
              selectedBox={selectedBox}
              isBoxLocked={isBoxLocked}
              disabled={!canEdit}
            />
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
