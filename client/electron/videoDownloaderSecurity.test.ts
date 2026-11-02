import {
  getCompatibleVideoQualities,
  validateExtractorRequestUrl,
  validateSupportedVideoUrl,
} from "./videoDownloaderSecurity";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 as const }];

describe("native video download URL and format policy", () => {
  it.each([
    "file:///C:/private/video.mp4",
    "http://youtube.com/watch?v=abc123",
    "https://127.0.0.1/watch?v=abc123",
    "https://youtube.com.evil.example/watch?v=abc123",
    "https://user:pass@youtube.com/watch?v=abc123",
    "https://www.youtube.com/playlist?list=PL123",
  ])("rejects unsupported or unsafe video URL %s", (url) => {
    expect(() => validateSupportedVideoUrl(url)).toThrow();
  });

  it("accepts a single public YouTube video and removes no URL parameters", () => {
    expect(validateSupportedVideoUrl("https://youtu.be/video123?t=15"))
      .toBe("https://youtu.be/video123?t=15");
  });

  it("pins an allowed extractor host to a validated public address", async () => {
    await expect(validateExtractorRequestUrl(
      "https://r3---sn.googlevideo.com/videoplayback",
      publicLookup,
    )).resolves.toMatchObject({ address: { address: "93.184.216.34", family: 4 } });
  });

  it("rejects a permitted provider hostname resolving to a private address", async () => {
    const privateLookup = async () => [{ address: "10.0.0.5", family: 4 as const }];
    await expect(validateExtractorRequestUrl(
      "https://r3---sn.googlevideo.com/videoplayback",
      privateLookup,
    )).rejects.toThrow(/private or local network/);
    await expect(validateExtractorRequestUrl("http://127.0.0.1/metadata"))
      .rejects.toThrow(/unsupported network address/);
  });

  it("offers only resolutions with compatible H.264 MP4 and AAC audio", () => {
    expect(getCompatibleVideoQualities([
      { ext: "mp4", vcodec: "avc1.640028", acodec: "none", height: 1080 },
      { ext: "m4a", vcodec: "none", acodec: "mp4a.40.2" },
      { ext: "mp4", vcodec: "av01.0.08M.08", acodec: "none", height: 2160 },
      { ext: "mp4", vcodec: "avc1.64001f", acodec: "mp4a.40.2", height: 720 },
    ])).toEqual([1080, 720]);
    expect(() => getCompatibleVideoQualities([
      { ext: "webm", vcodec: "vp9", acodec: "none", height: 1080 },
    ])).toThrow(/without conversion/);
  });
});
