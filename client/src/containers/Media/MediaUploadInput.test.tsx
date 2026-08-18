import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import MediaUploadInput from "./MediaUploadInput";
import { createLocalMediaFromFile } from "./localMediaImport";
import { enqueueLocalImageUpload } from "../../utils/localImageUploadQueue";
import type { MediaType } from "../../types";

const mockValidateFiles = jest.fn((files: File[]) => ({
  valid: files,
  invalid: [],
}));
const mockDetectFileType = jest.fn((_file: File) => "image");

jest.mock("../../components/Modal/Modal", () => ({
  __esModule: true,
  default: ({
    isOpen,
    title,
    children,
    headerAction,
  }: {
    isOpen: boolean;
    title?: string;
    children: React.ReactNode;
    headerAction?: React.ReactNode;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title || "modal"}>
        {headerAction}
        {children}
      </div>
    ) : null,
}));

jest.mock("./utils/fileUtils", () => ({
  validateFiles: (files: File[]) => mockValidateFiles(files),
  detectFileType: (file: File) => mockDetectFileType(file),
}));

jest.mock("./localMediaImport", () => ({
  createLocalMediaFromFile: jest.fn(),
}));

jest.mock("../../utils/localImageUploadQueue", () => ({
  enqueueLocalImageUpload: jest.fn(),
}));

jest.mock("./utils/muxUpload", () => ({
  uploadVideoToMux: jest.fn(),
}));

const mockedCreateLocalMedia = jest.mocked(createLocalMediaFromFile);
const mockedEnqueueUpload = jest.mocked(enqueueLocalImageUpload);

const localImage = (): MediaType => ({
  path: "",
  createdAt: "",
  updatedAt: "",
  format: "png",
  height: 1080,
  width: 1920,
  name: "photo.png",
  publicId: "local_image_1",
  type: "image",
  id: "local_image_1",
  background: "local-image://local_image_1",
  thumbnail: "",
  source: "local",
  localImage: {
    id: "local_image_1",
    ownerDeviceId: "this-device",
    ownerLabel: "Booth",
    fileName: "photo.png",
    contentType: "image/png",
    storagePolicy: "local-only",
  },
});

const renderUploadInput = (
  onLocalMediaAdded = jest.fn(),
  extra?: { isGuestSession?: boolean },
) =>
  render(
    <ControllerInfoContext.Provider
      value={{ isGuestSession: extra?.isGuestSession ?? false } as never}
    >
      <GlobalInfoContext.Provider
        value={{ churchId: "church-1", uploadPreset: "preset-1" } as never}
      >
        <MediaUploadInput onLocalMediaAdded={onLocalMediaAdded} />
      </GlobalInfoContext.Provider>
    </ControllerInfoContext.Provider>,
  );

describe("MediaUploadInput", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockedCreateLocalMedia.mockResolvedValue(localImage());
    mockedEnqueueUpload.mockResolvedValue({} as never);
    (window as { electronAPI?: unknown }).electronAPI = {
      setUploadInProgress: jest.fn().mockResolvedValue(true),
      setTaskbarUploadProgress: jest.fn().mockResolvedValue(true),
    };
  });

  afterEach(() => {
    delete (window as { electronAPI?: unknown }).electronAPI;
  });

  it("uploads to the cloud by default", async () => {
    const onLocalMediaAdded = jest.fn();
    renderUploadInput(onLocalMediaAdded);

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(
      screen.getByRole("switch", { name: /Upload to cloud/i }),
    ).toBeChecked();

    const file = new File(["image"], "photo.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/Media Files/i), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload (1 file)" }));

    await waitFor(() => {
      expect(mockedEnqueueUpload).toHaveBeenCalledWith({
        assetId: "local_image_1",
        itemId: "",
        workspaceId: "church-1",
        uploadPreset: "preset-1",
      });
    });
    expect(onLocalMediaAdded).toHaveBeenCalled();
  });

  it("remembers the upload preference per device when the toggle changes", () => {
    localStorage.setItem("worshipsync_device_id", "device-a");
    renderUploadInput();

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("switch", { name: /Upload to cloud/i }));

    expect(
      localStorage.getItem("worshipsync_local_media_upload_policy_v2:device-a"),
    ).toBe("local-only");

    fireEvent.click(screen.getByRole("switch", { name: /Upload to cloud/i }));

    expect(
      localStorage.getItem("worshipsync_local_media_upload_policy_v2:device-a"),
    ).toBe("local-and-cloud");
  });

  it("keeps files on this device when Upload to cloud is off", async () => {
    const onLocalMediaAdded = jest.fn();
    renderUploadInput(onLocalMediaAdded);

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("switch", { name: /Upload to cloud/i }));

    const file = new File(["image"], "photo.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/Media Files/i), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add (1 file)" }));

    await waitFor(() => {
      expect(onLocalMediaAdded).toHaveBeenCalledWith(
        expect.objectContaining({ id: "local_image_1" }),
      );
    });
    expect(mockedEnqueueUpload).not.toHaveBeenCalled();
  });

  it("updates Electron upload progress while adding files", async () => {
    jest.useFakeTimers();
    let resolveImport: ((value: MediaType) => void) | undefined;
    mockedCreateLocalMedia.mockImplementation(
      () =>
        new Promise<MediaType>((resolve) => {
          resolveImport = resolve;
        }),
    );
    const onLocalMediaAdded = jest.fn();
    renderUploadInput(onLocalMediaAdded);

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const file = new File(["image"], "photo.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/Media Files/i), {
      target: { files: [file] },
    });

    const electronAPI = window.electronAPI as unknown as {
      setUploadInProgress: jest.Mock;
      setTaskbarUploadProgress: jest.Mock;
    };
    electronAPI.setUploadInProgress.mockClear();
    electronAPI.setTaskbarUploadProgress.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Upload (1 file)" }));

    await waitFor(() => {
      expect(electronAPI.setUploadInProgress).toHaveBeenCalledWith(true);
    });

    await act(async () => {
      resolveImport?.(localImage());
    });

    await waitFor(() => {
      expect(onLocalMediaAdded).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(electronAPI.setUploadInProgress).toHaveBeenCalledWith(false);
    });

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    jest.useRealTimers();
  });
});
