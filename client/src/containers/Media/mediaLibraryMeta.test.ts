import {
  mediaLibraryDisplayName,
  normalizeMediaLibraryStoredName,
  truncatedMediaToastLabel,
} from "./mediaLibraryMeta";

describe("mediaLibraryMeta", () => {
  describe("normalizeMediaLibraryStoredName", () => {
    it("strips one leading folder segment", () => {
      expect(normalizeMediaLibraryStoredName("backgrounds/slide.png")).toBe(
        "slide.png",
      );
    });

    it("leaves names without slashes unchanged", () => {
      expect(normalizeMediaLibraryStoredName("slide.png")).toBe("slide.png");
    });

    it("trims whitespace", () => {
      expect(normalizeMediaLibraryStoredName("  foo  ")).toBe("foo");
    });
  });

  describe("truncatedMediaToastLabel", () => {
    it("uses display name without folder prefix", () => {
      expect(
        truncatedMediaToastLabel({ name: "folder/sub/WorshipBackground.png" }),
      ).toBe("sub/WorshipBackground.png");
    });

    it("truncates long names with ellipsis", () => {
      const long =
        "VeryLongFilenameWithoutSpacesThatWouldOverflowAToastOtherwise";
      const result = truncatedMediaToastLabel({ name: long }, 20);
      expect(result.length).toBeLessThanOrEqual(20);
      expect(result.endsWith("…")).toBe(true);
      expect(result.startsWith("VeryLongFilenameWi")).toBe(true);
    });

    it("matches mediaLibraryDisplayName when under limit", () => {
      const name = "Short";
      expect(truncatedMediaToastLabel({ name })).toBe(
        mediaLibraryDisplayName({ name }),
      );
    });
  });
});
