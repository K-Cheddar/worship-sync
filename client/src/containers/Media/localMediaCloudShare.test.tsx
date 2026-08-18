import type { MediaType } from "../../types";
import {
  buildLocalVideoCloudSharePatch,
  createMediaCloudUploadRequest,
  getLocalMediaCloudShareBarAction,
} from "./localMediaCloudShare";

const deviceId = "this-device";

const ownedVideo = (overrides: Partial<MediaType> = {}): MediaType => ({
  path: "",
  createdAt: "",
  updatedAt: "",
  format: "mp4",
  height: 1080,
  width: 1920,
  name: "clip.mp4",
  publicId: "local_video_1",
  type: "video",
  id: "local_video_1",
  background: "local-video-file://local_video_1",
  thumbnail: "",
  source: "local",
  localVideoFile: {
    id: "local_video_1",
    ownerDeviceId: deviceId,
    ownerLabel: "Booth PC",
    fileName: "clip.mp4",
    contentType: "video/mp4",
    storagePolicy: "local-only",
  },
  ...overrides,
});

describe("localMediaCloudShare", () => {
  it("offers Upload to cloud on the owner device", () => {
    const action = getLocalMediaCloudShareBarAction({
      media: ownedVideo(),
      deviceId,
      isGuest: false,
      onUpload: jest.fn(),
      onRequest: jest.fn(),
    });
    expect(action?.id).toBe("upload-local-media-cloud");
    expect(action?.label).toBe("Upload to cloud");
  });

  it("lets another device ask once", () => {
    const media = ownedVideo({
      localVideoFile: {
        id: "local_video_1",
        ownerDeviceId: "other-device",
        ownerLabel: "Laptop",
        fileName: "clip.mp4",
        contentType: "video/mp4",
        storagePolicy: "local-only",
      },
    });
    const first = getLocalMediaCloudShareBarAction({
      media,
      deviceId,
      isGuest: false,
      onUpload: jest.fn(),
      onRequest: jest.fn(),
    });
    expect(first?.id).toBe("ask-local-media-cloud-upload");
    expect(first?.disabled).toBe(false);

    const asked = getLocalMediaCloudShareBarAction({
      media: {
        ...media,
        cloudUploadRequest: createMediaCloudUploadRequest(deviceId, "Chrome"),
      },
      deviceId,
      isGuest: false,
      onUpload: jest.fn(),
      onRequest: jest.fn(),
    });
    expect(asked?.label).toBe("Asked to upload");
    expect(asked?.disabled).toBe(true);
  });

  it("does not offer cloud actions to guests or for USB inputs", () => {
    expect(
      getLocalMediaCloudShareBarAction({
        media: ownedVideo(),
        deviceId,
        isGuest: true,
        onUpload: jest.fn(),
        onRequest: jest.fn(),
      }),
    ).toBeNull();
    expect(
      getLocalMediaCloudShareBarAction({
        media: ownedVideo({
          localVideoFile: undefined,
          localVideoInput: {
            kind: "local-video-input",
            sourceId: "src-1",
            label: "USB Capture",
            ownerDeviceId: deviceId,
            ownerLabel: "Booth PC",
          },
        }),
        deviceId,
        isGuest: false,
        onUpload: jest.fn(),
        onRequest: jest.fn(),
      }),
    ).toBeNull();
  });

  it("attaches Mux playback to the existing local video item", () => {
    const patch = buildLocalVideoCloudSharePatch(ownedVideo(), {
      playbackId: "play-1",
      assetId: "asset-1",
      playbackUrl: "https://stream.mux.com/play-1.m3u8",
      thumbnailUrl: "https://image.mux.com/play-1/thumbnail.png",
      name: "clip",
    });
    expect(patch.background).toBe("https://stream.mux.com/play-1.m3u8");
    expect(patch.muxPlaybackId).toBe("play-1");
    expect(patch.cloudUploadRequest).toBeNull();
    expect(patch.localVideoFile?.cloudUrl).toBe(
      "https://stream.mux.com/play-1.m3u8",
    );
    expect(patch.localVideoFile?.storagePolicy).toBe("local-and-cloud");
  });
});
