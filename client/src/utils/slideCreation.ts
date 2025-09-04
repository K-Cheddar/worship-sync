import {
  Box,
  SlideType,
  OverflowMode,
  FormattedTextDisplayInfo,
  MediaType,
} from "../types";
import generateRandomId from "./generateRandomId";

export const defaultFormattedTextDisplayInfo: FormattedTextDisplayInfo = {
  backgroundColor: "#eb8934",
  textColor: "#ffffff",
  fontSize: 1.5,
  paddingX: 2,
  paddingY: 1,
  align: "left",
  isBold: false,
  isItalic: false,
  text: "",
};

type CreateBoxType = {
  words?: string;
  id?: string;
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
  isBold?: boolean;
  isItalic?: boolean;
  mediaInfo?: MediaType;
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
  background,
  brightness,
  label,
  slideIndex,
  isBold,
  isItalic,
  mediaInfo,
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
    background: background ?? "",
    fontColor: fontColor ?? "rgba(255, 255, 255, 1)",
    shouldKeepAspectRatio: shouldKeepAspectRatio ?? false,
    words,
    transparent: transparent ?? false,
    excludeFromOverflow: excludeFromOverflow ?? false,
    align: align ?? "center",
    slideIndex: slideIndex ?? 0,
    label: label ?? "",
    isBold: isBold ?? false,
    isItalic: isItalic ?? false,
    mediaInfo: mediaInfo ?? undefined,
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
  isBold?: boolean;
  isItalic?: boolean;
  formattedTextDisplayInfo?: FormattedTextDisplayInfo;
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
  isBold,
  isItalic,
  formattedTextDisplayInfo,
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
        topMargin: 3,
        sideMargin: 4,
        align: "left",
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
        align: "center",
        topMargin: 1,
        sideMargin: 2,
        excludeFromOverflow: true,
        isBold: isBold ?? false,
        isItalic: isItalic ?? false,
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
        words: words ? words[0] : " ",
        isBold: isBold ?? false,
        isItalic: isItalic ?? false,
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
        words: words ? words[1] : " ",
      })
    );
  } else if (!boxes.length) {
    boxes.push(
      createBox({
        ...box,
      })
    );
    boxes.push(
      createBox({
        ...box,
        background: "",
        transparent: true,
        topMargin: 3,
        sideMargin: 4,
        words: words[1] || " ",
      })
    );
  }

  const obj = {
    type: type,
    name: name,
    boxes: JSON.parse(JSON.stringify(boxes)),
    id: generateRandomId(),
    ...(overflow && { overflow }),
    ...(formattedTextDisplayInfo && {
      formattedTextDisplayInfo: {
        ...defaultFormattedTextDisplayInfo,
        ...formattedTextDisplayInfo,
      },
    }),
  };

  if (typeof slideIndex === "number" && slideIndex >= 0)
    obj.boxes[1].slideIndex = slideIndex;
  if (fontSize) obj.boxes[1].fontSize = fontSize;
  if (background) obj.boxes[0].background = background;
  if (brightness) obj.boxes[0].brightness = brightness;

  return obj;
};
