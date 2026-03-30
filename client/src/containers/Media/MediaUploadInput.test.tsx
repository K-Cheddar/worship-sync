import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import MediaUploadInput from "./MediaUploadInput";

const mockValidateFiles = jest.fn((files: File[]) => ({
  valid: files,
  invalid: [],
}));
const mockDetectFileType = jest.fn(() => "image");
const mockUploadImageToCloudinary = jest.fn();

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

jest.mock("./utils/cloudinaryUpload", () => ({
  uploadImageToCloudinary: (...args: any[]) => mockUploadImageToCloudinary(...args),
}));

jest.mock("./utils/muxUpload", () => ({
  uploadVideoToMux: jest.fn(),
}));

describe("MediaUploadInput", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (window as { electronAPI?: unknown }).electronAPI = {
      setUploadInProgress: jest.fn().mockResolvedValue(true),
      setTaskbarUploadProgress: jest.fn().mockResolvedValue(true),
    };
  });

  afterEach(() => {
    delete (window as { electronAPI?: unknown }).electronAPI;
  });

  it("updates Electron upload progress while uploads are active", async () => {
    jest.useFakeTimers();

    const onImageComplete = jest.fn();
    const uploadResult = {
      secure_url: "https://cdn.test/image.jpg",
      public_id: "image-1",
      asset_id: "asset-1",
      original_filename: "sermon",
      width: 100,
      height: 100,
      format: "jpg",
      resource_type: "image",
      created_at: "2026-03-29T00:00:00.000Z",
      bytes: 100,
      url: "https://cdn.test/image.jpg",
      thumbnail_url: "https://cdn.test/thumb.jpg",
    };
    let resolveUpload: ((value: typeof uploadResult) => void) | undefined;
    const uploadDone = new Promise<typeof uploadResult>((resolve) => {
      resolveUpload = resolve;
    });

    mockUploadImageToCloudinary.mockImplementation(
      async (_file: File, _uploadPreset: string, _cloudName: string, callbacks: any) => {
        callbacks.onProgress(50);
        return uploadDone;
      }
    );

    const { container } = render(
      <MediaUploadInput
        onImageComplete={onImageComplete}
        onVideoComplete={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["image"], "photo.png", { type: "image/png" });

    fireEvent.change(fileInput, { target: { files: [file] } });

    const electronAPI = window.electronAPI as {
      setUploadInProgress: jest.Mock;
      setTaskbarUploadProgress: jest.Mock;
    };

    electronAPI.setUploadInProgress.mockClear();
    electronAPI.setTaskbarUploadProgress.mockClear();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Upload (1 file)" }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(electronAPI.setUploadInProgress).toHaveBeenCalledWith(true);
    });

    await waitFor(() => {
      expect(electronAPI.setTaskbarUploadProgress).toHaveBeenCalledWith(0.5);
    });

    await act(async () => {
      resolveUpload?.(uploadResult);
      await uploadDone;
    });

    await waitFor(() => {
      expect(onImageComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          original_filename: "sermon",
        })
      );
    });

    await waitFor(() => {
      expect(electronAPI.setUploadInProgress).toHaveBeenCalledWith(false);
      expect(electronAPI.setTaskbarUploadProgress).toHaveBeenCalledWith(null);
    });

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    jest.useRealTimers();
  });
});
