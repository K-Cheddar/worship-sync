import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ControllerInfoContext } from "../../context/controllerInfo";
import type { MediaType } from "../../types";
import LocalMediaCloudShareManager from "./LocalMediaCloudShareManager";

const mockDispatch = jest.fn();
const mockUploadOwnedLocalMedia = jest.fn();
const deviceId = "this-device";

const pendingImage = (): MediaType => ({
  path: "",
  createdAt: "",
  updatedAt: "",
  format: "png",
  height: 1080,
  width: 1920,
  name: "slide.png",
  publicId: "local_image_1",
  type: "image",
  id: "local_image_1",
  background: "local-image://local_image_1",
  thumbnail: "",
  source: "local",
  localImage: {
    id: "local_image_1",
    ownerDeviceId: deviceId,
    ownerLabel: "Booth PC",
    fileName: "slide.png",
    contentType: "image/png",
    storagePolicy: "local-only",
  },
  cloudUploadRequest: {
    requestedAt: "2026-08-17T12:00:00.000Z",
    requestedByDeviceId: "other-device",
    requestedByLabel: "Laptop",
  },
});

const mockState = {
  media: { list: [pendingImage()] as MediaType[] },
};

jest.mock("../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: typeof mockState) => unknown) =>
    selector(mockState),
}));

jest.mock("../../containers/Media/localMediaCloudShare", () => ({
  useLocalMediaCloudShare: () => ({
    deviceId,
    getBarAction: jest.fn(),
    uploadOwnedLocalMedia: mockUploadOwnedLocalMedia,
  }),
}));

describe("LocalMediaCloudShareManager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.media.list = [pendingImage()];
    mockUploadOwnedLocalMedia.mockResolvedValue(undefined);
  });

  it("prompts the owner and can dismiss the request", async () => {
    const user = userEvent.setup();
    render(
      <ControllerInfoContext.Provider
        value={{ isGuestSession: false } as never}
      >
        <LocalMediaCloudShareManager />
      </ControllerInfoContext.Provider>,
    );

    expect(
      screen.getByRole("dialog", { name: "Upload this file?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Laptop asked to upload "slide.png"/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Not now" }));
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "media/updateMediaItemFields",
        payload: expect.objectContaining({
          id: "local_image_1",
          patch: expect.objectContaining({ cloudUploadRequest: null }),
        }),
      }),
    );
  });

  it("uploads when the owner confirms", async () => {
    const user = userEvent.setup();
    render(
      <ControllerInfoContext.Provider
        value={{ isGuestSession: false } as never}
      >
        <LocalMediaCloudShareManager />
      </ControllerInfoContext.Provider>,
    );

    await user.click(screen.getByRole("button", { name: "Upload" }));
    expect(mockUploadOwnedLocalMedia).toHaveBeenCalledWith(
      expect.objectContaining({ id: "local_image_1" }),
    );
  });

  it("does not prompt guests", () => {
    render(
      <ControllerInfoContext.Provider
        value={{ isGuestSession: true } as never}
      >
        <LocalMediaCloudShareManager />
      </ControllerInfoContext.Provider>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
