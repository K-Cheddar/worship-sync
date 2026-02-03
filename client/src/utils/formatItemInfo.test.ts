import { formatItemInfo } from "./formatItemInfo";
import type { DBItem } from "../types";

jest.mock("./generateRandomId", () => ({
  __esModule: true,
  default: () => "fixed-id",
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
});
