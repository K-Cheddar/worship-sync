import {
  createBox,
  createNewSlide,
  createSlideFromMedia,
  insertSlidesAt,
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
      expect(box.fontSize).toBe(108);
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

  describe("createSlideFromMedia", () => {
    it("creates an empty normal custom slide with image media on box zero", () => {
      const slide = createSlideFromMedia({
        id: "image-1",
        name: "Welcome",
        background: "https://example.test/welcome.jpg",
        type: "image",
      } as any);

      expect(slide.boxes).toHaveLength(2);
      expect(slide.boxes[0].mediaInfo?.id).toBe("image-1");
      expect(slide.boxes[0].shouldKeepAspectRatio).toBe(true);
      expect(slide.boxes[1].words).toBe("");
    });

    it("keeps local video input as the slide media source", () => {
      const source = {
        kind: "local-video-input" as const,
        sourceId: "screen-1",
        label: "Screen 1",
        captureKind: "screen" as const,
      };
      const slide = createSlideFromMedia({
        id: "input-1",
        name: "Screen 1",
        background: "",
        type: "video",
        localVideoInput: source,
      } as any);

      expect(slide.mediaSource).toEqual(source);
      expect(slide.boxes[0].mediaInfo).toBeUndefined();
      expect(slide.boxes[0].shouldKeepAspectRatio).toBe(true);
    });

    it("preserves an explicit sizing mode when creating from an existing box", () => {
      const slide = createNewSlide({
        type: "Section",
        box: createBox({ shouldKeepAspectRatio: false }),
        mediaInfo: {
          id: "image-1",
          name: "Welcome",
          background: "https://example.test/welcome.jpg",
          type: "image",
        } as any,
        shouldKeepAspectRatio: true,
      });

      expect(slide.boxes[0].shouldKeepAspectRatio).toBe(false);
    });
  });

  it("inserts a group of slides at the requested position", () => {
    expect(insertSlidesAt(["one", "four"], ["two", "three"], 1)).toEqual([
      "one",
      "two",
      "three",
      "four",
    ]);
  });
});
