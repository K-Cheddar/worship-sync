import Button from "../../components/Button/Button";
import cn from "classnames";
import { ReactComponent as LockSVG } from "../../assets/icons/lock.svg";
import { ReactComponent as UnlockSVG } from "../../assets/icons/unlock.svg";
import { ReactComponent as ExpandSVG } from "../../assets/icons/expand.svg";
import { ReactComponent as CollapseSVG } from "../../assets/icons/collapse.svg";
import { ReactComponent as EditSVG } from "../../assets/icons/edit.svg";
import { ReactComponent as EditTextSVG } from "../../assets/icons/edit-text.svg";
import { ReactComponent as CheckSVG } from "../../assets/icons/check.svg";
import { ReactComponent as CloseSVG } from "../../assets/icons/close.svg";
import { ReactComponent as BoxSVG } from "../../assets/icons/box.svg";
import { ReactComponent as DeleteSVG } from "../../assets/icons/delete.svg";
import { ReactComponent as AddSVG } from "../../assets/icons/add.svg";

import Input from "../../components/Input/Input";
import "./ItemEditor.scss";
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
  toggleEditMode,
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

const SlideEditor = () => {
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

  const { db, isMobile } = useContext(ControllerInfoContext) || {};

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
  }: {
    index: number;
    value: string;
    box: Box;
    cursorPosition?: number;
  }) => {
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

    const updatedItem = {
      ...item,
      slides: item.slides.map((slide, index) => {
        if (index === selectedSlide) {
          return { ...slide, boxes: newBoxes };
        }
        return slide;
      }),
    };

    if (type === "bible") {
      const _item = formatBible({
        item: updatedItem,
        mode: item.bibleInfo?.fontMode || "separate",
      });
      dispatch(updateSlides({ slides: _item.slides }));
    }

    if (type === "free") {
      const _item = formatFree({
        ...updatedItem,
      });
      dispatch(updateSlides({ slides: _item.slides }));
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
                  slides: slides.map((slide, i) => {
                    if (i === selectedSlide) {
                      return {
                        ...slide,
                        boxes: newBoxes,
                      };
                    } else {
                      return slide;
                    }
                  }),
                };
              } else {
                return arrangement;
              }
            }
          );

          const _item = formatSong({
            ...item,
            arrangements: updatedArrangements,
            selectedArrangement,
          });

          dispatch(updateArrangements({ arrangements: _item.arrangements }));
        }
      }
    }
  };

  let _boxes =
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
    <div>
      <section className="flex justify-end w-full pr-2 bg-gray-900 h-8 mb-1 gap-1 overflow-hidden">
        <span
          className={`slide-editor-song-name-container ${borderColorMap.get(
            type
          )}`}
        >
          {isEditingName && (
            <Button
              variant="tertiary"
              svg={CloseSVG}
              onClick={() => setIsEditingName(false)}
            />
          )}
          <Button
            variant="tertiary"
            disabled={isLoading}
            svg={isEditingName ? CheckSVG : EditSVG}
            onClick={
              isEditingName ? () => saveName() : () => setIsEditingName(true)
            }
          />
          {!isEditingName && (
            <span className="slide-editor-song-name">
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
              className="slide-editor-song-name"
              value={localName}
              onChange={(val) => setLocalName(val as string)}
              data-ignore-undo="true"
            />
          )}
        </span>
        {type === "song" && (
          <Button
            className="text-sm"
            disabled={isLoading}
            onClick={() => dispatch(toggleEditMode())}
            svg={EditTextSVG}
          >
            {isMobile ? "" : "Edit Lyrics"}
          </Button>
        )}
        <Button
          variant="tertiary"
          padding="p-1"
          svg={shouldShowItemEditor ? CollapseSVG : ExpandSVG}
          onClick={() =>
            dispatch(setShouldShowItemEditor(!shouldShowItemEditor))
          }
          className="text-xs"
        ></Button>
      </section>
      <div
        className="slide-editor-container"
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
            <Icon svg={BoxSVG} color="#93c5fd" />
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
                  svg={isBoxLocked[index] ? LockSVG : UnlockSVG}
                  color={isBoxLocked[index] ? "gray" : "green"}
                  variant="tertiary"
                  onClick={() => {
                    setIsBoxLocked((prev) => {
                      const newLocked = [...prev];
                      newLocked[index] = !newLocked[index];
                      return newLocked;
                    });
                  }}
                />
                {canDeleteBox(index) && (
                  <Button
                    svg={DeleteSVG}
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
          <Button
            className="text-xs w-full justify-center"
            svg={AddSVG}
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
          />
        ) : (
          <p
            id="slide-editor-empty"
            ref={emptySlideRef}
            className="slide-editor-empty"
          >
            No slide selected
          </p>
        )}
      </div>
    </div>
  );
};

export default SlideEditor;
