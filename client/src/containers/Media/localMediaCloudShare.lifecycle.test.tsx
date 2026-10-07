import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { MediaType } from "../../types";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { useLocalMediaCloudShare } from "./localMediaCloudShare";

const mockDispatch = jest.fn();
const mockUploadVideo = jest.fn();
const mockDeleteMuxAsset = jest.fn();
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
jest.mock("./utils/muxUpload", () => ({ uploadVideoToMux: (...args: unknown[]) => mockUploadVideo(...args) }));
jest.mock("../../api/providerStorage", () => ({
  deleteChurchMuxAsset: (...args: unknown[]) => mockDeleteMuxAsset(...args),
}));
jest.mock("../../utils/localImageUploadQueue", () => ({}));
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

describe("useLocalMediaCloudShare church scope", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTransfers.clear();
    mockTransferActions.clear();
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
});
