import { Box } from "../types";
import generateRandomId from "./generateRandomId";

type CreateNewSlideType = {
  type: string;
  itemType?: string;
  box?: Box;
  words?: string[];
  slideIndex?: number;
  fontSize?: number;
  background?: string;
  brightness?: number;
  boxes?: Box[];
  textFontSize?: number;
};

export const createNewSlide = ({
  type,
  itemType,
  box,
  words = [],
  slideIndex,
  fontSize,
  background,
  brightness,
  boxes: _boxes,
  textFontSize,
}: CreateNewSlideType) => {
  if (!box)
    box = {
      brightness: 100,
      height: 100,
      width: 100,
      topMargin: 0,
      sideMargin: 0,
      x: 0,
      y: 0,
      fontSize: fontSize,
      id: generateRandomId(),
      isLocked: true,
      background: "",
      fontColor: "rgba(255, 255, 255, 1)",
      shouldKeepAspectRatio: false,
    };

  let boxes: Box[] = _boxes ? [..._boxes] : [];
  const newBoxes: Box[] = [];

  if (_boxes && words.length) {
    for (let i = 0; i < _boxes.length; ++i) {
      const box = {
        ..._boxes[i],
        words: words[i] ? words[i] : "",
        id: generateRandomId(),
      };
      newBoxes.push(box);
    }
  }

  if (itemType === "bible" && words.length === 3 && boxes.length !== 3) {
    boxes = newBoxes.map((box, index) => {
      if (index === 0) return box;
      return {
        ...box,
        height: 95,
        y: 5,
        width: 100,
        isLocked: true,
        topMargin: 3,
        sideMargin: 4,
      };
    });
    boxes.push({
      ...box,
      fontColor: "rgb(253 224 71)",
      fontSize: 1.5,
      height: 20,
      width: 100,
      words: words[2],
      isLocked: true,
      align: "left",
      topMargin: 1,
      sideMargin: 2,
      excludeFromOverflow: true,
    });
  } else if (newBoxes.length) {
    boxes = [...newBoxes];
  }

  if (type === "Announcement" && !boxes.length) {
    let obj = Object.assign({}, box);
    obj.words = " ";
    boxes.push(obj);
    obj = Object.assign({}, box);
    obj.height = 23;
    obj.fontSize = 2.1;
    obj.fontColor = "rgba(255, 251, 43, 1)";
    obj.transparent = true;
    obj.topMargin = 1;
    obj.sideMargin = 2.5;
    obj.excludeFromOverflow = true;
    obj.words = words ? words[0] : " ";
    boxes.push(obj);
    obj = Object.assign({}, box);
    obj.height = 77;
    obj.y = 23;
    obj.fontSize = textFontSize || 1.9;
    obj.align = "left";
    obj.transparent = true;
    obj.topMargin = 1;
    obj.sideMargin = 2.5;
    obj.excludeFromOverflow = true;
    obj.words = words ? words[1] : " ";
    boxes.push(obj);
  } else if (type === "timer" && !boxes.length) {
    let obj = Object.assign({}, box);
    obj.words = " ";
    obj.excludeFromOverflow = true;
    boxes.push(obj);
    obj = Object.assign({}, box);
    obj.transparent = true;
    obj.y = 30;
    obj.height = 35;
    obj.topMargin = 3;
    obj.sideMargin = 4;
    obj.words = words[0] || " ";
    boxes.push(obj);
  } else if (!boxes.length) {
    let obj = Object.assign({}, box);
    obj.words = " ";
    obj.excludeFromOverflow = true;
    obj.id = generateRandomId();
    boxes.push(obj);
    obj = Object.assign({}, box);
    obj.background = "";
    obj.transparent = true;
    obj.isLocked = false;
    obj.topMargin = 3;
    obj.sideMargin = 4;
    obj.words = words[1] || " ";
    boxes.push(obj);
  }

  let obj = {
    type: type,
    boxes: JSON.parse(JSON.stringify(boxes)),
    id: generateRandomId(),
  };

  // if(type === 'Announcement')
  // 	obj.duration = 15;
  // if(type === 'Announcement Title')
  // 	obj.duration = 5;

  if (typeof slideIndex === "number" && slideIndex >= 0)
    obj.boxes[1].slideIndex = slideIndex;
  if (fontSize) obj.boxes[1].fontSize = fontSize;
  if (background) obj.boxes[0].background = background;
  if (brightness) obj.boxes[0].brightness = brightness;

  return obj;
};
