import {
  Arrangment,
  ItemSlide,
  ItemState,
  SlideType,
  verseType,
  BibleFontMode,
} from "../types";
import { getLetterFromIndex } from "./generalUtils";
import { createBox, createNewSlide } from "./slideCreation";
import generateRandomId from "./generateRandomId";

type getMaxLinesProps = {
  fontSize: number;
  height: number;
  topMargin?: number;
  isBold?: boolean;
  isItalic?: boolean;
};

type MaxLinesResult = {
  maxLines: number;
  lineHeight: number;
};

export const getMaxLines = ({
  fontSize,
  height,
  topMargin: _topMargin,
  isBold,
  isItalic,
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
      font-weight: ${isBold ? "bold" : "normal"};
      font-style: ${isItalic ? "italic" : "normal"};
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

    measureSpan.textContent = "Sample\nText\nWith\nMultiple\nLines";
    const multiLineHeight = measureSpan.getBoundingClientRect().height;

    document.body.removeChild(measureSpan);

    const lineHeight = Math.max(singleLineHeight, multiLineHeight / 5);
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
  isBold?: boolean;
  isItalic?: boolean;
};

export const getNumLines = ({
  text,
  fontSize,
  lineHeight,
  width,
  sideMargin: _sideMargin,
  isBold,
  isItalic,
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
      font-weight: ${isBold ? "bold" : "normal"};
      font-style: ${isItalic ? "italic" : "normal"};
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
  type: SlideType;
  name: string;
  slides: ItemSlide[];
  newSlides: ItemSlide[];
  fontSize: number;
  selectedBox: number;
  selectedSlide: ItemSlide;
};

export const formatSection = ({
  text,
  type,
  name,
  slides,
  newSlides,
  fontSize,
  selectedBox,
  selectedSlide,
}: FormatSectionType): ItemSlide[] => {
  let lines = text.split("\n");
  let formattedSlides = [];
  let currentBoxes = [];

  let maxLines = 0,
    lineHeight = 0,
    lineCounter = 0,
    counter = 0;
  let boxWords = "";
  let slidePosition = 0;

  for (let i = 0; i < lines.length; ++i) {
    counter = 0;
    lineCounter = 0;
    boxWords = "";
    slidePosition = newSlides.length + formattedSlides.length;

    if (slides[slidePosition]) currentBoxes = slides[slidePosition].boxes;
    else currentBoxes = slides[slides.length - 1].boxes || [];

    const currentBox = currentBoxes[1];

    // Process text overflow for all boxes
    ({ maxLines, lineHeight } = getMaxLines({
      fontSize,
      height: currentBox.height,
      isBold: currentBox.isBold,
      isItalic: currentBox.isItalic,
      topMargin: currentBox.topMargin,
    }));

    while (i + counter < lines.length && lineCounter < maxLines) {
      let testWords = boxWords + lines[i + counter];

      if (i + counter < lines.length - 1) testWords += "\n";

      let lineCount = getNumLines({
        text: lines[i + counter],
        fontSize,
        lineHeight,
        width: currentBox.width,
        isBold: currentBox.isBold,
        isItalic: currentBox.isItalic,
      });

      // If the text can't fit and we're not on the first round of the loop
      // break the loop. Existing text will be added and the next round will grab
      // The rest of the text
      if (lineCount + lineCounter > maxLines && counter > 0) {
        break;
      }

      boxWords = testWords;
      lineCounter += lineCount;
      counter++;
    }

    const box = Object.assign({}, currentBox);
    if (boxWords === "") boxWords = " ";
    box.words = boxWords;

    i += counter - 1;
    formattedSlides.push(
      createNewSlide({
        type,
        name,
        boxes: currentBoxes.map((_box, index) => {
          if (index === selectedBox) {
            return box;
          } else {
            return _box;
          }
        }),
        fontSize,
        fontColor: selectedSlide.boxes[selectedBox].fontColor,
        slideIndex: formattedSlides.length,
        background: selectedSlide.boxes[0].background || undefined,
        isBold: selectedSlide.boxes[selectedBox].isBold,
        isItalic: selectedSlide.boxes[selectedBox].isItalic,
        formattedTextDisplayInfo: selectedSlide.formattedTextDisplayInfo,
      })
    );
  }
  return formattedSlides;
};

export const formatFree = (item: ItemState) => {
  const { selectedSlide, selectedBox } = item;
  let slides = item.slides;
  const slide = slides[selectedSlide];
  let newSlides: ItemSlide[] = [];

  const fontSize = slide.boxes[selectedBox].fontSize || 2.5;
  const fontColor = slide.boxes[selectedBox].fontColor || "rgb(255, 255, 255)";
  const isBold = slide.boxes[selectedBox].isBold || false;
  const isItalic = slide.boxes[selectedBox].isItalic || false;
  const formattedTextDisplayInfo = slide.formattedTextDisplayInfo;
  let minFontSize = 0.5; // Minimum font size to try

  // Get the current section number from the slide name
  const currentSectionMatch = slide.name.match(/Section (\d+)/);
  const currentSectionNum = currentSectionMatch
    ? parseInt(currentSectionMatch[1])
    : 1;

  const currentSectionSlides = slides.filter((slide) =>
    slide.name.includes(`Section ${currentSectionNum}`)
  );

  // Get words from selected box of all slides of section
  const sectionWords = currentSectionSlides
    .map((slide, index) => {
      const words = slide.boxes[selectedBox]?.words || "";

      // Check if the current slide already ends with a newline
      const alreadyHasNewline = words.endsWith("\n");

      // Only add newline if:
      // 1. It's not the last slide
      // 2. The slide doesn't already end with a newline
      // 3. The slide has some content (not empty)
      const shouldAddNewline =
        index < currentSectionSlides.length - 1 &&
        !alreadyHasNewline &&
        words.trim().length > 0;

      return shouldAddNewline ? words + "\n" : words;
    })
    .join("");

  // Get the background from the last slide in the section
  const lastSlideInSection =
    currentSectionSlides[currentSectionSlides.length - 1];
  const background = lastSlideInSection?.boxes[0]?.background || undefined;

  let _formattedSlides: ItemSlide[] = [];
  if (slide.overflow === "fit") {
    // Try to fit all words in one slide by adjusting font size
    let currentFontSize = fontSize;
    let maxLines = 0;
    let lineHeight = 0;
    let numLines = 0;

    while (currentFontSize >= minFontSize) {
      ({ maxLines, lineHeight } = getMaxLines({
        fontSize: currentFontSize,
        height: slide.boxes[selectedBox].height,
        isBold,
        isItalic,
      }));

      numLines = getNumLines({
        text: sectionWords,
        fontSize: currentFontSize,
        lineHeight,
        width: slide.boxes[selectedBox].width,
        isBold,
        isItalic,
      });

      if (numLines <= maxLines) {
        break;
      }
      currentFontSize -= 0.1;
    }

    if (currentFontSize < minFontSize) {
      // If we couldn't fit with minimum font size, use formatSection to split into multiple slides
      _formattedSlides = formatSection({
        text: sectionWords,
        type: slide.type,
        name: slide.name,
        slides: currentSectionSlides,
        newSlides,
        fontSize: minFontSize,
        selectedSlide: slide,
        selectedBox,
      });
    } else {
      // Create a single slide with the adjusted font size
      _formattedSlides = [
        createNewSlide({
          type: slide.type,
          name: `Section ${currentSectionNum}`,
          boxes: slide.boxes.map((box, index) => {
            if (index === selectedBox) {
              return {
                ...box,
                fontSize: currentFontSize,
                words: sectionWords,
              };
            }
            return box;
          }),
          fontSize: currentFontSize,
          fontColor,
          slideIndex: 0,
          overflow: "fit",
          background,
          isBold,
          isItalic,
          formattedTextDisplayInfo,
        }),
      ];
    }
  } else {
    // Use the original formatting logic
    _formattedSlides = formatSection({
      text: sectionWords,
      type: slide.type,
      name: slide.name,
      slides: currentSectionSlides,
      newSlides,
      fontSize,
      selectedSlide: slide,
      selectedBox,
    });
  }

  const formattedSlides = _formattedSlides.map((newSlide, index) => {
    // Update slide names with section numbers and letters
    const id = newSlide.id ?? generateRandomId();

    // Get the corresponding current section slide if it exists
    const currentSectionSlide = currentSectionSlides[index];

    // Combine boxes from both slides, prioritizing the selected box from formatted slides
    const combinedBoxes = newSlide.boxes.map((box, boxIndex) => {
      if (boxIndex === selectedBox) {
        // Keep the box from formatted slides for the selected box
        return box;
      } else if (currentSectionSlide?.boxes?.[boxIndex]) {
        // Use box from current section slide for other indices
        return currentSectionSlide.boxes[boxIndex];
      }
      // Fallback to formatted slide box if no current section box exists
      return box;
    });

    // Create the new slide with the background from the last slide
    const newSlideWithBackground = {
      ...newSlide,
      name:
        _formattedSlides.length > 1
          ? `Section ${currentSectionNum}${getLetterFromIndex(index, true)}`
          : `Section ${currentSectionNum}`,
      id,
      overflow: slide.overflow,
      boxes: combinedBoxes,
      background,
    };

    return newSlideWithBackground;
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
  const selectedSlide = item.selectedSlide || 1;
  const arrangements = item.arrangements || [];
  let slides = arrangements[selectedArrangement].slides || [];
  const slide = slides[selectedSlide];

  const boxes = slides[0].boxes;
  const lastSlide = slides.length - 1;
  const lastBoxes = slides[lastSlide].boxes;

  const newSlides = [
    createNewSlide({
      type: "Title",
      name: "Title",
      boxes,
      words: ["", boxes[1].words || " "],
      fontSize: boxes[1].fontSize || 3.5,
      fontColor: boxes[1].fontColor || "rgb(255, 255, 255)",
    }),
  ];
  const songOrder = arrangements[selectedArrangement].songOrder;
  const formattedLyrics = arrangements[selectedArrangement].formattedLyrics;
  const fontSize: number = slide ? slide.boxes[1].fontSize || 2.5 : 2.5;

  for (let i = 0; i < songOrder.length; ++i) {
    let lyrics =
      formattedLyrics.find((e) => e.name === songOrder[i].name)?.words || "";
    const sectionSlides = slides.filter((slide) =>
      slide.name.startsWith(songOrder[i].name)
    );

    newSlides.push(
      ...formatSection({
        text: lyrics,
        type: songOrder[i].name.split(" ")[0] as SlideType,
        name: songOrder[i].name,
        slides: sectionSlides,
        newSlides,
        fontSize,
        selectedSlide: slide,
        selectedBox: 1,
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

  // Create a map to track how many times we've seen each section
  const sectionOccurrences = new Map<string, number>();

  const updatedSlides = slides.map((slide, index) => {
    const formattedLyric = formattedLyrics.find((e) => e.name === slide.name);
    if (!formattedLyric || formattedLyric.slideSpan < 2) return slide;

    // Get how many times we've seen this section
    const occurrence = sectionOccurrences.get(slide.name) || 0;
    sectionOccurrences.set(slide.name, occurrence + 1);

    // Calculate which letter to use based on the occurrence and slideSpan
    const letterIndex = occurrence % Math.ceil(formattedLyric.slideSpan);

    return {
      ...slide,
      name: `${slide.name}${getLetterFromIndex(letterIndex, true)}`,
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
          itemType: "bible",
          fontSize: 3.5,
          words: ["", item.name],
          background,
          brightness,
        }),

        createNewSlide({
          itemType: "bible",
          type: "Verse",
          fontSize: 2.5,
          background,
          brightness,
          boxes: [
            createBox({}),
            createBox({
              height: 92,
            }),
            createBox({ height: 8 }),
          ],
          words: ["", "", ""],
        }),
      ];
  let boxes = slides[0]?.boxes || [];

  let newSlides = [
    createNewSlide({
      type: "Title",
      itemType: "bible",
      fontSize: boxes[1]?.fontSize || 3.5,
      words: ["", boxes[1]?.words || " "],
      background: boxes[0]?.background || background,
      brightness: boxes[0]?.brightness || brightness,
      isBold: boxes[1]?.isBold || false,
      isItalic: boxes[1]?.isItalic || false,
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
  const referenceIndex = item.selectedSlide > 0 ? item.selectedSlide : 1;
  let currentSlide: ItemSlide = slides[referenceIndex] || {};
  const titleSlideText = slides[0]?.boxes[1]?.words?.trim() || "";

  let currentBoxes = [...currentSlide.boxes];
  let { maxLines, lineHeight } = getMaxLines({
    fontSize: currentBoxes[1].fontSize || 1,
    height: currentBoxes[1].height || 95,
    isBold: currentBoxes[1].isBold,
    isItalic: currentBoxes[1].isItalic,
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
            isBold: currentBoxes[1].isBold,
            isItalic: currentBoxes[1].isItalic,
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
            isBold: currentBoxes[1].isBold,
            isItalic: currentBoxes[1].isItalic,
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
                    ? getLetterFromIndex(verseSplitCounts[verse.name], true)
                    : ""),
                itemType: "bible",
                boxes: isNew
                  ? [currentBoxes[0], { ...currentBoxes[1] }]
                  : [currentBoxes[0], { ...currentBoxes[1] }, currentBoxes[2]],
                words: [
                  "",
                  currentPrefix + cleanText,
                  titleSlideText ||
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
                ? getLetterFromIndex(verseSplitCounts[verse.name], true)
                : ""),
            boxes: isNew
              ? [currentBoxes[0], { ...currentBoxes[1] }]
              : [currentBoxes[0], { ...currentBoxes[1] }, currentBoxes[2]],
            words: [
              "",
              currentPrefix + cleanText,
              titleSlideText ||
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
      let currentFontSize = currentBoxes[1]?.fontSize || 2.5;
      let fitProcessing = true;
      const versePrefix = "\u200B" + verse.name + ".\u200B ";

      // Update maxLines and lineHeight before each verse
      ({ maxLines, lineHeight } = getMaxLines({
        fontSize: currentFontSize,
        height: currentBoxes[1].height || 95,
        isBold: currentBoxes[1].isBold,
        isItalic: currentBoxes[1].isItalic,
      }));

      while (fitProcessing) {
        let tempSlide = "";
        for (let j = 0; j < words.length; j++) {
          let update = tempSlide + words[j];
          // Always include the verse prefix in the line calculation
          if (
            getNumLines({
              text: versePrefix + update,
              fontSize: currentFontSize,
              lineHeight,
              width: currentBoxes[1].width,
              isBold: currentBoxes[1].isBold,
              isItalic: currentBoxes[1].isItalic,
            }) <= maxLines
          )
            tempSlide = update + " ";
          else {
            currentFontSize -= 0.1;
            ({ maxLines, lineHeight } = getMaxLines({
              fontSize: currentFontSize,
              height: currentBoxes[1].height || 95,
              isBold: currentBoxes[1].isBold,
              isItalic: currentBoxes[1].isItalic,
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
            versePrefix + slide,
            titleSlideText ||
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
        isBold: currentBoxes[1].isBold,
        isItalic: currentBoxes[1].isItalic,
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
          isBold: currentBoxes[1].isBold,
          isItalic: currentBoxes[1].isItalic,
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
        isBold: currentBoxes[1].isBold,
        isItalic: currentBoxes[1].isItalic,
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
          isBold: currentBoxes[1].isBold,
          isItalic: currentBoxes[1].isItalic,
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
          isBold: currentBoxes[1].isBold,
          isItalic: currentBoxes[1].isItalic,
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
            isBold: currentBoxes[1].isBold,
            isItalic: currentBoxes[1].isItalic,
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
                titleSlideText ||
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
                isBold: currentBoxes[1].isBold,
                isItalic: currentBoxes[1].isItalic,
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
                      getLetterFromIndex(verseSplitCounts[verse.name], true),
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
                      titleSlideText ||
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
                  isBold: currentBoxes[1].isBold,
                  isItalic: currentBoxes[1].isItalic,
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
                  getLetterFromIndex(verseSplitCounts[verse.name], true),
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
                  titleSlideText ||
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
            titleSlideText ||
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
