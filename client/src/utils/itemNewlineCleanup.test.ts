import {
  cleanItemNewlines,
  itemHasCleanableNewlines,
  removeExtraNewlines,
} from "./itemNewlineCleanup";
import { ItemState } from "../types";

const mockFormatSong = jest.fn((item: ItemState) => ({
  ...item,
  slides: [{ id: "formatted-song-slide", type: "Verse", name: "Verse 1", boxes: [] }],
}));
const mockFormatFree = jest.fn((item: ItemState) => ({
  ...item,
  slides: [{ id: "formatted-free-slide", type: "Section", name: "Section 1", boxes: [] }],
}));

jest.mock("./overflow", () => ({
  formatSong: (item: ItemState) => mockFormatSong(item),
  formatFree: (item: ItemState) => mockFormatFree(item),
}));

describe("itemNewlineCleanup", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("removes repeated newlines and trims text", () => {
    expect(removeExtraNewlines("\nAlpha\n\n\nBeta\n")).toBe("Alpha\nBeta");
  });

  it("detects cleanable newlines for songs", () => {
    const item = {
      _id: "song-1",
      type: "song",
      name: "Song",
      selectedArrangement: 0,
      selectedSlide: 0,
      selectedBox: 1,
      slides: [],
      arrangements: [
        {
          id: "arr-1",
          name: "Master",
          slides: [],
          songOrder: [],
          formattedLyrics: [
            { id: "f1", name: "Verse 1", type: "Verse", words: "Line 1\n\nLine 2", slideSpan: 1 },
          ],
        },
      ],
      shouldSendTo: { projector: true, monitor: true, stream: true },
    } as ItemState;

    expect(itemHasCleanableNewlines(item)).toBe(true);
  });

  it("detects cleanable newlines for free items", () => {
    const item = {
      _id: "free-1",
      type: "free",
      name: "Free",
      selectedArrangement: 0,
      selectedSlide: 0,
      selectedBox: 1,
      slides: [],
      arrangements: [],
      formattedSections: [
        { id: "s1", sectionNum: 1, words: "Line 1\n\n\nLine 2", slideSpan: 1 },
      ],
      shouldSendTo: { projector: true, monitor: true, stream: true },
    } as ItemState;

    expect(itemHasCleanableNewlines(item)).toBe(true);
  });

  it("returns false when only single newlines are present", () => {
    const item = {
      _id: "free-2",
      type: "free",
      name: "Free",
      selectedArrangement: 0,
      selectedSlide: 0,
      selectedBox: 1,
      slides: [],
      arrangements: [],
      formattedSections: [
        { id: "s1", sectionNum: 1, words: "Line 1\nLine 2", slideSpan: 1 },
      ],
      shouldSendTo: { projector: true, monitor: true, stream: true },
    } as ItemState;

    expect(itemHasCleanableNewlines(item)).toBe(false);
  });

  it("cleans songs and re-runs formatSong", () => {
    const item = {
      _id: "song-2",
      type: "song",
      name: "Song",
      selectedArrangement: 0,
      selectedSlide: 0,
      selectedBox: 1,
      slides: [],
      arrangements: [
        {
          id: "arr-1",
          name: "Master",
          slides: [],
          songOrder: [],
          formattedLyrics: [
            { id: "f1", name: "Verse 1", type: "Verse", words: "Line 1\n\nLine 2\n", slideSpan: 1 },
          ],
        },
      ],
      shouldSendTo: { projector: true, monitor: true, stream: true },
    } as ItemState;

    const result = cleanItemNewlines(item);

    expect(mockFormatSong).toHaveBeenCalledWith(
      expect.objectContaining({
        arrangements: [
          expect.objectContaining({
            formattedLyrics: [
              expect.objectContaining({
                words: "Line 1\nLine 2",
              }),
            ],
          }),
        ],
      })
    );
    expect(result.slides[0].id).toBe("formatted-song-slide");
  });

  it("cleans free items and re-runs formatFree", () => {
    const item = {
      _id: "free-3",
      type: "free",
      name: "Free",
      selectedArrangement: 0,
      selectedSlide: 0,
      selectedBox: 1,
      slides: [],
      arrangements: [],
      formattedSections: [
        { id: "s1", sectionNum: 1, words: "Line 1\n\nLine 2\n", slideSpan: 1 },
      ],
      shouldSendTo: { projector: true, monitor: true, stream: true },
    } as ItemState;

    const result = cleanItemNewlines(item);

    expect(mockFormatFree).toHaveBeenCalledWith(
      expect.objectContaining({
        formattedSections: [
          expect.objectContaining({
            words: "Line 1\nLine 2",
          }),
        ],
      })
    );
    expect(result.slides[0].id).toBe("formatted-free-slide");
  });
});
