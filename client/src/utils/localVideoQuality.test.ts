import {
  getLocalVideoRealtimeBitrate,
  resolveLocalVideoCaptureProfile,
} from "./localVideoQuality";

describe("localVideoQuality", () => {
  it("uses the smallest profile that preserves the largest active output", () => {
    expect(
      resolveLocalVideoCaptureProfile([
        { width: 1_280, height: 720 },
        { width: 2_560, height: 1_440 },
      ]),
    ).toEqual({ id: "1440p", width: 2_560, height: 1_440 });
  });

  it("does not request 4K work for a 1440p output", () => {
    expect(
      resolveLocalVideoCaptureProfile([{ width: 2_560, height: 1_440 }]).id,
    ).toBe("1440p");
  });

  it("keeps a detailed controller preview when no output reports a size", () => {
    expect(resolveLocalVideoCaptureProfile([]).id).toBe("1080p");
  });

  it("keeps a stable 1080p floor instead of renegotiating capture cards to 720p", () => {
    expect(
      resolveLocalVideoCaptureProfile([{ width: 1_280, height: 720 }]),
    ).toEqual({ id: "1080p", width: 1_920, height: 1_080 });
  });

  it("caps oversized output requests at 4K", () => {
    expect(
      resolveLocalVideoCaptureProfile([{ width: 7_680, height: 4_320 }]),
    ).toEqual({ id: "2160p", width: 3_840, height: 2_160 });
  });

  it("scales realtime bitrate with actual resolution and frame rate", () => {
    const fullHd = getLocalVideoRealtimeBitrate(1_920, 1_080, 60);
    const quadHd = getLocalVideoRealtimeBitrate(2_560, 1_440, 60);
    const quadHd30 = getLocalVideoRealtimeBitrate(2_560, 1_440, 30);

    expect(fullHd).toBe(11_250_000);
    expect(quadHd).toBe(20_000_000);
    expect(quadHd30).toBe(10_000_000);
  });
});
