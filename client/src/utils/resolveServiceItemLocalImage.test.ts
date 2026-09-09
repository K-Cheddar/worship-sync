import { buildLocalImageUrl, parseLocalImageAssetId } from "./localImageAssets";
import { resolveServiceItemLocalImage } from "./resolveServiceItemLocalImage";
import type { MediaType, ServiceItem } from "../types";

describe("resolveServiceItemLocalImage", () => {
  const localImage = {
    id: "asset-1",
    ownerDeviceId: "device-1",
    ownerLabel: "This PC",
    fileName: "slide.png",
    contentType: "image/png",
    storagePolicy: "local-and-cloud" as const,
    cloudUrl: "https://res.cloudinary.com/example/slide.png",
  };

  it("returns the item localImage when present", () => {
    const item: Pick<ServiceItem, "background" | "localImage"> = {
      background: buildLocalImageUrl("asset-1"),
      localImage,
    };
    expect(resolveServiceItemLocalImage(item, [])).toBe(localImage);
  });

  it("recovers localImage from the media library for legacy outline rows", () => {
    const item: Pick<ServiceItem, "background" | "localImage"> = {
      background: buildLocalImageUrl("asset-1"),
    };
    const media = {
      id: "asset-1",
      background: buildLocalImageUrl("asset-1"),
      localImage,
    } as MediaType;
    expect(resolveServiceItemLocalImage(item, [media])).toEqual(localImage);
  });

  it("returns undefined for normal remote backgrounds", () => {
    expect(
      resolveServiceItemLocalImage({
        background: "https://example.com/slide.jpg",
      }),
    ).toBeUndefined();
  });
});

describe("parseLocalImageAssetId", () => {
  it("decodes asset ids from local-image URLs", () => {
    expect(parseLocalImageAssetId(buildLocalImageUrl("asset 1"))).toBe(
      "asset 1",
    );
  });
});
