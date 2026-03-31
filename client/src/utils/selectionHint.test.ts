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
    const newSlides = [
      makeSlide("Section 1A"),
      makeSlide("Section 1B"),
    ];

    const hint = getSelectionHint(oldSlides, 2);

    expect(hint).not.toBeNull();
    expect(getIndexFromSelectionHint(newSlides, hint!)).toBe(1);
  });
});
