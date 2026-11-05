import {
  addMonitorFormattedToSlide,
  addMonitorFormattedToSlides,
  formatBoxesForMonitorBand,
  getMonitorLayoutForSlides,
  stripMonitorBoxClones,
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

    const result = addMonitorFormattedToSlide(slideWithoutBand, {
      currentFontSizePx: 24,
      nextFontSizePx: 18,
    });
    expect(result.monitorCurrentBandBoxes).toEqual([]);
    expect(result.monitorNextBandBoxes).toEqual([]);
  });

  it("derives identical current and next monitor boxes from the source box", () => {
    const slides = [
      createSlide("s1", "short"),
      createSlide("s2", "this is long text"),
    ];

    const layout = getMonitorLayoutForSlides(slides);
    const result = addMonitorFormattedToSlides(slides, layout);
    expect(layout.currentFontSizePx).toBe(33);
    expect(layout.nextFontSizePx).toBe(33);
    expect(result[0].monitorCurrentBandBoxes).toEqual(
      formatBoxesForMonitorBand([slides[0].boxes[1]], 540).map((box) => ({ ...box, fontSize: 33, monitorFontSizePx: 33 })),
    );
    expect(result[1].monitorNextBandBoxes?.[0]).toMatchObject({
      id: "s2-band", words: "this is long text", fontColor: "rgba(255,255,255,1)", monitorFontSizePx: 33,
    });
    const edited = { ...slides[0], boxes: [slides[0].boxes[0], { ...slides[0].boxes[1], words: "updated source", fontColor: "#123456" }] };
    const updated = addMonitorFormattedToSlides([edited], layout)[0];
    expect(updated.monitorCurrentBandBoxes?.[0]).toMatchObject({ words: "updated source", fontColor: "#123456" });
  });

  it("removes legacy monitor clones after capturing their compact layout", () => {
    const legacySong = {
      _id: "song-1", type: "song", selectedArrangement: 0, slides: [{ ...createSlide("legacy-root", "ignored") }],
      arrangements: [{
        id: "arr-1", name: "Master", songOrder: [], formattedLyrics: [],
        slides: [{
          ...createSlide("s1", "source text"),
          monitorCurrentBandBoxes: [{ ...createBox({ words: "source text", fontSize: 31, monitorFontSizePx: 31 }) }],
          monitorNextBandBoxes: [{ ...createBox({ words: "source text", fontSize: 29, monitorFontSizePx: 29 }) }],
        }],
      }],
    } as any;
    const { normalizeItemSlides } = require("./activeItemSlides");
    const normalized = normalizeItemSlides(legacySong);
    expect(normalized.slides).toEqual([]);
    expect(normalized.arrangements[0].monitorLayout).toEqual({ currentFontSizePx: 31, nextFontSizePx: 29 });
    expect(normalized.arrangements[0].slides[0]).not.toHaveProperty("monitorCurrentBandBoxes");
    expect(normalized.arrangements[0].slides[0]).not.toHaveProperty("monitorNextBandBoxes");
    expect(stripMonitorBoxClones([normalized.arrangements[0].slides[0]])[0]).not.toHaveProperty("monitorCurrentBandBoxes");
  });
});
