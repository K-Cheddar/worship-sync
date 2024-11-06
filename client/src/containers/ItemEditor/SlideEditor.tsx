import Button from "../../components/Button/Button";
import { ReactComponent as LockSVG } from "../../assets/icons/lock.svg";
import { ReactComponent as UnlockSVG } from "../../assets/icons/unlock.svg";
import { ReactComponent as ExpandSVG } from "../../assets/icons/expand.svg";
import { ReactComponent as CollapseSVG } from "../../assets/icons/collapse.svg";
import { ReactComponent as EditSVG } from "../../assets/icons/edit.svg";
import { ReactComponent as CheckSVG } from "../../assets/icons/check.svg";
import Input from "../../components/Input/Input";
import "./ItemEditor.scss";
import { useEffect, useState } from "react";
import { borderColorMap } from "../../utils/itemTypeMaps";
import DisplayWindow from "../../components/DisplayWindow/DisplayWindow";
import { useDispatch, useSelector } from "../../hooks";
import { toggleEditMode, updateArrangements } from "../../store/itemSlice";
import { setName, updateBoxes } from "../../store/itemSlice";
import { updateItemList } from "../../store/itemList";
import { updateAllItemsList } from "../../store/allItems";
import { formatSong } from "../../utils/overflow";
import { Box } from "../../types";

const SlideEditor = () => {
  const item = useSelector((state) => state.item);
  const {
    name,
    type,
    arrangements,
    selectedArrangement,
    selectedSlide,
    slides,
  } = item;
  const { list } = useSelector((state) => state.itemList);
  const { list: allItemsList } = useSelector((state) => state.allItems);
  const [showEditor, setShowEditor] = useState(true);
  const [isEditingName, setIsEditingName] = useState(false);
  const [localName, setLocalName] = useState(name);
  const arrangement = arrangements[selectedArrangement];

  const dispatch = useDispatch();

  useEffect(() => {
    setLocalName(name);
  }, [name]);

  const saveName = () => {
    setIsEditingName(false);
    dispatch(setName(localName));

    console.log(list, name, localName);

    const updatedList = list.map((item) => {
      if (item.name === name) {
        return {
          ...item,
          name: localName,
        };
      }
      return item;
    });

    const updatedAllItemsList = allItemsList.map((item) => {
      if (item.name === name) {
        return {
          ...item,
          name: localName,
        };
      }
      return item;
    });

    dispatch(updateAllItemsList(updatedAllItemsList));
    dispatch(updateItemList(updatedList));
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
    if (type === "bible") return;
    if (
      box.excludeFromOverflow ||
      selectedSlide === 0 ||
      selectedSlide === arrangements[selectedArrangement].slides.length - 1
    ) {
      dispatch(
        updateBoxes(
          boxes.map((b, i) => (i === index ? { ...b, words: value } : b))
        )
      );
    } else {
      const formattedLyrics =
        item.arrangements[item.selectedArrangement].formattedLyrics;
      const slides = item.arrangements[item.selectedArrangement].slides;
      const _index = formattedLyrics.findIndex(
        (e) => e.name === slides[selectedSlide].type
      );

      const start =
        selectedSlide - (slides[selectedSlide]?.boxes[index]?.slideIndex || 0);
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

        dispatch(updateArrangements(_item.arrangements));
        setTimeout(() => {
          const textBoxElement = document.getElementById(
            `display-box-text-${index}`
          ) as HTMLTextAreaElement;
          if (textBoxElement) {
            textBoxElement.selectionEnd = cursorPosition;
            textBoxElement.selectionStart = cursorPosition;
            textBoxElement.scrollTop = 0;
          }
        });
      }
    }
  };

  const boxes =
    slides?.[selectedSlide]?.boxes ||
    arrangement?.slides[selectedSlide]?.boxes ||
    [];

  return (
    <div>
      <section className="flex justify-end w-full pr-2 bg-slate-900 h-8 mb-1 gap-1 overflow-hidden">
        <span
          className={`slide-editor-song-name-container ${borderColorMap.get(
            type
          )}`}
        >
          <Button
            variant="tertiary"
            padding="px-4"
            svg={isEditingName ? CheckSVG : EditSVG}
            onClick={
              isEditingName ? () => saveName() : () => setIsEditingName(true)
            }
          />
          {!isEditingName && (
            <span className="slide-editor-song-name">
              <h2>{name}</h2>
              <p className="text-xs">({arrangement?.name})</p>
            </span>
          )}
          {isEditingName && (
            <Input
              hideLabel
              className="slide-editor-song-name"
              value={localName}
              onChange={(val) => setLocalName(val as string)}
            />
          )}
        </span>
        {type === "song" && (
          <Button
            className="text-sm"
            onClick={() => dispatch(toggleEditMode())}
          >
            Edit Lyrics
          </Button>
        )}
        <Button
          variant="tertiary"
          padding="p-0"
          svg={showEditor ? CollapseSVG : ExpandSVG}
          onClick={() => setShowEditor(!showEditor)}
          className="text-xs"
        ></Button>
      </section>
      {showEditor && (
        <div className="flex">
          <section className="w-[10vw]">
            <p className="text-center font-semibold border-b-2 border-black text-lg">
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
                    onClick={() =>
                      dispatch(
                        updateBoxes(
                          boxes.map((b, i) =>
                            i === index ? { ...b, isLocked: !b.isLocked } : b
                          )
                        )
                      )
                    }
                  />
                </span>
              );
            })}
          </section>
          <DisplayWindow
            showBorder
            boxes={boxes}
            onChange={(onChangeInfo) => {
              onChange(onChangeInfo);
            }}
            width={42}
            displayType="editor"
          />
        </div>
      )}
    </div>
  );
};

export default SlideEditor;
