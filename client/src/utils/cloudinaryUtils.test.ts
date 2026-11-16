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

  it("extracts a versionless id after a Cloudinary transformation", () => {
    expect(extractPublicId(
      "https://res.cloudinary.com/demo/image/upload/c_fill,w_640/f_auto/folder/photo.jpg?crop=1",
    )).toBe("folder/photo");
  });

  it("extracts a versionless id when no transformation is present", () => {
    expect(extractPublicId(
      "https://res.cloudinary.com/demo/image/upload/folder/photo.jpg",
    )).toBe("folder/photo");
    expect(extractPublicId(
      "https://res.cloudinary.com/demo/image/upload/folder/v123/photo.jpg",
    )).toBe("folder/v123/photo");
  });

  it("returns null for a non-Cloudinary URL", () => {
    expect(extractPublicId("https://example.com/photo.jpg")).toBeNull();
    expect(extractPublicId("https://res.cloudinary.com.attacker.invalid/demo/image/upload/v1/photo.jpg")).toBeNull();
    expect(extractPublicId("https://res.cloudinary.com:444/demo/image/upload/v1/photo.jpg")).toBeNull();
    expect(extractPublicId("https://res.cloudinary.com/demo/video/upload/v1/photo.mp4")).toBeNull();
    expect(extractPublicId("http://res.cloudinary.com/demo/image/upload/v1/photo.jpg")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(extractPublicId("")).toBeNull();
  });
});
