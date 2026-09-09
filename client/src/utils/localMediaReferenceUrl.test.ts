import {
  isLocalMediaReferenceUrl,
  parseLocalVideoInputSourceId,
} from "./localMediaReferenceUrl";

describe("isLocalMediaReferenceUrl", () => {
  it("detects local image, video file, and video input reference schemes", () => {
    expect(isLocalMediaReferenceUrl("local-image://asset-1")).toBe(true);
    expect(isLocalMediaReferenceUrl("local-video-file://video-1")).toBe(true);
    expect(isLocalMediaReferenceUrl("local-video-input://source-1")).toBe(true);
  });

  it("allows real displayable URLs", () => {
    expect(isLocalMediaReferenceUrl("https://cdn.example.com/a.jpg")).toBe(
      false,
    );
    expect(isLocalMediaReferenceUrl("blob:http://localhost/1")).toBe(false);
    expect(isLocalMediaReferenceUrl("worshipsync-media://asset/1")).toBe(false);
    expect(isLocalMediaReferenceUrl("media-cache://clip.mp4")).toBe(false);
    expect(isLocalMediaReferenceUrl(undefined)).toBe(false);
    expect(isLocalMediaReferenceUrl("")).toBe(false);
  });
});

describe("parseLocalVideoInputSourceId", () => {
  it("decodes outline background references", () => {
    expect(parseLocalVideoInputSourceId("local-video-input://source-1")).toBe(
      "source-1",
    );
    expect(
      parseLocalVideoInputSourceId("local-video-input://source%2Dcam"),
    ).toBe("source-cam");
  });

  it("returns undefined for other URLs", () => {
    expect(parseLocalVideoInputSourceId("local-image://a")).toBeUndefined();
    expect(parseLocalVideoInputSourceId(undefined)).toBeUndefined();
  });
});
