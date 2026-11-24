import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { MediaType } from "../../types";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { useLocalMediaCloudShare } from "./localMediaCloudShare";

const mockDispatch = jest.fn();
const mockUploadVideo = jest.fn();
const mockUploadLocalVideo = jest.fn();
const mockDeleteMuxAsset = jest.fn();
const mockCancelLocalImageUpload = jest.fn();
const mockEnqueueLocalImageUpload = jest.fn();
const mockGetLocalImageUploadJob = jest.fn();
const mockRetryLocalImageUpload = jest.fn();
const mockWaitForLocalImageUpload = jest.fn();
let mockMediaList: MediaType[] = [];
const mockClaim = { isCurrent: () => true, setCancel: jest.fn(), release: jest.fn(), failCleanup: jest.fn() };
const mockTransfers = new Map<string, any>();
const mockTransferActions = new Map<string, () => void | Promise<void>>();
const mockActions = {
  updateTransfer: jest.fn((transfer: any) => mockTransfers.set(transfer.id, transfer)),
  getTransfer: jest.fn((id: string) => mockTransfers.get(id)),
  removeTransfer: jest.fn((id: string) => mockTransfers.delete(id)),
  registerTransferAction: jest.fn((id: string, key: string, handler: () => void | Promise<void>) => {
    const actionKey = `${id}:${key}`;
    mockTransferActions.set(actionKey, handler);
    return () => mockTransferActions.delete(actionKey);
  }),
};

jest.mock("../../hooks", () => ({ useDispatch: () => mockDispatch }));
jest.mock("react-redux", () => ({ ...jest.requireActual("react-redux"), useStore: () => ({ getState: () => ({ media: { list: mockMediaList } }) }) }));
jest.mock("../../context/toastContext", () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock("../../context/transferContext", () => ({ useOptionalTransferActions: () => mockActions }));
jest.mock("../../utils/authStorage", () => ({ getOrCreateDeviceId: () => "device-a" }));
jest.mock("../../utils/deviceInfo", () => ({ getTrustedDeviceLabel: () => "Booth PC" }));
jest.mock("../../utils/localVideoFileAssets", () => ({
  getLocalVideoFileBlob: jest.fn(async () => ({
    blob: new Blob(["video"]),
    fileName: "clip.mp4",
    contentType: "video/mp4",
  })),
}));
jest.mock("./utils/muxUpload", () => ({
  uploadVideoToMux: (...args: unknown[]) => mockUploadVideo(...args),
  uploadLocalVideoAssetToMux: (...args: unknown[]) => mockUploadLocalVideo(...args),
}));
jest.mock("../../api/providerStorage", () => ({
  deleteChurchMuxAsset: (...args: unknown[]) => mockDeleteMuxAsset(...args),
}));
jest.mock("../../utils/localImageUploadQueue", () => ({
  cancelLocalImageUpload: (...args: unknown[]) => mockCancelLocalImageUpload(...args),
  enqueueLocalImageUpload: (...args: unknown[]) => mockEnqueueLocalImageUpload(...args),
  getLocalImageUploadJob: (...args: unknown[]) => mockGetLocalImageUploadJob(...args),
  retryLocalImageUpload: (...args: unknown[]) => mockRetryLocalImageUpload(...args),
  retryLocalImageUploadCancellation: jest.fn(async () => undefined),
  waitForLocalImageUpload: (...args: unknown[]) => mockWaitForLocalImageUpload(...args),
}));
jest.mock("../../utils/mediaOperationClaims", () => ({
  claimMediaUpload: () => mockClaim,
  isMediaUploadClaimed: () => false,
}));
jest.mock("./mediaLibraryLocalAvailability", () => ({
  canRequestLocalMediaCloudUpload: () => false,
  canUploadLocalMediaToCloud: () => true,
  getLocalMediaOwnerLabel: () => "Booth PC",
  localMediaHasCloudCopy: () => false,
}));

const media: MediaType = {
  path: "",
  createdAt: "",
  updatedAt: "",
  format: "mp4",
  height: 1080,
  width: 1920,
  name: "clip.mp4",
  publicId: "local-video-1",
  type: "video",
  id: "local-video-1",
  background: "local-video-file://local-video-1",
  thumbnail: "",
  source: "local",
  localVideoFile: {
    id: "local-video-1",
    ownerDeviceId: "device-a",
    ownerLabel: "Booth PC",
    fileName: "clip.mp4",
    contentType: "video/mp4",
    storagePolicy: "local-only",
  },
};

const localImage: MediaType = {
  ...media,
  id: "shared-media-id",
  name: "photo.jpg",
  format: "jpg",
  type: "image",
  background: "local-image-file://shared-asset-id",
  localVideoFile: undefined,
  localImage: {
    id: "shared-asset-id",
    ownerDeviceId: "device-a",
    ownerLabel: "Booth PC",
    fileName: "photo.jpg",
    contentType: "image/jpeg",
    storagePolicy: "local-only",
  },
};

describe("useLocalMediaCloudShare church scope", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMediaList = [];
    mockCancelLocalImageUpload.mockReset().mockResolvedValue(undefined);
    mockEnqueueLocalImageUpload.mockReset().mockResolvedValue(undefined);
    mockGetLocalImageUploadJob.mockReset().mockResolvedValue({ status: "failed", cancelRequested: false });
    mockRetryLocalImageUpload.mockReset().mockResolvedValue(undefined);
    mockWaitForLocalImageUpload.mockReset().mockResolvedValue(undefined);
    mockUploadLocalVideo.mockResolvedValue({
      playbackId: "playback-local",
      assetId: "mux-local",
      playbackUrl: "https://stream.mux.com/playback-local.m3u8",
      thumbnailUrl: "https://image.mux.com/playback-local/thumbnail.png",
      name: "clip",
    });
    mockTransfers.clear();
    mockTransferActions.clear();
    delete (window as { electronAPI?: unknown }).electronAPI;
  });

  it("streams a linked local video natively and applies cloud fields to the latest Media Library row", async () => {
    const hash = "a".repeat(64);
    const selected = {
      ...media,
      localVideoFile: { ...media.localVideoFile!, storageMode: "linked" as const, contentHash: hash, audioEnabled: true },
    };
    mockMediaList = [selected];
    const db = {
      get: jest.fn(async (id: string) => id === "media-library-meta"
        ? { schemaVersion: 2 }
        : { ...selected, _id: `media-item:${media.id}`, docType: "mediaItem" }),
    } as unknown as PouchDB.Database;
    const getLocalAsset = jest.fn(async () => ({ contentHash: hash, workspaceId: "church-a" }));
    const isVideoDownloaderAvailable = jest.fn(async () => true);
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { getLocalAsset, isVideoDownloaderAvailable, uploadLocalVideoAssetToMux: jest.fn() },
    });
    let resolveUpload!: (value: {
      playbackId: string;
      assetId: string;
      playbackUrl: string;
      thumbnailUrl: string;
      name: string;
    }) => void;
    mockUploadLocalVideo.mockReturnValueOnce(new Promise((resolve) => { resolveUpload = resolve; }));
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ControllerInfoContext.Provider value={{ db, isGuestSession: false } as never}>
        <GlobalInfoContext.Provider value={{ churchId: "church-a" } as never}>{children}</GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>
    );
    const { result } = renderHook(() => useLocalMediaCloudShare(), { wrapper });
    let completion!: Promise<void>;
    act(() => { completion = result.current.uploadOwnedLocalMedia(selected); });
    await waitFor(() => expect(mockUploadLocalVideo).toHaveBeenCalledTimes(1));

    mockMediaList = [{
      ...selected,
      name: "Current edited title",
      folderId: "folder-current",
      localVideoFile: { ...selected.localVideoFile!, audioEnabled: false },
    }];
    await act(async () => {
      resolveUpload({
        playbackId: "playback-local",
        assetId: "mux-local",
        playbackUrl: "https://stream.mux.com/playback-local.m3u8",
        thumbnailUrl: "https://image.mux.com/playback-local/thumbnail.png",
        name: "clip",
      });
      await completion;
    });

    expect(isVideoDownloaderAvailable).toHaveBeenCalledTimes(1);
    expect(mockUploadVideo).not.toHaveBeenCalled();
    expect(mockUploadLocalVideo).toHaveBeenCalledWith(
      selected.localVideoFile!.id,
      "clip.mp4",
      { churchId: "church-a", mediaId: media.id, title: "clip.mp4" },
      expect.objectContaining({ onProgress: expect.any(Function), setCancelUpload: expect.any(Function) }),
    );
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        id: media.id,
        patch: expect.objectContaining({
          muxPlaybackId: "playback-local",
          localVideoFile: expect.objectContaining({ storagePolicy: "local-and-cloud", audioEnabled: false }),
        }),
      }),
    }));
    expect(mockDeleteMuxAsset).not.toHaveBeenCalled();
  });

  it("cleans an unregistered Mux result when the linked source changes during upload", async () => {
    const hash = "a".repeat(64);
    const selected = {
      ...media,
      localVideoFile: { ...media.localVideoFile!, storageMode: "linked" as const, contentHash: hash },
    };
    mockMediaList = [selected];
    const db = {
      get: jest.fn(async (id: string) => id === "media-library-meta"
        ? { schemaVersion: 2 }
        : { ...selected, _id: `media-item:${media.id}`, docType: "mediaItem" }),
    } as unknown as PouchDB.Database;
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        getLocalAsset: jest.fn(async () => ({ contentHash: hash, workspaceId: "church-a" })),
        isVideoDownloaderAvailable: jest.fn(async () => true),
        uploadLocalVideoAssetToMux: jest.fn(),
      },
    });
    let resolveUpload!: (value: {
      playbackId: string;
      assetId: string;
      playbackUrl: string;
      thumbnailUrl: string;
      name: string;
    }) => void;
    mockUploadLocalVideo.mockReturnValueOnce(new Promise((resolve) => { resolveUpload = resolve; }));
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ControllerInfoContext.Provider value={{ db, isGuestSession: false } as never}>
        <GlobalInfoContext.Provider value={{ churchId: "church-a" } as never}>{children}</GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>
    );
    const { result } = renderHook(() => useLocalMediaCloudShare(), { wrapper });
    let completion!: Promise<void>;
    act(() => { completion = result.current.uploadOwnedLocalMedia(selected); });
    await waitFor(() => expect(mockUploadLocalVideo).toHaveBeenCalledTimes(1));

    mockMediaList = [{
      ...selected,
      localVideoFile: { ...selected.localVideoFile!, contentHash: "b".repeat(64) },
    }];
    await act(async () => {
      resolveUpload({
        playbackId: "playback-local",
        assetId: "mux-local",
        playbackUrl: "https://stream.mux.com/playback-local.m3u8",
        thumbnailUrl: "https://image.mux.com/playback-local/thumbnail.png",
        name: "clip",
      });
      await completion;
    });

    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockDeleteMuxAsset).toHaveBeenCalledWith("church-a", "mux-local");
    expect([...mockTransfers.values()]).toEqual(expect.arrayContaining([expect.objectContaining({
      files: expect.arrayContaining([expect.objectContaining({
        status: "failed",
        error: expect.stringContaining("source changed or was removed"),
      })]),
    })]));
  });

  it.each(["stale A", "current B"])("does not upload selected %s when Pouch holds B and native still holds A", async (selection) => {
    const stale = { ...media, localVideoFile: { ...media.localVideoFile!, storageMode: "linked" as const, contentHash: "a".repeat(64) } };
    const current = { ...stale, localVideoFile: { ...stale.localVideoFile, contentHash: "b".repeat(64) },
      pendingLinkedVideoCleanup: [{ localAssetId: "candidate", linkedAssetId: media.localVideoFile!.id,
        contentHash: "b".repeat(64), previousContentHash: "a".repeat(64), contentChanged: true, muxAssetIds: [], previousFields: stale }] };
    const db = { get: jest.fn(async (id: string) => id === "media-library-meta" ? { schemaVersion: 2 }
      : { ...current, _id: `media-item:${media.id}`, docType: "mediaItem" }) } as unknown as PouchDB.Database;
    const getLocalAsset = jest.fn(async () => ({ contentHash: "a".repeat(64), workspaceId: "church-a" }));
    Object.defineProperty(window, "electronAPI", { configurable: true, value: { getLocalAsset } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ControllerInfoContext.Provider value={{ db, isGuestSession: false } as never}>
        <GlobalInfoContext.Provider value={{ churchId: "church-a" } as never}>{children}</GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>
    );
    const { result } = renderHook(() => useLocalMediaCloudShare(), { wrapper });
    try {
      await act(async () => { await result.current.uploadOwnedLocalMedia(selection === "stale A" ? stale : current); });
      expect(mockUploadVideo).not.toHaveBeenCalled();
      expect(mockDispatch).not.toHaveBeenCalled();
      expect(getLocalAsset).toHaveBeenCalledTimes(selection === "stale A" ? 0 : 1);
      expect(mockTransferActions.has(`media-relink-cleanup-church-a:${media.id}:retry-cleanup`)).toBe(true);
      expect([...mockTransfers.values()]).toEqual(expect.arrayContaining([expect.objectContaining({
        files: expect.arrayContaining([expect.objectContaining({ error: expect.stringContaining("relink") })]),
      })]));
    } finally { delete (window as { electronAPI?: unknown }).electronAPI; }
  });

  it("cleans up a Church A Mux result after Media unmounts without patching Church B", async () => {
    let resolveUpload!: (value: {
      playbackId: string;
      assetId: string;
      playbackUrl: string;
      thumbnailUrl: string;
      name: string;
    }) => void;
    mockUploadVideo.mockReturnValueOnce(new Promise((resolve) => { resolveUpload = resolve; }));
    const dbA = {} as PouchDB.Database;
    const dbB = {} as PouchDB.Database;
    let activeDb = dbA;
    let activeChurchId = "church-a";
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ControllerInfoContext.Provider value={{ db: activeDb, isGuestSession: false } as any}>
        <GlobalInfoContext.Provider value={{ churchId: activeChurchId } as any}>{children}</GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>
    );
    const { result, rerender, unmount } = renderHook(() => useLocalMediaCloudShare(), { wrapper });
    let completion!: Promise<void>;
    act(() => { completion = result.current.uploadOwnedLocalMedia(media); });
    await waitFor(() => expect(mockUploadVideo).toHaveBeenCalledTimes(1));

    activeDb = dbB;
    activeChurchId = "church-b";
    rerender();
    unmount();
    await act(async () => {
      resolveUpload({
        playbackId: "playback-a",
        assetId: "mux-asset-a",
        playbackUrl: "https://stream.mux.com/playback-a.m3u8",
        thumbnailUrl: "https://image.mux.com/playback-a/thumbnail.png",
        name: "clip.mp4",
      });
      await completion;
    });

    expect(mockDeleteMuxAsset).toHaveBeenCalledWith("church-a", "mux-asset-a");
    expect(mockDispatch).not.toHaveBeenCalled();
    const transferId = [...mockTransfers.keys()][0];
    expect(mockTransfers.get(transferId).actions).toEqual([{ key: "dismiss", label: "Dismiss" }]);
    expect(mockTransferActions.has(`${transferId}:dismiss`)).toBe(true);
    await act(async () => { await mockTransferActions.get(`${transferId}:dismiss`)?.(); });
    expect(mockActions.removeTransfer).toHaveBeenCalledWith(transferId);
  });

  it("keeps provider cleanup and dismissal available when late Mux cleanup fails after unmount", async () => {
    let resolveUpload!: (value: {
      playbackId: string;
      assetId: string;
      playbackUrl: string;
      thumbnailUrl: string;
      name: string;
    }) => void;
    mockUploadVideo.mockReturnValueOnce(new Promise((resolve) => { resolveUpload = resolve; }));
    mockDeleteMuxAsset
      .mockRejectedValueOnce(new Error("Mux cleanup unavailable"))
      .mockResolvedValueOnce({ success: true });
    const dbA = {} as PouchDB.Database;
    const dbB = {} as PouchDB.Database;
    let activeDb = dbA;
    let activeChurchId = "church-a";
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ControllerInfoContext.Provider value={{ db: activeDb, isGuestSession: false } as any}>
        <GlobalInfoContext.Provider value={{ churchId: activeChurchId } as any}>{children}</GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>
    );
    const { result, rerender, unmount } = renderHook(() => useLocalMediaCloudShare(), { wrapper });
    let completion!: Promise<void>;
    act(() => { completion = result.current.uploadOwnedLocalMedia(media); });
    await waitFor(() => expect(mockUploadVideo).toHaveBeenCalledTimes(1));
    const transferId = [...mockTransfers.keys()][0];

    activeDb = dbB;
    activeChurchId = "church-b";
    rerender();
    unmount();
    expect(mockTransfers.get(transferId).actions).toEqual([{ key: "dismiss", label: "Dismiss" }]);
    await act(async () => {
      resolveUpload({
        playbackId: "playback-a",
        assetId: "mux-asset-a",
        playbackUrl: "https://stream.mux.com/playback-a.m3u8",
        thumbnailUrl: "https://image.mux.com/playback-a/thumbnail.png",
        name: "clip.mp4",
      });
      await completion;
    });

    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockDeleteMuxAsset).toHaveBeenNthCalledWith(1, "church-a", "mux-asset-a");
    expect(mockTransfers.get(transferId).actions).toEqual([
      { key: "retry-cleanup", label: "Retry cleanup" },
      { key: "dismiss", label: "Dismiss" },
    ]);
    const retryCleanup = mockTransferActions.get(`${transferId}:retry-cleanup`);
    expect(retryCleanup).toBeDefined();
    await act(async () => { await retryCleanup?.(); });
    expect(mockDeleteMuxAsset).toHaveBeenNthCalledWith(2, "church-a", "mux-asset-a");
    expect(mockTransfers.get(transferId).actions).toEqual([{ key: "dismiss", label: "Dismiss" }]);
    expect(mockTransfers.get(transferId).files[0].error).toContain("Cleanup succeeded");
    await act(async () => { await mockTransferActions.get(`${transferId}:dismiss`)?.(); });
    expect(mockActions.removeTransfer).toHaveBeenCalledWith(transferId);
  });

  it("blocks an image retry after a church switch, during preparation, and until returning to its owner", async () => {
    const imageA = { ...localImage, name: "Church A photo.jpg" };
    const imageB = { ...localImage, name: "Church B photo.jpg" };
    mockMediaList = [imageA];
    mockWaitForLocalImageUpload.mockRejectedValueOnce(new Error("Temporary image upload failure"));
    let activeDb: PouchDB.Database = { name: "church-a" } as PouchDB.Database;
    let activeChurchId = "church-a";
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ControllerInfoContext.Provider value={{ db: activeDb, isGuestSession: false } as any}>
        <GlobalInfoContext.Provider value={{ churchId: activeChurchId } as any}>{children}</GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>
    );
    const { result, rerender } = renderHook(() => useLocalMediaCloudShare(), { wrapper });
    await act(async () => { await result.current.uploadOwnedLocalMedia(imageA); });
    const transferId = [...mockTransfers.keys()][0];
    const retry = mockTransferActions.get(`${transferId}:retry-failed`);
    expect(retry).toBeDefined();

    activeDb = { name: "church-b" } as PouchDB.Database;
    activeChurchId = "church-b";
    mockMediaList = [imageB];
    rerender();
    await act(async () => { await retry?.(); });
    expect(mockGetLocalImageUploadJob).not.toHaveBeenCalled();
    expect(mockRetryLocalImageUpload).not.toHaveBeenCalled();
    expect(mockEnqueueLocalImageUpload).toHaveBeenCalledTimes(1);
    expect(mockTransfers.get(transferId).files[0].error).toContain("original church");

    activeDb = { name: "church-a" } as PouchDB.Database;
    activeChurchId = "church-a";
    mockMediaList = [imageA];
    rerender();
    let resolveJob!: (job: { status: string; cancelRequested: boolean }) => void;
    mockGetLocalImageUploadJob.mockReturnValueOnce(new Promise((resolve) => { resolveJob = resolve; }));
    let preparing!: Promise<void>;
    act(() => { preparing = retry!(); });
    await waitFor(() => expect(mockGetLocalImageUploadJob).toHaveBeenCalledTimes(1));

    activeDb = { name: "church-b" } as PouchDB.Database;
    activeChurchId = "church-b";
    mockMediaList = [imageB];
    rerender();
    await act(async () => {
      resolveJob({ status: "failed", cancelRequested: false });
      await preparing;
    });
    expect(mockRetryLocalImageUpload).not.toHaveBeenCalled();
    expect(mockEnqueueLocalImageUpload).toHaveBeenCalledTimes(1);

    activeDb = { name: "church-a" } as PouchDB.Database;
    activeChurchId = "church-a";
    mockMediaList = [imageA];
    rerender();
    await act(async () => { await retry?.(); });
    expect(mockRetryLocalImageUpload).toHaveBeenCalledWith("shared-asset-id");
    expect(mockEnqueueLocalImageUpload).toHaveBeenCalledTimes(2);
    expect(mockEnqueueLocalImageUpload.mock.calls[0][0]).toMatchObject({ workspaceId: "church-a", mediaId: "shared-media-id" });
    expect(mockEnqueueLocalImageUpload.mock.calls[1][0]).toMatchObject({ workspaceId: "church-a", mediaId: "shared-media-id" });
    expect(mockEnqueueLocalImageUpload.mock.calls.map(([value]) => value.workspaceId)).not.toContain("church-b");
  });

  it("cancels the original church's image upload when scope changes during enqueue", async () => {
    const imageA = { ...localImage, name: "Church A photo.jpg" };
    const imageB = { ...localImage, name: "Church B photo.jpg" };
    mockMediaList = [imageA];
    let finishEnqueue!: () => void;
    mockEnqueueLocalImageUpload.mockReturnValueOnce(new Promise<void>((resolve) => { finishEnqueue = resolve; }));
    let activeDb: PouchDB.Database = { name: "church-a" } as PouchDB.Database;
    let activeChurchId = "church-a";
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ControllerInfoContext.Provider value={{ db: activeDb, isGuestSession: false } as any}>
        <GlobalInfoContext.Provider value={{ churchId: activeChurchId } as any}>{children}</GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>
    );
    const { result, rerender } = renderHook(() => useLocalMediaCloudShare(), { wrapper });
    let completion!: Promise<void>;
    act(() => { completion = result.current.uploadOwnedLocalMedia(imageA); });
    await waitFor(() => expect(mockEnqueueLocalImageUpload).toHaveBeenCalledTimes(1));
    expect(mockEnqueueLocalImageUpload.mock.calls[0][0]).toMatchObject({ workspaceId: "church-a" });

    activeDb = { name: "church-b" } as PouchDB.Database;
    activeChurchId = "church-b";
    mockMediaList = [imageB];
    rerender();
    await act(async () => {
      finishEnqueue();
      await completion;
    });

    expect(mockCancelLocalImageUpload).toHaveBeenCalledWith("shared-asset-id");
    expect(mockWaitForLocalImageUpload).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockEnqueueLocalImageUpload.mock.calls.map(([value]) => value.workspaceId)).toEqual(["church-a"]);
  });
});
