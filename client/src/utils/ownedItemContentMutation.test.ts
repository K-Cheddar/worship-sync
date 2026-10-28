import type { ItemSlideType, ItemState } from "../types";
import { applyOwnedItemContentMutation } from "./ownedItemContentMutation";
import { formatFree } from "./overflow";

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

describe("owned item slide targeting", () => {
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
});
