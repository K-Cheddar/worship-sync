import { Box, SlideType, OverflowMode } from "../types";
import generateRandomId from "./generateRandomId";

type CreateBoxType = {
  words?: string;
  id?: string;
  isLocked?: boolean;
  background?: string;
  width?: number;
  height?: number;
  label?: string;
  fontSize?: number;
  align?: "left" | "right" | "center";
  brightness?: number;
  x?: number;
  y?: number;
  fontColor?: string;
  shouldKeepAspectRatio?: boolean;
  excludeFromOverflow?: boolean;
  transparent?: boolean;
  topMargin?: number;
  sideMargin?: number;
  slideIndex?: number;
};

export const createBox = ({
  id,
  words = " ",
  height,
  width,
  x,
  y,
  fontSize,
  fontColor,
  transparent,
  topMargin,
  sideMargin,
  excludeFromOverflow,
  align,
  shouldKeepAspectRatio,
  isLocked,
  background,
  brightness,
  label,
  slideIndex,
}: CreateBoxType): Box => {
  return {
    brightness: brightness ?? 100,
    height: height ?? 100,
    width: width ?? 100,
    topMargin: topMargin ?? 0,
    sideMargin: sideMargin ?? 0,
    x: x ?? 0,
    y: y ?? 0,
    fontSize: fontSize ?? 2.5,
    id: generateRandomId(),
    isLocked: isLocked ?? true,
    background: background ?? "",
    fontColor: fontColor ?? "rgba(255, 255, 255, 1)",
    shouldKeepAspectRatio: shouldKeepAspectRatio ?? false,
    words,
    transparent: transparent ?? false,
    excludeFromOverflow: excludeFromOverflow ?? false,
    align: align ?? "center",
    slideIndex: slideIndex ?? 0,
    label: label ?? "",
  };
};

type CreateNewSlideType = {
  type: SlideType;
  name?: string;
  itemType?: string;
  box?: Box;
  words?: string[];
  slideIndex?: number;
  fontSize?: number;
  background?: string;
  brightness?: number;
  boxes?: Box[];
  textFontSize?: number;
  fontColor?: string;
  overflow?: OverflowMode;
};

export const createNewSlide = ({
  type,
  name = type,
  itemType,
  box,
  words = [],
  slideIndex,
  fontSize,
  background,
  brightness,
  boxes: _boxes,
  textFontSize,
  fontColor,
  overflow,
}: CreateNewSlideType) => {
  const defaultBox = createBox({});

  if (!box) {
    box = defaultBox;
  }

  let boxes: Box[] = _boxes ? [..._boxes] : [];
  const newBoxes: Box[] = [];

  if (_boxes && words.length) {
    for (let i = 0; i < _boxes.length; ++i) {
      const box = createBox({
        ..._boxes[i],
        words: words[i] ? words[i] : "",
      });
      newBoxes.push(box);
    }
  }

  if (itemType === "bible" && words.length === 3 && boxes.length !== 3) {
    boxes = newBoxes.map((box, index) => {
      if (index === 0) return box;
      return createBox({
        ...box,
        height: 92,
        y: 8,
        width: 100,
        isLocked: true,
        topMargin: 3,
        sideMargin: 4,
      });
    });
    boxes.push(
      createBox({
        ...box,
        fontColor: fontColor || "#fde047",
        fontSize: 2,
        height: 20,
        width: 100,
        words: words[2],
        isLocked: true,
        align: "left",
        topMargin: 1,
        sideMargin: 2,
        excludeFromOverflow: true,
      })
    );
  } else if (newBoxes.length) {
    boxes = [...newBoxes];
  }

  if (type === "Announcement" && !boxes.length) {
    boxes.push(createBox({ ...box }));
    boxes.push(
      createBox({
        ...box,
        height: 23,
        fontSize: 2.1,
        fontColor: fontColor || "rgba(255, 251, 43, 1)",
        transparent: true,
        topMargin: 1,
        sideMargin: 2.5,
        excludeFromOverflow: true,
        words: words ? words[0] : " ",
      })
    );
    boxes.push(
      createBox({
        ...box,
        height: 77,
        y: 23,
        fontSize: textFontSize || 1.9,
        align: "left",
        transparent: true,
        topMargin: 1,
        sideMargin: 2.5,
        excludeFromOverflow: true,
        words: words ? words[1] : " ",
      })
    );
  } else if (!boxes.length) {
    boxes.push(
      createBox({
        ...box,
        excludeFromOverflow: true,
      })
    );
    boxes.push(
      createBox({
        ...box,
        background: "",
        transparent: true,
        isLocked: true,
        topMargin: 3,
        sideMargin: 4,
        words: words[1] || " ",
      })
    );
  }

  let obj = {
    type: type,
    name: name,
    boxes: JSON.parse(JSON.stringify(boxes)),
    id: generateRandomId(),
    ...(overflow && { overflow }),
  };

  if (typeof slideIndex === "number" && slideIndex >= 0)
    obj.boxes[1].slideIndex = slideIndex;
  if (fontSize) obj.boxes[1].fontSize = fontSize;
  if (background) obj.boxes[0].background = background;
  if (brightness) obj.boxes[0].brightness = brightness;

  return obj;
};
