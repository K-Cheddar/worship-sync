import type { MediaType } from "../../types";
import {
  formatMediaDimensionsLine,
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

  describe("formatMediaDimensionsLine", () => {
    const media = (overrides: Partial<MediaType> = {}): MediaType => ({
      path: "",
      createdAt: "",
      updatedAt: "",
      format: "mp4",
      height: 1080,
      width: 1920,
      name: "clip.mp4",
      publicId: "clip",
      type: "video",
      id: "media-1",
      background: "",
      thumbnail: "",
      duration: 311,
      source: "local",
      ...overrides,
    });

    it("labels the classified origin instead of the storage provider", () => {
      expect(formatMediaDimensionsLine(media())).toBe(
        "1920×1080 · mp4 · 311s · local",
      );
      expect(
        formatMediaDimensionsLine(
          media({
            localVideoInput: {
              kind: "local-video-input",
              sourceId: "src-1",
              label: "USB Capture",
            },
          }),
        ),
      ).toBe("1920×1080 · mp4 · 311s · video input");
      expect(
        formatMediaDimensionsLine(
          media({
            source: "cloudinary",
            canvaImportKey: "canva:DAF_1:rev:1:mp4:1",
          }),
        ),
      ).toBe("1920×1080 · mp4 · 311s · canva");
      expect(
        formatMediaDimensionsLine(
          media({ source: "mux", format: "mp4" }),
        ),
      ).toBe("1920×1080 · mp4 · 311s · uploaded");
    });
  });
});
