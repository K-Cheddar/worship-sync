import generateRandomId from "../../utils/generateRandomId";
import {
  readImageDimensions,
  saveLocalImage,
} from "../../utils/localImageAssets";
import { createLocalMediaFromFile } from "./localMediaImport";

jest.mock("../../utils/generateRandomId");
jest.mock("../../utils/localImageAssets", () => ({
  ...jest.requireActual("../../utils/localImageAssets"),
  readImageDimensions: jest.fn(),
  saveLocalImage: jest.fn(),
}));

const mockedGenerateRandomId = jest.mocked(generateRandomId);
const mockedReadImageDimensions = jest.mocked(readImageDimensions);
const mockedSaveLocalImage = jest.mocked(saveLocalImage);

describe("createLocalMediaFromFile", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGenerateRandomId.mockReturnValue("asset-1");
    mockedReadImageDimensions.mockResolvedValue({ width: 1920, height: 1080 });
    mockedSaveLocalImage.mockResolvedValue();
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
});
