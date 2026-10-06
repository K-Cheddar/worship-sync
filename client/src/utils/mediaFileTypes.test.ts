import mediaImageFormats from "../../../shared/mediaImageFormats.json";
import { getImageContentType, isRecognizedImageFile } from "./mediaFileTypes";
import {
  detectFileType,
  validateFiles,
} from "../containers/Media/utils/fileUtils";

// These examples independently pin the intentional application/provider contract.
const expectedFormats = [
  ["avif", "image/avif", "avif"],
  ["bmp", "image/bmp", "bmp"],
  ["gif", "image/gif", "gif"],
  ["heic", "image/heic", "heic"],
  ["heif", "image/heif", "heic"],
  ["jpg", "image/jpeg", "jpg"],
  ["jpeg", "image/jpeg", "jpg"],
  ["jpe", "image/jpeg", "jpg"],
  ["jxl", "image/jxl", "jxl"],
  ["png", "image/png", "png"],
  ["svg", "image/svg+xml", "svg"],
  ["tiff", "image/tiff", "tiff"],
  ["tif", "image/tiff", "tiff"],
  ["webp", "image/webp", "webp"],
  ["ico", "image/x-icon", "ico"],
];

describe("shared Media image format contract", () => {
  it.each(expectedFormats)(
    "recognizes .%s and %s and admits provider format %s",
    (extension, mimeType, cloudinaryFormat) => {
      expect(mediaImageFormats).toContainEqual(
        expect.objectContaining({
          mimeType,
          cloudinaryFormat,
          extensions: expect.arrayContaining([extension]),
        }),
      );
      for (const type of [mimeType, "", "application/octet-stream"]) {
        const file = new File(["image"], `photo.${extension.toUpperCase()}`, {
          type,
        });
        expect(isRecognizedImageFile(file)).toBe(true);
        expect(getImageContentType(file)).toBe(mimeType);
        expect(detectFileType(file)).toBe("image");
        expect(validateFiles([file])).toEqual({ valid: [file], invalid: [] });
      }
    },
  );

  it("contains only the intentional image formats", () => {
    expect(
      mediaImageFormats.flatMap(({ mimeType, extensions, cloudinaryFormat }) =>
        extensions.map((extension) => [extension, mimeType, cloudinaryFormat]),
      ),
    ).toEqual(expectedFormats);
  });

  it("rejects arbitrary extensions without a recognized media MIME type", () => {
    for (const extension of ["unknown", "pdf", "psd", "ai", "glb"]) {
      const file = new File(["data"], `file.${extension}`, {
        type: "application/octet-stream",
      });
      expect(isRecognizedImageFile(file)).toBe(false);
      expect(validateFiles([file])).toEqual({ valid: [], invalid: [file] });
    }
  });

  it("preserves broad local image MIME recognition", () => {
    expect(
      isRecognizedImageFile({ name: "image.custom", type: "image/custom" }),
    ).toBe(true);
  });
});
