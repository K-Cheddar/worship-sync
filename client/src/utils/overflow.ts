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
import generateRandomId from "./generateRandomId";

type getMaxLinesProps = {
  fontSize: number;
  height: number;
  topMargin?: number;
};

type MaxLinesResult = {
  maxLines: number;
  lineHeight: number;
};

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

    // Create a hidden span once for measuring
    const measureSpan = document.createElement("span");
    measureSpan.style.cssText = `
      font-size: ${fontSizeVw};
      font-family: Verdana;
      overflow-wrap: break-word;
      position: fixed;
      line-height: 1.25;
      visibility: hidden;
      padding: 0;
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      box-sizing: border-box;
    `;

    measureSpan.textContent = "Sample Text";
    document.body.appendChild(measureSpan);

    // Use `getBoundingClientRect()` for more precise height
    const singleLineHeight = measureSpan.getBoundingClientRect().height;

    measureSpan.textContent =
      "Sample Text\nWith Multiple Lines\nAnd Some Longer Words";
    const multiLineHeight = measureSpan.getBoundingClientRect().height;

    document.body.removeChild(measureSpan);

    const lineHeight = Math.max(singleLineHeight, multiLineHeight / 3);
    const maxLines = Math.floor(containerHeightPx / lineHeight);

    return {
      maxLines: Math.max(1, maxLines),
      lineHeight,
    };
  } catch (error) {
    console.error("Error calculating max lines:", error);
    return {
      maxLines: 1,
      lineHeight: fontSize * 1.25,
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
    const containerWidth = Math.floor(
      (((width || 95) * sideMargin) / 100) * windowWidth * 0.42
    );

    // Reusable span for measurement
    const measureSpan = document.createElement("span");
    measureSpan.style.cssText = `
      font-size: ${fontSizeVw};
      font-family: Verdana;
      overflow-wrap: break-word;
      white-space: pre-wrap;
      width: ${containerWidth}px;
      position: fixed;
      line-height: ${lineHeight}px;
      visibility: hidden;
      padding: 0;
      margin: 0;
      box-sizing: border-box;
      word-break: break-word;
    `;
    measureSpan.textContent = text;
    document.body.appendChild(measureSpan);

    const textHeight = measureSpan.getBoundingClientRect().height;
    document.body.removeChild(measureSpan);

    const numLines = Math.round(textHeight / lineHeight);

    return Math.max(1, numLines);
  } catch (error) {
    console.error("Error calculating number of lines:", error);
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
  let formattedText = [];
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

    if (slides[newSlides.length + formattedText.length])
      currentBoxes = slides[newSlides.length + formattedText.length].boxes;
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
    formattedText.push(
      createNewSlide({
        type: type as SlideType,
        name: name,
        boxes: boxes,
        fontSize: fontSize,
        fontColor: fontColor,
        slideIndex: formattedText.length,
      })
    );
  }
  return formattedText;
};

export const formatSectionByWords = ({
  text,
  type,
  name,
  slides,
  newSlides,
  lastBoxes,
  fontSize,
  fontColor,
}: FormatSectionType) => {
  // Handle empty text case
  if (!text || text.trim() === "") {
    return [
      createNewSlide({
        type: type as SlideType,
        name: name,
        boxes: lastBoxes.map((box) => ({
          ...box,
          words: box === lastBoxes[0] ? " " : " ",
        })),
        fontSize: fontSize,
        fontColor: fontColor,
        slideIndex: 0,
      }),
    ];
  }

  let words = text.split(" ");
  let formattedText = [];
  let currentBoxes = [];
  let boxes: Box[] = [];
  let box: Box = { width: 100, height: 100 };
  let maxLines = 0,
    lineHeight = 0,
    lineCounter = 0,
    counter = 0;
  let boxWords = "";

  for (let i = 0; i < words.length; ++i) {
    counter = 0;
    lineCounter = 0;
    boxWords = "";
    boxes = [];

    if (slides[newSlides.length + formattedText.length])
      currentBoxes = slides[newSlides.length + formattedText.length].boxes;
    else currentBoxes = lastBoxes;

    for (let j = 0; j < currentBoxes.length; ++j) {
      ({ maxLines, lineHeight } = getMaxLines({
        fontSize,
        height: currentBoxes[1].height,
      }));

      // Handle case where we're at the last word
      if (i === words.length - 1) {
        boxWords = words[i];
        break;
      }

      while (i + counter < words.length && lineCounter < maxLines) {
        let testWords = boxWords + (boxWords ? " " : "") + words[i + counter];
        let lineCount = getNumLines({
          text: testWords,
          fontSize,
          lineHeight,
          width: currentBoxes[1].width,
        });

        // If even a single word doesn't fit, force it to fit
        if (counter === 0 && lineCount > maxLines) {
          boxWords = words[i];
          lineCounter = lineCount;
          counter = 1;
          break;
        }

        if (lineCount <= maxLines) {
          boxWords = testWords;
          lineCounter = lineCount;
          counter++;
        } else {
          break;
        }
      }

      box = Object.assign({}, currentBoxes[j]);
      if (boxWords === "") boxWords = " ";
      box.words = boxWords;
      boxes.push(box);
    }

    boxes[0].words = " ";
    boxes[1].excludeFromOverflow = false;
    boxes[1].brightness = 100;

    i += counter - 1;
    formattedText.push(
      createNewSlide({
        type: type as SlideType,
        name: name,
        boxes: boxes,
        fontSize: fontSize,
        fontColor: fontColor,
        slideIndex: formattedText.length,
      })
    );
  }

  // If no slides were created (e.g., empty text), create a default slide
  if (formattedText.length === 0) {
    formattedText.push(
      createNewSlide({
        type: type as SlideType,
        name: name,
        boxes: lastBoxes.map((box) => ({
          ...box,
          words: box === lastBoxes[0] ? " " : " ",
        })),
        fontSize: fontSize,
        fontColor: fontColor,
        slideIndex: 0,
      })
    );
  }

  return formattedText;
};

export const formatFree = (item: ItemState) => {
  const { selectedSlide, selectedBox } = item;
  let slides = item.slides;
  const slide = slides[selectedSlide];
  let newSlides: ItemSlide[] = [];

  const fontSize = slide.boxes[selectedBox].fontSize || 2.5;
  const fontColor = slide.boxes[selectedBox].fontColor || "rgb(255, 255, 255)";

  // Get the current section number from the slide name
  const currentSectionMatch = slide.name.match(/Section (\d+)/);
  const currentSectionNum = currentSectionMatch
    ? parseInt(currentSectionMatch[1])
    : 1;

  // Get words from all slides of section
  const sectionWords = slides
    .filter((slide) => slide.name.includes(`Section ${currentSectionNum}`))
    .map((slide) => slide.boxes[selectedBox].words)
    .join("");

  // Format the text and get new slides
  const _formattedSlides = formatSection({
    text: sectionWords,
    type: slide.type,
    name: slide.name,
    slides,
    newSlides,
    lastBoxes: slide.boxes,
    fontSize,
    fontColor,
  });

  const formattedSlides = _formattedSlides.map((newSlide, index) => {
    // Update slide names with section numbers and letters
    const id = newSlide.id ?? generateRandomId();
    if (_formattedSlides.length > 1) {
      // If more than one slide, get letter suffixes
      return {
        ...newSlide,
        name: `Section ${currentSectionNum}${getLetterFromIndex(index)}`,
        id,
      };
    }
    // If only one slide, keep the original section number
    return {
      ...newSlide,
      name: `Section ${currentSectionNum}`,
      id,
    };
  });

  // Remove all slides from current section and save location
  const firstSlideLocation = slides.findIndex((slide) =>
    slide.name.includes(`Section ${currentSectionNum}`)
  );
  const updatedSlides = slides.filter(
    (slide) => !slide.name.includes(`Section ${currentSectionNum}`)
  );

  // Replace all slides of section with updated slides
  updatedSlides.splice(firstSlideLocation, 0, ...formattedSlides);
  return {
    ...item,
    slides: updatedSlides,
  };
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
    height: currentBoxes[1].height || 95,
  });
  let formattedVerses = [];
  // let type = currentSlide.type;

  if (mode === "separate" && verses) {
    for (let i = 0; i < verses.length; ++i) {
      const verse = verses[i];
      let words = verse.text?.split(" ") || [];
      let slide = "";
      let verseSplitCounts: { [key: string]: number } = {}; // Track splits per verse
      let needsLetters = false; // Track if this verse will be split

      // First pass to check if we need letters
      let tempSlide = "";
      for (let j = 0; j < words.length; j++) {
        let testSlide = tempSlide + (tempSlide ? " " : "") + words[j];
        let versePrefix = "\u200B" + verse.name + ".\u200B ";
        let fullText = versePrefix + testSlide;

        if (
          getNumLines({
            text: fullText,
            fontSize: currentBoxes[1].fontSize || 1,
            lineHeight,
            width: currentBoxes[1].width,
          }) <= maxLines
        ) {
          tempSlide = testSlide;
        } else {
          needsLetters = true;
          break;
        }
      }

      // Reset for actual processing
      tempSlide = "";
      for (let j = 0; j < words.length; j++) {
        let testSlide = slide + (slide ? " " : "") + words[j];
        let versePrefix =
          "\u200B" +
          verse.name +
          (needsLetters
            ? getLetterFromIndex(verseSplitCounts[verse.name] || 0)
            : "") +
          ".\u200B ";
        let fullText = versePrefix + testSlide;

        if (
          getNumLines({
            text: fullText,
            fontSize: currentBoxes[1].fontSize || 1,
            lineHeight,
            width: currentBoxes[1].width,
          }) <= maxLines
        ) {
          slide = testSlide;
        } else {
          // Create slide with current words
          if (slide) {
            if (!verseSplitCounts[verse.name]) {
              verseSplitCounts[verse.name] = 0;
            }
            const currentPrefix =
              "\u200B" +
              verse.name +
              (needsLetters
                ? getLetterFromIndex(verseSplitCounts[verse.name])
                : "") +
              ".\u200B ";
            const cleanText = slide.replace(/^\u200B\d+\.\u200B\s*/, "");

            formattedVerses.push(
              createNewSlide({
                type: "Verse",
                name:
                  "Verse " +
                  verse.name +
                  (needsLetters
                    ? getLetterFromIndex(verseSplitCounts[verse.name])
                    : ""),
                itemType: "bible",
                boxes: currentBoxes,
                words: [
                  "",
                  currentPrefix + cleanText,
                  getBibleName({
                    book,
                    chapter,
                    verse:
                      verse.name +
                      (needsLetters
                        ? getLetterFromIndex(verseSplitCounts[verse.name])
                        : ""),
                    version,
                  }),
                ],
              })
            );
            verseSplitCounts[verse.name]++;
          }
          // Start new slide with current word
          slide = words[j];
        }
      }

      // Add remaining text if any
      if (slide) {
        if (!verseSplitCounts[verse.name]) {
          verseSplitCounts[verse.name] = 0;
        }
        const currentPrefix =
          "\u200B" +
          verse.name +
          (needsLetters
            ? getLetterFromIndex(verseSplitCounts[verse.name])
            : "") +
          ".\u200B ";
        const cleanText = slide.replace(/^\u200B\d+\.\u200B\s*/, "");

        formattedVerses.push(
          createNewSlide({
            itemType: "bible",
            type: "Verse",
            name:
              "Verse " +
              verse.name +
              (needsLetters
                ? getLetterFromIndex(verseSplitCounts[verse.name])
                : ""),
            boxes: currentBoxes,
            words: [
              "",
              currentPrefix + cleanText,
              getBibleName({
                book,
                chapter,
                verse:
                  verse.name +
                  (needsLetters
                    ? getLetterFromIndex(verseSplitCounts[verse.name])
                    : ""),
                version,
              }),
            ],
          })
        );
        verseSplitCounts[verse.name]++;
      }
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
              height: currentBoxes[1].height || 95,
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

      // Update maxLines and lineHeight for the final slide
      ({ maxLines, lineHeight } = getMaxLines({
        fontSize: currentFontSize,
        height: currentBoxes[1].height || 95,
      }));

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
    let previousVerse: verseType | null = null;
    let verseSplitCounts: { [key: string]: number } = {}; // Track splits per verse

    for (let i = 0; i < verses.length; ++i) {
      const verse = verses[i];
      if (!verse?.text) continue; // Skip verses without text

      let verseText = "\u200B" + verse.name + ".\u200B " + verse.text;

      // First check if this verse can fit on its own
      let singleVerseLines = getNumLines({
        text: verseText,
        fontSize: currentFontSize,
        lineHeight,
        width: currentBoxes[1]?.width || 95,
      });

      // If it doesn't fit, check if adding a letter suffix would make it fit
      if (singleVerseLines > maxLines) {
        let verseTextWithLetter =
          "\u200B" + verse.name + "a.\u200B " + verse.text;
        singleVerseLines = getNumLines({
          text: verseTextWithLetter,
          fontSize: currentFontSize,
          lineHeight,
          width: currentBoxes[1]?.width || 95,
        });
      }

      // Then check if it can fit with the current slide
      let combinedText = currentSlide
        ? currentSlide + " " + verseText
        : verseText;
      let combinedLines = getNumLines({
        text: combinedText,
        fontSize: currentFontSize,
        lineHeight,
        width: currentBoxes[1]?.width || 95,
      });

      // If it doesn't fit with current slide, check if adding a letter suffix would make it fit
      if (combinedLines > maxLines) {
        let verseTextWithLetter =
          "\u200B" + verse.name + "a.\u200B " + verse.text;
        let combinedTextWithLetter = currentSlide
          ? currentSlide + " " + verseTextWithLetter
          : verseTextWithLetter;
        combinedLines = getNumLines({
          text: combinedTextWithLetter,
          fontSize: currentFontSize,
          lineHeight,
          width: currentBoxes[1]?.width || 95,
        });
      }

      // If we have a previous verse on its own slide, check if we can combine with it
      let canCombineWithPrevious = false;
      if (previousVerse && !currentSlide) {
        let previousText =
          "\u200B" + previousVerse.name + ".\u200B " + previousVerse.text;
        let combinedWithPrevious = previousText + " " + verseText;
        let combinedWithPreviousLines = getNumLines({
          text: combinedWithPrevious,
          fontSize: currentFontSize,
          lineHeight,
          width: currentBoxes[1]?.width || 95,
        });
        canCombineWithPrevious = combinedWithPreviousLines <= maxLines;

        // If it doesn't fit with previous verse, check if adding a letter suffix would make it fit
        if (!canCombineWithPrevious) {
          let verseTextWithLetter =
            "\u200B" + verse.name + "a.\u200B " + verse.text;
          let combinedWithPreviousWithLetter =
            previousText + " " + verseTextWithLetter;
          let combinedWithPreviousWithLetterLines = getNumLines({
            text: combinedWithPreviousWithLetter,
            fontSize: currentFontSize,
            lineHeight,
            width: currentBoxes[1]?.width || 95,
          });
          canCombineWithPrevious =
            combinedWithPreviousWithLetterLines <= maxLines;
        }
      }

      if (combinedLines <= maxLines) {
        // Verse fits with current slide, add it
        currentSlide = combinedText;
        currentVerses.push(verse);
        previousVerse = null;
      } else if (canCombineWithPrevious) {
        // Can combine with previous verse
        let previousText =
          "\u200B" + previousVerse!.name + ".\u200B " + previousVerse!.text;
        currentSlide = previousText + " " + verseText;
        currentVerses = [previousVerse!, verse];
        previousVerse = null;
      } else {
        // If we have a current slide, create it first
        if (currentSlide) {
          formattedVerses.push(
            createNewSlide({
              itemType: "bible",
              type: "Verse",
              name:
                (currentVerses.length > 1 ? "Verses " : "Verse ") +
                formatVerseRange(currentVerses),
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

        // If this verse can fit on its own, start a new slide with it
        if (singleVerseLines <= maxLines) {
          currentSlide = verseText;
          currentVerses = [verse];
          previousVerse = null;
        } else {
          // Handle the verse that didn't fit
          let words = verseText.split(" ");
          let tempSlide = "";
          let remainingWords = [...words];

          while (remainingWords.length > 0) {
            let word = remainingWords[0];
            let testText = tempSlide ? tempSlide + " " + word : word;
            let versePrefix =
              "\u200B" +
              verse.name +
              getLetterFromIndex(verseSplitCounts[verse.name] || 0) +
              ".\u200B ";
            let fullText = versePrefix + testText;

            if (
              getNumLines({
                text: fullText,
                fontSize: currentFontSize,
                lineHeight,
                width: currentBoxes[1]?.width || 95,
              }) <= maxLines
            ) {
              tempSlide = testText;
              remainingWords.shift();
            } else {
              if (tempSlide) {
                // Initialize split count for this verse if not exists
                if (!verseSplitCounts[verse.name]) {
                  verseSplitCounts[verse.name] = 0;
                }

                const versePrefix =
                  "\u200B" +
                  verse.name +
                  getLetterFromIndex(verseSplitCounts[verse.name]) +
                  ".\u200B ";
                // Remove the existing verse number from the text
                const cleanText = tempSlide.replace(
                  /^\u200B\d+\.\u200B\s*/,
                  ""
                );

                formattedVerses.push(
                  createNewSlide({
                    itemType: "bible",
                    type: "Verse",
                    name:
                      "Verse " +
                      verse.name +
                      getLetterFromIndex(verseSplitCounts[verse.name]),
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
                      versePrefix + cleanText,
                      getBibleName({
                        book,
                        chapter,
                        verse:
                          verse.name +
                          getLetterFromIndex(verseSplitCounts[verse.name]),
                        version,
                      }),
                    ],
                  })
                );
                verseSplitCounts[verse.name]++; // Increment split count for this verse
                tempSlide = "";
              } else {
                // If even a single word doesn't fit, we need to reduce font size
                currentFontSize -= 0.1;
                ({ maxLines, lineHeight } = getMaxLines({
                  fontSize: currentFontSize,
                  height: currentBoxes[1].height || 95,
                }));
              }
            }
          }

          // Add any remaining text as a new slide
          if (tempSlide) {
            // Initialize split count for this verse if not exists
            if (!verseSplitCounts[verse.name]) {
              verseSplitCounts[verse.name] = 0;
            }

            const versePrefix =
              "\u200B" +
              verse.name +
              getLetterFromIndex(verseSplitCounts[verse.name]) +
              ".\u200B ";
            // Remove the existing verse number from the text
            const cleanText = tempSlide.replace(/^\u200B\d+\.\u200B\s*/, "");

            formattedVerses.push(
              createNewSlide({
                itemType: "bible",
                type: "Verse",
                name:
                  "Verse " +
                  verse.name +
                  getLetterFromIndex(verseSplitCounts[verse.name]),
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
                  versePrefix + cleanText,
                  getBibleName({
                    book,
                    chapter,
                    verse:
                      verse.name +
                      getLetterFromIndex(verseSplitCounts[verse.name]),
                    version,
                  }),
                ],
              })
            );
            verseSplitCounts[verse.name]++; // Increment split count for this verse
          }

          // Reset for next verse
          currentSlide = "";
          currentVerses = [];
          previousVerse = verse;
        }
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
