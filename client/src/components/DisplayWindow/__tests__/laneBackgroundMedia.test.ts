import type { Box, LocalVideoInputPresentation } from "../../../types";
import {
  getLaneBackgroundMediaKey,
  getSnapshotBackgroundIdentity,
  getSnapshotForegroundIdentity,
  resolveLaneBackgroundMedia,
} from "../laneBackgroundMedia";

const imageBox: Box = {
  id: "image",
  words: "",
  width: 100,
  height: 100,
  background: "https://cdn.example/image.jpg",
};

const videoBox: Box = {
  id: "video",
  words: "",
  width: 100,
  height: 100,
  mediaInfo: {
    id: "video-1",
    type: "video",
    background: "https://cdn.example/clip.mp4",
  } as NonNullable<Box["mediaInfo"]>,
};

const localInput: LocalVideoInputPresentation = {
  sourceId: "cam-1",
  deviceLabel: "USB",
  ownerDeviceId: "device-1",
  ownerLabel: "Booth",
};

describe("laneBackgroundMedia", () => {
  it("prefers local capture over file video", () => {
    const media = resolveLaneBackgroundMedia({
      boxes: [videoBox],
      showBackground: true,
      shouldPlayVideo: true,
      localVideoInput: localInput,
      resolvedFileVideoUrl: "https://cdn.example/clip.mp4",
    });
    expect(media).toEqual({ kind: "localVideo", input: localInput });
    expect(getLaneBackgroundMediaKey(media)).toBe("local:cam-1");
  });

  it("resolves file video when playback is enabled", () => {
    const media = resolveLaneBackgroundMedia({
      boxes: [videoBox],
      showBackground: true,
      shouldPlayVideo: true,
      resolvedFileVideoUrl: "worshipsync-media://asset/1",
    });
    expect(media).toEqual(
      expect.objectContaining({
        kind: "fileVideo",
        originalSrc: "worshipsync-media://asset/1",
      }),
    );
  });

  it("returns none for image-only slides", () => {
    const media = resolveLaneBackgroundMedia({
      boxes: [imageBox],
      showBackground: true,
      shouldPlayVideo: true,
    });
    expect(media).toEqual({ kind: "none" });
    expect(getLaneBackgroundMediaKey(media)).toBe("none");
  });

  it("keeps the same background identity across lyric-only slide changes", () => {
    const media = resolveLaneBackgroundMedia({
      boxes: [videoBox],
      showBackground: true,
      shouldPlayVideo: true,
      resolvedFileVideoUrl: "https://cdn.example/clip.mp4",
    });
    const first = getSnapshotBackgroundIdentity(media, [
      { ...videoBox, words: "Verse 1" },
    ]);
    const second = getSnapshotBackgroundIdentity(media, [
      { ...videoBox, words: "Verse 2" },
    ]);
    expect(first).toBe(second);
    expect(first).toMatch(/^file:/);
  });

  it("changes foreground identity when lyrics change", () => {
    const first = getSnapshotForegroundIdentity([
      { ...videoBox, words: "Verse 1" },
    ]);
    const second = getSnapshotForegroundIdentity([
      { ...videoBox, words: "Verse 2" },
    ]);
    const same = getSnapshotForegroundIdentity([
      { ...videoBox, words: "Verse 1", background: "other.jpg" },
    ]);
    expect(first).not.toBe(second);
    expect(first).toBe(same);
  });

  it("uses box image identity when there is no full-frame media", () => {
    const first = getSnapshotBackgroundIdentity({ kind: "none" }, [
      { ...imageBox, words: "A" },
    ]);
    const second = getSnapshotBackgroundIdentity({ kind: "none" }, [
      { ...imageBox, words: "B" },
    ]);
    const different = getSnapshotBackgroundIdentity({ kind: "none" }, [
      { ...imageBox, background: "https://cdn.example/other.jpg", words: "B" },
    ]);
    expect(first).toBe(second);
    expect(first).not.toBe(different);
  });
});
