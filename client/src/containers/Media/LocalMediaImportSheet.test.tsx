import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { ToastContext } from "../../context/toastContext";
import generateRandomId from "../../utils/generateRandomId";
import {
  readImageDimensions,
  saveLocalImage,
} from "../../utils/localImageAssets";
import { enqueueLocalImageUpload } from "../../utils/localImageUploadQueue";
import LocalMediaImportSheet from "./LocalMediaImportSheet";

jest.mock("../../utils/generateRandomId");
jest.mock("../../utils/localImageAssets", () => ({
  ...jest.requireActual("../../utils/localImageAssets"),
  readImageDimensions: jest.fn(),
  saveLocalImage: jest.fn(),
}));
jest.mock("../../utils/localImageUploadQueue", () => ({
  enqueueLocalImageUpload: jest.fn(),
}));

const mockedGenerateRandomId = jest.mocked(generateRandomId);
const mockedReadImageDimensions = jest.mocked(readImageDimensions);
const mockedSaveLocalImage = jest.mocked(saveLocalImage);
const mockedEnqueueUpload = jest.mocked(enqueueLocalImageUpload);

describe("LocalMediaImportSheet", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockedGenerateRandomId.mockReturnValue("asset-1");
    mockedReadImageDimensions.mockResolvedValue({ width: 1920, height: 1080 });
    mockedSaveLocalImage.mockResolvedValue();
    mockedEnqueueUpload.mockResolvedValue({} as never);
  });

  it("adds a local image to Media and queues its optional cloud copy", async () => {
    const onImported = jest.fn();
    const onOpenChange = jest.fn();
    const showToast = jest.fn(() => "toast-1");
    render(
      <ControllerInfoContext.Provider
        value={{ isGuestSession: false } as never}
      >
        <GlobalInfoContext.Provider
          value={
            {
              churchId: "church-1",
              uploadPreset: "preset-1",
            } as never
          }
        >
          <ToastContext.Provider
            value={{
              showToast,
              updateToast: jest.fn(),
              removeToast: jest.fn(),
            }}
          >
            <LocalMediaImportSheet
              open
              onOpenChange={onOpenChange}
              activeItemId="item-1"
              onImported={onImported}
            />
          </ToastContext.Provider>
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );

    fireEvent.click(
      screen.getByLabelText("This device and Media Library cloud"),
    );
    const file = new File(["image"], "Welcome.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Local media file"), {
      target: { files: [file] },
    });

    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    expect(mockedSaveLocalImage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "local_image_asset-1",
        blob: file,
        width: 1920,
        height: 1080,
      }),
    );
    expect(onImported).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "local_image_asset-1",
        source: "local",
        background: "local-image://local_image_asset-1",
        localImage: expect.objectContaining({
          storagePolicy: "local-and-cloud",
        }),
      }),
    );
    expect(mockedEnqueueUpload).toHaveBeenCalledWith({
      assetId: "local_image_asset-1",
      itemId: "item-1",
      workspaceId: "church-1",
      uploadPreset: "preset-1",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
