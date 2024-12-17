import Button from "../../../components/Button/Button";

import { ReactComponent as BoxEditSVG } from "../../../assets/icons/box-edit.svg";

import textFull from "../../../assets/images/textbox_full.png";
import textLeftHalf from "../../../assets/images/textbox_leftHalf.png";
import textRightHalf from "../../../assets/images/textbox_rightHalf.png";
import textMatch from "../../../assets/images/textbox_match.png";
import textLowerThird from "../../../assets/images/textbox_lowerThird.png";
import textUpperThird from "../../../assets/images/textbox_upperThird.png";
import textMidThird from "../../../assets/images/textbox_midThird.png";

import { Box } from "../../../types";
import { useDispatch, useSelector } from "../../../hooks";
import { formatSong } from "../../../utils/overflow";
import { updateArrangements, updateBoxes } from "../../../store/itemSlice";
import { useMemo, useState } from "react";
import RadioButton from "../../../components/RadioButton/RadioButton";
import Icon from "../../../components/Icon/Icon";

const BoxEditor = () => {
  const item = useSelector((state) => state.undoable.present.item);
  const {
    type,
    arrangements,
    selectedArrangement,
    selectedSlide,
    selectedBox,
    slides,
  } = item;

  const boxes = useMemo(() => {
    return slides[selectedSlide].boxes;
  }, [slides, selectedSlide]);

  const dispatch = useDispatch();

  const [shouldApplyToAll, setShouldApplyToAll] = useState(false);

  const updateBoxSize = ({
    width,
    height,
    x,
    y,
  }: {
    width: number;
    height: number;
    x: number;
    y: number;
  }) => {
    const box: Box = { ...boxes[selectedBox], width, height, x, y };

    const newBoxes = boxes.map((b, i) =>
      i === selectedBox
        ? {
            ...b,
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
          }
        : b
    );
    // TODO : add support for free and bible
    // if (type === "free" || type === "bible") {
    //   dispatch(updateBoxes({ boxes: newBoxes }));
    //   return;
    // }

    if (type === "song") {
      if (
        box.excludeFromOverflow ||
        selectedSlide === 0 ||
        selectedSlide === arrangements[selectedArrangement]?.slides?.length - 1
      ) {
        dispatch(updateBoxes({ boxes: newBoxes }));
      } else {
        const slides = item.arrangements[item.selectedArrangement].slides;

        const updatedArrangements = item.arrangements.map(
          (arrangement, index) => {
            if (index === item.selectedArrangement) {
              return {
                ...arrangement,
                slides: slides.map((slide, i) => {
                  if (i === selectedSlide) {
                    return {
                      ...slide,
                      boxes: newBoxes,
                    };
                  } else if (shouldApplyToAll && i !== 0) {
                    // skip title slide
                    return {
                      ...slide,
                      boxes: slide.boxes.map((b, i) =>
                        i === selectedBox
                          ? {
                              ...b,
                              x: box.x,
                              y: box.y,
                              width: box.width,
                              height: box.height,
                            }
                          : b
                      ),
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
  };

  return (
    <ul className="flex flex-wrap gap-2 lg:border-r-2 lg:pr-2 max-lg:border-b-2 max-lg:pb-4 justify-center items-center">
      <li>
        <Icon svg={BoxEditSVG} size="lg" />
      </li>
      <li>
        <Button
          image={textFull}
          variant="tertiary"
          className="w-10"
          onClick={() =>
            updateBoxSize({
              width: 100,
              height: 100,
              x: 0,
              y: 0,
            })
          }
        />
      </li>
      <li>
        <Button
          image={textLeftHalf}
          variant="tertiary"
          className="w-10"
          onClick={() =>
            updateBoxSize({
              width: 50,
              height: 100,
              x: 0,
              y: 0,
            })
          }
        />
      </li>
      <li>
        <Button
          image={textRightHalf}
          variant="tertiary"
          className="w-10"
          onClick={() =>
            updateBoxSize({
              width: 50,
              height: 100,
              x: 50,
              y: 0,
            })
          }
        />
      </li>
      <li>
        <Button
          image={textLowerThird}
          variant="tertiary"
          className="w-10"
          onClick={() =>
            updateBoxSize({
              width: 100,
              height: 35,
              x: 0,
              y: 65,
            })
          }
        />
      </li>
      <li>
        <Button
          image={textMidThird}
          variant="tertiary"
          className="w-10"
          onClick={() =>
            updateBoxSize({
              width: 100,
              height: 35,
              x: 0,
              y: 35,
            })
          }
        />
      </li>
      <li>
        <Button
          image={textUpperThird}
          variant="tertiary"
          className="w-10"
          onClick={() =>
            updateBoxSize({
              width: 100,
              height: 35,
              x: 0,
              y: 0,
            })
          }
        />
      </li>
      <li>
        <Button
          image={textMatch}
          variant="tertiary"
          className="w-10"
          onClick={() =>
            updateBoxSize({
              width: boxes[selectedBox].width,
              height: boxes[selectedBox].height,
              x: boxes[selectedBox].x || 0,
              y: boxes[selectedBox].y || 0,
            })
          }
        />
      </li>
      <li>
        <RadioButton
          className="text-xs w-fit"
          label="Apply to selected"
          value={!shouldApplyToAll}
          onChange={() => setShouldApplyToAll(false)}
        />
      </li>
      <li>
        <RadioButton
          label="Apply to all"
          className="text-xs w-fit"
          value={shouldApplyToAll}
          onChange={() => setShouldApplyToAll(true)}
        />
      </li>
    </ul>
  );
};

export default BoxEditor;
