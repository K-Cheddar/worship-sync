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

jest.mock("../../hooks", () => ({ useDispatch: () => mockDispatch }));
jest.mock("../../context/toastContext", () => ({ useToast: () => ({ showToast: jest.fn() }) }));
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
  });

  it("cleans up a completed Church A Mux upload without patching Church B Redux state", async () => {
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
    const { result, rerender } = renderHook(() => useLocalMediaCloudShare(), { wrapper });
    let completion!: Promise<void>;
    act(() => { completion = result.current.uploadOwnedLocalMedia(media); });
    await waitFor(() => expect(mockUploadVideo).toHaveBeenCalledTimes(1));

    activeDb = dbB;
    activeChurchId = "church-b";
    rerender();
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
  });
});
