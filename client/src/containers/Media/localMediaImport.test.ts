import generateRandomId from "../../utils/generateRandomId";
import {
  readImageDimensions,
  saveLocalImage,
} from "../../utils/localImageAssets";
import {
  readVideoMetadata,
  readVideoMetadataFromLocalAsset,
  deleteLocalVideoThumbnail,
  saveLocalVideoFile,
} from "../../utils/localVideoFileAssets";
import {
  createLocalMediaFromFile,
  createLocalMediaFromDownloadedVideo,
  createLocalMediaFromLinkedVideo,
  LocalImagePlaybackError,
} from "./localMediaImport";

jest.mock("../../utils/generateRandomId");
jest.mock("../../utils/localImageAssets", () => ({
  ...jest.requireActual("../../utils/localImageAssets"),
  readImageDimensions: jest.fn(),
  saveLocalImage: jest.fn(),
}));
jest.mock("../../utils/localVideoFileAssets", () => ({
  ...jest.requireActual("../../utils/localVideoFileAssets"),
  readVideoMetadata: jest.fn(),
  readVideoMetadataFromLocalAsset: jest.fn(),
  deleteLocalVideoThumbnail: jest.fn(),
  saveLocalVideoFile: jest.fn(),
}));

const mockedGenerateRandomId = jest.mocked(generateRandomId);
const mockedReadImageDimensions = jest.mocked(readImageDimensions);
const mockedSaveLocalImage = jest.mocked(saveLocalImage);
const mockedReadVideoMetadata = jest.mocked(readVideoMetadata);
const mockedSaveLocalVideoFile = jest.mocked(saveLocalVideoFile);

describe("createLocalMediaFromFile", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGenerateRandomId.mockReturnValue("asset-1");
    mockedReadImageDimensions.mockResolvedValue({ width: 1920, height: 1080 });
    mockedSaveLocalImage.mockResolvedValue();
    mockedReadVideoMetadata.mockResolvedValue({
      width: 1920,
      height: 1080,
      duration: 12,
    });
    mockedSaveLocalVideoFile.mockResolvedValue();
  });

  it("validates a staged linked replacement without changing local records or thumbnails", async () => {
    const asset = { assetId: "candidate", kind: "video", storageMode: "linked", size: 100,
      fileName: "replacement.mp4", contentType: "video/mp4", contentHash: "b".repeat(64),
      url: "worshipsync-media://asset/candidate" } as const;
    jest.mocked(readVideoMetadataFromLocalAsset).mockResolvedValueOnce({ width: 1280, height: 720, duration: 90 });
    const media = await createLocalMediaFromLinkedVideo({ asset: asset as never, workspaceId: "church-1", validateOnly: true });
    expect(media).toMatchObject({ width: 1280, height: 720, duration: 90 });
    expect(mockedSaveLocalVideoFile).not.toHaveBeenCalled();
    expect(deleteLocalVideoThumbnail).not.toHaveBeenCalled();
    jest.mocked(readVideoMetadataFromLocalAsset).mockRejectedValueOnce(new Error("unsupported codec"));
    await expect(createLocalMediaFromLinkedVideo({ asset: asset as never, workspaceId: "church-1", validateOnly: true })).rejects.toThrow("cannot be played");
    expect(mockedSaveLocalVideoFile).not.toHaveBeenCalled();
    expect(deleteLocalVideoThumbnail).not.toHaveBeenCalled();
  });

  it("saves an image on this device", async () => {
    const file = new File(["image"], "Welcome.png", { type: "image/png" });
    const media = await createLocalMediaFromFile(file, "church-1");
    expect(mockedSaveLocalImage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "local_image_asset-1",
        blob: file,
        width: 1920,
        height: 1080,
      }),
    );
    expect(media).toEqual(
      expect.objectContaining({
        id: "local_image_asset-1",
        source: "local",
        background: "local-image://local_image_asset-1",
        localImage: expect.objectContaining({
          storagePolicy: "local-only",
        }),
      }),
    );
  });

  it("offers cloud conversion when a recognized image cannot be decoded locally", async () => {
    mockedReadImageDimensions.mockRejectedValueOnce(
      new Error("The selected image could not be read."),
    );
    const file = new File(["image"], "design.avif", { type: "image/avif" });

    await expect(
      createLocalMediaFromFile(file, "church-1", "local-only"),
    ).rejects.toBeInstanceOf(LocalImagePlaybackError);
    expect(mockedSaveLocalImage).not.toHaveBeenCalled();
  });

  it("uses a custom image display name without changing the source filename", async () => {
    const file = new File(["image"], "final-slide.png", { type: "image/png" });

    const media = await createLocalMediaFromFile(file, "church-1", "local-only", {
      displayName: "Welcome Slide",
    });

    expect(media.name).toBe("Welcome Slide");
    expect(media.localImage?.fileName).toBe("final-slide.png");
    expect(mockedSaveLocalImage).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: "final-slide.png", blob: file }),
    );
  });

  it("uses a custom video display name without changing the source filename", async () => {
    const file = new File(["video"], "final-video-v3.mp4", { type: "video/mp4" });

    const media = await createLocalMediaFromFile(file, "church-1", "local-only", {
      displayName: "Sermon Opener",
    });

    expect(media.name).toBe("Sermon Opener");
    expect(media.localVideoFile?.fileName).toBe("final-video-v3.mp4");
    expect(mockedSaveLocalVideoFile).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: "final-video-v3.mp4", blob: file }),
    );
  });

  it("keeps a locally undecodable MOV and marks cloud playback as authoritative", async () => {
    mockedReadVideoMetadata.mockRejectedValueOnce(
      new Error("The selected video could not be read."),
    );
    const file = new File(["video"], "camera.mov", { type: "video/quicktime" });

    const media = await createLocalMediaFromFile(
      file,
      "church-1",
      "local-and-cloud",
      { allowCloudPlaybackFallback: true },
    );

    expect(mockedSaveLocalVideoFile).toHaveBeenCalledWith(
      expect.objectContaining({
        blob: file,
        contentType: "video/quicktime",
        width: 1920,
        height: 1080,
        duration: 0,
      }),
    );
    expect(media.localVideoFile).toEqual(
      expect.objectContaining({
        preferCloudPlayback: true,
        contentType: "video/quicktime",
      }),
    );
  });

  it("rejects a locally undecodable video when cloud upload is disabled", async () => {
    mockedReadVideoMetadata.mockRejectedValueOnce(
      new Error("The selected video could not be read."),
    );
    const file = new File(["video"], "camera.mov", { type: "video/quicktime" });

    await expect(
      createLocalMediaFromFile(file, "church-1", "local-only"),
    ).rejects.toThrow(/cannot be played on this device/i);
    expect(mockedSaveLocalVideoFile).not.toHaveBeenCalled();
  });

  it("registers a downloaded file under its stable local asset id without loading video bytes", async () => {
    window.electronAPI = { getLocalAsset: jest.fn() } as unknown as typeof window.electronAPI;
    const asset = {
      assetId: "local_video_download_12345678-1234-4123-8123-123456789abc",
      workspaceId: "church-1",
      kind: "video" as const,
      fileName: "downloaded-video.mp4",
      contentType: "video/mp4",
      size: 12345,
      width: 1920,
      height: 1080,
      createdAt: "2026-10-29T12:00:00.000Z",
      updatedAt: "2026-10-29T12:00:01.000Z",
      url: "worshipsync-local-asset://video",
    };
    const media = await createLocalMediaFromDownloadedVideo({
      asset,
      workspaceId: "church-1",
      displayName: "Sunday Opener",
      duration: 42,
      storagePolicy: "local-only",
      folderId: "folder-one",
    });

    expect(mockedSaveLocalVideoFile).toHaveBeenCalledWith(expect.objectContaining({
      id: asset.assetId,
      fileName: "Sunday Opener.mp4",
      duration: 42,
    }), expect.objectContaining({ deferThumbnail: true }));
    expect(mockedSaveLocalVideoFile.mock.calls[0][0]).not.toHaveProperty("blob");
    expect(media).toMatchObject({
      id: asset.assetId,
      name: "Sunday Opener",
      duration: 42,
      folderId: "folder-one",
      background: `local-video-file://${encodeURIComponent(asset.assetId)}`,
      localVideoFile: { id: asset.assetId, storagePolicy: "local-only" },
    });
  });

  it("passes the validated source thumbnail to the permanent local video asset store", async () => {
    window.electronAPI = { getLocalAsset: jest.fn() } as unknown as typeof window.electronAPI;
    const asset = {
      assetId: "local_video_download_12345678-1234-4123-8123-123456789abc",
      workspaceId: "church-1",
      kind: "video" as const,
      fileName: "downloaded-video.mp4",
      contentType: "video/mp4",
      size: 12345,
      width: 1920,
      height: 1080,
      createdAt: "2026-10-29T12:00:00.000Z",
      updatedAt: "2026-10-29T12:00:01.000Z",
      url: "worshipsync-local-asset://video",
    };
    const thumbnail = "data:image/png;base64,iVBORw0KGgo=";
    const media = await createLocalMediaFromDownloadedVideo({
      asset,
      workspaceId: "church-1",
      displayName: "Sunday Opener",
      duration: 42,
      thumbnail,
      storagePolicy: "local-and-cloud",
    });

    const savedThumbnail = mockedSaveLocalVideoFile.mock.calls[0][1]?.thumbnailBlob;
    expect(savedThumbnail).toBeInstanceOf(Blob);
    expect(savedThumbnail).toMatchObject({ type: "image/png", size: 8 });
    expect(mockedSaveLocalVideoFile.mock.calls[0][1]).toMatchObject({ deferThumbnail: true });
    expect(media.thumbnail).toBe("");
    expect(JSON.stringify(media)).not.toContain("iVBORw0KGgo=");
  });

  it("still registers the downloaded video when the inspected thumbnail is invalid", async () => {
    window.electronAPI = { getLocalAsset: jest.fn() } as unknown as typeof window.electronAPI;
    const asset = {
      assetId: "local_video_download_12345678-1234-4123-8123-123456789abc",
      workspaceId: "church-1",
      kind: "video" as const,
      fileName: "downloaded-video.mp4",
      contentType: "video/mp4",
      size: 12345,
      width: 1920,
      height: 1080,
      createdAt: "2026-10-29T12:00:00.000Z",
      updatedAt: "2026-10-29T12:00:01.000Z",
      url: "worshipsync-local-asset://video",
    };
    const media = await createLocalMediaFromDownloadedVideo({
      asset,
      workspaceId: "church-1",
      displayName: "Sunday Opener",
      duration: 42,
      thumbnail: "data:image/jpeg;base64,YWJj",
      storagePolicy: "local-only",
    });

    expect(mockedSaveLocalVideoFile).toHaveBeenCalledTimes(1);
    expect(mockedSaveLocalVideoFile.mock.calls[0][1]).toMatchObject({ deferThumbnail: true });
    expect(mockedSaveLocalVideoFile.mock.calls[0][1]?.thumbnailBlob).toBeUndefined();
    expect(media.id).toBe(asset.assetId);
  });
});
