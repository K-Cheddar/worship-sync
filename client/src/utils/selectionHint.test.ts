import {
  getBaseLyricName,
  getIndexFromSelectionHint,
  getSelectionHint,
} from "./selectionHint";
import type { ItemSlideType } from "../types";

const makeSlide = (name: string): ItemSlideType => ({
  id: name,
  name,
  type: "Media",
  boxes: [],
});

describe("selectionHint", () => {
  it("normalizes free section slide letters into a shared base name", () => {
    expect(getBaseLyricName("Section 3A")).toBe("Section 3");
    expect(getBaseLyricName("Section 3B")).toBe("Section 3");
    expect(getBaseLyricName("Section 3")).toBe("Section 3");
  });

  it("keeps free-section slide mapping stable when the section loses a slide", () => {
    const oldSlides = [
      makeSlide("Section 1A"),
      makeSlide("Section 1B"),
      makeSlide("Section 1C"),
      makeSlide("Section 2"),
    ];
    const newSlides = [
      makeSlide("Section 1A"),
      makeSlide("Section 1B"),
      makeSlide("Section 2"),
    ];

    const hint = getSelectionHint(oldSlides, 1);

    expect(hint).not.toBeNull();
    expect(getIndexFromSelectionHint(newSlides, hint!)).toBe(1);
  });

  it("clamps to the last remaining free-section slide when later slides collapse", () => {
    const oldSlides = [
      makeSlide("Section 1A"),
      makeSlide("Section 1B"),
      makeSlide("Section 1C"),
    ];
    const newSlides = [makeSlide("Section 1A"), makeSlide("Section 1B")];

    const hint = getSelectionHint(oldSlides, 2);

    expect(hint).not.toBeNull();
    expect(getIndexFromSelectionHint(newSlides, hint!)).toBe(1);
  });

  it("returns null for missing slides or empty base names", () => {
    expect(getSelectionHint([], 0)).toBeNull();
    expect(getSelectionHint([makeSlide("")], 0)).toBeNull();
  });

  it("tracks repeated section occurrences and maps them after reorder", () => {
    const slides = [
      makeSlide("Chorus\u200Ba\u200B"),
      makeSlide("Chorus\u200Bb\u200B"),
      makeSlide("Verse 1"),
      makeSlide("Chorus\u200Ba\u200B"),
      makeSlide("Chorus\u200Bb\u200B"),
    ];

    const firstChorus = getSelectionHint(slides, 1);
    const secondChorus = getSelectionHint(slides, 3);

    expect(firstChorus).toEqual({
      baseLyricName: "Chorus",
      occurrenceIndex: 0,
      slideIndexInSection: 1,
    });
    expect(secondChorus).toEqual({
      baseLyricName: "Chorus",
      occurrenceIndex: 1,
      slideIndexInSection: 0,
    });

    expect(getIndexFromSelectionHint(slides, secondChorus!)).toBe(3);
    expect(getIndexFromSelectionHint([], secondChorus!)).toBeNull();
    expect(
      getIndexFromSelectionHint(
        [makeSlide("Verse 1"), makeSlide("Bridge")],
        secondChorus!,
      ),
    ).toBeNull();
  });

  it("strips zero-width lyric suffixes from named sections", () => {
    expect(getBaseLyricName("Chorus\u200Ba\u200B")).toBe("Chorus");
    expect(getBaseLyricName("Verse 1\u200Bb\u200B")).toBe("Verse 1");
  });

  it("maps single-slide sections and sparse slide names safely", () => {
    const slides = [
      makeSlide("Verse 1"),
      { ...makeSlide("Bridge"), name: undefined as unknown as string },
      makeSlide("Verse 1"),
    ];
    const hint = getSelectionHint(slides, 0);
    expect(hint).toEqual({
      baseLyricName: "Verse 1",
      occurrenceIndex: 0,
      slideIndexInSection: 0,
    });
    expect(getIndexFromSelectionHint(slides, hint!)).toBe(0);

    const second = getSelectionHint(slides, 2);
    expect(second?.occurrenceIndex).toBe(1);
    expect(getIndexFromSelectionHint(slides, second!)).toBe(2);
  });
});
