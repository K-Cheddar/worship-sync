import { extractPublicId } from "./cloudinaryUtils";

describe("extractPublicId", () => {
  it("extracts public id from a standard Cloudinary image URL", () => {
    const url =
      "https://res.cloudinary.com/portable-media/image/upload/v1/backgrounds/image1.jpg";
    expect(extractPublicId(url)).toBe("backgrounds/image1");
  });

  it("strips the file extension", () => {
    const url =
      "https://res.cloudinary.com/portable-media/image/upload/v1234567890/folder/photo.png";
    expect(extractPublicId(url)).toBe("folder/photo");
  });

  it("handles nested folder paths", () => {
    const url =
      "https://res.cloudinary.com/demo/image/upload/v1/a/b/c/file.gif";
    expect(extractPublicId(url)).toBe("a/b/c/file");
  });

  it("stops at the query string boundary", () => {
    const url =
      "https://res.cloudinary.com/demo/image/upload/v1/sample.jpg?foo=bar";
    expect(extractPublicId(url)).toBe("sample");
  });

  it("returns the id as-is when there is no file extension", () => {
    const url =
      "https://res.cloudinary.com/demo/image/upload/v1/some-id";
    expect(extractPublicId(url)).toBe("some-id");
  });

  it("returns null for a non-Cloudinary URL", () => {
    expect(extractPublicId("https://example.com/photo.jpg")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(extractPublicId("")).toBeNull();
  });
});
