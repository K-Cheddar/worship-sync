import {
  capitalizeFirstLetter,
  checkMediaType,
  getImageFromVideoUrl,
  getLetterFromIndex,
  levenshteinDistance,
  getMatchForString,
  updateWordMatches,
} from "./generalUtils";

describe("generalUtils", () => {
  describe("capitalizeFirstLetter", () => {
    it("returns empty string for undefined", () => {
      expect(capitalizeFirstLetter(undefined)).toBe("");
    });

    it("returns empty string for null", () => {
      expect(capitalizeFirstLetter(null)).toBe("");
    });

    it("returns empty string for empty string", () => {
      expect(capitalizeFirstLetter("")).toBe("");
    });

    it("capitalizes first character", () => {
      expect(capitalizeFirstLetter("hello")).toBe("Hello");
    });

    it("leaves rest of string unchanged", () => {
      expect(capitalizeFirstLetter("hELLO")).toBe("HELLO");
    });

    it("handles single character", () => {
      expect(capitalizeFirstLetter("a")).toBe("A");
    });
  });

  describe("checkMediaType", () => {
    it("returns image when url is undefined", () => {
      expect(checkMediaType(undefined)).toBe("image");
    });

    it("returns image when url is empty", () => {
      expect(checkMediaType("")).toBe("image");
    });

    it("returns video for Cloudinary video URL", () => {
      expect(
        checkMediaType(
          "https://res.cloudinary.com/portable-media/video/upload/xyz",
        ),
      ).toBe("video");
    });

    it("returns video for Mux URL", () => {
      expect(checkMediaType("https://stream.mux.com/abc123")).toBe("video");
    });

    it("returns image for plain image URL", () => {
      expect(checkMediaType("https://example.com/photo.jpg")).toBe("image");
    });
  });

  describe("getImageFromVideoUrl", () => {
    it("returns empty string when url is undefined", () => {
      expect(getImageFromVideoUrl(undefined)).toBe("");
    });

    it("returns thumbnail URL for Mux URL", () => {
      const result = getImageFromVideoUrl(
        "https://stream.mux.com/playbackId123",
      );
      expect(result).toContain("image.mux.com");
      expect(result).toContain("playbackId123");
      expect(result).toContain("thumbnail.png");
    });

    it("returns PNG variant for Cloudinary-style URL", () => {
      const result = getImageFromVideoUrl(
        "https://res.cloudinary.com/portable-media/video/upload/sp_auto/sample.m3u8",
      );
      expect(result).toMatch(/\.png$/);
    });
  });

  describe("getLetterFromIndex", () => {
    it("returns a-z for indices 0-25", () => {
      expect(getLetterFromIndex(0)).toBe("a");
      expect(getLetterFromIndex(25)).toBe("z");
      expect(getLetterFromIndex(5)).toBe("f");
    });

    it("returns aa for index 26", () => {
      expect(getLetterFromIndex(26)).toBe("aa");
    });

    it("wraps in zero-width when requested", () => {
      expect(getLetterFromIndex(0, true)).toBe("\u200Ba\u200B");
    });
  });

  describe("levenshteinDistance", () => {
    it("returns 0 for identical strings", () => {
      expect(levenshteinDistance("hello", "hello")).toBe(0);
    });

    it("returns string length when other is empty", () => {
      expect(levenshteinDistance("hello", "")).toBe(5);
      expect(levenshteinDistance("", "hello")).toBe(5);
    });

    it("returns 1 for one character substitution", () => {
      expect(levenshteinDistance("cat", "bat")).toBe(1);
    });

    it("returns 1 for one character insertion", () => {
      expect(levenshteinDistance("cat", "cart")).toBe(1);
    });
  });

  describe("getMatchForString", () => {
    it("returns 0 for empty search", () => {
      expect(
        getMatchForString({ string: "hello world", searchValue: "" }),
      ).toBe(0);
    });

    it("returns higher score for exact match", () => {
      const exact = getMatchForString({
        string: "hello world",
        searchValue: "hello world",
      });
      const partial = getMatchForString({
        string: "hello world",
        searchValue: "hello",
      });
      expect(exact).toBeGreaterThan(partial);
    });

    it("returns positive score when phrase is contained", () => {
      const score = getMatchForString({
        string: "the quick brown fox",
        searchValue: "quick brown",
      });
      expect(score).toBeGreaterThan(0);
    });
  });

  describe("updateWordMatches", () => {
    it("returns first match when all matches are 0", () => {
      const result = updateWordMatches({
        matchedWords: "initial",
        match: 0,
        wordMatches: [
          { match: 0, matchedWords: "a" },
          { match: 0, matchedWords: "b" },
        ],
      });
      expect(result.updatedMatchedWords).toBe("initial");
      expect(result.updatedMatch).toBe(0);
    });

    it("returns most matched word when one has higher match", () => {
      const result = updateWordMatches({
        matchedWords: "initial",
        match: 0,
        wordMatches: [
          { match: 0.5, matchedWords: "low" },
          { match: 1.5, matchedWords: "high" },
        ],
      });
      expect(result.updatedMatchedWords).toBe("high");
      expect(result.updatedMatch).toBe(1.5);
    });
  });
});
