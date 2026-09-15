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
    mockValidateFiles.mockImplementation((files: File[]) => ({
      valid: files,
      invalid: [],
    }));
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

  it("defaults a queued display name and passes an edited name to local import", async () => {
    renderUploadInput();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("switch", { name: /Upload to cloud/i }));

    const file = new File(["image"], "final-slide.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/Media Files/i), {
      target: { files: [file] },
    });
    expect(screen.getByText("final-slide.png")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Edit display name for final-slide.png" }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Display name for final-slide.png" }), {
      target: { value: "Welcome Slide" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add (1 file)" }));

    await waitFor(() => {
      expect(mockedCreateLocalMedia).toHaveBeenCalledWith(
        file,
        "church-1",
        "local-only",
        { allowCloudPlaybackFallback: false, displayName: "Welcome Slide" },
      );
    });
  });

  it("keeps independent display names for multiple queued files", async () => {
    renderUploadInput();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("switch", { name: /Upload to cloud/i }));

    const first = new File(["one"], "one.png", { type: "image/png" });
    const second = new File(["two"], "two.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/Media Files/i), {
      target: { files: [first, second] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit display name for one.png" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Display name for one.png" }), {
      target: { value: "First" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit display name for two.png" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Display name for two.png" }), {
      target: { value: "Second" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add (2 files)" }));

    await waitFor(() => expect(mockedCreateLocalMedia).toHaveBeenCalledTimes(2));
    expect(mockedCreateLocalMedia).toHaveBeenNthCalledWith(
      1,
      first,
      "church-1",
      "local-only",
      { allowCloudPlaybackFallback: false, displayName: "First" },
    );
    expect(mockedCreateLocalMedia).toHaveBeenNthCalledWith(
      2,
      second,
      "church-1",
      "local-only",
      { allowCloudPlaybackFallback: false, displayName: "Second" },
    );
  });

  it("does not start importing when a queued display name is empty", async () => {
    renderUploadInput();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const file = new File(["image"], "photo.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/Media Files/i), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit display name for photo.png" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Display name for photo.png" }), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload (1 file)" }));

    expect(screen.getByText("Each media file needs a display name.")).toBeInTheDocument();
    expect(mockedCreateLocalMedia).not.toHaveBeenCalled();
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

  it("reuses a converted local image when its cloud share is retried", async () => {
    const playbackError = new Error(
      "This image cannot be displayed on this device. You can convert it for offline playback.",
    );
    playbackError.name = "LocalImagePlaybackError";
    const convertedFile = new File(["converted"], "design.jpg", {
      type: "image/jpeg",
    });
    const sourceFile = new File(["source"], "design.heic", {
      type: "image/heic",
    });
    const onLocalMediaAdded = jest.fn();
    mockedCreateLocalMedia
      .mockRejectedValueOnce(playbackError)
      .mockResolvedValue(localImage());
    mockedConvertCloudinaryImage.mockResolvedValue(convertedFile);
    mockedEnqueueUpload
      .mockRejectedValueOnce(new Error("Cloud share failed"))
      .mockResolvedValueOnce({} as never);
    renderUploadInput(onLocalMediaAdded);

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(screen.getByLabelText(/Media Files/i), {
      target: { files: [sourceFile] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload (1 file)" }));

    await screen.findByRole("button", { name: "Convert design.heic" });
    fireEvent.click(screen.getByRole("button", { name: "Convert design.heic" }));

    await waitFor(() => expect(mockedEnqueueUpload).toHaveBeenCalledTimes(1));
    expect(onLocalMediaAdded).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Convert design.heic" }));

    await waitFor(() => expect(mockedEnqueueUpload).toHaveBeenCalledTimes(2));
    expect(mockedConvertCloudinaryImage).toHaveBeenCalledTimes(1);
    expect(mockedCreateLocalMedia).toHaveBeenCalledTimes(2);
    expect(onLocalMediaAdded).toHaveBeenCalledTimes(1);
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

  it("opens and populates the upload modal from a native file drop", () => {
    const ref = { current: null as null | MediaUploadInputRef };
    render(
      <ControllerInfoContext.Provider value={{ isGuestSession: false } as never}>
        <GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
          <MediaUploadInput
            ref={(instance) => {
              ref.current = instance;
            }}
            onLocalMediaAdded={jest.fn()}
          />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );

    const file = new File(["image"], "dropped.png", { type: "image/png" });
    act(() => ref.current?.openModalWithFiles([file]));

    expect(screen.getByRole("dialog", { name: "Upload Media" })).toBeInTheDocument();
    expect(screen.getByText("dropped.png")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload (1 file)" })).toBeInTheDocument();
  });

  it("accepts dropped image and video files together", () => {
    mockDetectFileType.mockImplementation((file: File) =>
      file.type.startsWith("video/") ? "video" : "image",
    );
    const ref = { current: null as null | MediaUploadInputRef };
    render(
      <GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
        <MediaUploadInput
          ref={(instance) => {
            ref.current = instance;
          }}
          onLocalMediaAdded={jest.fn()}
        />
      </GlobalInfoContext.Provider>,
    );

    act(() =>
      ref.current?.openModalWithFiles([
        new File(["image"], "photo.png", { type: "image/png" }),
        new File(["video"], "clip.mp4", { type: "video/mp4" }),
      ]),
    );

    expect(screen.getByText("photo.png")).toBeInTheDocument();
    expect(screen.getByText("clip.mp4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload (2 files)" })).toBeInTheDocument();
  });

  it("shows the upload drop state only for native file drags", () => {
    renderUploadInput();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const target = screen.getByRole("button", { name: "Choose Files" });
    const file = new File(["image"], "dropped.png", { type: "image/png" });

    fireEvent.dragEnter(target, {
      dataTransfer: { types: ["Files"], files: [file] },
    });
    expect(screen.getByText("Drop files to add media")).toBeInTheDocument();

    fireEvent.dragLeave(target, {
      dataTransfer: { types: ["Files"], files: [file] },
    });
    expect(screen.queryByText("Drop files to add media")).not.toBeInTheDocument();

    fireEvent.dragEnter(target, {
      dataTransfer: { types: ["application/x-worshipsync-media"], files: [] },
    });
    expect(screen.queryByText("Drop files to add media")).not.toBeInTheDocument();
  });

  it("uses the existing validation error for invalid dropped files", () => {
    mockValidateFiles.mockReturnValue({ valid: [] as File[], invalid: [new File([], "notes.txt")] });
    renderUploadInput();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const target = screen.getByRole("button", { name: "Choose Files" });

    fireEvent.drop(target, {
      dataTransfer: {
        types: ["Files"],
        files: [new File(["text"], "notes.txt", { type: "text/plain" })],
      },
    });

    expect(screen.getByText(/1 invalid file found/)).toBeInTheDocument();
    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
  });
});
