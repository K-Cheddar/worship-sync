import type { FileUploadProgress } from "./MediaUploadInput.types";
import { getMediaBatchProgress, getMediaCloudFileProgress, getMediaFileProgress } from "./mediaUploadProgress";

const file = (status: FileUploadProgress["status"], progress: number): FileUploadProgress => ({
  file: new File(["x"], "media.png", { type: "image/png" }),
  displayName: "media.png",
  fileType: "image",
  status,
  progress,
});

describe("media upload progress", () => {
  it("maps cloud callback progress after the 40 percent local import portion", () => {
    expect(getMediaCloudFileProgress(63)).toBeCloseTo(77.8);
    expect(getMediaFileProgress(file("uploading", getMediaCloudFileProgress(63)))).toBeCloseTo(77.8);
  });

  it("averages normalized file progress, including files already completed", () => {
    expect(getMediaBatchProgress([file("ready", 100), file("uploading", 40)])).toBe(70);
    expect(getMediaBatchProgress([file("uploading", 40), file("ready", 100)])).toBe(70);
    expect(getMediaBatchProgress([])).toBeNull();
  });
});
