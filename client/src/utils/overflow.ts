import { Arrangment, Box, ItemSlide, ItemState, verseType } from "../types";
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
  let verticalMargin = _topMargin ? (_topMargin * 2) / 100 : 0.06;
  const containerHeight = windowWidth * 0.23625;
  const marginCalc = windowWidth * 0.42 * verticalMargin; // use window width to calculate margin

  if (!height) height = 90;
  const calcHeight = containerHeight * (height / 100) - marginCalc;

  let singleSpan = document.createElement("singleSpan");
  singleSpan.innerHTML = "Only Line";
  singleSpan.style.fontSize = newFontSize;
  singleSpan.style.fontFamily = "Verdana";
  singleSpan.style.overflowWrap = "anywhere";
  singleSpan.style.position = "fixed";
  singleSpan.style.lineHeight = "1.25";
  document.body.appendChild(singleSpan);
  let lineHeight = singleSpan.offsetHeight;
  document.body.removeChild(singleSpan);

  let maxLines = Math.floor(calcHeight / lineHeight);
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
  if (!width) width = 95;
  else width *= sideMargin;
  width /= 100;
  width = width * windowWidth * 0.42; //Width of Display Editor = 42vw

  let textSpan = document.createElement("textSpan");
  textSpan.innerHTML = text;
  textSpan.style.fontSize = newFontSize;
  textSpan.style.fontFamily = "Verdana";
  textSpan.style.overflowWrap = "anywhere";
  textSpan.style.whiteSpace = "pre-wrap";
  textSpan.style.width = width + "px";
  textSpan.style.position = "fixed";
  textSpan.style.wordBreak = "break-word";
  textSpan.style.lineHeight = "1.25";
  // textSpan.style.zIndex = "10";
  // textSpan.style.top = "0";
  document.body.appendChild(textSpan);
  let textSpanHeight = textSpan.offsetHeight;
  document.body.removeChild(textSpan);

  let lines = Math.round(textSpanHeight / lineHeight);
  return lines;
};

type FormatSectionType = {
  text: string;
  type: string;
  name: string;
  slides: ItemSlide[];
  newSlides: ItemSlide[];
  lastBoxes: Box[];
  fontSize: number;
  fontColor?: string;
};

export const formatSection = ({
  text,
  type,
  name,
  slides,
  newSlides,
  lastBoxes,
  fontSize,
  fontColor,
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
    boxes[1].brightness = 100; // todo fix brightness on added slides without this line

    i += counter - 1;
    fLyrics.push(
      createNewSlide({
        type: "Section",
        name: name,
        boxes: boxes,
        fontSize: fontSize,
        fontColor: fontColor,
        slideIndex: fLyrics.length,
      })
    );
  }
  return fLyrics;
};

export const formatLyrics = (item: ItemState) => {
  const selectedArrangement = item.selectedArrangement || 0;
  const arrangements = item.arrangements || [];
  let slides = arrangements[selectedArrangement].slides || [];

  const boxes = slides[0].boxes;
  const lastSlide = slides.length - 1;
  const lastBoxes = slides[lastSlide].boxes;
  const newSlides = [
    createNewSlide({
      type: "Title",
      name: "Title",
      boxes,
      words: ["", boxes[1].words || " "],
      fontSize: boxes[1].fontSize || 4.5,
      fontColor: boxes[1].fontColor || "rgb(255, 255, 255)",
    }),
  ];
  const songOrder = arrangements[selectedArrangement].songOrder;
  const formattedLyrics = arrangements[selectedArrangement].formattedLyrics;
  const fontSize: number = slides[1] ? slides[1].boxes[1].fontSize || 2.5 : 2.5;
  const fontColor: string = slides[1]
    ? slides[1].boxes[1].fontColor || "rgb(255, 255, 255)"
    : "rgb(255, 255, 255)";

  for (let i = 0; i < songOrder.length; ++i) {
    let lyrics =
      formattedLyrics.find((e) => e.name === songOrder[i].name)?.words || "";
    newSlides.push(
      ...formatSection({
        text: lyrics,
        type: songOrder[i].name,
        name: songOrder[i].name,
        slides,
        newSlides,
        lastBoxes,
        fontSize,
        fontColor,
      })
    );
  }

  newSlides.push(createNewSlide({ type: "Blank", boxes: lastBoxes }));
  return newSlides;
};

export const formatSong = (_item: ItemState) => {
  const item = {
    ..._item,
    arrangements: _item.arrangements
      ? _item.arrangements.map((el, i): Arrangment => {
          if (i === _item.selectedArrangement) {
            return { ...el, slides: formatLyrics(_item) };
          }
          return el;
        })
      : [],
  };
  const selectedArrangement = item.selectedArrangement || 0;

  let slides = item.arrangements[selectedArrangement].slides;

  let songOrder = item.arrangements[selectedArrangement].songOrder;

  const formattedLyrics = item.arrangements[
    selectedArrangement
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

  item.arrangements[selectedArrangement] = {
    ...item.arrangements[selectedArrangement],
    formattedLyrics,
  };

  item.slides = [...slides];

  return item;
};

type formatBibleType = {
  item: ItemState;
  mode: "add" | "fit";
  verses?: verseType[];
  book?: string;
  chapter?: string;
  version?: string;
  background?: string;
  brightness?: number;
};
export const formatBible = ({
  item,
  mode,
  verses,
  book,
  chapter,
  version,
  background,
  brightness,
}: formatBibleType): ItemState => {
  let slides = item.slides.length
    ? item.slides
    : [
        createNewSlide({
          type: "Title",
          fontSize: 4.5,
          words: ["", item.name],
          background,
          brightness,
        }),
        createNewSlide({
          type: "Verse",
          fontSize: 2.5,
          background,
          brightness,
        }),
      ];
  let boxes = slides[0]?.boxes || [];
  let newSlides = [
    createNewSlide({
      type: "Title",
      fontSize: boxes[1]?.fontSize || 4.5,
      words: ["", boxes[1]?.words || " "],
      background: boxes[0]?.background || background,
      brightness: boxes[0]?.brightness || brightness,
    }),
  ];
  let _item = {
    ...item,
    background: item.background || background,
    slides: [...slides],
  };

  const _book = book || item.bibleInfo?.book || "";
  const _chapter = chapter || item.bibleInfo?.chapter || "";
  const _version = version || item.bibleInfo?.version || "";
  const _verses = verses || item.bibleInfo?.verses || [];

  if (_verses.length)
    newSlides.push(
      ...formatBibleVerses({
        verses: _verses,
        item: _item,
        mode,
        book: _book,
        chapter: _chapter,
        version: _version,
      })
    );
  else
    newSlides.push(
      ...formatBibleVerses({
        verses: [],
        item: _item,
        mode,
        book: _book,
        chapter: _chapter,
        version: _version,
      })
    );

  _item.slides = [...newSlides];

  return {
    ..._item,
    bibleInfo: {
      book: _book,
      chapter: _chapter,
      version: _version,
      verses: _verses,
    },
  };
};

type GetBibleNameType = {
  book: string | undefined;
  chapter: string | undefined;
  verse: string | undefined;
  version: string | undefined;
};
const getBibleName = ({ book, chapter, verse, version }: GetBibleNameType) =>
  `${book} ${chapter}:${verse} ${version?.toUpperCase()}`;

type formatBibleVersesType = {
  verses?: verseType[];
  item: ItemState;
  mode: "add" | "fit";
  book?: string;
  chapter?: string;
  version?: string;
};
const formatBibleVerses = ({
  verses,
  item,
  mode,
  book,
  chapter,
  version,
}: formatBibleVersesType) => {
  let slides = item.slides || [];
  let currentSlide: ItemSlide = slides[1] || {};
  // let allBoxes = slides.flatMap(x => x.boxes);
  // let overflowBoxes = allBoxes.filter(e => !e.excludeFromOverflow)
  let currentBoxes = [...currentSlide.boxes];
  let { maxLines, lineHeight } = getMaxLines({
    fontSize: currentBoxes[1].fontSize || 1,
    height: 95,
  });
  let formattedVerses = [];
  let slide = "";
  // let type = currentSlide.type;
  let fitProcessing = true;

  if (mode === "add" && verses) {
    for (let i = 0; i < verses.length; ++i) {
      const verse = verses[i];
      let words = verse.text?.split(" ") || [];

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
              type: "Verse",
              name: "Verse " + verse.name,
              itemType: "bible",
              boxes: currentBoxes,
              words: [
                "",
                slide,
                getBibleName({ book, chapter, verse: verse.name, version }),
              ],
            })
          );
          slide = words[j] + " ";
        }
      }
      formattedVerses.push(
        createNewSlide({
          itemType: "bible",
          type: "Verse",
          name: "Verse " + verse.name,
          boxes: currentBoxes,
          words: [
            "",
            slide,
            getBibleName({ book, chapter, verse: verse.name, version }),
          ],
        })
      );
      slide = " ";
    }
  }

  if (mode === "fit" && verses) {
    while (fitProcessing) {
      verseLoop: for (let i = 0; i < verses.length; ++i) {
        const verse = verses[i];
        let words = verse.text?.split(" ") || [];
        if (slide[slide.length - 1] === " ")
          slide = slide.substring(0, slide.length - 1);

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
              height: 95,
            }));
            formattedVerses = [];
            slide = "";
            break verseLoop;
          }
        }
        formattedVerses.push(
          createNewSlide({
            itemType: "bible",
            type: "Verse",
            name: "Verse " + verse.name,
            boxes: currentBoxes,
            words: [
              "",
              slide,
              getBibleName({ book, chapter, verse: verse.name, version }),
            ],
          })
        );
        fitProcessing = false;
      }
    }
  }

  formattedVerses.push(
    createNewSlide({
      type: "Blank",
      boxes: currentBoxes,
      words: ["", " "],
    })
  );

  return formattedVerses;
};
