import {
  Arrangment,
  Box,
  ItemSlide,
  UpdateItemState,
  verseType,
} from "../types";
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
  let topMargin = _topMargin ? 1 - (_topMargin * 2) / 100 : 0.92;

  if (!height) height = 86;
  else height *= topMargin;
  height /= 100; // % -> decimal
  height = height * windowWidth * 0.23625; //Height of Display Editor = 23.625vw

  let singleSpan = document.createElement("singleSpan");
  singleSpan.innerHTML = "Only Line";
  singleSpan.style.fontSize = newFontSize;
  singleSpan.style.fontFamily = "Verdana";
  singleSpan.style.position = "fixed";
  singleSpan.style.lineHeight = "1.25";
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
  let sideMargin = _sideMargin ? 1 - (_sideMargin * 2) / 100 : 0.92;
  if (!width) width = 90;
  else width *= sideMargin;
  width /= 100;
  width = width * windowWidth * 0.42; //Width of Display Editor = 42vw

  let textSpan = document.createElement("textSpan");
  textSpan.innerHTML = text;
  textSpan.style.fontSize = newFontSize;
  textSpan.style.fontFamily = "Verdana";
  textSpan.style.whiteSpace = "pre-wrap";
  textSpan.style.width = width + "px";
  textSpan.style.position = "fixed";
  textSpan.style.wordBreak = "break-word";
  textSpan.style.lineHeight = "1.25";
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
      words: [boxes[0].words || " "],
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

type formatBibleType = {
  item: UpdateItemState;
  mode: "create" | "edit" | "fit";
  verses: verseType[];
};
export const formatBible = ({ item, mode, verses }: formatBibleType) => {
  let slides = item.arrangements[item.selectedArrangement].slides;
  let boxes = slides[0].boxes;
  let newSlides = [
    createNewSlide({
      type: "Title",
      fontSize: 4.5,
      words: [boxes[1].words || " "],
      background: boxes[0].background,
      brightness: boxes[0].brightness,
    }),
  ];
  if (verses) newSlides.push(...formatBibleVerses({ verses, item, mode }));
  else newSlides.push(...formatBibleVerses({ verses: [], item, mode }));

  item.arrangements[item.selectedArrangement] = {
    ...item.arrangements[item.selectedArrangement],
    slides: newSlides,
  };
  return item;
};

type formatBibleVersesType = {
  verses: verseType[];
  item: UpdateItemState;
  mode: "create" | "edit" | "fit";
};
const formatBibleVerses = ({ verses, item, mode }: formatBibleVersesType) => {
  let slides = item.arrangements[item.selectedArrangement].slides;
  let currentSlide = slides[1];
  // let allBoxes = slides.flatMap(x => x.boxes);
  // let overflowBoxes = allBoxes.filter(e => !e.excludeFromOverflow)
  let currentBoxes = [...currentSlide.boxes];
  let { maxLines, lineHeight } = getMaxLines({
    fontSize: currentBoxes[1].fontSize || 1,
    height: currentBoxes[1].height,
  });
  let formattedVerses = [];
  let slide = "";
  let type = currentSlide.type;
  let fitProcessing = true;

  if (mode === "create") {
    for (let i = 0; i < verses.length; ++i) {
      const verse = verses[i];
      let words = verse.text?.split(" ") || [];
      if (slide[slide.length - 1] === " ")
        slide = slide.substring(0, slide.length - 1);
      slide += "{" + verse.name + "}";

      for (let j = 0; j < words.length; j++) {
        let update = slide + words[j];
        if (
          getNumLines({
            text: update,
            fontSize: currentBoxes[1].fontSize || 1,
            lineHeight,
            width: currentBoxes[1].width,
          }) <= maxLines
        )
          slide = update + " ";
        else {
          slide = slide.replace(/\s+/g, " ").trim();
          formattedVerses.push(
            createNewSlide({
              type: "Verse " + verse.name,
              boxes: currentBoxes,
              words: ["", slide],
            })
          );
          slide = words[j] + " ";
        }
      }
      formattedVerses.push(
        createNewSlide({
          type: "Verse " + verse.name,
          boxes: currentBoxes,
          words: ["", slide],
        })
      );
      slide = " ";
    }
  }

  if (mode === "fit") {
    while (fitProcessing) {
      verseLoop: for (let i = 0; i < verses.length; ++i) {
        const verse = verses[i];
        let words = verse.text?.split(" ") || [];
        if (slide[slide.length - 1] === " ")
          slide = slide.substring(0, slide.length - 1);
        slide += "{" + verse.name + "}";

        for (let j = 0; j < words.length; j++) {
          let update = slide + words[j];
          if (
            getNumLines({
              text: update,
              fontSize: currentBoxes[1].fontSize || 1,
              lineHeight,
              width: currentBoxes[1].width,
            }) <= maxLines
          )
            slide = update + " ";
          else {
            currentBoxes[1].fontSize = (currentBoxes[1].fontSize || 1) - 0.1;
            ({ maxLines, lineHeight } = getMaxLines({
              fontSize: currentBoxes[1].fontSize,
              height: currentBoxes[1].height,
            }));
            formattedVerses = [];
            slide = "";
            break verseLoop;
          }
        }
        formattedVerses.push(
          createNewSlide({
            type: "Verse " + verse.name,
            boxes: currentBoxes,
            words: ["", slide],
          })
        );
        fitProcessing = false;
      }
    }
  }

  if (mode === "edit") {
    for (let i = 1; i < slides.length; ++i) {
      currentSlide = slides[i];
      currentBoxes = currentSlide.boxes;
      let words = currentBoxes[1].words?.split(" ") || [];
      if (type !== currentSlide.type) {
        slide = slide.replace(/\s+/g, " ").trim();
        formattedVerses.push(
          createNewSlide({
            type: type,
            boxes: currentBoxes,
            words: ["", slide],
          })
        );
        slide = "";
      }
      type = currentSlide.type;
      ({ maxLines, lineHeight } = getMaxLines({
        fontSize: currentBoxes[1].fontSize || 1,
        height: currentBoxes[1].height,
      }));

      for (let k = 0; k < words.length; k++) {
        let update = slide + words[k];
        if (
          getNumLines({
            text: update,
            fontSize: currentBoxes[1].fontSize || 1,
            lineHeight,
            width: currentBoxes[1].width,
          }) <= maxLines
        )
          slide = update + " ";
        else {
          slide = slide.replace(/\s+/g, " ").trim();
          formattedVerses.push(
            createNewSlide({
              type: type,
              boxes: currentBoxes,
              words: ["", slide],
            })
          );
          slide = words[k] + " ";
        }
      }
    }
  }

  formattedVerses.push(
    createNewSlide({
      type: "blank",
      boxes: currentBoxes,
      words: ["", " "],
    })
  );

  return formattedVerses;
};
