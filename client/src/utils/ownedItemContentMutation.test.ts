import type { ItemSlideType, ItemState } from "../types";
import { applyOwnedItemContentMutation } from "./ownedItemContentMutation";
import { formatFree, formatSong } from "./overflow";
import { getMaxLines } from "./textMeasurement";

jest.mock("./textMeasurement", () => ({
  getMaxLines: jest.fn(() => ({ maxLines: 1, lineHeight: 1 })),
  getNumLines: jest.fn(() => 1),
}));

const makeSlide = (
  id: string,
  name: string,
  backgroundBoxId: string,
  bodyBoxId: string,
  words: string,
): ItemSlideType => ({
  id,
  name,
  type: "Section",
  overflow: "separate",
  boxes: [
    { id: backgroundBoxId, width: 100, height: 100, background: "" },
    {
      id: bodyBoxId,
      width: 100,
      height: 100,
      fontSize: 40,
      fontColor: "#ffffff",
      words,
      isBold: false,
      isItalic: false,
    },
  ],
});

const makeItem = (
  slides: ItemSlideType[],
  selectedSlide = 0,
  sectionWords = "",
): ItemState => ({
  _id: "free-item",
  name: "Free item",
  type: "free",
  selectedArrangement: 0,
  selectedSlide,
  selectedBox: 1,
  slides,
  arrangements: [],
  shouldSendTo: { projector: true, monitor: true, stream: true },
  formattedSections: sectionWords
    ? [{ sectionNum: 1, words: sectionWords, slideSpan: slides.length }]
    : [],
} as ItemState);

const makeSongSlide = (
  id: string,
  name: string,
  type: string,
  words: string,
  fontSize: number,
  slideIndex = 0,
): ItemSlideType => ({
  id,
  name,
  type: type as ItemSlideType["type"],
  boxes: [
    {
      id: `${id}-background`,
      background: `background-${id}`,
      brightness: 70,
      width: 100,
      height: 100,
    },
    {
      id: `${id}-body`,
      words,
      fontSize,
      fontColor: "#ffffff",
      width: 100,
      height: 100,
      isBold: false,
      isItalic: false,
      slideIndex,
    },
  ],
});

const makeSongItem = (): ItemState => ({
  _id: "song-item",
  name: "Song",
  type: "song",
  selectedArrangement: 0,
  selectedSlide: 2,
  selectedBox: 1,
  slides: [],
  arrangements: [
    {
      id: "active-arrangement",
      name: "Active",
      songOrder: [
        { name: "Verse 1" },
        { name: "Chorus 1" },
        { name: "Verse 1" },
      ],
      formattedLyrics: [
        { name: "Verse 1", type: "Verse", words: "one\ntwo\nthree\nfour", slideSpan: 2 },
        { name: "Chorus 1", type: "Chorus", words: "chorus", slideSpan: 1 },
      ],
      slides: [
        makeSongSlide("title", "Title", "Title", "Song title", 120),
        makeSongSlide("verse-first-page-1", "Verse 1", "Verse", "one\ntwo", 40, 0),
        makeSongSlide("verse-first-page-2", "Verse 1a", "Verse", "three\nfour", 40, 1),
        makeSongSlide("chorus-page", "Chorus 1", "Chorus", "chorus", 40, 0),
        makeSongSlide("verse-second-page-1", "Verse 1", "Verse", "one\ntwo", 40, 0),
        makeSongSlide("verse-second-page-2", "Verse 1a", "Verse", "three\nfour", 40, 1),
        makeSongSlide("trailing-blank", "Blank", "Blank", " ", 77),
      ],
    },
    {
      id: "other-arrangement",
      name: "Other",
      songOrder: [{ name: "Verse 1" }],
      formattedLyrics: [{ name: "Verse 1", type: "Verse", words: "other lyrics", slideSpan: 1 }],
      slides: [
        makeSongSlide("other-title", "Title", "Title", "Other title", 110),
        makeSongSlide("other-verse", "Verse 1", "Verse", "other lyrics", 90, 0),
        makeSongSlide("other-blank", "Blank", "Blank", " ", 75),
      ],
    },
  ],
} as unknown as ItemState);

const makeFourPageSongItem = (): ItemState => {
  const item = makeSongItem();
  const arrangement = item.arrangements[0];
  const createPages = (prefix: string) =>
    ["one", "two", "three", "four"].map((word, index) =>
      makeSongSlide(
        `${prefix}-${index + 1}`,
        `Verse 1${index === 0 ? "" : String.fromCharCode(96 + index)}`,
        "Verse",
        index === 3 ? word : `${word}\n`,
        40,
        index,
      ),
    );

  return {
    ...item,
    arrangements: [
      {
        ...arrangement,
        slides: [
          arrangement.slides[0],
          ...createPages("verse-first-page"),
          arrangement.slides[3],
          ...createPages("verse-second-page"),
          arrangement.slides.at(-1)!,
        ],
      },
      item.arrangements[1],
    ],
  } as ItemState;
};

const getVerseGroups = (slides: ItemSlideType[]) => {
  const groups: ItemSlideType[][] = [];
  for (const slide of slides) {
    if (!slide.name.startsWith("Verse 1")) continue;
    if (slide.boxes[1]?.slideIndex === 0 || groups.length === 0) groups.push([]);
    groups[groups.length - 1].push(slide);
  }
  return groups;
};

const useSongFontPagination = () =>
  jest.mocked(getMaxLines).mockImplementation(({ fontSizePx }) => ({
    maxLines: fontSizePx >= 70 ? 1 : 2,
    lineHeight: 1,
  }));

describe("owned item slide targeting", () => {
  beforeEach(() => {
    jest.mocked(getMaxLines).mockImplementation(() => ({ maxLines: 1, lineHeight: 1 }));
  });

  it("does not retarget a deleted slide to the item now occupying its old index", () => {
    const currentItem = makeItem([
      makeSlide("section-2", "Section 2", "background-2", "body-2", "B words"),
    ]);

    const result = applyOwnedItemContentMutation(currentItem, {
      kind: "boxProperties",
      slideId: "deleted-section-1",
      targetBoxId: "deleted-body-1",
      sectionNum: 1,
      boxIndex: 1,
      properties: { fontColor: "#ff0000" },
    });

    expect(result).toBeNull();
    expect(currentItem.slides[0].boxes[1].fontColor).toBe("#ffffff");
  });

  it("follows a reordered slide by its stable slide ID", () => {
    const slideA = makeSlide("slide-a", "Section 1A", "background-a", "body-a", "A words");
    const slideB = makeSlide("slide-b", "Section 1B", "background-b", "body-b", "B words");
    const currentItem = makeItem([slideB, slideA]);

    const result = applyOwnedItemContentMutation(currentItem, {
      kind: "boxProperties",
      slideId: "slide-a",
      targetBoxId: "body-a",
      sectionNum: 1,
      boxIndex: 1,
      properties: { fontColor: "#00ff00" },
    });

    expect(result?.slides?.[0].boxes[1].fontColor).toBe("#ffffff");
    expect(result?.slides?.[1].boxes[1].fontColor).toBe("#00ff00");
  });

  it("applies matched geometry across every slide in the selected scope", () => {
    const currentItem = {
      ...makeItem([
        makeSlide("slide-a", "Section 1A", "background-a", "body-a", "A words"),
        makeSlide("slide-b", "Section 1B", "background-b", "body-b", "B words"),
      ]),
      type: "image",
      arrangements: [],
    } as ItemState;

    const result = applyOwnedItemContentMutation(currentItem, {
      kind: "boxProperties",
      slideId: "slide-a",
      targetBoxId: "body-a",
      sectionNum: 1,
      boxIndex: 1,
      properties: { x: 0, y: 35, width: 100, height: 35 },
      applyToAll: true,
    });

    expect(result?.slides?.map((slide) => slide.boxes[1])).toEqual([
      expect.objectContaining({ x: 0, y: 35, width: 100, height: 35 }),
      expect.objectContaining({ x: 0, y: 35, width: 100, height: 35 }),
    ]);
  });

  it("limits selected-scope geometry changes to the original slide", () => {
    const currentItem = makeItem([
      makeSlide("slide-a", "Section 1A", "background-a", "body-a", "A words"),
      makeSlide("slide-b", "Section 1B", "background-b", "body-b", "B words"),
    ]);

    const result = applyOwnedItemContentMutation(currentItem, {
      kind: "boxProperties",
      slideId: "slide-a",
      targetBoxId: "body-a",
      sectionNum: 1,
      boxIndex: 1,
      properties: { x: 0, y: 65, width: 100, height: 35 },
      applyToAll: false,
    });

    expect(result?.slides?.[0].boxes[1]).toEqual(
      expect.objectContaining({ x: 0, y: 65, width: 100, height: 35 }),
    );
    expect(result?.slides?.[1].boxes[1]).toEqual(
      expect.objectContaining({ width: 100, height: 100 }),
    );
  });

  it("resolves a regenerated overflow slide through its retained box identity", () => {
    const originalSlides = [
      makeSlide("old-slide-a", "Section 1A", "background-a", "body-a", "Line A\n"),
      makeSlide("old-slide-b", "Section 1B", "background-b", "body-b", "Line B"),
    ];
    const currentItem = makeItem(originalSlides, 1, "Line A\nLine B");
    const regenerated = formatFree(currentItem);

    expect(regenerated.slides[1].id).not.toBe("old-slide-b");
    expect(regenerated.slides[1].boxes[1].id).toBe("body-b");

    const result = applyOwnedItemContentMutation(regenerated, {
      kind: "boxProperties",
      slideId: "old-slide-b",
      targetBoxId: "body-b",
      sectionNum: 1,
      boxIndex: 1,
      properties: { fontColor: "#0000ff" },
    });

    expect(result?.slides?.[0].boxes[1].fontColor).toBe("#ffffff");
    expect(result?.slides?.[1].boxes[1].fontColor).toBe("#0000ff");
  });

  it("keeps delayed overflow changes on the regenerated target section", () => {
    const originalSlides = [
      makeSlide("old-slide-a", "Section 1A", "background-a", "body-a", "Line A\n"),
      makeSlide("old-slide-b", "Section 1B", "background-b", "body-b", "Line B"),
      makeSlide("section-2", "Section 2", "background-2", "body-2", "Other section"),
    ];
    const currentItem = makeItem(originalSlides, 1, "Line A\nLine B");
    currentItem.formattedSections = [
      { sectionNum: 1, words: "Line A\nLine B", slideSpan: 2 },
      { sectionNum: 2, words: "Other section", slideSpan: 1 },
    ];
    const regenerated = formatFree(currentItem);

    const result = applyOwnedItemContentMutation(regenerated, {
      kind: "overflow",
      slideId: "old-slide-b",
      targetBoxId: "body-b",
      boxIndex: 1,
      sectionNum: 1,
      value: "fit",
    });

    expect(result?.slides).toHaveLength(2);
    expect(result?.slides?.[0].name).toBe("Section 1");
    expect(result?.slides?.[0].overflow).toBe("fit");
    expect(result?.slides?.[0].boxes[1].words).toBe("Line A\nLine B");
    expect(result?.slides?.[1].id).toBe("section-2");
    expect(result?.slides?.[1].boxes[1].words).toBe("Other section");
  });

  it("applies song-wide font size to active-arrangement lyrics and repaginates repeated sections", () => {
    useSongFontPagination();
    const currentItem = makeSongItem();
    const originalSlides = currentItem.arrangements[0].slides;
    const originalOtherArrangement = currentItem.arrangements[1];
    const lyrics = "one\ntwo\nthree\nfour";

    const result = applyOwnedItemContentMutation(currentItem, {
      kind: "boxProperties",
      slideId: "verse-first-page-2",
      targetBoxId: "verse-first-page-2-body",
      arrangementId: "active-arrangement",
      boxIndex: 1,
      properties: { fontSize: 80 },
      applyToAll: true,
      formatItem: true,
      newPageFontSizePx: 80,
    });

    const activeSlides = result?.arrangements?.[0].slides ?? [];
    const lyricSlides = activeSlides.filter((slide) =>
      slide.name.startsWith("Verse 1") || slide.name.startsWith("Chorus 1"),
    );
    const verseGroups = getVerseGroups(activeSlides);
    expect(lyricSlides.every((slide) => slide.boxes[1].fontSize === 80)).toBe(true);
    expect(verseGroups).toHaveLength(2);
    expect(verseGroups.map((group) => group.map((slide) => slide.boxes[1].words).join(""))).toEqual([
      lyrics,
      lyrics,
    ]);
    expect(verseGroups[0].map((slide) => slide.id)).toEqual(
      expect.arrayContaining(["verse-first-page-1", "verse-first-page-2"]),
    );
    expect(verseGroups[1].map((slide) => slide.id)).toEqual(
      expect.arrayContaining(["verse-second-page-1", "verse-second-page-2"]),
    );
    expect(activeSlides[0]).toEqual(originalSlides[0]);
    expect(activeSlides.at(-1)).toEqual(originalSlides.at(-1));
    expect(result?.arrangements?.[1]).toEqual(originalOtherArrangement);
  });

  it("keeps single-slide song formatting local while new overflow pages inherit its font size", () => {
    useSongFontPagination();
    const currentItem = makeSongItem();
    const originalSlides = currentItem.arrangements[0].slides;
    const lyrics = "one\ntwo\nthree\nfour";

    const result = applyOwnedItemContentMutation(currentItem, {
      kind: "boxProperties",
      slideId: "verse-first-page-2",
      targetBoxId: "verse-first-page-2-body",
      arrangementId: "active-arrangement",
      boxIndex: 1,
      properties: { fontSize: 80 },
      applyToAll: false,
      formatItem: true,
      newPageFontSizePx: 80,
    });

    const activeSlides = result?.arrangements?.[0].slides ?? [];
    const verseGroups = getVerseGroups(activeSlides);
    const firstOccurrence = verseGroups[0];
    const secondOccurrence = verseGroups[1];
    expect(firstOccurrence.map((slide) => slide.boxes[1].words).join("")).toBe(lyrics);
    expect(secondOccurrence.map((slide) => slide.boxes[1].words).join("")).toBe(lyrics);
    expect(firstOccurrence.find((slide) => slide.id === "verse-first-page-1")?.boxes[1].fontSize).toBe(40);
    expect(firstOccurrence.find((slide) => slide.id === "verse-first-page-2")?.boxes[1].fontSize).toBe(80);
    expect(firstOccurrence.filter((slide) => !originalSlides.some((old) => old.id === slide.id))
      .every((slide) => slide.boxes[1].fontSize === 80)).toBe(true);
    expect(secondOccurrence.every((slide) => slide.boxes[1].fontSize === 40)).toBe(true);
    expect(activeSlides.find((slide) => slide.id === "chorus-page")?.boxes[1].fontSize).toBe(40);
    expect(activeSlides[0]).toEqual(originalSlides[0]);
    expect(activeSlides.at(-1)).toEqual(originalSlides.at(-1));
    expect(result?.arrangements?.[1]).toEqual(currentItem.arrangements[1]);
  });

  it("does not apply a selected page font to new pages in another section occurrence", () => {
    useSongFontPagination();
    const currentItem = makeSongItem();
    const slides = currentItem.arrangements[0].slides.map((slide) =>
      slide.id === "verse-first-page-2" || slide.id.startsWith("verse-second-page-")
        ? {
            ...slide,
            boxes: slide.boxes.map((box, index) =>
              index === 1 ? { ...box, fontSize: 80 } : box,
            ),
          }
        : slide,
    );

    const result = applyOwnedItemContentMutation(
      {
        ...currentItem,
        arrangements: [
          { ...currentItem.arrangements[0], slides },
          currentItem.arrangements[1],
        ],
      },
      {
        kind: "boxProperties",
        slideId: "verse-first-page-2",
        targetBoxId: "verse-first-page-2-body",
        arrangementId: "active-arrangement",
        boxIndex: 1,
        properties: { fontSize: 40 },
        applyToAll: false,
        formatItem: true,
        newPageFontSizePx: 40,
      },
    );

    const verseGroups = getVerseGroups(result?.arrangements?.[0].slides ?? []);
    expect(verseGroups).toHaveLength(2);
    expect(verseGroups[0].map((slide) => slide.boxes[1].fontSize)).toEqual([40, 40]);
    expect(verseGroups[1].map((slide) => slide.boxes[1].fontSize)).toEqual([80, 80, 80, 80]);
    expect(verseGroups[1].map((slide) => slide.boxes[1].words).join(""))
      .toBe("one\ntwo\nthree\nfour");
  });

  it("shrinks selected-scope song pagination without changing other page styles or lyric order", () => {
    useSongFontPagination();
    const currentItem = makeFourPageSongItem();
    const originalOtherArrangement = currentItem.arrangements[1];
    const highFontSlides = currentItem.arrangements[0].slides.map((slide) =>
      slide.name.startsWith("Verse 1")
        ? {
            ...slide,
            boxes: slide.boxes.map((box, index) =>
              index === 1 ? { ...box, fontSize: 80 } : box,
            ),
          }
        : slide,
    );
    const originalIds = highFontSlides
      .filter((slide) => slide.name.startsWith("Verse 1"))
      .map((slide) => slide.id);

    const result = applyOwnedItemContentMutation(
      {
        ...currentItem,
        arrangements: [
          { ...currentItem.arrangements[0], slides: highFontSlides },
          originalOtherArrangement,
        ],
      },
      {
        kind: "boxProperties",
        slideId: "verse-first-page-2",
        targetBoxId: "verse-first-page-2-body",
        arrangementId: "active-arrangement",
        boxIndex: 1,
        properties: { fontSize: 40 },
        applyToAll: false,
        formatItem: true,
        newPageFontSizePx: 40,
      },
    );

    const activeSlides = result?.arrangements?.[0].slides ?? [];
    const verseGroups = getVerseGroups(activeSlides);
    expect(verseGroups).toHaveLength(2);
    expect(verseGroups[0].map((slide) => slide.boxes[1].fontSize)).toEqual([80, 40, 80]);
    expect(verseGroups[1].map((slide) => slide.boxes[1].fontSize)).toEqual([80, 80, 80, 80]);
    expect(verseGroups.map((group) => group.map((slide) => slide.boxes[1].words).join("")))
      .toEqual(["one\ntwo\nthree\nfour", "one\ntwo\nthree\nfour"]);
    expect(verseGroups[0].map((slide) => slide.id)).toEqual(originalIds.slice(0, 3));
    expect(verseGroups[1].map((slide) => slide.id)).toEqual(originalIds.slice(4));
    expect(result?.arrangements?.[1]).toEqual(originalOtherArrangement);
  });

  it("shrinks all-slides song pagination across repeated sections", () => {
    useSongFontPagination();
    const currentItem = makeFourPageSongItem();
    const originalOtherArrangement = currentItem.arrangements[1];
    const highFontSlides = currentItem.arrangements[0].slides.map((slide) =>
      slide.name.startsWith("Verse 1")
        ? {
            ...slide,
            boxes: slide.boxes.map((box, index) =>
              index === 1 ? { ...box, fontSize: 80 } : box,
            ),
          }
        : slide,
    );

    const result = applyOwnedItemContentMutation(
      {
        ...currentItem,
        arrangements: [
          { ...currentItem.arrangements[0], slides: highFontSlides },
          originalOtherArrangement,
        ],
      },
      {
        kind: "boxProperties",
        slideId: "verse-first-page-2",
        targetBoxId: "verse-first-page-2-body",
        arrangementId: "active-arrangement",
        boxIndex: 1,
        properties: { fontSize: 40 },
        applyToAll: true,
        formatItem: true,
        newPageFontSizePx: 40,
      },
    );

    const activeSlides = result?.arrangements?.[0].slides ?? [];
    const verseGroups = getVerseGroups(activeSlides);
    expect(verseGroups).toHaveLength(2);
    expect(verseGroups.every((group) => group.length === 2)).toBe(true);
    expect(verseGroups.flat().every((slide) => slide.boxes[1].fontSize === 40)).toBe(true);
    expect(verseGroups.map((group) => group.map((slide) => slide.boxes[1].words).join("")))
      .toEqual(["one\ntwo\nthree\nfour", "one\ntwo\nthree\nfour"]);
    expect(result?.arrangements?.[1]).toEqual(originalOtherArrangement);
  });

  it("does not propagate a title-slide font size change across song lyrics", () => {
    const currentItem = makeSongItem();
    const originalSlides = currentItem.arrangements[0].slides;

    const result = applyOwnedItemContentMutation(currentItem, {
      kind: "boxProperties",
      slideId: "title",
      targetBoxId: "title-body",
      arrangementId: "active-arrangement",
      boxIndex: 1,
      properties: { fontSize: 100 },
      applyToAll: true,
      formatItem: true,
    });

    const activeSlides = result?.arrangements?.[0].slides ?? [];
    expect(activeSlides[0].boxes[1].fontSize).toBe(100);
    expect(activeSlides.slice(1)).toEqual(originalSlides.slice(1));
  });

  it("preserves song slide identities when an all-slides font change does not repaginate", () => {
    useSongFontPagination();
    const currentItem = formatSong(makeSongItem());
    const originalIds = currentItem.arrangements[0].slides.map((slide) => slide.id);

    const result = applyOwnedItemContentMutation(currentItem, {
      kind: "boxProperties",
      slideId: "verse-first-page-2",
      targetBoxId: "verse-first-page-2-body",
      arrangementId: "active-arrangement",
      boxIndex: 1,
      properties: { fontSize: 40 },
      applyToAll: true,
      formatItem: true,
    });

    expect(result?.arrangements?.[0].slides.map((slide) => slide.id)).toEqual(originalIds);
    expect(result?.arrangements?.[0]).toEqual(currentItem.arrangements[0]);
  });
});
