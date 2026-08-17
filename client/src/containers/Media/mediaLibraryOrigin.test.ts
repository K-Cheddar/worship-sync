import type { MediaType } from "../../types";
import {
  getMediaLibraryOrigin,
  getMediaLibraryOriginBadgeLabel,
  isMediaOriginFilterValue,
  mediaMatchesOriginFilter,
  MEDIA_LIBRARY_ORIGIN_FILTER_OPTIONS,
  MEDIA_LIBRARY_ORIGINS,
} from "./mediaLibraryOrigin";

const baseMedia = (overrides: Partial<MediaType> = {}): MediaType => ({
  path: "",
  createdAt: "",
  updatedAt: "",
  format: "jpg",
  height: 1080,
  width: 1920,
  name: "Background",
  publicId: "bg",
  type: "image",
  id: "media-1",
  background: "https://example.com/bg.jpg",
  thumbnail: "https://example.com/thumb.jpg",
  source: "cloudinary",
  ...overrides,
});

describe("mediaLibraryOrigin", () => {
  it("exposes every origin operators can add from Media", () => {
    expect([...MEDIA_LIBRARY_ORIGINS]).toEqual([
      "uploaded",
      "local",
      "video-input",
      "canva",
    ]);
    expect(
      MEDIA_LIBRARY_ORIGIN_FILTER_OPTIONS.map((option) => option.value),
    ).toEqual(["all", ...MEDIA_LIBRARY_ORIGINS]);
    expect(isMediaOriginFilterValue("video-input")).toBe(true);
    expect(isMediaOriginFilterValue("usb")).toBe(false);
  });

  it("classifies uploaded cloud and mux items", () => {
    expect(getMediaLibraryOrigin(baseMedia())).toBe("uploaded");
    expect(
      getMediaLibraryOrigin(baseMedia({ source: "mux", type: "video" })),
    ).toBe("uploaded");
  });

  it("classifies local files ahead of the shared local source flag", () => {
    expect(getMediaLibraryOrigin(baseMedia({ source: "local" }))).toBe("local");
    expect(
      getMediaLibraryOrigin(
        baseMedia({
          source: "local",
          localImage: {
            id: "local_image_1",
            ownerDeviceId: "device-1",
            ownerLabel: "This PC",
            fileName: "slide.png",
            contentType: "image/png",
            storagePolicy: "local-only",
          },
        }),
      ),
    ).toBe("local");
    expect(
      getMediaLibraryOrigin(
        baseMedia({
          source: "local",
          type: "video",
          localVideoFile: {
            id: "local_video_1",
            ownerDeviceId: "device-1",
            ownerLabel: "This PC",
            fileName: "clip.mp4",
            contentType: "video/mp4",
            storagePolicy: "local-only",
          },
        }),
      ),
    ).toBe("local");
  });

  it("classifies live video inputs separately from local files", () => {
    expect(
      getMediaLibraryOrigin(
        baseMedia({
          source: "local",
          type: "video",
          localVideoInput: {
            kind: "local-video-input",
            sourceId: "src-1",
            label: "USB Capture",
          },
        }),
      ),
    ).toBe("video-input");
  });

  it("classifies Canva imports even when they uploaded through cloudinary or mux", () => {
    expect(
      getMediaLibraryOrigin(
        baseMedia({
          canvaImportKey: "canva:DAF_1:rev:1:png:1",
        }),
      ),
    ).toBe("canva");
    expect(
      getMediaLibraryOrigin(
        baseMedia({
          source: "mux",
          type: "video",
          canvaSource: {
            designId: "DAF_1",
            designTitle: "Welcome",
            revision: 2,
            format: "mp4",
            pageNumbers: [1],
          },
        }),
      ),
    ).toBe("canva");
  });

  it("filters by the classified origin", () => {
    const local = baseMedia({
      source: "local",
      localVideoFile: {
        id: "local_video_1",
        ownerDeviceId: "device-1",
        ownerLabel: "This PC",
        fileName: "clip.mp4",
        contentType: "video/mp4",
        storagePolicy: "local-only",
      },
    });
    expect(mediaMatchesOriginFilter(local, "all")).toBe(true);
    expect(mediaMatchesOriginFilter(local, "local")).toBe(true);
    expect(mediaMatchesOriginFilter(local, "canva")).toBe(false);
    expect(mediaMatchesOriginFilter(baseMedia(), "uploaded")).toBe(true);
  });

  it("omits origin badges for uploaded library items", () => {
    expect(getMediaLibraryOriginBadgeLabel(baseMedia())).toBeNull();
    expect(
      getMediaLibraryOriginBadgeLabel(
        baseMedia({
          source: "local",
          localVideoInput: {
            kind: "local-video-input",
            sourceId: "src-1",
            label: "USB Capture",
          },
        }),
      ),
    ).toBe("Video input");
    expect(
      getMediaLibraryOriginBadgeLabel(
        baseMedia({ canvaImportKey: "canva:DAF_1:rev:1:png:1" }),
      ),
    ).toBe("Canva");
  });
});
