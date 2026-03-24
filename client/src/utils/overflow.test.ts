import { formatSection, getFormattedSections } from "./overflow";
import { formatBible, formatFree, formatLyrics, formatSong } from "./overflow";
import { getNumLines } from "./textMeasurement";

jest.mock("./textMeasurement", () => ({
  getMaxLines: jest.fn(() => ({ maxLines: 2, lineHeight: 1 })),
  getNumLines: jest.fn(() => 1),
}));

jest.mock("./slideCreation", () => ({
  createBox: jest.fn((box) => box),
  createNewSlide: jest.fn((payload) => ({
    ...payload,
    id: `slide-${payload.slideIndex}`,
  })),
}));

jest.mock("./monitorSlideFormatter", () => ({
  addMonitorFormattedToSlide: jest.fn((slide) => ({
    ...slide,
    monitorFormatted: true,
    monitorCurrentBandBoxes: [{ id: "current-0", words: slide.boxes?.[1]?.words }],
    monitorNextBandBoxes: [{ id: "next-0", words: slide.boxes?.[1]?.words }],
  })),
  addMonitorFormattedToSlides: jest.fn((slides) =>
    slides.map((slide: any, index: number) => ({
      ...slide,
      monitorCurrentBandBoxes: [{ id: `current-${index}`, words: slide.boxes?.[1]?.words }],
      monitorNextBandBoxes: [{ id: `next-${index}`, words: slide.boxes?.[1]?.words }],
    })),
  ),
}));

let generatedId = 0;
jest.mock("./generateRandomId", () => ({
  __esModule: true,
  default: jest.fn(() => {
    generatedId += 1;
    return `generated-${generatedId}`;
  }),
}));

describe("overflow utilities", () => {
  beforeEach(() => {
    generatedId = 0;
    jest.clearAllMocks();
  });

  it("groups section slides, merges words, and sorts sections", () => {
    const slides = [
      { name: "Section 2", boxes: [{}, { words: "Second section line 1" }] },
      { name: "Section 1", boxes: [{}, { words: "First section line 1" }] },
      { name: "Section 2", boxes: [{}, { words: "Second section line 2" }] },
      { name: "Section 1", boxes: [{}, { words: "First section line 2" }] },
      { name: "Title", boxes: [{}, { words: "ignored non-section" }] },
    ] as any[];

    const result = getFormattedSections(slides as any, 1);

    expect(result).toEqual([
      {
        sectionNum: 1,
        words: "First section line 1\nFirst section line 2",
        slideSpan: 2,
        id: "generated-2",
      },
      {
        sectionNum: 2,
        words: "Second section line 1\nSecond section line 2",
        slideSpan: 2,
        id: "generated-1",
      },
    ]);
  });

  it("formats section text into overflow slides and preserves selected box updates", () => {
    const selectedSlide = {
      type: "Custom",
      name: "Section 1",
      boxes: [
        { background: "bg-image" },
        {
          words: "",
          width: 100,
          height: 100,
          topMargin: 0,
          sideMargin: 0,
          fontColor: "#fff",
          isBold: false,
          isItalic: false,
        },
      ],
      formattedTextDisplayInfo: { align: "center" },
    } as any;

    const slides = [selectedSlide] as any[];

    const result = formatSection({
      text: "Line 1\nLine 2\nLine 3",
      type: "Custom" as any,
      name: "Section 1",
      slides: slides as any,
      newSlides: [],
      fontSizePx: 60,
      selectedBox: 1,
      selectedSlide,
    });

    expect(result).toHaveLength(2);
    expect(result[0].boxes[1].words).toBe("Line 1\nLine 2\n");
    expect(result[1].boxes[1].words).toBe("Line 3");
    expect((result[0] as { monitorFormatted?: boolean }).monitorFormatted).toBe(
      true,
    );
    expect((result[1] as { monitorFormatted?: boolean }).monitorFormatted).toBe(
      true,
    );
  });

  it("returns original slides when free-form section metadata is missing", () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const item = {
      selectedSlide: 0,
      selectedBox: 1,
      slides: [
        {
          name: "Section 3",
          type: "Custom",
          overflow: "fit",
          boxes: [{ background: "bg" }, { fontSize: 40, width: 100, height: 100 }],
        },
      ],
      formattedSections: [{ sectionNum: 1, words: "Hello", slideSpan: 1 }],
    } as any;

    const result = formatFree(item);

    expect(result.slides).toEqual([
      expect.objectContaining({
        name: "Section 3",
        monitorCurrentBandBoxes: [
          expect.objectContaining({ id: "current-0" }),
        ],
        monitorNextBandBoxes: [
          expect.objectContaining({ id: "next-0" }),
        ],
      }),
    ]);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("formats free-form fit section into a single updated slide", () => {
    const item = {
      selectedSlide: 0,
      selectedBox: 1,
      slides: [
        {
          id: "s1",
          name: "Section 1",
          type: "Custom",
          overflow: "fit",
          formattedTextDisplayInfo: { align: "center" },
          boxes: [
            { background: "bg-1", width: 100, height: 100 },
            {
              words: "old",
              fontSize: 40,
              fontColor: "#fff",
              width: 100,
              height: 100,
              topMargin: 0,
              sideMargin: 0,
              isBold: false,
              isItalic: false,
            },
          ],
        },
      ],
      formattedSections: [{ sectionNum: 1, words: "new words", slideSpan: 1 }],
    } as any;

    const result = formatFree(item);

    expect(result.slides).toHaveLength(1);
    expect(result.slides[0].name).toBe("Section 1");
    expect(result.slides[0].boxes[1].words).toBe("new words");
    expect(result.slides[0].monitorCurrentBandBoxes).toEqual([
      expect.objectContaining({ id: "current-0", words: "new words" }),
    ]);
    expect(result.slides[0].monitorNextBandBoxes).toEqual([
      expect.objectContaining({ id: "next-0", words: "new words" }),
    ]);
    expect(result.formattedSections?.[0]?.slideSpan).toBe(1);
  });

  it("formats lyrics into title, body slides, and trailing blank", () => {
    const item = {
      selectedArrangement: 0,
      selectedSlide: 1,
      arrangements: [
        {
          songOrder: [{ name: "Verse 1" }],
          formattedLyrics: [{ name: "Verse 1", words: "a\nb\nc" }],
          slides: [
            {
              boxes: [{}, { words: "Song Title", fontSize: 40, fontColor: "#fff" }],
            },
            {
              boxes: [
                {},
                {
                  words: "",
                  fontSize: 40,
                  width: 100,
                  height: 100,
                  topMargin: 0,
                  sideMargin: 0,
                  isBold: false,
                  isItalic: false,
                },
              ],
            },
          ],
        },
      ],
    } as any;

    const slides = formatLyrics(item);

    expect(slides[0].type).toBe("Title");
    expect(slides[slides.length - 1].type).toBe("Blank");
    expect(slides.length).toBeGreaterThan(2);
  });

  it("formats song and appends section letters when slideSpan > 1", () => {
    const item = {
      selectedArrangement: 0,
      selectedSlide: 1,
      arrangements: [
        {
          songOrder: [{ name: "Verse 1" }],
          formattedLyrics: [{ name: "Verse 1", words: "line 1\nline 2\nline 3" }],
          slides: [
            {
              boxes: [{}, { words: "Title", fontSize: 40, fontColor: "#fff" }],
            },
            {
              boxes: [
                {},
                {
                  words: "",
                  fontSize: 40,
                  width: 100,
                  height: 100,
                  topMargin: 0,
                  sideMargin: 0,
                  isBold: false,
                  isItalic: false,
                },
              ],
            },
          ],
        },
      ],
    } as any;

    const result = formatSong(item);
    const verseSlides = result.slides.filter((s: any) =>
      String(s.name).startsWith("Verse 1"),
    );

    expect(verseSlides.length).toBeGreaterThan(1);
    expect(verseSlides.some((s: any) => String(s.name).includes("\u200Ba\u200B"))).toBe(
      true,
    );
  });

  it("formats bible item and sets bibleInfo for empty and non-empty verse modes", () => {
    const baseItem = {
      name: "Bible Item",
      selectedSlide: 0,
      slides: [
        {
          name: "Title",
          boxes: [{}, { words: "Bible Title", fontSize: 40, isBold: false, isItalic: false }],
        },
        {
          name: "Verse",
          boxes: [
            { background: "bg", mediaInfo: undefined, brightness: 100 },
            {
              words: "",
              width: 100,
              height: 92,
              fontSize: 40,
              isBold: false,
              isItalic: false,
            },
            { words: "", height: 8 },
          ],
        },
      ],
      bibleInfo: { book: "", chapter: "", version: "", verses: [], fontMode: "fit" },
    } as any;

    const noVerses = formatBible({
      item: baseItem,
      mode: "fit",
      book: "John",
      chapter: "3",
      version: "nkjv",
      verses: [],
    });
    expect(noVerses.bibleInfo?.book).toBe("John");
    expect(noVerses.slides.length).toBe(2);

    (getNumLines as jest.Mock).mockReturnValue(1);
    const withVerses = formatBible({
      item: baseItem,
      mode: "separate",
      book: "John",
      chapter: "3",
      version: "nkjv",
      verses: [{ index: 15, name: "16", text: "For God so loved the world" }],
    });
    expect(withVerses.slides.length).toBeGreaterThan(2);
    expect(withVerses.bibleInfo?.verses[0]?.name).toBe("16");
  });
});
