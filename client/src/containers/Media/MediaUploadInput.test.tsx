import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import MediaUploadInput from "./MediaUploadInput";
import type { MediaUploadInputRef } from "./MediaUploadInput.types";
import { createLocalMediaFromFile } from "./localMediaImport";
import {
  cancelLocalImageUpload,
  enqueueLocalImageUpload,
  getLocalImageUploadJob,
  retryLocalImageUpload,
  retryLocalImageUploadCancellation,
  waitForLocalImageUpload,
} from "../../utils/localImageUploadQueue";
import type { MediaType } from "../../types";
import { convertMuxVideoToLocalMp4, uploadVideoToMux } from "./utils/muxUpload";
import type { MuxUploadResult } from "./MediaUploadInput.types";
import { convertCloudinaryImageToLocalWebp } from "./utils/cloudinaryUpload";
import { TransferProvider } from "../../context/transferContext";
import { MediaAddControl } from "./MediaAddControl";
import { deleteChurchMuxAsset } from "../../api/providerStorage";
import { deleteLocalImage } from "../../utils/localImageAssets";
import { deleteLocalVideoFile } from "../../utils/localVideoFileAssets";

const mockValidateFiles = jest.fn((files: File[]): { valid: File[]; invalid: File[] } => ({
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
    size,
    contentClassName,
  }: {
    isOpen: boolean;
    title?: string;
    children: React.ReactNode;
    headerAction?: React.ReactNode;
    size?: string;
    contentClassName?: string;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title || "modal"} data-size={size} data-content-class={contentClassName}>
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
  cancelLocalImageUpload: jest.fn(),
  enqueueLocalImageUpload: jest.fn(),
  getLocalImageUploadJob: jest.fn(),
  retryLocalImageUpload: jest.fn(),
  retryLocalImageUploadCancellation: jest.fn(),
  waitForLocalImageUpload: jest.fn(),
}));

jest.mock("./utils/muxUpload", () => ({
  convertMuxVideoToLocalMp4: jest.fn(),
  uploadVideoToMux: jest.fn(),
}));

jest.mock("./utils/cloudinaryUpload", () => ({
  convertCloudinaryImageToLocalWebp: jest.fn(),
}));

jest.mock("../../api/providerStorage", () => ({
  deleteChurchMuxAsset: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../utils/localImageAssets", () => ({
  ...jest.requireActual("../../utils/localImageAssets"),
  deleteLocalImage: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../utils/localVideoFileAssets", () => ({
  ...jest.requireActual("../../utils/localVideoFileAssets"),
  deleteLocalVideoFile: jest.fn().mockResolvedValue(undefined),
}));

const mockedCreateLocalMedia = jest.mocked(createLocalMediaFromFile);
const mockedCancelUpload = jest.mocked(cancelLocalImageUpload);
const mockedEnqueueUpload = jest.mocked(enqueueLocalImageUpload);
const mockedGetUploadJob = jest.mocked(getLocalImageUploadJob);
const mockedRetryUpload = jest.mocked(retryLocalImageUpload);
const mockedRetryCancellation = jest.mocked(retryLocalImageUploadCancellation);
const mockedWaitForUpload = jest.mocked(waitForLocalImageUpload);
const mockedConvertMuxVideo = jest.mocked(convertMuxVideoToLocalMp4);
const mockedUploadVideo = jest.mocked(uploadVideoToMux);
const mockedConvertCloudinaryImage = jest.mocked(
  convertCloudinaryImageToLocalWebp,
);
const mockedDeleteLocalImage = jest.mocked(deleteLocalImage);
const mockedDeleteLocalVideoFile = jest.mocked(deleteLocalVideoFile);

const localImage = (id = "local_image_1", name = "photo.png"): MediaType => ({
  path: "",
  createdAt: "",
  updatedAt: "",
  format: "png",
  height: 1080,
  width: 1920,
  name,
  publicId: id,
  type: "image",
  id,
  background: `local-image://${id}`,
  thumbnail: "",
  source: "local",
  localImage: {
    id,
    ownerDeviceId: "this-device",
    ownerLabel: "Booth",
    fileName: name,
    contentType: "image/png",
    storagePolicy: "local-only",
  },
});

const localVideo = (id = "local_video_1", name = "clip.mp4"): MediaType => ({
  ...localImage(id, name),
  format: "mp4",
  type: "video",
  localImage: undefined,
  localVideoFile: {
    id,
    ownerDeviceId: "this-device",
    ownerLabel: "Booth",
    fileName: name,
    contentType: "video/mp4",
    storagePolicy: "local-and-cloud",
  },
});

const renderUploadInput = (
  onLocalMediaAdded = jest.fn(),
  extra?: { isGuestSession?: boolean },
  onUploadComplete?: () => void,
) =>
  render(
    <TransferProvider>
      <ControllerInfoContext.Provider
        value={{ isGuestSession: extra?.isGuestSession ?? false } as never}
      >
        <GlobalInfoContext.Provider
          value={{ churchId: "church-1", uploadPreset: "preset-1" } as never}
        >
          <MediaUploadInput
            onLocalMediaAdded={onLocalMediaAdded}
            onUploadComplete={onUploadComplete}
          />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>
    </TransferProvider>,
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
    mockedCancelUpload.mockResolvedValue();
    mockedEnqueueUpload.mockResolvedValue({} as never);
    mockedGetUploadJob.mockResolvedValue(undefined);
    mockedRetryUpload.mockResolvedValue({} as never);
    mockedRetryCancellation.mockResolvedValue();
    mockedWaitForUpload.mockImplementation(async (_assetId, onState) => {
      onState?.({ status: "complete", progress: 100, phase: "Upload complete" });
      return {} as never;
    });
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
    const onUploadComplete = jest.fn();
    renderUploadInput(onLocalMediaAdded, undefined, onUploadComplete);

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
        mediaId: "local_image_1",
      });
    });
    expect(onLocalMediaAdded).toHaveBeenCalled();
    await waitFor(() => expect(onUploadComplete).toHaveBeenCalledTimes(1));
  });

  it("normalizes native video upload progress for the shared transfer panel", async () => {
    let finishUpload!: (result: MuxUploadResult) => void;
    mockedUploadVideo.mockImplementation(async (_file, _options, callbacks) => {
      callbacks?.onProgress?.(63);
      return new Promise<MuxUploadResult>((resolve) => { finishUpload = resolve; });
    });
    mockDetectFileType.mockReturnValue("video");

    render(
      <MemoryRouter>
        <TransferProvider>
          <ControllerInfoContext.Provider value={{ isGuestSession: false } as never}>
            <GlobalInfoContext.Provider value={{ churchId: "church-1", uploadPreset: "preset-1" } as never}>
              <MediaUploadInput onLocalMediaAdded={jest.fn()} />
            </GlobalInfoContext.Provider>
          </ControllerInfoContext.Provider>
        </TransferProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(screen.getByLabelText(/Media Files/i), {
      target: { files: [new File(["video"], "clip.mp4", { type: "video/mp4" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload (1 file)" }));

    await waitFor(() => {
      expect(within(screen.getByRole("complementary", { name: "Activity" })).getByRole("progressbar", { name: "clip.mp4 progress" })).toHaveAttribute("aria-valuenow", "78");
    });

    await act(async () => finishUpload({} as MuxUploadResult));
  });

  it("cancels an unmounted upload and cleans up a Mux result that arrives afterward", async () => {
    let finishUpload!: (result: MuxUploadResult) => void;
    mockedUploadVideo.mockImplementation(async () => new Promise<MuxUploadResult>((resolve) => { finishUpload = resolve; }));
    mockDetectFileType.mockReturnValue("video");
    mockedCreateLocalMedia.mockResolvedValue({
      ...localImage("local-video-1", "clip.mp4"),
      type: "video",
      format: "mp4",
      localImage: undefined,
      localVideoFile: {
        id: "local-video-1",
        ownerDeviceId: "this-device",
        ownerLabel: "Booth",
        fileName: "clip.mp4",
        contentType: "video/mp4",
        storagePolicy: "local-and-cloud",
      },
    });
    const onLocalMediaPatched = jest.fn();
    const surface = (showInput: boolean) => (
      <TransferProvider>
        <ControllerInfoContext.Provider value={{ isGuestSession: false } as never}>
          <GlobalInfoContext.Provider value={{ churchId: "church-1", uploadPreset: "preset-1" } as never}>
            {showInput ? <MediaUploadInput onLocalMediaAdded={jest.fn()} onLocalMediaPatched={onLocalMediaPatched} /> : null}
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </TransferProvider>
    );
    const view = render(surface(true));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(screen.getByLabelText(/Media Files/i), {
      target: { files: [new File(["video"], "clip.mp4", { type: "video/mp4" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload (1 file)" }));
    await waitFor(() => expect(mockedUploadVideo).toHaveBeenCalledTimes(1));

    view.rerender(surface(false));
    const activity = within(screen.getByRole("complementary", { name: "Activity" }));
    expect(activity.getAllByText("Cancelled").length).toBeGreaterThan(0);
    expect(activity.queryByText(/1 failed/)).not.toBeInTheDocument();

    await act(async () => {
      finishUpload({ assetId: "mux-asset-1" } as MuxUploadResult);
      await Promise.resolve();
    });

    expect(deleteChurchMuxAsset).toHaveBeenCalledWith("church-1", "mux-asset-1");
    expect(onLocalMediaPatched).not.toHaveBeenCalled();
    expect(activity.getAllByText("Cancelled").length).toBeGreaterThan(0);
    expect(activity.queryByText(/1 failed/)).not.toBeInTheDocument();
  });

  it("deletes a newly imported local video when unmounted before import resolves", async () => {
    let resolveImport!: (media: MediaType) => void;
    mockedCreateLocalMedia.mockImplementation(() => new Promise((resolve) => {
      resolveImport = resolve;
    }));
    mockDetectFileType.mockReturnValue("video");
    const onLocalMediaAdded = jest.fn();
    const onLocalMediaPatched = jest.fn();
    const surface = (showInput: boolean) => (
      <TransferProvider>
        <ControllerInfoContext.Provider value={{ isGuestSession: false } as never}>
          <GlobalInfoContext.Provider value={{ churchId: "church-1", uploadPreset: "preset-1" } as never}>
            {showInput ? <MediaUploadInput onLocalMediaAdded={onLocalMediaAdded} onLocalMediaPatched={onLocalMediaPatched} /> : null}
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </TransferProvider>
    );
    const view = render(surface(true));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(screen.getByLabelText(/Media Files/i), {
      target: { files: [new File(["video"], "clip.mp4", { type: "video/mp4" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload (1 file)" }));
    await waitFor(() => expect(mockedCreateLocalMedia).toHaveBeenCalledTimes(1));

    view.rerender(surface(false));
    await act(async () => {
      resolveImport(localVideo("local_video_created_during_import"));
      await Promise.resolve();
    });

    expect(mockedDeleteLocalVideoFile).toHaveBeenCalledWith("local_video_created_during_import");
    expect(onLocalMediaAdded).not.toHaveBeenCalled();
    expect(onLocalMediaPatched).not.toHaveBeenCalled();
    expect(mockedUploadVideo).not.toHaveBeenCalled();
    expect(mockedEnqueueUpload).not.toHaveBeenCalled();
    const activity = within(screen.getByRole("complementary", { name: "Activity" }));
    expect(activity.getAllByText("Cancelled").length).toBeGreaterThan(0);
    expect(activity.queryByText(/1 failed/)).not.toBeInTheDocument();
  });

  it("deletes a newly imported local image when unmounted before import resolves", async () => {
    let resolveImport!: (media: MediaType) => void;
    mockedCreateLocalMedia.mockImplementation(() => new Promise((resolve) => {
      resolveImport = resolve;
    }));
    const onLocalMediaAdded = jest.fn();
    const surface = (showInput: boolean) => (
      <TransferProvider>
        <ControllerInfoContext.Provider value={{ isGuestSession: false } as never}>
          <GlobalInfoContext.Provider value={{ churchId: "church-1", uploadPreset: "preset-1" } as never}>
            {showInput ? <MediaUploadInput onLocalMediaAdded={onLocalMediaAdded} /> : null}
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </TransferProvider>
    );
    const view = render(surface(true));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(screen.getByLabelText(/Media Files/i), {
      target: { files: [new File(["image"], "photo.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload (1 file)" }));
    await waitFor(() => expect(mockedCreateLocalMedia).toHaveBeenCalledTimes(1));

    view.rerender(surface(false));
    await act(async () => {
      resolveImport(localImage("local_image_created_during_import"));
      await Promise.resolve();
    });

    expect(mockedDeleteLocalImage).toHaveBeenCalledWith("local_image_created_during_import");
    expect(onLocalMediaAdded).not.toHaveBeenCalled();
    expect(mockedEnqueueUpload).not.toHaveBeenCalled();
    const activity = within(screen.getByRole("complementary", { name: "Activity" }));
    expect(activity.getAllByText("Cancelled").length).toBeGreaterThan(0);
    expect(activity.queryByText(/1 failed/)).not.toBeInTheDocument();
  });

  it("keeps failed local-asset cleanup retryable on the cancelled transfer", async () => {
    let resolveImport!: (media: MediaType) => void;
    mockedCreateLocalMedia.mockImplementation(() => new Promise((resolve) => {
      resolveImport = resolve;
    }));
    mockedDeleteLocalVideoFile.mockRejectedValueOnce(new Error("Local cleanup failed"));
    mockDetectFileType.mockReturnValue("video");
    const surface = (showInput: boolean) => (
      <TransferProvider>
        <ControllerInfoContext.Provider value={{ isGuestSession: false } as never}>
          <GlobalInfoContext.Provider value={{ churchId: "church-1", uploadPreset: "preset-1" } as never}>
            {showInput ? <MediaUploadInput onLocalMediaAdded={jest.fn()} /> : null}
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </TransferProvider>
    );
    const view = render(surface(true));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(screen.getByLabelText(/Media Files/i), {
      target: { files: [new File(["video"], "clip.mp4", { type: "video/mp4" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload (1 file)" }));
    await waitFor(() => expect(mockedCreateLocalMedia).toHaveBeenCalledTimes(1));
    view.rerender(surface(false));
    await act(async () => {
      resolveImport(localVideo("local_video_cleanup_retry"));
      await Promise.resolve();
    });

    const retryCleanup = await screen.findByRole("button", { name: "Retry cleanup" });
    expect(mockedDeleteLocalVideoFile).toHaveBeenCalledTimes(1);
    expect(within(screen.getByRole("complementary", { name: "Activity" })).getAllByText("Cancelled").length).toBeGreaterThan(0);

    fireEvent.click(retryCleanup);
    await waitFor(() => expect(mockedDeleteLocalVideoFile).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry cleanup" })).not.toBeInTheDocument());
    expect(within(screen.getByRole("complementary", { name: "Activity" })).getAllByText("Cancelled").length).toBeGreaterThan(0);
  });

  it("keeps a pre-existing local video checkpoint when its cloud retry is cancelled", async () => {
    const media = localVideo("existing_local_video");
    let finishUpload!: (result: MuxUploadResult) => void;
    mockedCreateLocalMedia.mockResolvedValueOnce(media);
    mockedUploadVideo
      .mockRejectedValueOnce(new Error("Mux is unavailable"))
      .mockImplementationOnce(async () => new Promise((resolve) => { finishUpload = resolve; }));
    mockDetectFileType.mockReturnValue("video");
    const surface = (showInput: boolean) => (
      <TransferProvider>
        <ControllerInfoContext.Provider value={{ isGuestSession: false } as never}>
          <GlobalInfoContext.Provider value={{ churchId: "church-1", uploadPreset: "preset-1" } as never}>
            {showInput ? <MediaUploadInput onLocalMediaAdded={jest.fn()} /> : null}
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </TransferProvider>
    );
    const view = render(surface(true));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(screen.getByLabelText(/Media Files/i), {
      target: { files: [new File(["video"], "clip.mp4", { type: "video/mp4" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload (1 file)" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry failed files" }));
    await waitFor(() => expect(mockedUploadVideo).toHaveBeenCalledTimes(2));

    view.rerender(surface(false));
    await act(async () => {
      finishUpload({ assetId: "mux_asset" } as MuxUploadResult);
      await Promise.resolve();
    });

    expect(mockedCreateLocalMedia).toHaveBeenCalledTimes(1);
    expect(mockedDeleteLocalVideoFile).not.toHaveBeenCalled();
  });

  it("cleans a converted local asset when its transfer owner unmounts during import", async () => {
    const playbackError = new Error(
      "This video cannot be played on this device. You can convert it for offline playback.",
    );
    playbackError.name = "LocalVideoPlaybackError";
    const sourceFile = new File(["source"], "camera.mov", { type: "video/quicktime" });
    const convertedFile = new File(["converted"], "camera.mp4", { type: "video/mp4" });
    let resolveImport!: (media: MediaType) => void;
    mockedCreateLocalMedia
      .mockRejectedValueOnce(playbackError)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveImport = resolve; }));
    mockedConvertMuxVideo.mockResolvedValueOnce(convertedFile);
    mockDetectFileType.mockReturnValue("video");
    const onLocalMediaAdded = jest.fn();
    const onLocalMediaPatched = jest.fn();
    const surface = (showInput: boolean) => (
      <TransferProvider>
        <ControllerInfoContext.Provider value={{ isGuestSession: false } as never}>
          <GlobalInfoContext.Provider value={{ churchId: "church-1", uploadPreset: "preset-1" } as never}>
            {showInput ? <MediaUploadInput onLocalMediaAdded={onLocalMediaAdded} onLocalMediaPatched={onLocalMediaPatched} /> : null}
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </TransferProvider>
    );
    const view = render(surface(true));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(screen.getByLabelText(/Media Files/i), { target: { files: [sourceFile] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload (1 file)" }));
    fireEvent.click(await screen.findByRole("button", { name: "Convert camera.mov" }));
    await waitFor(() => expect(mockedCreateLocalMedia).toHaveBeenCalledTimes(2));

    view.rerender(surface(false));
    await act(async () => {
      resolveImport(localVideo("converted_video_created_during_import"));
      await Promise.resolve();
    });

    expect(mockedDeleteLocalVideoFile).toHaveBeenCalledWith("converted_video_created_during_import");
    expect(onLocalMediaAdded).not.toHaveBeenCalled();
    expect(onLocalMediaPatched).not.toHaveBeenCalled();
    expect(mockedUploadVideo).not.toHaveBeenCalled();
    const activity = within(screen.getByRole("complementary", { name: "Activity" }));
    expect(activity.getAllByText("Cancelled").length).toBeGreaterThan(0);
    expect(activity.queryByText(/1 failed/)).not.toBeInTheDocument();
  });

  it("cancels an active local-image upload on unmount and keeps late job updates terminal", async () => {
    let reportJobState!: (state: { status: "uploading" | "cancelled"; progress: number; phase: string }) => void;
    let finishJob!: (value: never) => void;
    mockedWaitForUpload.mockImplementation(async (_assetId, onState) => new Promise((resolve) => {
      reportJobState = onState as typeof reportJobState;
      finishJob = resolve;
      onState?.({ status: "uploading", progress: 52, phase: "Uploading image" } as never);
    }));
    mockedCancelUpload.mockImplementation(async () => {
      reportJobState({ status: "cancelled", progress: 0, phase: "Upload cancelled" });
      finishJob({} as never);
    });
    const surface = (showInput: boolean) => (
      <TransferProvider>
        <ControllerInfoContext.Provider value={{ isGuestSession: false } as never}>
          <GlobalInfoContext.Provider value={{ churchId: "church-1", uploadPreset: "preset-1" } as never}>
            {showInput ? <MediaUploadInput onLocalMediaAdded={jest.fn()} /> : null}
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </TransferProvider>
    );
    const view = render(surface(true));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(screen.getByLabelText(/Media Files/i), {
      target: { files: [new File(["image"], "photo.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload (1 file)" }));
    await waitFor(() => expect(mockedWaitForUpload).toHaveBeenCalledWith(
      "local_image_1",
      expect.any(Function),
    ));

    view.rerender(surface(false));
    await waitFor(() => expect(mockedCancelUpload).toHaveBeenCalledWith("local_image_1"));
    await act(async () => { await Promise.resolve(); });

    const activity = within(screen.getByRole("complementary", { name: "Activity" }));
    expect(activity.getAllByText("Cancelled").length).toBeGreaterThan(0);
    expect(activity.queryByText(/Uploading image/)).not.toBeInTheDocument();
    expect(activity.queryByText(/1 failed/)).not.toBeInTheDocument();
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
    expect(within(screen.getByRole("list", { name: "photo.png files" })).getByText("Complete")).toBeInTheDocument();
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
    expect(screen.queryByText("Source: final-slide.png")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Edit name for final-slide.png" }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Display name for final-slide.png" }), {
      target: { value: "Welcome Slide" },
    });
    expect(screen.getByText("Source: final-slide.png")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Edit name for one.png" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Display name for one.png" }), {
      target: { value: "First" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit name for two.png" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Edit name for photo.png" }));
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
        "church-1",
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
        "church-1",
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
      mediaId: "local_image_1",
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

  it("starts a second independent batch while the first is active", async () => {
    let createdMedia = 0;
    mockedCreateLocalMedia.mockImplementation(async (_file, _churchId, _policy) => localImage(`local-video-${++createdMedia}`));
    mockDetectFileType.mockReturnValue("video");
    const finishes: Array<(result: MuxUploadResult) => void> = [];
    let uploadIndex = 0;
    mockedUploadVideo.mockImplementation(async (_file, _options, callbacks) => {
      callbacks?.onProgress?.(++uploadIndex === 1 ? 20 : 80);
      return new Promise<MuxUploadResult>((resolve) => finishes.push(resolve));
    });
    const addSource = jest.fn();
    render(
      <TransferProvider>
        <ControllerInfoContext.Provider value={{ isGuestSession: false } as never}>
          <GlobalInfoContext.Provider value={{ churchId: "church-1", uploadPreset: "preset-1" } as never}>
            <MediaAddControl><button onClick={addSource}>Add media source</button></MediaAddControl>
            <MediaUploadInput onLocalMediaAdded={jest.fn()} />
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </TransferProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(screen.getByLabelText(/Media Files/i), { target: { files: [new File(["a"], "clip-a.mp4", { type: "video/mp4" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload (1 file)" }));
    await waitFor(() => expect(finishes).toHaveLength(1));

    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show Activity · 1 active" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add media source" }));
    expect(addSource).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("dialog", { name: "Upload Media" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Media Files/i), { target: { files: [new File(["b"], "clip-b.mp4", { type: "video/mp4" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload (1 file)" }));

    await waitFor(() => expect(finishes).toHaveLength(2));
    expect(screen.getByRole("button", { name: "Show Activity · 2 active" })).toBeInTheDocument();
    const transfers = within(screen.getByRole("complementary", { name: "Activity" }));
    expect(transfers.getAllByText("clip-a.mp4")).toHaveLength(2);
    expect(transfers.getAllByText("clip-b.mp4")).toHaveLength(2);
    expect(transfers.getAllByRole("progressbar")).toHaveLength(2);

    await act(async () => finishes.forEach((finish) => finish({} as MuxUploadResult)));
    await waitFor(() => expect(transfers.getAllByText("Complete")).toHaveLength(4));
  });

  it.each(["first", "second"] as const)("reports partial success and retries only the failed %s file", async (failedPosition) => {
    const first = localImage("media-first", "first.png");
    const second = localImage("media-second", "second.png");
    mockedCreateLocalMedia.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const failedAsset = failedPosition === "first" ? first.id : second.id;
    let failedOnce = false;
    mockedEnqueueUpload.mockImplementation(async ({ assetId }) => {
      if (assetId === failedAsset && !failedOnce) {
        failedOnce = true;
        throw new Error("Cloud share failed.");
      }
      return {} as never;
    });
    const onLocalMediaAdded = jest.fn();
    renderUploadInput(onLocalMediaAdded);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(screen.getByLabelText(/Media Files/i), {
      target: { files: [new File(["a"], "first.png", { type: "image/png" }), new File(["b"], "second.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload (2 files)" }));

    const retry = await screen.findByRole("button", { name: "Retry failed files" });
    const transferPanel = within(screen.getByRole("complementary", { name: "Activity" }));
    expect(transferPanel.getAllByText(/Completed with errors/).length).toBeGreaterThan(0);
    expect(transferPanel.getByText("1 file failed to upload.")).toBeInTheDocument();
    expect(transferPanel.getAllByText("Cloud share failed.")).toHaveLength(1);
    expect(transferPanel.getByText(`${failedPosition}.png`)).toBeInTheDocument();
    expect(transferPanel.queryByRole("progressbar", { name: "2 media files progress" })).not.toBeInTheDocument();

    fireEvent.click(retry);
    expect(await transferPanel.findByText("Complete")).toBeInTheDocument();
    expect(mockedEnqueueUpload).toHaveBeenCalledTimes(3);
    expect(onLocalMediaAdded).toHaveBeenCalledTimes(2);
  });

  it("repairs an existing unsigned ownership failure only after Retry failed files is chosen", async () => {
    const media = localImage("old-cloud-failure", "welcome.png");
    mockedCreateLocalMedia.mockResolvedValue(media);
    mockedGetUploadJob
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue({
        status: "failed",
        lastError: "The image was not uploaded to this church's media folder.",
        cloudMedia: { id: "old-cloud-copy", publicId: "misplaced-image" },
      } as never);
    mockedWaitForUpload
      .mockRejectedValueOnce(new Error("The image was not uploaded to this church's media folder."))
      .mockImplementationOnce(async (_assetId, onState) => {
        onState?.({ status: "complete", progress: 100, phase: "Upload complete" });
        return {} as never;
      });
    renderUploadInput();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(screen.getByLabelText(/Media Files/i), {
      target: { files: [new File(["image"], "welcome.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload (1 file)" }));

    const retry = await screen.findByRole("button", { name: "Retry failed files" });
    expect(mockedRetryUpload).not.toHaveBeenCalled();
    fireEvent.click(retry);

    await waitFor(() => expect(mockedRetryUpload).toHaveBeenCalledWith(media.id));
    expect(mockedEnqueueUpload).toHaveBeenCalledTimes(2);
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

  it("uses an adaptive medium dialog and keeps Add files available", () => {
    renderUploadInput();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const dialog = screen.getByRole("dialog", { name: "Upload Media" });
    expect(dialog).toHaveAttribute("data-size", "md");
    expect(dialog).toHaveAttribute("data-content-class", "flex flex-col overflow-hidden");
    const dropZone = within(dialog).getByRole("group", { name: "Media file drop zone" });
    expect(dropZone).toHaveClass("p-4");
    expect(within(dropZone).getByText("Drop media here or choose files")).toBeInTheDocument();
    expect(within(dropZone).getByRole("button", { name: "Choose files" })).toBeInTheDocument();

    const files = ["one.png", "two.png", "three.png", "four.png", "five.png", "six.png", "seven.png", "eight.png"]
      .map((name) => new File(["image"], name, { type: "image/png" }));
    fireEvent.change(within(dialog).getByLabelText("Media Files"), { target: { files } });

    expect(dropZone).toHaveClass("p-2");
    expect(within(dropZone).getByText("Drop more files here")).toBeInTheDocument();
    expect(within(dropZone).getByRole("button", { name: "Add files" })).toBeInTheDocument();
    const list = within(dialog).getByRole("region", { name: "Selected media files" });
    expect(list).toHaveClass("min-h-0", "flex-1", "overflow-y-auto", "max-h-[min(50vh,32rem)]");
    files.forEach((file) => expect(within(list).getByText(file.name)).toBeInTheDocument());
    expect(screen.getByRole("switch", { name: /Upload to cloud/i })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Upload (8 files)" })).toBeInTheDocument();
  });
  it("shows the upload drop state only for native file drags", () => {
    renderUploadInput();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const target = screen.getByRole("button", { name: "Choose files" });
    expect(screen.getByText("Drop media here or choose files")).toBeInTheDocument();
    expect(screen.getByText("Images and videos")).toBeInTheDocument();
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
    const target = screen.getByRole("button", { name: "Choose files" });

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
