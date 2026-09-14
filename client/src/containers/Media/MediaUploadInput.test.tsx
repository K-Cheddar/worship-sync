import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import MediaUploadInput from "./MediaUploadInput";
import type { MediaUploadInputRef } from "./MediaUploadInput.types";
import { createLocalMediaFromFile } from "./localMediaImport";
import { enqueueLocalImageUpload } from "../../utils/localImageUploadQueue";
import type { MediaType } from "../../types";
import { convertMuxVideoToLocalMp4 } from "./utils/muxUpload";
import { convertCloudinaryImageToLocalWebp } from "./utils/cloudinaryUpload";

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
  convertMuxVideoToLocalMp4: jest.fn(),
  uploadVideoToMux: jest.fn(),
}));

jest.mock("./utils/cloudinaryUpload", () => ({
  convertCloudinaryImageToLocalWebp: jest.fn(),
}));

const mockedCreateLocalMedia = jest.mocked(createLocalMediaFromFile);
const mockedEnqueueUpload = jest.mocked(enqueueLocalImageUpload);
const mockedConvertMuxVideo = jest.mocked(convertMuxVideoToLocalMp4);
const mockedConvertCloudinaryImage = jest.mocked(
  convertCloudinaryImageToLocalWebp,
);

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
    mockDetectFileType.mockImplementation(() => "image");
    localStorage.clear();
    mockedCreateLocalMedia.mockResolvedValue(localImage());
    mockedEnqueueUpload.mockResolvedValue({} as never);
    mockedConvertMuxVideo.mockResolvedValue(
      new File(["converted"], "photo.mp4", { type: "video/mp4" }),
    );
    mockedConvertCloudinaryImage.mockResolvedValue(
      new File(["converted"], "photo.webp", { type: "image/webp" }),
    );
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
    expect(
      screen.getByRole("heading", { name: /Add Progress/i }),
    ).toBeInTheDocument();
    expect(mockedEnqueueUpload).not.toHaveBeenCalled();
  });

  it("offers a temporary cloud conversion when a local video cannot play", async () => {
    const playbackError = new Error(
      "This video cannot be played on this device. You can convert it for offline playback.",
    );
    playbackError.name = "LocalVideoPlaybackError";
    const convertedFile = new File(["converted"], "camera.mp4", {
      type: "video/mp4",
    });
    const onLocalMediaAdded = jest.fn();
    const sourceFile = new File(["source"], "camera.mov", {
      type: "video/quicktime",
    });
    mockDetectFileType.mockReturnValue("video");
    mockedCreateLocalMedia
      .mockRejectedValueOnce(playbackError)
      .mockResolvedValueOnce(localImage());
    mockedConvertMuxVideo.mockResolvedValueOnce(convertedFile);
    renderUploadInput(onLocalMediaAdded);

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("switch", { name: /Upload to cloud/i }));
    fireEvent.change(screen.getByLabelText(/Media Files/i), {
      target: { files: [sourceFile] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add (1 file)" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Convert camera.mov" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Convert camera.mov" }));

    await waitFor(() => {
      expect(mockedConvertMuxVideo).toHaveBeenCalledWith(
        sourceFile,
        expect.objectContaining({
          isCancelled: expect.any(Function),
          onProgress: expect.any(Function),
        }),
      );
    });
    await waitFor(() => {
      expect(mockedCreateLocalMedia).toHaveBeenLastCalledWith(
        convertedFile,
        "church-1",
        "local-only",
        { importBytes: true },
      );
    });
    await waitFor(() => {
      expect(onLocalMediaAdded).toHaveBeenCalledWith(
        expect.objectContaining({ id: "local_image_1" }),
      );
    });
  });

  it("offers a temporary cloud conversion when a local image cannot play", async () => {
    const playbackError = new Error(
      "This image cannot be displayed on this device. You can convert it for offline playback.",
    );
    playbackError.name = "LocalImagePlaybackError";
    const convertedFile = new File(["converted"], "design.jpg", {
      type: "image/jpeg",
    });
    const onLocalMediaAdded = jest.fn();
    const sourceFile = new File(["source"], "design.heic", {
      type: "image/heic",
    });
    mockedCreateLocalMedia
      .mockRejectedValueOnce(playbackError)
      .mockResolvedValueOnce(localImage());
    mockedConvertCloudinaryImage.mockResolvedValueOnce(convertedFile);
    renderUploadInput(onLocalMediaAdded);

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(screen.getByLabelText(/Media Files/i), {
      target: { files: [sourceFile] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload (1 file)" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Convert design.heic" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Convert design.heic" }));

    await waitFor(() => {
      expect(mockedConvertCloudinaryImage).toHaveBeenCalledWith(
        sourceFile,
        "preset-1",
        expect.objectContaining({
          isCancelled: expect.any(Function),
          onProgress: expect.any(Function),
        }),
      );
    });
    await waitFor(() => {
      expect(mockedCreateLocalMedia).toHaveBeenLastCalledWith(
        convertedFile,
        "church-1",
        "local-only",
        { importBytes: true },
      );
    });
    expect(mockedEnqueueUpload).toHaveBeenCalledWith({
      assetId: "local_image_1",
      itemId: "",
      workspaceId: "church-1",
      uploadPreset: "preset-1",
    });
    expect(onLocalMediaAdded).toHaveBeenCalledWith(
      expect.objectContaining({ id: "local_image_1" }),
    );
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

  it("reopens the upload modal after it is minimized to the Add button", async () => {
    let resolveImport: ((value: MediaType) => void) | undefined;
    mockedCreateLocalMedia.mockImplementation(
      () =>
        new Promise<MediaType>((resolve) => {
          resolveImport = resolve;
        }),
    );
    const ref = { current: null as null | MediaUploadInputRef };
    render(
      <ControllerInfoContext.Provider
        value={{ isGuestSession: false } as never}
      >
        <GlobalInfoContext.Provider
          value={{ churchId: "church-1", uploadPreset: "preset-1" } as never}
        >
          <MediaUploadInput
            ref={(instance) => {
              ref.current = instance;
            }}
            onLocalMediaAdded={jest.fn()}
          />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(screen.getByLabelText(/Media Files/i), {
      target: {
        files: [new File(["image"], "photo.png", { type: "image/png" })],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload (1 file)" }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /Upload Progress/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Minimize to Add button" }),
    );
    expect(
      screen.queryByRole("heading", { name: /Upload Progress/i }),
    ).not.toBeInTheDocument();

    act(() => {
      ref.current?.openModal();
    });
    expect(
      screen.getByRole("dialog", { name: "Upload Media" }),
    ).toBeInTheDocument();

    await act(async () => {
      resolveImport?.(localImage());
    });
  });
});
