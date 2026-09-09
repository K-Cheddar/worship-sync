import {
  buildLocalVideoFileUrl,
  parseLocalVideoFileAssetId,
} from "./localVideoFileAssets";
import { resolveServiceItemLocalVideoFile } from "./resolveServiceItemLocalVideoFile";
import type { MediaType, ServiceItem } from "../types";

describe("resolveServiceItemLocalVideoFile", () => {
  const localVideoFile = {
    id: "video-1",
    ownerDeviceId: "device-1",
    ownerLabel: "This PC",
    fileName: "clip.mp4",
    contentType: "video/mp4",
    storagePolicy: "local-only" as const,
  };

  it("returns the item localVideoFile when present", () => {
    const item: Pick<ServiceItem, "background" | "localVideoFile"> = {
      background: buildLocalVideoFileUrl("video-1"),
      localVideoFile,
    };
    expect(resolveServiceItemLocalVideoFile(item, [])).toBe(localVideoFile);
  });

  it("recovers localVideoFile from the media library for legacy outline rows", () => {
    const item: Pick<ServiceItem, "background" | "localVideoFile"> = {
      background: buildLocalVideoFileUrl("video-1"),
    };
    const media = {
      id: "video-1",
      background: buildLocalVideoFileUrl("video-1"),
      localVideoFile,
    } as MediaType;
    expect(resolveServiceItemLocalVideoFile(item, [media])).toEqual(
      localVideoFile,
    );
  });

  it("returns undefined for normal remote backgrounds", () => {
    expect(
      resolveServiceItemLocalVideoFile({
        background: "https://example.com/clip.mp4",
      }),
    ).toBeUndefined();
  });
});

describe("parseLocalVideoFileAssetId", () => {
  it("decodes asset ids from local-video-file URLs", () => {
    expect(parseLocalVideoFileAssetId(buildLocalVideoFileUrl("video 1"))).toBe(
      "video 1",
    );
  });
});
