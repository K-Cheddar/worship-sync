import { formatItemInfo } from "./formatItemInfo";
import type { DBItem } from "../types";

jest.mock("./generateRandomId", () => ({
  __esModule: true,
  default: () => "fixed-id",
}));

jest.mock("./overflow", () => ({
  __esModule: true,
  formatSong: (item: unknown) => item,
  getFormattedSections: jest.fn(() => []),
}));

const mockToURL = jest.fn(() => "https://cloudinary.com/box.jpg");
const mockCloud = {
  image: jest.fn(() => ({ toURL: mockToURL })),
} as any;

describe("formatItemInfo", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns ItemState with name, type, _id from DBItem", () => {
    const item: DBItem = {
      name: "Free Item",
      type: "free",
      _id: "item-1",
      selectedArrangement: 0,
      shouldSendTo: { projector: false, monitor: false, stream: false },
      arrangements: [],
      slides: [
        {
          id: "s1",
          type: "Media",
          name: "Section 1",
          boxes: [
            {
              id: "b1",
              background: "",
              excludeFromOverflow: false,
              brightness: 100,
              width: 100,
              height: 100,
            },
          ],
        },
      ],
    };
    const result = formatItemInfo(item, mockCloud);
    expect(result.name).toBe("Free Item");
    expect(result.type).toBe("free");
    expect(result._id).toBe("item-1");
    expect(result.selectedArrangement).toBe(0);
    expect(result.shouldSkipTitle).toBe(false);
    expect(result.selectedBox).toBe(1);
    expect(result.selectedSlide).toBe(0);
  });

  it("assigns shouldSendTo when missing on item", () => {
    const item = {
      name: "Item",
      type: "free",
      _id: "1",
      selectedArrangement: 0,
      arrangements: [],
      slides: [],
    } as unknown as DBItem;
    const result = formatItemInfo(item, mockCloud);
    expect(result.shouldSendTo).toEqual({
      projector: true,
      monitor: true,
      stream: true,
    });
  });

  it("preserves shouldSendTo when present on item", () => {
    const item: DBItem = {
      name: "Item",
      type: "free",
      _id: "1",
      selectedArrangement: 0,
      shouldSendTo: { projector: true, monitor: false, stream: true },
      arrangements: [],
      slides: [],
    };
    const result = formatItemInfo(item, mockCloud);
    expect(result.shouldSendTo).toEqual({
      projector: true,
      monitor: false,
      stream: true,
    });
  });

  it("assigns formattedSections for free form with empty slides", () => {
    const item: DBItem = {
      name: "Free",
      type: "free",
      _id: "1",
      selectedArrangement: 0,
      shouldSendTo: { projector: false, monitor: false, stream: false },
      arrangements: [],
      slides: [],
    };
    const result = formatItemInfo(item, mockCloud);
    expect(result.formattedSections).toBeDefined();
    expect(Array.isArray(result.formattedSections)).toBe(true);
  });

  it("fills in missing lyric ids without replacing existing ones", () => {
    const item = {
      name: "Song",
      type: "song",
      _id: "song-1",
      selectedArrangement: 0,
      shouldSendTo: { projector: true, monitor: true, stream: true },
      arrangements: [
        {
          name: "Master",
          id: "arr-1",
          songOrder: [{ id: "order-1", name: "Verse 1" }],
          slides: [],
          formattedLyrics: [
            {
              id: "existing-id",
              type: "Verse",
              name: "Verse 1",
              words: "First verse",
              slideSpan: 1,
            },
            {
              type: "Verse",
              name: "Verse 2",
              words: "Second verse",
              slideSpan: 1,
            },
          ],
        },
      ],
      slides: [],
    } as unknown as DBItem;

    const result = formatItemInfo(item, mockCloud);

    expect(result.arrangements[0].formattedLyrics[0].id).toBe("existing-id");
    expect(result.arrangements[0].formattedLyrics[1].id).toBe("fixed-id");
  });

  it("converts legacy string song orders and resolves Cloudinary backgrounds", () => {
    const item = {
      name: "Song",
      type: "song",
      _id: "song-2",
      selectedArrangement: 0,
      shouldSendTo: { projector: true, monitor: true, stream: true },
      arrangements: [
        {
          name: "Master",
          id: "arr-1",
          songOrder: ["Verse 1", "Chorus"],
          formattedLyrics: [],
          slides: [
            {
              id: "s1",
              type: "Verse",
              name: "Verse 1",
              boxes: [
                {
                  id: "bg",
                  background: "folder/bg",
                  brightness: 80,
                },
                {
                  id: "text",
                  background: "https://cdn.example/text.jpg",
                  brightness: 50,
                  width: undefined,
                  height: undefined,
                  fontColor: undefined,
                },
              ],
            },
          ],
        },
      ],
      slides: [],
    } as unknown as DBItem;

    const result = formatItemInfo(item, mockCloud);

    expect(result.arrangements[0].songOrder).toEqual([
      { name: "Verse 1", id: "fixed-id" },
      { name: "Chorus", id: "fixed-id" },
    ]);
    expect(mockCloud.image).toHaveBeenCalledWith("folder/bg");
    expect(result.arrangements[0].slides[0].boxes[0].background).toBe(
      "https://cloudinary.com/box.jpg",
    );
    expect(result.arrangements[0].slides[0].boxes[1].background).toBe("");
    expect(result.arrangements[0].slides[0].boxes[1].brightness).toBe(100);
    expect(result.arrangements[0].slides[0].boxes[1].width).toBe(100);
    expect(result.arrangements[0].slides[0].boxes[1].fontColor).toBe(
      "rgb(255, 255, 255)",
    );
  });

  it("preserves existing free formattedSections and defaults non-song slide boxes", () => {
    const item: DBItem = {
      name: "Free",
      type: "free",
      _id: "free-2",
      selectedArrangement: 0,
      shouldSendTo: { projector: true, monitor: true, stream: true },
      arrangements: [],
      formattedSections: [
        { id: "sec-1", sectionNum: 1, words: "Hi", slideSpan: 1 },
      ],
      slides: [
        {
          id: "s1",
          type: "Media",
          name: "Section 1",
          boxes: [
            { id: "bg", background: "#000", brightness: 70 },
            { id: "text", background: "keep", brightness: 40 },
          ],
        },
      ],
    };

    const result = formatItemInfo(item, mockCloud);

    expect(result.formattedSections).toEqual([
      { id: "sec-1", sectionNum: 1, words: "Hi", slideSpan: 1 },
    ]);
    expect(result.slides[0].boxes[0].background).toBe("#000");
    expect(result.slides[0].boxes[1].background).toBe("");
    expect(result.slides[0].boxes[1].brightness).toBe(100);
  });
});
