import Button from "../../components/Button/Button";
import { ReactComponent as LockSVG } from "../../assets/icons/lock.svg";
import { ReactComponent as UnlockSVG } from "../../assets/icons/unlock.svg";
import { ReactComponent as ExpandSVG } from "../../assets/icons/expand.svg";
import { ReactComponent as CollapseSVG } from "../../assets/icons/collapse.svg";
import { ReactComponent as EditSVG } from "../../assets/icons/edit.svg";
import { ReactComponent as CheckSVG } from "../../assets/icons/check.svg";
import { ReactComponent as CloseSVG } from "../../assets/icons/close.svg";
import Input from "../../components/Input/Input";
import "./ItemEditor.scss";
import {
  CSSProperties,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { borderColorMap } from "../../utils/itemTypeMaps";
import DisplayWindow from "../../components/DisplayWindow/DisplayWindow";
import { useDispatch, useSelector } from "../../hooks";
import { toggleEditMode, updateArrangements } from "../../store/itemSlice";
import { setName, updateBoxes } from "../../store/itemSlice";
import { formatSong } from "../../utils/overflow";
import { Box } from "../../types";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { setShouldShowItemEditor } from "../../store/preferencesSlice";

const SlideEditor = () => {
  const item = useSelector((state) => state.undoable.present.item);
  const {
    name,
    type,
    arrangements,
    selectedArrangement,
    selectedSlide,
    slides,
    isLoading,
  } = item;

  const { shouldShowItemEditor } = useSelector((state) => state.preferences);

  const [isEditingName, setIsEditingName] = useState(false);
  const [editorHeight, setEditorHeight] = useState(0);
  const [localName, setLocalName] = useState(name);
  const arrangement = arrangements[selectedArrangement];

  const slideInfoRef = useRef(null);

  const { db, isMobile } = useContext(ControllerInfoContext) || {};

  const editorRef = useCallback((node: HTMLUListElement) => {
    if (node) {
      const resizeObserver = new ResizeObserver((entries) => {
        setEditorHeight(entries[0].borderBoxSize[0].blockSize);
      });

      resizeObserver.observe(node);
    }
  }, []);

  const dispatch = useDispatch();

  useEffect(() => {
    setLocalName(name);
  }, [name]);

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
    cursorPosition: number;
  }) => {
    if (type === "bible" || !db) return;
    const newBoxes = boxes.map((b, i) =>
      i === index ? { ...b, words: value } : b
    );
    if (type === "free") {
      dispatch(updateBoxes({ boxes: newBoxes }));
      return;
    }
    if (type === "song") {
      if (
        box.excludeFromOverflow ||
        selectedSlide === 0 ||
        selectedSlide === arrangements[selectedArrangement]?.slides?.length - 1
      ) {
        dispatch(updateBoxes({ boxes: newBoxes }));
      } else {
        const formattedLyrics =
          item.arrangements[item.selectedArrangement].formattedLyrics;
        const slides = item.arrangements[item.selectedArrangement].slides;
        const _index = formattedLyrics.findIndex(
          (e) => e.name === slides[selectedSlide].type
        );

        const start =
          selectedSlide -
          (slides[selectedSlide]?.boxes[index]?.slideIndex || 0);
        const end = start + formattedLyrics[_index].slideSpan - 1;
        let newWords = "";

        for (let i = start; i <= end; ++i) {
          if (i === selectedSlide) newWords += value;
          else newWords += slides[i].boxes[index].words;
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
          setTimeout(() => {
            const textBoxElement = document.getElementById(
              `display-box-text-${index}`
            ) as HTMLTextAreaElement;
            if (textBoxElement) {
              textBoxElement.selectionEnd = cursorPosition;
              textBoxElement.selectionStart = cursorPosition;
              textBoxElement.scrollTop = 0;
            }
          }, 10);
        }
      }
    }
  };

  let _boxes =
    slides?.[selectedSlide]?.boxes ||
    arrangement?.slides[selectedSlide]?.boxes ||
    [];

  const boxes = isLoading ? [] : _boxes;

  return (
    <div>
      <section className="flex justify-end w-full pr-2 bg-slate-900 h-8 mb-1 gap-1 overflow-hidden">
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
            variant="tertiary"
            disabled={isLoading}
            onClick={() => dispatch(toggleEditMode())}
            svg={EditSVG}
          >
            Edit Lyrics
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
              : `${editorHeight}px`,
          } as CSSProperties
        }
      >
        <section className="md:w-[10vw] max-md:w-[100%]" ref={slideInfoRef}>
          <p className="text-center font-semibold border-b-2 border-black text-sm">
            Slide Content
          </p>
          {boxes.map((box, index) => {
            return (
              <span
                key={box.id}
                className={`flex gap-1 bg-slate-600 border-slate-300 ${
                  index !== boxes.length - 1 && "border-b"
                }`}
              >
                <Button
                  truncate
                  className="flex-1 text-xs hover:bg-slate-500"
                  variant="none"
                >
                  <p>{box.label || box.words?.trim() || box.background}</p>
                </Button>
                <Button
                  svg={box.isLocked ? LockSVG : UnlockSVG}
                  color={box.isLocked ? "gray" : "green"}
                  variant="tertiary"
                  onClick={() => {
                    dispatch(
                      updateBoxes({
                        boxes: boxes.map((b, i) =>
                          i === index ? { ...b, isLocked: !b.isLocked } : b
                        ),
                      })
                    );
                  }}
                />
              </span>
            );
          })}
        </section>
        <DisplayWindow
          showBorder
          boxes={boxes}
          ref={editorRef}
          onChange={(onChangeInfo) => {
            onChange(onChangeInfo);
          }}
          width={isMobile ? 84 : 42}
          displayType="editor"
        />
      </div>
    </div>
  );
};

export default SlideEditor;
