import { Arrangment, Box, ItemSlide, UpdateItemState } from "../types";
import { createNewSlide } from "./slideCreation";

type getMaxLinesProps = {
  fontSize: number;
  height: number;
  topMargin?: number;
};

export const getMaxLines = ({
  fontSize,
  height,
  topMargin: _topMargin,
}: getMaxLinesProps) => {
  const newFontSize = fontSize + "vw";
  let windowWidth = window.innerWidth;
  let topMargin = _topMargin ? 1 - (_topMargin * 2) / 100 : 0.86;

  if (!height) height = 86;
  else height *= topMargin;
  height /= 100; // % -> decimal
  height = height * windowWidth * 0.239; //Height of Display Editor = 23.9vw

  let singleSpan = document.createElement("singleSpan");
  singleSpan.innerHTML = "Only Line";
  singleSpan.style.fontSize = newFontSize;
  singleSpan.style.fontFamily = "Verdana";
  singleSpan.style.position = "fixed";
  document.body.appendChild(singleSpan);
  let lineHeight = singleSpan.offsetHeight;
  document.body.removeChild(singleSpan);

  let maxLines = Math.floor(height / lineHeight);
  let obj = { maxLines: maxLines, lineHeight: lineHeight };
  return obj;
};

type getNumLinesProps = {
  text: string;
  fontSize: number;
  lineHeight: number;
  width: number;
  sideMargin?: number;
};

export const getNumLines = ({
  text,
  fontSize,
  lineHeight,
  width,
  sideMargin: _sideMargin,
}: getNumLinesProps) => {
  const newFontSize = fontSize + "vw";
  let windowWidth = window.innerWidth;
  let sideMargin = _sideMargin ? 1 - (_sideMargin * 2) / 100 : 0.9;
  if (!width) width = 90;
  else width *= sideMargin;
  width /= 100;
  width = width * windowWidth * 0.425; //Width of Display Editor = 42.5vw

  let textSpan = document.createElement("textSpan");
  textSpan.innerHTML = text;
  textSpan.style.fontSize = newFontSize;
  textSpan.style.fontFamily = "Verdana";
  textSpan.style.whiteSpace = "pre-wrap";
  textSpan.style.width = width + "px";
  textSpan.style.position = "fixed";
  textSpan.style.wordBreak = "break-word";
  // textSpan.style.zIndex = 10;
  document.body.appendChild(textSpan);
  let textSpanHeight = textSpan.offsetHeight;
  document.body.removeChild(textSpan);

  let lines = Math.floor(textSpanHeight / lineHeight);
  return lines;
};

type FormatSectionType = {
  text: string;
  type: string;
  slides: ItemSlide[];
  newSlides: ItemSlide[];
  lastBoxes: Box[];
  fontSize: number;
};

export const formatSection = ({
  text,
  type,
  slides,
  newSlides,
  lastBoxes,
  fontSize,
}: FormatSectionType) => {
  let lines = text.split("\n");
  let fLyrics = [];
  let currentBoxes = [];
  let boxes: Box[] = [];
  let box: Box = { width: 100, height: 100 };
  //lineContainer = {}
  let maxLines = 0,
    lineHeight = 0,
    lineCounter = 0,
    counter = 0;
  let boxWords = "";

  for (let i = 0; i < lines.length; ++i) {
    counter = 0;
    lineCounter = 0;
    boxWords = "";
    boxes = [];

    if (slides[newSlides.length + fLyrics.length])
      currentBoxes = slides[newSlides.length + fLyrics.length].boxes;
    else currentBoxes = lastBoxes;

    for (let j = 0; j < currentBoxes.length; ++j) {
      ({ maxLines, lineHeight } = getMaxLines({
        fontSize,
        height: currentBoxes[1].height,
      }));

      while (i + counter < lines.length && lineCounter < maxLines) {
        boxWords += lines[i + counter];
        if (i + counter < lines.length - 1) boxWords += "\n";

        let lineCount = getNumLines({
          text: lines[i + counter],
          fontSize,
          lineHeight,
          width: currentBoxes[1].width,
        });
        if (lineCount === 0) lineCount = 1;
        lineCounter += lineCount;
        counter++;
      }
      box = Object.assign({}, currentBoxes[j]);
      if (boxWords === "") boxWords = " ";
      box.words = boxWords;
      boxes.push(box);
    }
    boxes[0].words = " ";
    boxes[1].excludeFromOverflow = false;

    i += counter - 1;
    fLyrics.push(
      createNewSlide({
        type: type,
        boxes: boxes,
        fontSize: fontSize,
        slideIndex: fLyrics.length,
      })
    );
  }
  return fLyrics;
};

export const formatLyrics = (item: UpdateItemState) => {
  let slides = item.arrangements[item.selectedArrangement].slides || [];
  slides = [...slides];

  const boxes = slides[0].boxes;
  const lastSlide = slides.length - 1;
  const lastBoxes = slides[lastSlide].boxes;
  const newSlides = [
    createNewSlide({
      type: "Title",
      boxes: slides[0].boxes,
      words: boxes[0].words,
    }),
  ];
  const songOrder = item.arrangements[item.selectedArrangement].songOrder;
  const formattedLyrics =
    item.arrangements[item.selectedArrangement].formattedLyrics;
  const fontSize: number = slides[1] ? slides[1].boxes[1].fontSize || 2.5 : 2.5;

  for (let i = 0; i < songOrder.length; ++i) {
    let lyrics =
      formattedLyrics.find((e) => e.name === songOrder[i].name)?.words || "";
    newSlides.push(
      ...formatSection({
        text: lyrics,
        type: songOrder[i].name,
        slides,
        newSlides,
        lastBoxes,
        fontSize,
      })
    );
  }

  newSlides.push(createNewSlide({ type: "blank", box: lastBoxes[0] }));
  return newSlides;
};

export const formatSong = (_item: UpdateItemState) => {
  const item = {
    ..._item,
    arrangements: _item.arrangements.map((el, i): Arrangment => {
      if (i === _item.selectedArrangement) {
        return { ...el, slides: formatLyrics(_item) };
      }
      return el;
    }),
  };

  let slides = item.arrangements[item.selectedArrangement].slides;

  let songOrder = item.arrangements[item.selectedArrangement].songOrder;

  const formattedLyrics = item.arrangements[
    item.selectedArrangement
  ].formattedLyrics.map((ele) => {
    let type = ele.name;
    let counter = 0;
    let songOrderCounter = 0;
    let slideSpan = 0;

    for (let j = 0; j < songOrder.length; j++) {
      if (type === songOrder[j].name) ++songOrderCounter;
    }
    for (let j = 0; j < slides.length; j++) {
      if (type === slides[j].type) ++counter;
    }
    if (songOrderCounter !== 0) {
      slideSpan = counter / songOrderCounter;
    } else slideSpan = counter;
    return { ...ele, slideSpan };
  });

  item.arrangements[item.selectedArrangement] = {
    ...item.arrangements[item.selectedArrangement],
    formattedLyrics,
  };

  return item;
};
