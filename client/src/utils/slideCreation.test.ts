import {
  createBox,
  createNewSlide,
  defaultFormattedTextDisplayInfo,
} from "./slideCreation";

jest.mock("./generateRandomId", () => ({
  __esModule: true,
  default: () => "fixed-id",
}));

describe("slideCreation", () => {
  describe("createBox", () => {
    it("returns box with defaults when given empty input", () => {
      const box = createBox({});
      expect(box.words).toBe(" ");
      expect(box.width).toBe(100);
      expect(box.height).toBe(100);
      expect(box.fontSize).toBe(2.5);
      expect(box.brightness).toBe(100);
      expect(box.align).toBe("center");
      expect(box.id).toBe("fixed-id");
    });

    it("overrides with provided values", () => {
      const box = createBox({
        words: "Hello",
        width: 50,
        height: 50,
        fontSize: 4,
        align: "left",
      });
      expect(box.words).toBe("Hello");
      expect(box.width).toBe(50);
      expect(box.height).toBe(50);
      expect(box.fontSize).toBe(4);
      expect(box.align).toBe("left");
    });
  });

  describe("createNewSlide", () => {
    it("returns slide with type and name", () => {
      const slide = createNewSlide({ type: "Verse" });
      expect(slide.type).toBe("Verse");
      expect(slide.name).toBe("Verse");
      expect(slide.id).toBe("fixed-id");
      expect(Array.isArray(slide.boxes)).toBe(true);
    });

    it("uses custom name when provided", () => {
      const slide = createNewSlide({ type: "Chorus", name: "Refrain" });
      expect(slide.name).toBe("Refrain");
    });

    it("includes formattedTextDisplayInfo when provided", () => {
      const custom = {
        ...defaultFormattedTextDisplayInfo,
        backgroundColor: "#000",
      };
      const slide = createNewSlide({
        type: "Announcement",
        formattedTextDisplayInfo: custom,
      });
      expect(slide.formattedTextDisplayInfo).toEqual(custom);
    });
  });
});
