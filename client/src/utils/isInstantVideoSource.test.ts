import { isInstantVideoSource } from "./isInstantVideoSource";

describe("isInstantVideoSource", () => {
  it("treats local and cached protocols as instant", () => {
    expect(isInstantVideoSource("media-cache://clip.mp4")).toBe(true);
    expect(isInstantVideoSource("worshipsync-media://asset/1")).toBe(true);
    expect(isInstantVideoSource("blob:https://localhost/1")).toBe(true);
  });

  it("treats remote streams as non-instant", () => {
    expect(isInstantVideoSource("https://cdn.example.com/clip.mp4")).toBe(
      false,
    );
    expect(isInstantVideoSource("https://stream.example.com/live.m3u8")).toBe(
      false,
    );
    expect(isInstantVideoSource(undefined)).toBe(false);
  });
});
