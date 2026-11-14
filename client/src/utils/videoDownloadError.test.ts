import { videoDownloadErrorMessage } from "./videoDownloadError";

describe("videoDownloadErrorMessage", () => {
  it("removes Electron invoke boilerplate while preserving the useful message", () => {
    expect(videoDownloadErrorMessage(
      new Error("Error invoking remote method 'inspect-video-url': Error: YouTube is limiting this request."),
      "Fallback",
    )).toBe("YouTube is limiting this request.");
  });

  it("uses the fallback when an error has no readable message", () => {
    expect(videoDownloadErrorMessage(new Error(" "), "Could not inspect this link.")).toBe("Could not inspect this link.");
    expect(videoDownloadErrorMessage({ message: "failed" }, "Could not inspect this link.")).toBe("Could not inspect this link.");
  });
});
