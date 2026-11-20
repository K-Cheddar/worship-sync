import { parseYtDlpProgressLine } from "./videoDownloader";

describe("yt-dlp progress parsing", () => {
  it("parses separate stream and unknown-total output captured from yt-dlp 2026.10.26", () => {
    // Captured on Windows from the pinned executable downloading local HTTP fixtures.
    // The source URLs and output paths are omitted; the progress lines are unchanged.
    expect(parseYtDlpProgressLine(
      "WSYNC_PROGRESS:137:avc1.640028:none:784914:2097152:NA:262012.01993290862:5",
    )).toEqual({
      streamId: "137",
      streamLabel: "Video",
      downloadedBytes: 784914,
      totalBytes: 2097152,
      speedBytesPerSecond: 262012.01993290862,
      etaSeconds: 5,
    });
    expect(parseYtDlpProgressLine(
      "WSYNC_PROGRESS:140:none:mp4a.40.2:261120:524288:NA:261823.13826157174:1",
    )).toEqual({
      streamId: "140",
      streamLabel: "Audio",
      downloadedBytes: 261120,
      totalBytes: 524288,
      speedBytesPerSecond: 261823.13826157174,
      etaSeconds: 1,
    });
    expect(parseYtDlpProgressLine(
      "WSYNC_PROGRESS:unknown:avc1.640028:none:523096:NA:NA:131028.5718746678:NA",
    )).toEqual({
      streamId: "unknown",
      streamLabel: "Video",
      downloadedBytes: 523096,
      totalBytes: undefined,
      speedBytesPerSecond: 131028.5718746678,
      etaSeconds: undefined,
    });
  });

  it("captures known size, speed, ETA, and an audio stream identity", () => {
    expect(parseYtDlpProgressLine(
      "WSYNC_PROGRESS:140:NA:mp4a.40.2:1048576:4194304:NA:524288:6",
    )).toEqual({
      streamId: "140",
      streamLabel: "Audio",
      downloadedBytes: 1048576,
      totalBytes: 4194304,
      speedBytesPerSecond: 524288,
      etaSeconds: 6,
    });
  });

  it("uses estimated size when known size is unavailable", () => {
    expect(parseYtDlpProgressLine(
      "WSYNC_PROGRESS:137:avc1.640028:NA:2097152:NA:8388608:NA:NA",
    )).toMatchObject({
      streamId: "137",
      streamLabel: "Video",
      downloadedBytes: 2097152,
      totalBytes: 8388608,
      speedBytesPerSecond: undefined,
      etaSeconds: undefined,
    });
  });

  it("keeps progress indeterminate when neither total is known", () => {
    expect(parseYtDlpProgressLine(
      "WSYNC_PROGRESS:137:avc1.640028:NA:2097152:NA:NA:NA:NA",
    )).toMatchObject({
      downloadedBytes: 2097152,
      totalBytes: undefined,
      speedBytesPerSecond: undefined,
      etaSeconds: undefined,
    });
  });

  it("accepts the previous byte-only progress template", () => {
    expect(parseYtDlpProgressLine("WSYNC_PROGRESS:100:200:300")).toEqual({
      downloadedBytes: 100,
      totalBytes: 200,
    });
    expect(parseYtDlpProgressLine("WSYNC_PROGRESS:100:NA:300")).toEqual({
      downloadedBytes: 100,
      totalBytes: 300,
    });
  });

  it("ignores malformed progress lines", () => {
    expect(parseYtDlpProgressLine("WSYNC_PROGRESS:1:2:3:4")).toBeNull();
  });
});
