import { createSections, makeUnique } from "./itemUtil";

jest.mock("./generateRandomId", () => ({
  __esModule: true,
  default: () => "fixed-id",
}));

describe("itemUtil", () => {
  describe("createSections", () => {
    it("parses unformatted lyrics by double newline and creates sections", () => {
      const result = createSections({
        unformattedLyrics: "Line one\n\nLine two\n\nLine three",
      });
      expect(result.formattedLyrics).toHaveLength(3);
      expect(result.songOrder).toHaveLength(3);
      expect(result.formattedLyrics[0].words).toBe("Line one");
      expect(result.formattedLyrics[0].name).toBe("Verse ");
      expect(result.formattedLyrics[0].type).toBe("Verse");
      expect(result.formattedLyrics[1].words).toBe("Line two");
      expect(result.formattedLyrics[2].words).toBe("Line three");
    });

    it("reuses existing section when words match", () => {
      const result = createSections({
        unformattedLyrics: "Same\n\nSame",
      });
      expect(result.formattedLyrics).toHaveLength(1);
      expect(result.songOrder).toHaveLength(2);
      expect(result.songOrder[0].name).toBe(result.songOrder[1].name);
    });

    it("uses existing formattedLyrics and songOrder when provided", () => {
      const existing = {
        formattedLyrics: [
          {
            type: "Verse" as const,
            name: "Verse 1",
            words: "Existing",
            id: "e1",
            slideSpan: 1,
          },
        ],
        songOrder: [{ name: "Verse 1", id: "s1" }],
      };
      const result = createSections({
        ...existing,
        unformattedLyrics: "New line",
      });
      expect(result.formattedLyrics[0].words).toBe("Existing");
      expect(result.formattedLyrics[1].words).toBe("New line");
      expect(result.songOrder).toHaveLength(2);
    });

    it("assigns deterministic ids when mocked", () => {
      const result = createSections({
        unformattedLyrics: "A\n\nB",
      });
      expect(result.formattedLyrics[0].id).toBe("fixed-id");
      expect(result.songOrder[0].id).toBe("fixed-id");
    });
  });

  describe("makeUnique", () => {
    it("returns value when not in list", () => {
      const list = [{ name: "Other" }, { name: "Another" }];
      expect(makeUnique({ value: "Unique", property: "name", list })).toBe(
        "Unique",
      );
    });

    it("returns value with (1) when value exists once", () => {
      const list = [{ name: "Item" }];
      expect(makeUnique({ value: "Item", property: "name", list })).toBe(
        "Item (1)",
      );
    });

    it("returns value with (2) when value and (1) exist", () => {
      const list = [{ name: "Item" }, { name: "Item (1)" }];
      expect(makeUnique({ value: "Item", property: "name", list })).toBe(
        "Item (2)",
      );
    });

    it("uses custom property", () => {
      const list = [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ];
      expect(makeUnique({ value: "a", property: "id", list })).toBe("a (1)");
      expect(makeUnique({ value: "c", property: "id", list })).toBe("c");
    });
  });
});
