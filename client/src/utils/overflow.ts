import {
  Arrangment,
  Box,
  ItemSlide,
  ItemState,
  SlideType,
  verseType,
  BibleFontMode,
} from "../types";
import { getLetterFromIndex } from "./generalUtils";
import { createNewSlide } from "./slideCreation";

type getMaxLinesProps = {
  fontSize: number;
  height: number;
  topMargin?: number;
};

type MaxLinesResult = {
  maxLines: number;
  lineHeight: number;
};

/**
 * Calculates the maximum number of lines that can fit in a container based on font size and height
 * @param props.fontSize - Font size in viewport width units (vw)
 * @param props.height - Container height percentage (0-100)
 * @param props.topMargin - Optional top margin percentage
 * @returns Object containing maxLines and lineHeight
 */
export const getMaxLines = ({
  fontSize,
  height,
  topMargin: _topMargin,
}: getMaxLinesProps): MaxLinesResult => {
  try {
    const fontSizeVw = `${fontSize}vw`;
    const windowWidth = window.innerWidth;
    const verticalMargin = _topMargin ? (_topMargin * 2) / 100 : 0.06;
    const containerHeight = windowWidth * 0.23625;
    const marginCalc = windowWidth * 0.42 * verticalMargin;

    const containerHeightPx = containerHeight * (height / 100) - marginCalc;

    // Create a temporary span to measure line height
    const measureSpan = document.createElement("span");
    measureSpan.style.cssText = `
      font-size: ${fontSizeVw};
      font-family: Verdana;
      overflow-wrap: anywhere;
      position: fixed;
      line-height: 1.25;
      visibility: hidden;
    `;
    measureSpan.textContent = "Only Line";

    document.body.appendChild(measureSpan);
    const lineHeight = measureSpan.offsetHeight;
    document.body.removeChild(measureSpan);

    const maxLines = Math.floor(containerHeightPx / lineHeight);

    return {
      maxLines: Math.max(1, maxLines), // Ensure at least 1 line
      lineHeight,
    };
  } catch (error) {
    console.error("Error calculating max lines:", error);
    // Return safe default values
    return {
      maxLines: 1,
      lineHeight: fontSize * 1.25, // Approximate line height based on font size
    };
  }
};

type getNumLinesProps = {
  text: string;
  fontSize: number;
  lineHeight: number;
  width: number;
  sideMargin?: number;
};

/**
 * Calculates the number of lines a text will occupy based on its content and container properties
 * @param props.text - The text content to measure
 * @param props.fontSize - Font size in viewport width units (vw)
 * @param props.lineHeight - Line height in pixels
 * @param props.width - Container width percentage (0-100)
 * @param props.sideMargin - Optional side margin percentage
 * @returns Number of lines the text will occupy
 */
export const getNumLines = ({
  text,
  fontSize,
  lineHeight,
  width,
  sideMargin: _sideMargin,
}: getNumLinesProps): number => {
  try {
    const fontSizeVw = `${fontSize}vw`;
    const windowWidth = window.innerWidth;
    const sideMargin = _sideMargin ? 1 - (_sideMargin * 2) / 100 : 0.92;

    // Calculate container width in pixels
    const containerWidth =
      (((width || 95) * sideMargin) / 100) * windowWidth * 0.42;

    // Create a temporary span to measure text height
    const measureSpan = document.createElement("span");
    measureSpan.style.cssText = `
      font-size: ${fontSizeVw};
      font-family: Verdana;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
      width: ${containerWidth}px;
      position: fixed;
      word-break: break-word;
      line-height: 1.25;
      visibility: hidden;
    `;
    measureSpan.textContent = text;

    document.body.appendChild(measureSpan);
    const textHeight = measureSpan.offsetHeight;
    document.body.removeChild(measureSpan);

    // Ensure at least 1 line is returned
    return Math.max(1, Math.round(textHeight / lineHeight));
  } catch (error) {
    console.error("Error calculating number of lines:", error);
    // Return safe default value
    return 1;
  }
};

const formatVerseRange = (verses: verseType[]): string => {
  if (verses.length === 0) return "";
  if (verses.length === 1) return verses[0].name;

  const numbers = verses.map((v) => parseInt(v.name));
  const ranges: string[] = [];
  let start = numbers[0];
  let prev = numbers[0];

  for (let i = 1; i <= numbers.length; i++) {
    if (i === numbers.length || numbers[i] !== prev + 1) {
      ranges.push(start === prev ? start.toString() : `${start}-${prev}`);
      if (i < numbers.length) {
        start = numbers[i];
      }
    }
    if (i < numbers.length) {
      prev = numbers[i];
    }
  }

  return ranges.join(", ");
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
        type: type as SlideType,
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
        type: songOrder[i].name?.split(" ")[0] as SlideType,
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
      if (type === slides[j].name) ++counter;
    }
    if (songOrderCounter !== 0) {
      slideSpan = counter / songOrderCounter;
    } else slideSpan = counter;
    return { ...ele, slideSpan };
  });

  const updatedSlides = slides.map((slide, index) => {
    const formattedLyric = formattedLyrics.find((e) => e.name === slide.name);
    if (!formattedLyric || formattedLyric.slideSpan < 2) return slide;

    // Count how many times this slide name has appeared before this index
    const occurrenceIndex =
      slides.slice(0, index + 1).filter((s) => s.name === slide.name).length -
      1;

    return {
      ...slide,
      name: `${slide.name}${getLetterFromIndex(occurrenceIndex)}`,
    };
  });

  item.arrangements[selectedArrangement] = {
    ...item.arrangements[selectedArrangement],
    formattedLyrics,
    slides: updatedSlides,
  };

  return { ...item, slides: updatedSlides };
};

type formatBibleType = {
  item: ItemState;
  mode: BibleFontMode;
  verses?: verseType[];
  book?: string;
  chapter?: string;
  version?: string;
  background?: string;
  brightness?: number;
  isNew?: boolean;
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
  isNew,
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
        isNew,
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
        isNew,
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
      fontMode: mode,
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
  mode: BibleFontMode;
  isNew?: boolean;
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
  isNew,
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

  if (mode === "equal" && verses) {
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
                "\u200B" + verse.name + ".\u200B " + slide,
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
            "\u200B" + verse.name + ".\u200B " + slide,
            getBibleName({ book, chapter, verse: verse.name, version }),
          ],
        })
      );
      slide = " ";
    }
  }

  if (mode === "fit" && verses) {
    for (let i = 0; i < verses.length; ++i) {
      const verse = verses[i];
      let words = verse.text?.split(" ") || [];
      let slide = "";
      let currentFontSize = 2.5;
      let fitProcessing = true;

      while (fitProcessing) {
        let tempSlide = "";
        for (let j = 0; j < words.length; j++) {
          let update = tempSlide + words[j];
          if (
            getNumLines({
              text: update,
              fontSize: currentFontSize,
              lineHeight,
              width: currentBoxes[1].width,
            }) <= maxLines
          )
            tempSlide = update + " ";
          else {
            currentFontSize -= 0.1;
            ({ maxLines, lineHeight } = getMaxLines({
              fontSize: currentFontSize,
              height: 95,
            }));
            tempSlide = "";
            break;
          }
        }
        if (tempSlide) {
          slide = tempSlide;
          fitProcessing = false;
        }
      }

      formattedVerses.push(
        createNewSlide({
          itemType: "bible",
          type: "Verse",
          name: "Verse " + verse.name,
          boxes: isNew
            ? [
                currentBoxes[0],
                { ...currentBoxes[1], fontSize: currentFontSize },
              ]
            : [
                currentBoxes[0],
                { ...currentBoxes[1], fontSize: currentFontSize },
                currentBoxes[2],
              ],
          words: [
            "",
            "\u200B" + verse.name + ".\u200B " + slide,
            getBibleName({ book, chapter, verse: verse.name, version }),
          ],
        })
      );
    }
  }

  if (mode === "multiple" && verses) {
    let currentSlide = "";
    let currentVerses: verseType[] = [];
    let currentFontSize = currentBoxes[1]?.fontSize || 2.5;

    for (let i = 0; i < verses.length; ++i) {
      const verse = verses[i];
      if (!verse?.text) continue; // Skip verses without text

      let verseText = "\u200B" + verse.name + ".\u200B " + verse.text;
      let testSlide = currentSlide ? currentSlide + " " + verseText : verseText;

      // Check if the entire verse fits on the current slide
      if (
        getNumLines({
          text: testSlide,
          fontSize: currentFontSize,
          lineHeight,
          width: currentBoxes[1]?.width || 95,
        }) <= maxLines
      ) {
        // Verse fits, add it to current slide
        currentSlide = testSlide;
        currentVerses.push(verse);
      } else {
        // Verse doesn't fit, create new slide with current content
        if (currentSlide) {
          formattedVerses.push(
            createNewSlide({
              itemType: "bible",
              type: "Verse",
              name: "Verses " + formatVerseRange(currentVerses),
              boxes: isNew
                ? [
                    currentBoxes[0],
                    { ...currentBoxes[1], fontSize: currentFontSize },
                  ]
                : [
                    currentBoxes[0],
                    { ...currentBoxes[1], fontSize: currentFontSize },
                    currentBoxes[2],
                  ],
              words: [
                "",
                currentSlide,
                getBibleName({
                  book,
                  chapter,
                  verse: formatVerseRange(currentVerses),
                  version,
                }),
              ],
            })
          );
        }
        // Start new slide with the verse that didn't fit
        currentSlide = verseText;
        currentVerses = [verse];
      }
    }

    // Add the last slide if there are remaining verses
    if (currentSlide && currentVerses.length > 0) {
      formattedVerses.push(
        createNewSlide({
          itemType: "bible",
          type: "Verse",
          name: "Verses " + formatVerseRange(currentVerses),
          boxes: isNew
            ? [
                currentBoxes[0],
                { ...currentBoxes[1], fontSize: currentFontSize },
              ]
            : [
                currentBoxes[0],
                { ...currentBoxes[1], fontSize: currentFontSize },
                currentBoxes[2],
              ],
          words: [
            "",
            currentSlide,
            getBibleName({
              book,
              chapter,
              verse: formatVerseRange(currentVerses),
              version,
            }),
          ],
        })
      );
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
