import {
  addMonitorFormattedToSlide,
  addMonitorFormattedToSlides,
  formatBoxesForMonitorBand,
} from "./monitorSlideFormatter";
import type { Box, ItemSlideType } from "../types";

jest.mock("./textMeasurement", () => ({
  getMaxLines: jest.fn(({ fontSizePx }: { fontSizePx: number }) => ({
    maxLines: Math.floor(100 / fontSizePx),
    lineHeight: 1,
  })),
  getNumLines: jest.fn(({ text }: { text: string }) => (text.length > 10 ? 3 : 1)),
}));

const createBox = (overrides: Partial<Box> = {}): Box => ({
  id: "box-1",
  words: "short",
  width: 100,
  height: 100,
  fontSize: 40,
  brightness: 100,
  topMargin: 0,
  sideMargin: 0,
  x: 0,
  y: 0,
  background: "",
  fontColor: "rgba(255,255,255,1)",
  shouldKeepAspectRatio: false,
  transparent: false,
  excludeFromOverflow: false,
  align: "center",
  slideIndex: 0,
  label: "box",
  isBold: false,
  isItalic: false,
  ...overrides,
});

const createSlide = (id: string, bandWords: string): ItemSlideType => ({
  id,
  type: "Media",
  name: id,
  boxes: [createBox({ id: `${id}-bg` }), createBox({ id: `${id}-band`, words: bandWords })],
});

describe("monitorSlideFormatter", () => {
  it("caps all box font sizes to the last box target size", () => {
    const result = formatBoxesForMonitorBand(
      [
        createBox({ id: "a", words: "short" }),
        createBox({ id: "b", words: "this is long text" }),
      ],
      540
    );

    expect(result[0].monitorFontSizePx).toBe(33);
    expect(result[0].fontSize).toBe(33);
    expect(result[1].monitorFontSizePx).toBe(33);
  });

  it("returns empty monitor bands when no band box exists", () => {
    const slideWithoutBand: ItemSlideType = {
      id: "s-no-band",
      type: "Media",
      name: "No Band",
      boxes: [createBox({ id: "only-box" })],
    };

    const result = addMonitorFormattedToSlide(slideWithoutBand);
    expect(result.monitorCurrentBandBoxes).toEqual([]);
    expect(result.monitorNextBandBoxes).toEqual([]);
  });

  it("applies one shared minimum monitor font size across all slides", () => {
    const slides = [
      createSlide("s1", "short"),
      createSlide("s2", "this is long text"),
    ];

    const result = addMonitorFormattedToSlides(slides);
    expect(result[0].monitorCurrentBandBoxes?.[0].monitorFontSizePx).toBe(33);
    expect(result[1].monitorCurrentBandBoxes?.[0].monitorFontSizePx).toBe(33);
    expect(result[0].monitorNextBandBoxes?.[0].monitorFontSizePx).toBe(33);
    expect(result[1].monitorNextBandBoxes?.[0].monitorFontSizePx).toBe(33);
  });
});
