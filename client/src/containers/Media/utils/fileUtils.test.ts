import { detectFileType, validateFiles } from "./fileUtils";

describe("media file classification", () => {
  it("accepts a MOV when the file picker does not provide a MIME type", () => {
    const file = new File(["video"], "camera.MOV", { type: "" });

    expect(detectFileType(file)).toBe("video");
    expect(validateFiles([file])).toEqual({ valid: [file], invalid: [] });
  });

  it("accepts common video containers for cloud transcoding", () => {
    const files = [
      new File(["video"], "clip.mkv", { type: "application/octet-stream" }),
      new File(["video"], "clip.avi", { type: "" }),
      new File(["video"], "clip.m4v", { type: "" }),
    ];

    expect(validateFiles(files)).toEqual({ valid: files, invalid: [] });
  });

  it("still rejects files with no supported media type or extension", () => {
    const file = new File(["data"], "notes.txt", {
      type: "application/octet-stream",
    });

    expect(validateFiles([file])).toEqual({ valid: [], invalid: [file] });
  });
});
