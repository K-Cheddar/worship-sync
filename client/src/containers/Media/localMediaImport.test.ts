import generateRandomId from "../../utils/generateRandomId";
import {
  readImageDimensions,
  saveLocalImage,
} from "../../utils/localImageAssets";
import {
  readVideoMetadata,
  saveLocalVideoFile,
} from "../../utils/localVideoFileAssets";
import {
  createLocalMediaFromFile,
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
});
