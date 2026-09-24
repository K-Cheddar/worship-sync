import {
  applyLocalVideoCaptureProfile,
  getLocalVideoRealtimeBitrate,
  resolveLocalVideoCaptureProfile,
} from "./localVideoQuality";
import {
  __getLocalVideoDiagnosticsForTests,
  __resetLocalVideoDiagnosticsForTests,
} from "./localVideoDiagnostics";

describe("localVideoQuality", () => {
  beforeEach(() => {
    localStorage.setItem("worshipsync_local_video_debug", "true");
    __resetLocalVideoDiagnosticsForTests();
  });

  afterEach(() => {
    localStorage.removeItem("worshipsync_local_video_debug");
    __resetLocalVideoDiagnosticsForTests();
  });
  it("uses the smallest profile that preserves the largest active output", () => {
    expect(
      resolveLocalVideoCaptureProfile([
        { width: 1_280, height: 720 },
        { width: 2_560, height: 1_440 },
      ]),
    ).toEqual({ id: "1440p", width: 2_560, height: 1_440 });
  });

  it("does not add two 1280x720 consumers into a 1440p demand", () => {
    expect(
      resolveLocalVideoCaptureProfile([
        { width: 1_280, height: 720 },
        { width: 1_280, height: 720 },
      ]).id,
    ).toBe("1080p");
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

  it("applies the smallest covering profile to a live capture track", async () => {
    const applyConstraints = jest.fn().mockResolvedValue(undefined);
    const getSettings = jest.fn().mockReturnValue({ width: 1_280, height: 720 });
    const stream = {
      getVideoTracks: () => [{ applyConstraints, getSettings }],
    } as unknown as MediaStream;

    await applyLocalVideoCaptureProfile(stream, 2_560, 1_440, "camera-1");

    expect(applyConstraints).toHaveBeenCalledWith({
      width: { ideal: 2_560 },
      height: { ideal: 1_440 },
      frameRate: { ideal: 60 },
    });
    expect(__getLocalVideoDiagnosticsForTests().get("camera-1")?.constraints).toEqual(
      expect.objectContaining({ succeeded: true, after: { width: 1_280, height: 720 } }),
    );
  });

  it("skips renegotiation when the track is already on that profile", async () => {
    const applyConstraints = jest.fn().mockResolvedValue(undefined);
    const videoTrack = { applyConstraints };
    const stream = {
      getVideoTracks: () => [videoTrack],
    } as unknown as MediaStream;

    await applyLocalVideoCaptureProfile(stream, 1_920, 1_080);
    await applyLocalVideoCaptureProfile(stream, 1_800, 1_000);

    expect(applyConstraints).toHaveBeenCalledTimes(1);
  });

  it("ignores capture modes that reject live renegotiation", async () => {
    const applyConstraints = jest
      .fn()
      .mockRejectedValue(new Error("unsupported"));
    const stream = {
      getVideoTracks: () => [{ applyConstraints }],
    } as unknown as MediaStream;

    await expect(
      applyLocalVideoCaptureProfile(stream, 1_920, 1_080),
    ).resolves.toBeUndefined();
  });
});
