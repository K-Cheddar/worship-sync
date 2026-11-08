import { act, render, waitFor } from "@testing-library/react";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { uploadImageToCloudinarySigned } from "../../containers/Media/utils/cloudinaryUpload";
import {
  cancelCloudinaryMediaUpload,
  commitCloudinaryMediaAsset,
  createCloudinaryMediaUpload,
  deleteCloudinaryMediaAsset,
} from "../../api/providerStorage";
import {
  claimLocalImageUploadJob,
  activateStagedLocalVideoInputThumbnailUploadJobAtomically,
  cleanupOrphanedLocalImages,
  discardStagedLocalVideoInputThumbnailUploadJobAtomically,
  deleteLocalImage,
  deleteLocalImageUploadJob,
  getLocalImage,
  listLocalImageUploadJobs,
  isLocalImageUploadStagingSessionActive,
  persistLocalImageCloudCopy,
  releaseLocalImageUploadJobLease,
  renewLocalImageUploadJobLease,
  stageLocalImageUploadCleanupJobAtomically,
  updateLeasedLocalImageUploadJob,
  type LocalImageUploadJob,
} from "../../utils/localImageAssets";
import LocalImageUploadManager from "./LocalImageUploadManager";
import type { MediaType } from "../../types";
import store from "../../store/store";
import { loadMediaLibrary } from "../../utils/mediaDocUtils";
import {
  addItemToMediaList,
  updateMediaItemFields,
  updateMediaList,
} from "../../store/mediaSlice";
import { flushMediaLibraryDocToPouch } from "../../utils/flushMediaLibraryDoc";

const mockDispatch = jest.fn();
const mockState = {
  media: { list: [] as MediaType[], isInitialized: true },
};
const mockPouchState = {
  list: [] as MediaType[],
  folders: [] as Array<{ id: string; name: string; parentId: string | null }>,
};
jest.mock("../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: typeof mockState) => unknown) =>
    selector(mockState),
}));
jest.mock("../../utils/localImageAssets", () => ({
  activateStagedLocalVideoInputThumbnailUploadJobAtomically: jest.fn(),
  claimLocalImageUploadJob: jest.fn(),
  cleanupOrphanedLocalImages: jest.fn(() => Promise.resolve(0)),
  deleteLocalImageUploadJob: jest.fn(),
  discardStagedLocalVideoInputThumbnailUploadJobAtomically: jest.fn(),
  deleteLocalImage: jest.fn(() => Promise.resolve()),
  getLocalImage: jest.fn(),
  getLocalImageUploadJob: jest.fn(() => Promise.resolve(undefined)),
  isLocalImageUploadStagingSessionActive: jest.fn(() => false),
  listLocalImageUploadJobs: jest.fn(),
  persistLocalImageCloudCopy: jest.fn(),
  putLocalImageUploadJob: jest.fn(() => Promise.resolve()),
  releaseLocalImageUploadJobLease: jest.fn(),
  registerLocalImageUploadManagerSession: jest.fn(() => jest.fn()),
  renewLocalImageUploadJobLease: jest.fn(),
  subscribeLocalImageUploadJobChanges: jest.fn(() => jest.fn()),
  stageLocalImageUploadCleanupJobAtomically: jest.fn(async (job) => ({ job, previous: undefined })),
  updateLeasedLocalImageUploadJob: jest.fn(),
}));
jest.mock("../../utils/flushMediaLibraryDoc", () => ({
  flushMediaLibraryDocToPouch: jest.fn(() => Promise.resolve({ ok: true })),
}));
jest.mock("../../utils/mediaDocUtils", () => ({
  loadMediaLibrary: jest.fn(async () => ({
    list: mockPouchState.list,
    folders: mockPouchState.folders,
  })),
}));
jest.mock("../../containers/Media/utils/cloudinaryUpload", () => ({
  uploadImageToCloudinarySigned: jest.fn(),
}));
jest.mock("../../api/providerStorage", () => ({
  createCloudinaryMediaUpload: jest.fn(() => Promise.resolve({
    uploadId: "intent-1",
    uploadUrl: "https://api.cloudinary.com/v1_1/portable-media/image/upload",
    publicId: "cloud-public-id",
    fields: { api_key: "key", timestamp: "1", signature: "sig", public_id: "cloud-public-id" },
  })),
  cancelCloudinaryMediaUpload: jest.fn(() => Promise.resolve({ cancelled: true })),
  commitCloudinaryMediaAsset: jest.fn(() => Promise.resolve({ asset: {
    provider: "cloudinary", assetId: "provider-asset-1", publicId: "cloud-public-id",
    churchId: "church-1", permanent: true, bytes: 5,
  } })),
  deleteCloudinaryMediaAsset: jest.fn(() => Promise.resolve({ success: true })),
}));
jest.mock("../../utils/localImageUploadQueue", () => ({
  clearLocalImageUploadProcessing: jest.fn(),
  clearLocalImageUploadRequest: jest.fn(),
  consumeLocalImageUploadCancellation: jest.fn(),
  isLocalImageUploadCancellationRequested: jest.fn(() => false),
  registerLocalImageUploadProcessing: jest.fn(),
  registerLocalImageUploadRequest: jest.fn(),
  signalLocalImageUploadCancellation: jest.fn(),
}));
jest.mock("../../containers/Media/utils/cloudinaryMediaItem", () => ({
  createCloudinaryImageMediaItem: jest.fn(() => ({
    id: "generated-media-id",
    name: "Welcome.png",
    type: "image",
    publicId: "cloud-public-id",
    background: "https://res.cloudinary.com/example/welcome.png",
  })),
}));

const mockListJobs = jest.mocked(listLocalImageUploadJobs);
const mockClaimJob = jest.mocked(claimLocalImageUploadJob);
const mockActivateStagedUpload = jest.mocked(activateStagedLocalVideoInputThumbnailUploadJobAtomically);
const mockDiscardStagedUpload = jest.mocked(discardStagedLocalVideoInputThumbnailUploadJobAtomically);
const mockGetLocalImage = jest.mocked(getLocalImage);
const mockStagingSessionActive = jest.mocked(isLocalImageUploadStagingSessionActive);
const mockUpload = jest.mocked(uploadImageToCloudinarySigned);
const mockCommitCloudinary = jest.mocked(commitCloudinaryMediaAsset);
const mockCancelCloudinaryUpload = jest.mocked(cancelCloudinaryMediaUpload);
const mockDeleteCloudinaryAsset = jest.mocked(deleteCloudinaryMediaAsset);
const mockCreateCloudinaryUpload = jest.mocked(createCloudinaryMediaUpload);
const mockPersistCloudCopy = jest.mocked(persistLocalImageCloudCopy);
const mockDeleteJob = jest.mocked(deleteLocalImageUploadJob);
const mockDeleteLocalImage = jest.mocked(deleteLocalImage);
const mockFlushMedia = jest.mocked(flushMediaLibraryDocToPouch);
const mockLoadMediaLibrary = jest.mocked(loadMediaLibrary);
const mockReleaseLease = jest.mocked(releaseLocalImageUploadJobLease);
const mockRenewLease = jest.mocked(renewLocalImageUploadJobLease);
const mockStageCleanup = jest.mocked(stageLocalImageUploadCleanupJobAtomically);
const mockUpdateJob = jest.mocked(updateLeasedLocalImageUploadJob);

const interruptedJob: LocalImageUploadJob = {
  id: "asset-1",
  assetId: "asset-1",
  itemId: "item-1",
  workspaceId: "church-1",
  uploadPreset: "preset",
  mediaId: "stable-media-id",
  status: "uploading",
  attemptCount: 1,
  nextAttemptAt: 0,
  createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z",
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

describe("LocalImageUploadManager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDispatch.mockReset();
    mockState.media.list = [];
    mockPouchState.list = [];
    mockPouchState.folders = [];
    mockLoadMediaLibrary.mockImplementation(async () => ({
      list: mockPouchState.list,
      folders: mockPouchState.folders,
    } as Awaited<ReturnType<typeof loadMediaLibrary>>));
    mockFlushMedia.mockImplementation(async (_db, list, folders) => {
      mockPouchState.list = list;
      mockPouchState.folders = folders;
      return { ok: true };
    });
    store.dispatch(updateMediaList([]));
    mockListJobs.mockReset().mockResolvedValueOnce([interruptedJob]).mockResolvedValue([]);
    mockGetLocalImage.mockResolvedValue({
      id: "asset-1",
      workspaceId: "church-1",
      blob: new Blob(["image"], { type: "image/png" }),
      fileName: "Welcome.png",
      contentType: "image/png",
      size: 5,
      width: 1920,
      height: 1080,
      createdAt: "2026-08-12T00:00:00.000Z",
    });
    mockUpload.mockResolvedValue({
      public_id: "cloud-public-id",
      secure_url: "https://res.cloudinary.com/example/welcome.png",
    } as any);
    mockCommitCloudinary.mockResolvedValue({ asset: {
      provider: "cloudinary", assetId: "provider-asset-1", publicId: "cloud-public-id",
      churchId: "church-1", permanent: true, bytes: 5,
    } });
    mockPersistCloudCopy.mockResolvedValue({} as any);
    mockDeleteJob.mockResolvedValue();
    mockUpdateJob.mockImplementation(
      async ({ leaseOwnerId, leaseDurationMs, now, patch }) => ({
        ...interruptedJob,
        ...patch,
        leaseOwnerId,
        leaseExpiresAt: now + leaseDurationMs,
        updatedAt: new Date(now).toISOString(),
      } as LocalImageUploadJob),
    );
    mockClaimJob.mockImplementation(async ({ leaseOwnerId }) => ({
      ...interruptedJob,
      leaseOwnerId,
      leaseExpiresAt: Date.now() + 300_000,
    }));
    mockActivateStagedUpload.mockReset();
    mockDiscardStagedUpload.mockReset().mockResolvedValue(true);
    mockStagingSessionActive.mockReset().mockReturnValue(false);
    mockReleaseLease.mockResolvedValue(true);
    mockRenewLease.mockResolvedValue(true);
    mockStageCleanup.mockReset().mockImplementation(async (job) => ({ job, previous: undefined }));
  });

  it("merges cloud finalization into the latest Media row and cleans its previous image", async () => {
    const previousImage = {
      id: "old-thumbnail",
      ownerDeviceId: "device-1",
      ownerLabel: "Booth PC",
      fileName: "old.webp",
      contentType: "image/webp",
      storagePolicy: "local-and-cloud" as const,
      cloudUrl: "https://res.cloudinary.com/example/old.webp",
      cloudMediaId: "old-cloud-id",
      cloudPublicId: "old-cloud-public-id",
    };
    const input: MediaType = {
      path: "",
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
      format: "live",
      height: 1080,
      width: 1920,
      name: "Main camera",
      publicId: "local_input_camera-1",
      type: "video",
      id: "local_input_camera-1",
      background: "local-video-input://camera-1",
      thumbnail: previousImage.cloudUrl,
      source: "local",
      providerStorage: {
        provider: "mux",
        assetId: "unrelated-provider-asset",
        churchId: "church-1",
        permanent: true,
      },
      localImage: {
        ...previousImage,
        id: "new-thumbnail",
        fileName: "camera.webp",
        storagePolicy: "local-and-cloud",
      },
      localVideoInput: {
        kind: "local-video-input",
        sourceId: "camera-1",
        label: "Main camera",
        ownerDeviceId: "device-1",
        ownerLabel: "Booth PC",
      },
    };
    const uploadJob: LocalImageUploadJob = {
      ...interruptedJob,
      assetId: "new-thumbnail",
      id: "new-thumbnail",
      itemId: "",
      mediaId: "thumbnail-cloud-asset",
      status: "pending",
      localVideoInputThumbnail: {
        targetMediaId: input.id,
        previousAssetId: "old-thumbnail",
        previousCloudPublicId: "old-cloud-public-id",
      },
    };
    let latestJob = uploadJob;
    mockState.media.list = [input];
    mockPouchState.list = [input];
    store.dispatch(updateMediaList([input]));
    mockDispatch.mockImplementation((action) => store.dispatch(action));
    mockListJobs.mockReset().mockResolvedValueOnce([uploadJob]).mockResolvedValue([]);
    mockClaimJob.mockResolvedValue({
      ...uploadJob,
      leaseOwnerId: "lease-owner",
      leaseExpiresAt: Date.now() + 300_000,
    });
    mockGetLocalImage.mockResolvedValue({
      id: "new-thumbnail",
      workspaceId: "church-1",
      blob: new Blob(["image"], { type: "image/webp" }),
      fileName: "camera.webp",
      contentType: "image/webp",
      size: 5,
      width: 640,
      height: 360,
      createdAt: "2026-11-05T00:00:00.000Z",
    });
    const allowFinalization = deferred<void>();
    mockFlushMedia.mockImplementationOnce(async (_db, list, folders, _getLatest, changeBase) => {
      await allowFinalization.promise;
      if (!changeBase) {
        mockPouchState.list = list;
        mockPouchState.folders = folders;
        return { ok: true };
      }
      const before = changeBase.list.find((item) => item.id === input.id);
      const requested = list.find((item) => item.id === input.id);
      const current = mockPouchState.list.find((item) => item.id === input.id);
      if (before && requested && current) {
        const merged = { ...current } as Record<string, unknown>;
        const currentFields = current as unknown as Record<string, unknown>;
        const beforeFields = before as unknown as Record<string, unknown>;
        const requestedFields = requested as unknown as Record<string, unknown>;
        for (const key of new Set([...Object.keys(before), ...Object.keys(requested)])) {
          if (JSON.stringify(beforeFields[key]) === JSON.stringify(requestedFields[key])) continue;
          if (
            JSON.stringify(currentFields[key]) === JSON.stringify(beforeFields[key]) ||
            JSON.stringify(currentFields[key]) === JSON.stringify(requestedFields[key])
          ) {
            merged[key] = requestedFields[key];
          }
        }
        mockPouchState.list = [merged as unknown as MediaType];
      }
      mockPouchState.folders = folders;
      return { ok: true };
    });
    mockUpdateJob.mockImplementation(async ({ leaseOwnerId, leaseDurationMs, now, patch }) => {
      latestJob = {
        ...latestJob,
        ...patch,
        leaseOwnerId,
        leaseExpiresAt: now + leaseDurationMs,
        updatedAt: new Date(now).toISOString(),
      } as LocalImageUploadJob;
      return latestJob;
    });

    const view = render(
      <ControllerInfoContext.Provider value={{ db: {} as PouchDB.Database, isGuestSession: false } as any}>
        <GlobalInfoContext.Provider value={{ churchId: "church-1" } as any}>
          <LocalImageUploadManager />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );

    await waitFor(() => expect(mockFlushMedia).toHaveBeenCalled());
    const latestMetadata = {
      name: "Renamed during cloud finalization",
      folderId: "camera-folder-2",
      localVideoInput: {
        ...input.localVideoInput!,
        label: "Renamed during cloud finalization",
        deviceId: "camera-device-2",
      },
    };
    mockPouchState.list = [{ ...input, ...latestMetadata }];
    mockState.media.list = [{ ...input, ...latestMetadata }];
    store.dispatch(updateMediaItemFields({ id: input.id, patch: latestMetadata }));
    allowFinalization.resolve();
    await waitFor(() =>
      expect(mockUpdateJob).toHaveBeenCalledWith(
        expect.objectContaining({
          patch: expect.objectContaining({ status: "complete" }),
        }),
      ),
    );
    expect(mockStageCleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "old-thumbnail",
        cleanupCloudPublicId: "old-cloud-public-id",
        cleanupOnly: true,
        cleanupReady: true,
      }),
      expect.any(Number),
    );
    expect(mockDeleteCloudinaryAsset).not.toHaveBeenCalledWith(
      "church-1",
      "old-cloud-public-id",
    );
    expect(mockDeleteLocalImage).not.toHaveBeenCalledWith("old-thumbnail");
    const updatedAction = mockDispatch.mock.calls
      .map(([action]) => action)
      .find((action) => action.type === updateMediaItemFields.type);
    expect(updatedAction).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          id: input.id,
          patch: expect.objectContaining({
            thumbnail: "https://res.cloudinary.com/example/welcome.png",
            localImage: expect.objectContaining({
              id: "new-thumbnail",
              cloudPublicId: "cloud-public-id",
            }),
          }),
        }),
      }),
    );
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: addItemToMediaList.type }),
    );
    expect(mockFlushMedia.mock.calls[0][4]).toEqual(
      expect.objectContaining({ list: expect.any(Array) }),
    );
    const persistedList = mockFlushMedia.mock.calls[0][1];
    expect(persistedList[0]).toEqual(
      expect.objectContaining({
        id: input.id,
        publicId: input.publicId,
        localVideoInput: input.localVideoInput,
        localImage: expect.objectContaining({ id: "new-thumbnail" }),
      }),
    );
    expect(mockPouchState.list[0]).toEqual(
      expect.objectContaining({
        name: "Renamed during cloud finalization",
        folderId: "camera-folder-2",
        localVideoInput: latestMetadata.localVideoInput,
        thumbnail: "https://res.cloudinary.com/example/welcome.png",
        localImage: expect.objectContaining({ id: "new-thumbnail" }),
      }),
    );
    expect(store.getState().media.list[0]).toEqual(
      expect.objectContaining({ ...latestMetadata, thumbnail: "https://res.cloudinary.com/example/welcome.png" }),
    );
    view.unmount();
  });

  it("cleans removed thumbnail bytes and cloud storage through a cleanup job", async () => {
    const cleanupJob: LocalImageUploadJob = {
      ...interruptedJob,
      assetId: "removed-thumbnail",
      id: "removed-thumbnail",
      status: "pending",
      cleanupOnly: true,
      cleanupReady: true,
      cleanupCloudPublicId: "removed-cloud-public-id",
      cleanupCloudComplete: false,
    };
    mockListJobs.mockReset().mockResolvedValueOnce([cleanupJob]).mockResolvedValue([]);
    mockClaimJob.mockResolvedValue({
      ...cleanupJob,
      leaseOwnerId: "lease-owner",
      leaseExpiresAt: Date.now() + 300_000,
    });
    mockUpdateJob.mockImplementation(async ({ leaseOwnerId, leaseDurationMs, now, patch }) => ({
      ...cleanupJob,
      ...patch,
      leaseOwnerId,
      leaseExpiresAt: now + leaseDurationMs,
      updatedAt: new Date(now).toISOString(),
    } as LocalImageUploadJob));

    const view = render(
      <ControllerInfoContext.Provider value={{ db: {} as PouchDB.Database, isGuestSession: false } as any}>
        <GlobalInfoContext.Provider value={{ churchId: "church-1" } as any}>
          <LocalImageUploadManager />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );

    await waitFor(() =>
      expect(mockDeleteCloudinaryAsset).toHaveBeenCalledWith(
        "church-1",
        "removed-cloud-public-id",
      ),
    );
    await waitFor(() =>
      expect(mockDeleteLocalImage).toHaveBeenCalledWith("removed-thumbnail"),
    );
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockCreateCloudinaryUpload).not.toHaveBeenCalled();
    view.unmount();
  });

  it("preserves a replaced thumbnail's predecessor cleanup before deleting its upload job", async () => {
    const cleanupJob: LocalImageUploadJob = {
      ...interruptedJob,
      assetId: "thumbnail-b",
      id: "thumbnail-b",
      itemId: "",
      status: "pending",
      cleanupOnly: true,
      cleanupReady: true,
      cleanupCloudPublicId: "cloud-b",
      cleanupCloudComplete: false,
      cleanupTargetMediaId: "local_input_camera-1",
      localVideoInputThumbnail: {
        targetMediaId: "local_input_camera-1",
        previousAssetId: "thumbnail-a",
        previousCloudPublicId: "cloud-a",
      },
    };
    mockListJobs.mockReset().mockResolvedValueOnce([cleanupJob]).mockResolvedValue([]);
    mockClaimJob.mockResolvedValue({
      ...cleanupJob,
      leaseOwnerId: "lease-owner",
      leaseExpiresAt: Date.now() + 300_000,
    });
    mockUpdateJob.mockImplementation(async ({ leaseOwnerId, leaseDurationMs, now, patch }) => ({
      ...cleanupJob,
      ...patch,
      leaseOwnerId,
      leaseExpiresAt: now + leaseDurationMs,
      updatedAt: new Date(now).toISOString(),
    } as LocalImageUploadJob));

    const view = render(
      <ControllerInfoContext.Provider value={{ db: {} as PouchDB.Database, isGuestSession: false } as any}>
        <GlobalInfoContext.Provider value={{ churchId: "church-1" } as any}>
          <LocalImageUploadManager />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );

    await waitFor(() => expect(mockDeleteLocalImage).toHaveBeenCalledWith("thumbnail-b"));
    expect(mockStageCleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "thumbnail-a",
        cleanupCloudPublicId: "cloud-a",
        cleanupOnly: true,
      }),
      expect.any(Number),
    );
    expect(mockStageCleanup.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeleteLocalImage.mock.invocationCallOrder[0],
    );
    expect(mockDeleteCloudinaryAsset).toHaveBeenCalledWith("church-1", "cloud-b");
    view.unmount();
  });

  it.each(["thumbnail URL", "localImage.cloudUrl", "localImage.cloudPublicId"])(
    "keeps a stale cloud result while a failed C upload still references it through %s",
    async (referenceField) => {
      const cloudUrl = "https://res.cloudinary.com/example/stale.webp";
      const input: MediaType = {
        ...({
          path: "",
          createdAt: "2026-11-01T00:00:00.000Z",
          updatedAt: "2026-11-01T00:00:00.000Z",
          format: "live",
          height: 1080,
          width: 1920,
          name: "Camera",
          publicId: "camera-row",
          type: "video",
          id: "camera-row",
          background: "local-video-input://camera-source",
          thumbnail: "",
          source: "local",
          localVideoInput: {
            kind: "local-video-input",
            sourceId: "camera-source",
            label: "Camera",
            ownerDeviceId: "device-1",
          },
        } as MediaType),
        ...(referenceField === "thumbnail URL" ? { thumbnail: cloudUrl } : {}),
        localImage: {
          id: "asset-c",
          ownerDeviceId: "device-1",
          ownerLabel: "Booth",
          fileName: "camera-c.webp",
          contentType: "image/webp",
          storagePolicy: "local-and-cloud",
          ...(referenceField === "localImage.cloudUrl" ? { cloudUrl } : {}),
          ...(referenceField === "localImage.cloudPublicId"
            ? { cloudPublicId: "stale-cloud-public-id" }
            : {}),
        },
      };
      const staleJob: LocalImageUploadJob = {
        ...interruptedJob,
        id: "asset-b",
        assetId: "asset-b",
        status: "uploaded",
        phase: "finalizing",
        cloudMedia: {
          ...input,
          id: "cloud-media-b",
          publicId: "stale-cloud-public-id",
          background: cloudUrl,
          thumbnail: cloudUrl,
        },
        localVideoInputThumbnail: { targetMediaId: input.id },
      };
      const failedCJob: LocalImageUploadJob = {
        ...interruptedJob,
        id: "asset-c",
        assetId: "asset-c",
        status: "failed",
        nextAttemptAt: 0,
        localVideoInputThumbnail: { targetMediaId: input.id },
      };
      mockState.media.list = [input];
      mockPouchState.list = [input];
      store.dispatch(updateMediaList([input]));
      mockListJobs.mockReset().mockResolvedValueOnce([staleJob, failedCJob]).mockResolvedValue([]);
      mockClaimJob.mockImplementation(async ({ assetId, leaseOwnerId }) => assetId === staleJob.assetId
        ? {
            ...staleJob,
            leaseOwnerId,
            leaseExpiresAt: Date.now() + 300_000,
          }
        : undefined);
      mockUpdateJob.mockImplementation(async ({ leaseOwnerId, leaseDurationMs, now, patch }) => ({
        ...staleJob,
        ...patch,
        leaseOwnerId,
        leaseExpiresAt: now + leaseDurationMs,
        updatedAt: new Date(now).toISOString(),
      } as LocalImageUploadJob));

      const view = render(
        <ControllerInfoContext.Provider value={{ db: {} as PouchDB.Database, isGuestSession: false } as any}>
          <GlobalInfoContext.Provider value={{ churchId: "church-1" } as any}>
            <LocalImageUploadManager />
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>,
      );

      await waitFor(() => expect(mockUpdateJob).toHaveBeenCalledWith(expect.objectContaining({
        patch: expect.objectContaining({
          status: "failed",
          nextAttemptAt: expect.any(Number),
          lastError: expect.stringContaining("still referenced by Media"),
        }),
      })));
      expect(mockDeleteCloudinaryAsset).not.toHaveBeenCalled();
      expect(mockClaimJob).not.toHaveBeenCalledWith(expect.objectContaining({ assetId: failedCJob.assetId }));
      expect(mockDeleteLocalImage).not.toHaveBeenCalledWith("asset-b");
      expect(mockUpdateJob).not.toHaveBeenCalledWith(expect.objectContaining({
        patch: expect.objectContaining({
          localVideoInputThumbnail: expect.objectContaining({ staleCloudCleanupComplete: true }),
        }),
      }));
      view.unmount();
    },
  );

  it("retries stale cloud cleanup after the replacement stops referencing the prior URL", async () => {
    const cloudUrl = "https://res.cloudinary.com/example/stale.webp";
    const input = {
      ...({
        path: "",
        createdAt: "2026-11-01T00:00:00.000Z",
        updatedAt: "2026-11-01T00:00:00.000Z",
        format: "live",
        height: 1080,
        width: 1920,
        name: "Camera",
        publicId: "camera-row",
        type: "video",
        id: "camera-row",
        background: "local-video-input://camera-source",
        thumbnail: cloudUrl,
        source: "local",
        localVideoInput: {
          kind: "local-video-input" as const,
          sourceId: "camera-source",
          label: "Camera",
          ownerDeviceId: "device-1",
        },
      } as MediaType),
      localImage: {
        id: "asset-c",
        ownerDeviceId: "device-1",
        ownerLabel: "Booth",
        fileName: "camera-c.webp",
        contentType: "image/webp",
        storagePolicy: "local-and-cloud" as const,
        cloudPublicId: "stale-cloud-public-id",
      },
    } as MediaType;
    const staleJob: LocalImageUploadJob = {
      ...interruptedJob,
      id: "asset-b",
      assetId: "asset-b",
      status: "uploaded",
      phase: "finalizing",
      cloudMedia: {
        ...input,
        id: "cloud-media-b",
        publicId: "stale-cloud-public-id",
        background: cloudUrl,
        thumbnail: cloudUrl,
      },
      localVideoInputThumbnail: { targetMediaId: input.id },
    };
    mockState.media.list = [input];
    mockPouchState.list = [input];
    store.dispatch(updateMediaList([input]));
    mockListJobs.mockReset().mockResolvedValue([staleJob]);
    mockClaimJob.mockResolvedValue({
      ...staleJob,
      leaseOwnerId: "lease-owner",
      leaseExpiresAt: Date.now() + 300_000,
    });
    mockUpdateJob.mockImplementation(async ({ leaseOwnerId, leaseDurationMs, now, patch }) => ({
      ...staleJob,
      ...patch,
      leaseOwnerId,
      leaseExpiresAt: now + leaseDurationMs,
      updatedAt: new Date(now).toISOString(),
    } as LocalImageUploadJob));

    const view = render(
      <ControllerInfoContext.Provider value={{ db: {} as PouchDB.Database, isGuestSession: false } as any}>
        <GlobalInfoContext.Provider value={{ churchId: "church-1" } as any}>
          <LocalImageUploadManager />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );

    await waitFor(() => expect(mockUpdateJob).toHaveBeenCalledWith(expect.objectContaining({
      patch: expect.objectContaining({
        status: "failed",
        lastError: expect.stringContaining("still referenced by Media"),
      }),
    })));
    expect(mockDeleteCloudinaryAsset).not.toHaveBeenCalled();
    mockPouchState.list = [{
      ...input,
      thumbnail: "https://res.cloudinary.com/example/current-c.webp",
      localImage: {
        ...input.localImage!,
        cloudPublicId: "current-c-public-id",
        cloudUrl: "https://res.cloudinary.com/example/current-c.webp",
      },
    }];
    await act(async () => window.dispatchEvent(new Event("online")));
    await waitFor(() => expect(mockDeleteCloudinaryAsset).toHaveBeenCalledWith(
      "church-1",
      "stale-cloud-public-id",
    ));
    view.unmount();
  });

  it("preserves the stale cloud checkpoint when its authoritative reference check fails", async () => {
    const staleJob: LocalImageUploadJob = {
      ...interruptedJob,
      id: "asset-b",
      assetId: "asset-b",
      status: "uploaded",
      phase: "finalizing",
      cloudMedia: {
        id: "cloud-media-b",
        path: "",
        createdAt: "",
        updatedAt: "",
        format: "webp",
        height: 360,
        width: 640,
        name: "stale.webp",
        publicId: "stale-cloud-public-id",
        type: "image",
        background: "https://res.cloudinary.com/example/stale.webp",
        thumbnail: "https://res.cloudinary.com/example/stale.webp",
        providerStorage: {
          provider: "cloudinary",
          assetId: "provider-asset-b",
          publicId: "stale-cloud-public-id",
          churchId: "church-1",
          permanent: true,
        },
      } as MediaType,
      localVideoInputThumbnail: { targetMediaId: "camera-row" },
    };
    mockListJobs.mockReset().mockResolvedValueOnce([staleJob]).mockResolvedValue([]);
    mockClaimJob.mockResolvedValue({
      ...staleJob,
      leaseOwnerId: "lease-owner",
      leaseExpiresAt: Date.now() + 300_000,
    });
    mockUpdateJob.mockImplementation(async ({ assetId, leaseOwnerId, leaseDurationMs, now, patch }) => ({
      ...staleJob,
      ...patch,
      id: assetId,
      assetId,
      leaseOwnerId,
      leaseExpiresAt: now + leaseDurationMs,
      updatedAt: new Date(now).toISOString(),
    } as LocalImageUploadJob));
    mockLoadMediaLibrary
      .mockImplementationOnce(async () => ({ list: [], folders: [] } as any))
      .mockRejectedValueOnce(new Error("Media read timed out"));

    const view = render(
      <ControllerInfoContext.Provider value={{ db: {} as PouchDB.Database, isGuestSession: false } as any}>
        <GlobalInfoContext.Provider value={{ churchId: "church-1" } as any}>
          <LocalImageUploadManager />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );

    await waitFor(() => expect(mockUpdateJob).toHaveBeenCalledWith(expect.objectContaining({
      patch: expect.objectContaining({
        status: "failed",
        nextAttemptAt: expect.any(Number),
        lastError: "Media read timed out",
      }),
    })));
    expect(mockDeleteCloudinaryAsset).not.toHaveBeenCalled();
    expect(mockUpdateJob).not.toHaveBeenCalledWith(expect.objectContaining({
      patch: expect.objectContaining({
        localVideoInputThumbnail: expect.objectContaining({ staleCloudCleanupComplete: true }),
      }),
    }));
    view.unmount();
  });

  it("does not clean an old church's cloud result after switching the active database", async () => {
    const staleJob: LocalImageUploadJob = {
      ...interruptedJob,
      id: "asset-b",
      assetId: "asset-b",
      status: "uploaded",
      phase: "finalizing",
      cloudMedia: {
        ...({} as MediaType),
        id: "cloud-media-b",
        path: "",
        createdAt: "",
        updatedAt: "",
        format: "webp",
        height: 360,
        width: 640,
        name: "stale.webp",
        publicId: "stale-cloud-public-id",
        type: "image",
        background: "https://res.cloudinary.com/example/stale.webp",
        thumbnail: "https://res.cloudinary.com/example/stale.webp",
      } as MediaType,
      localVideoInputThumbnail: { targetMediaId: "camera-row" },
    };
    const readA = deferred<Awaited<ReturnType<typeof loadMediaLibrary>>>();
    mockListJobs.mockReset().mockImplementation(async (workspaceId) =>
      workspaceId === "church-1" ? [staleJob] : [],
    );
    mockClaimJob.mockResolvedValue({
      ...staleJob,
      leaseOwnerId: "lease-owner",
      leaseExpiresAt: Date.now() + 300_000,
    });
    mockUpdateJob.mockImplementation(async ({ assetId, leaseOwnerId, leaseDurationMs, now, patch }) => ({
      ...staleJob,
      ...patch,
      id: assetId,
      assetId,
      leaseOwnerId,
      leaseExpiresAt: now + leaseDurationMs,
      updatedAt: new Date(now).toISOString(),
    } as LocalImageUploadJob));
    mockLoadMediaLibrary.mockImplementationOnce(() => readA.promise);
    const dbA = {} as PouchDB.Database;
    const dbB = {} as PouchDB.Database;
    const view = render(
      <ControllerInfoContext.Provider value={{ db: dbA, isGuestSession: false } as any}>
        <GlobalInfoContext.Provider value={{ churchId: "church-1" } as any}>
          <LocalImageUploadManager />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );
    await waitFor(() => expect(mockLoadMediaLibrary).toHaveBeenCalledWith(dbA));

    view.rerender(
      <ControllerInfoContext.Provider value={{ db: dbB, isGuestSession: false } as any}>
        <GlobalInfoContext.Provider value={{ churchId: "church-2" } as any}>
          <LocalImageUploadManager />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );
    await act(async () => readA.resolve({ list: [], folders: [] } as any));

    expect(mockDeleteCloudinaryAsset).not.toHaveBeenCalled();
    expect(mockDeleteLocalImage).not.toHaveBeenCalledWith("asset-b");
    view.unmount();
  });

  it("reconciles staged uploads only after an authoritative matching Media commit", async () => {
    const stagedJob: LocalImageUploadJob = {
      ...interruptedJob,
      id: "staged-thumbnail",
      assetId: "staged-thumbnail",
      status: "staged",
      localVideoInputThumbnail: {
        targetMediaId: "camera-row",
        targetSourceId: "camera-source",
        mediaReferencePending: true,
      },
    };
    const row: MediaType = {
      ...({
        path: "",
        createdAt: "2026-11-01T00:00:00.000Z",
        updatedAt: "2026-11-01T00:00:00.000Z",
        format: "live",
        height: 1080,
        width: 1920,
        name: "Camera",
        publicId: "camera-row",
        type: "video",
        id: "camera-row",
        background: "local-video-input://camera-source",
        thumbnail: "",
        source: "local",
      } as MediaType),
      localVideoInput: {
        kind: "local-video-input",
        sourceId: "camera-source",
        label: "Camera",
        ownerDeviceId: "device-1",
      },
      localImage: {
        id: stagedJob.assetId,
        ownerDeviceId: "device-1",
        ownerLabel: "Booth",
        fileName: "camera.webp",
        contentType: "image/webp",
        storagePolicy: "local-and-cloud",
      },
    };
    const activatedJob: LocalImageUploadJob = {
      ...stagedJob,
      status: "pending",
      localVideoInputThumbnail: {
        targetMediaId: "camera-row",
        targetSourceId: "camera-source",
      },
    };
    mockPouchState.list = [row];
    mockListJobs.mockReset().mockResolvedValueOnce([stagedJob]).mockResolvedValue([]);
    mockActivateStagedUpload.mockResolvedValue(activatedJob);
    mockClaimJob.mockImplementation(async ({ leaseOwnerId }) => ({
      ...activatedJob,
      leaseOwnerId,
      leaseExpiresAt: Date.now() + 300_000,
    }));
    mockUpdateJob.mockImplementation(async ({ leaseOwnerId, leaseDurationMs, now, patch }) => ({
      ...activatedJob,
      ...patch,
      leaseOwnerId,
      leaseExpiresAt: now + leaseDurationMs,
      updatedAt: new Date(now).toISOString(),
    } as LocalImageUploadJob));

    const view = render(
      <ControllerInfoContext.Provider value={{ db: {} as PouchDB.Database, isGuestSession: false } as any}>
        <GlobalInfoContext.Provider value={{ churchId: "church-1" } as any}>
          <LocalImageUploadManager />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );

    await waitFor(() => expect(mockCreateCloudinaryUpload).toHaveBeenCalled());
    expect(mockActivateStagedUpload).toHaveBeenCalledWith(stagedJob.assetId, expect.any(Number));
    expect(mockActivateStagedUpload.mock.invocationCallOrder[0]).toBeLessThan(
      mockCreateCloudinaryUpload.mock.invocationCallOrder[0],
    );
    expect(mockDiscardStagedUpload).not.toHaveBeenCalled();
    view.unmount();
  });

  it("retains staged local images when the authoritative Media read fails", async () => {
    const stagedJob: LocalImageUploadJob = {
      ...interruptedJob,
      id: "staged-thumbnail",
      assetId: "staged-thumbnail",
      status: "staged",
      localVideoInputThumbnail: {
        targetMediaId: "camera-row",
        targetSourceId: "camera-source",
        mediaReferencePending: true,
      },
    };
    mockListJobs.mockReset().mockResolvedValueOnce([stagedJob]).mockResolvedValue([]);
    mockLoadMediaLibrary.mockRejectedValueOnce(new Error("database temporarily unavailable"));

    const view = render(
      <ControllerInfoContext.Provider value={{ db: {} as PouchDB.Database, isGuestSession: false } as any}>
        <GlobalInfoContext.Provider value={{ churchId: "church-1" } as any}>
          <LocalImageUploadManager />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );

    await waitFor(() => expect(mockLoadMediaLibrary).toHaveBeenCalled());
    expect(mockActivateStagedUpload).not.toHaveBeenCalled();
    expect(mockDiscardStagedUpload).not.toHaveBeenCalled();
    expect(mockDeleteLocalImage).not.toHaveBeenCalledWith(stagedJob.assetId);
    expect(mockClaimJob).not.toHaveBeenCalled();
    view.unmount();
  });

  it("discards an uncommitted staged upload and orphaned bytes after an authoritative read", async () => {
    const stagedJob: LocalImageUploadJob = {
      ...interruptedJob,
      id: "staged-thumbnail",
      assetId: "staged-thumbnail",
      status: "staged",
      localVideoInputThumbnail: {
        targetMediaId: "camera-row",
        targetSourceId: "camera-source",
        mediaReferencePending: true,
      },
    };
    mockListJobs.mockReset().mockResolvedValueOnce([stagedJob]).mockResolvedValue([]);

    const view = render(
      <ControllerInfoContext.Provider value={{ db: {} as PouchDB.Database, isGuestSession: false } as any}>
        <GlobalInfoContext.Provider value={{ churchId: "church-1" } as any}>
          <LocalImageUploadManager />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );

    await waitFor(() => expect(mockDiscardStagedUpload).toHaveBeenCalledWith({
      assetId: stagedJob.assetId,
      workspaceId: "church-1",
      targetMediaId: "camera-row",
    }));
    await waitFor(() => expect(mockDeleteLocalImage).toHaveBeenCalledWith(stagedJob.assetId));
    expect(mockActivateStagedUpload).not.toHaveBeenCalled();
    expect(mockClaimJob).not.toHaveBeenCalled();
    expect(mockCreateCloudinaryUpload).not.toHaveBeenCalled();
    view.unmount();
  });

  it("does not discard an uncommitted intent while its originating tab is active", async () => {
    const stagedJob: LocalImageUploadJob = {
      ...interruptedJob,
      id: "staged-thumbnail",
      assetId: "staged-thumbnail",
      status: "staged",
      localVideoInputThumbnail: {
        targetMediaId: "camera-row",
        targetSourceId: "camera-source",
        stagingSessionId: "active-save-session",
        mediaReferencePending: true,
      },
    };
    mockListJobs.mockReset().mockResolvedValueOnce([stagedJob]).mockResolvedValue([]);
    mockStagingSessionActive.mockReturnValue(true);

    const view = render(
      <ControllerInfoContext.Provider value={{ db: {} as PouchDB.Database, isGuestSession: false } as any}>
        <GlobalInfoContext.Provider value={{ churchId: "church-1" } as any}>
          <LocalImageUploadManager />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );

    await waitFor(() => expect(mockStagingSessionActive).toHaveBeenCalledWith("active-save-session"));
    expect(mockDiscardStagedUpload).not.toHaveBeenCalled();
    expect(mockDeleteLocalImage).not.toHaveBeenCalledWith(stagedJob.assetId);
    expect(mockClaimJob).not.toHaveBeenCalled();
    expect(mockCreateCloudinaryUpload).not.toHaveBeenCalled();
    view.unmount();
  });

  it("does not activate a staged job after the thumbnail was replaced", async () => {
    const stagedJob: LocalImageUploadJob = {
      ...interruptedJob,
      id: "staged-thumbnail",
      assetId: "staged-thumbnail",
      status: "staged",
      localVideoInputThumbnail: {
        targetMediaId: "camera-row",
        targetSourceId: "camera-source",
        mediaReferencePending: true,
      },
    };
    const replacement: MediaType = {
      ...({
        path: "",
        createdAt: "2026-11-01T00:00:00.000Z",
        updatedAt: "2026-11-01T00:00:00.000Z",
        format: "live",
        height: 1080,
        width: 1920,
        name: "Camera",
        publicId: "camera-row",
        type: "video",
        id: "camera-row",
        background: "local-video-input://camera-source",
        thumbnail: "",
        source: "local",
        localVideoInput: {
          kind: "local-video-input",
          sourceId: "camera-source",
          label: "Camera",
          ownerDeviceId: "device-1",
        },
      } as MediaType),
      localImage: {
        id: "asset-d",
        ownerDeviceId: "device-1",
        ownerLabel: "Booth",
        fileName: "camera-d.webp",
        contentType: "image/webp",
        storagePolicy: "local-only",
      },
    };
    mockPouchState.list = [replacement];
    mockListJobs.mockReset().mockResolvedValueOnce([stagedJob]).mockResolvedValue([]);

    const view = render(
      <ControllerInfoContext.Provider value={{ db: {} as PouchDB.Database, isGuestSession: false } as any}>
        <GlobalInfoContext.Provider value={{ churchId: "church-1" } as any}>
          <LocalImageUploadManager />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );

    await waitFor(() => expect(mockDiscardStagedUpload).toHaveBeenCalledWith({
      assetId: stagedJob.assetId,
      workspaceId: "church-1",
      targetMediaId: "camera-row",
    }));
    expect(mockActivateStagedUpload).not.toHaveBeenCalled();
    expect(mockClaimJob).not.toHaveBeenCalled();
    expect(mockCreateCloudinaryUpload).not.toHaveBeenCalled();
    // The replacement row owns different bytes, so the unreferenced staged
    // asset can be removed after its intent is retired.
    expect(mockDeleteLocalImage).toHaveBeenCalledWith(stagedJob.assetId);
    view.unmount();
  });

  it("fails a committed staged upload safely when its local image is missing", async () => {
    const stagedJob: LocalImageUploadJob = {
      ...interruptedJob,
      id: "staged-thumbnail",
      assetId: "staged-thumbnail",
      status: "staged",
      localVideoInputThumbnail: {
        targetMediaId: "camera-row",
        targetSourceId: "camera-source",
        mediaReferencePending: true,
      },
    };
    const row: MediaType = {
      ...({
        path: "",
        createdAt: "2026-11-01T00:00:00.000Z",
        updatedAt: "2026-11-01T00:00:00.000Z",
        format: "live",
        height: 1080,
        width: 1920,
        name: "Camera",
        publicId: "camera-row",
        type: "video",
        id: "camera-row",
        background: "local-video-input://camera-source",
        thumbnail: "",
        source: "local",
      } as MediaType),
      localVideoInput: {
        kind: "local-video-input",
        sourceId: "camera-source",
        label: "Camera",
        ownerDeviceId: "device-1",
      },
      localImage: {
        id: stagedJob.assetId,
        ownerDeviceId: "device-1",
        ownerLabel: "Booth",
        fileName: "camera.webp",
        contentType: "image/webp",
        storagePolicy: "local-and-cloud",
      },
    };
    const activatedJob: LocalImageUploadJob = {
      ...stagedJob,
      status: "pending",
      localVideoInputThumbnail: {
        targetMediaId: "camera-row",
        targetSourceId: "camera-source",
      },
    };
    mockPouchState.list = [row];
    mockListJobs.mockReset().mockResolvedValueOnce([stagedJob]).mockResolvedValue([]);
    mockActivateStagedUpload.mockResolvedValue(activatedJob);
    mockClaimJob.mockImplementation(async ({ leaseOwnerId }) => ({
      ...activatedJob,
      leaseOwnerId,
      leaseExpiresAt: Date.now() + 300_000,
    }));
    mockGetLocalImage.mockResolvedValue(undefined);
    mockUpdateJob.mockImplementation(async ({ leaseOwnerId, leaseDurationMs, now, patch }) => ({
      ...activatedJob,
      ...patch,
      leaseOwnerId,
      leaseExpiresAt: now + leaseDurationMs,
      updatedAt: new Date(now).toISOString(),
    } as LocalImageUploadJob));

    const view = render(
      <ControllerInfoContext.Provider value={{ db: {} as PouchDB.Database, isGuestSession: false } as any}>
        <GlobalInfoContext.Provider value={{ churchId: "church-1" } as any}>
          <LocalImageUploadManager />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );

    await waitFor(() => expect(mockUpdateJob).toHaveBeenCalledWith(expect.objectContaining({
      assetId: stagedJob.assetId,
      patch: expect.objectContaining({
        status: "failed",
        nextAttemptAt: 0,
        lastError: "The local image is missing. Relink it to continue.",
      }),
    })));
    expect(mockActivateStagedUpload).toHaveBeenCalled();
    expect(mockCreateCloudinaryUpload).not.toHaveBeenCalled();
    expect(mockDeleteLocalImage).not.toHaveBeenCalledWith(stagedJob.assetId);
    view.unmount();
  });

  it("cleans a completed upload after a local-only thumbnail replacement", async () => {
    const input: MediaType = {
      path: "",
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
      format: "live",
      height: 1080,
      width: 1920,
      name: "Camera B saved locally",
      publicId: "local_input_camera-1",
      type: "video",
      id: "local_input_camera-1",
      background: "local-video-input://camera-1",
      thumbnail: "",
      source: "local",
      folderId: "camera-folder-b",
      localImage: {
        id: "latest-thumbnail",
        ownerDeviceId: "device-1",
        ownerLabel: "Booth PC",
        fileName: "latest.webp",
        contentType: "image/webp",
        storagePolicy: "local-only",
      },
      localVideoInput: {
        kind: "local-video-input",
        sourceId: "camera-1",
        label: "Main camera",
        ownerDeviceId: "device-1",
        ownerLabel: "Booth PC",
      },
    };
    const staleJob: LocalImageUploadJob = {
      ...interruptedJob,
      id: "stale-thumbnail",
      assetId: "stale-thumbnail",
      status: "uploaded",
      phase: "finalizing",
      cloudMedia: {
        id: "stale-cloud-media",
        path: "",
        createdAt: "",
        updatedAt: "",
        format: "webp",
        height: 360,
        width: 640,
        name: "Stale thumbnail",
        publicId: "stale-cloud-public-id",
        type: "image",
        background: "https://res.cloudinary.com/example/stale.webp",
        thumbnail: "https://res.cloudinary.com/example/stale.webp",
        providerStorage: {
          provider: "cloudinary",
          assetId: "stale-cloud-media",
          publicId: "stale-cloud-public-id",
          churchId: "church-1",
          permanent: true,
        },
      },
      localVideoInputThumbnail: {
        targetMediaId: input.id,
      },
    };
    mockState.media.list = [input];
    mockPouchState.list = [input];
    store.dispatch(updateMediaList([input]));
    mockListJobs.mockReset().mockResolvedValueOnce([staleJob]).mockResolvedValue([]);
    mockClaimJob.mockResolvedValue({
      ...staleJob,
      leaseOwnerId: "lease-owner",
      leaseExpiresAt: Date.now() + 300_000,
    });
    mockUpdateJob.mockImplementation(async ({ leaseOwnerId, leaseDurationMs, now, patch }) => ({
      ...staleJob,
      ...patch,
      leaseOwnerId,
      leaseExpiresAt: now + leaseDurationMs,
      updatedAt: new Date(now).toISOString(),
    } as LocalImageUploadJob));
    mockGetLocalImage.mockResolvedValue({
      id: "stale-thumbnail",
      workspaceId: "church-1",
      blob: new Blob(["image"], { type: "image/webp" }),
      fileName: "stale.webp",
      contentType: "image/webp",
      size: 5,
      width: 640,
      height: 360,
      createdAt: "2026-11-05T00:00:00.000Z",
    });

    const view = render(
      <ControllerInfoContext.Provider value={{ db: {} as PouchDB.Database, isGuestSession: false } as any}>
        <GlobalInfoContext.Provider value={{ churchId: "church-1" } as any}>
          <LocalImageUploadManager />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );

    await waitFor(() =>
      expect(mockDeleteCloudinaryAsset).toHaveBeenCalledWith(
        "church-1",
        "stale-cloud-public-id",
      ),
    );
    await waitFor(() =>
      expect(mockDeleteLocalImage).toHaveBeenCalledWith("stale-thumbnail"),
    );
    expect(mockFlushMedia).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: addItemToMediaList.type }),
    );
    expect(store.getState().media.list[0]).toEqual(
      expect.objectContaining({
        name: "Camera B saved locally",
        folderId: "camera-folder-b",
        thumbnail: "",
        localImage: expect.objectContaining({
          id: "latest-thumbnail",
          storagePolicy: "local-only",
        }),
        localVideoInput: expect.objectContaining({ sourceId: "camera-1" }),
      }),
    );
    expect(mockPouchState.list[0]).toEqual(
      expect.objectContaining({
        name: "Camera B saved locally",
        folderId: "camera-folder-b",
        thumbnail: "",
        localImage: expect.objectContaining({
          id: "latest-thumbnail",
          storagePolicy: "local-only",
        }),
      }),
    );
    view.unmount();
  });

  it("waits for schema v2 before marking a workspace swept", async () => {
    jest.useFakeTimers();
    jest.mocked(cleanupOrphanedLocalImages).mockReset().mockResolvedValueOnce(null).mockResolvedValue(0);
    const view = render(
      <ControllerInfoContext.Provider value={{ db: {} as PouchDB.Database, isGuestSession: false } as any}>
        <GlobalInfoContext.Provider value={{ churchId: "church-1" } as any}>
          <LocalImageUploadManager />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );
    await waitFor(() => expect(cleanupOrphanedLocalImages).toHaveBeenCalledTimes(1));
    await act(async () => { await jest.advanceTimersByTimeAsync(30_000); });
    await waitFor(() => expect(cleanupOrphanedLocalImages).toHaveBeenCalledTimes(2));
    expect(cleanupOrphanedLocalImages).toHaveBeenLastCalledWith({ db: expect.any(Object), workspaceId: "church-1" });
    view.unmount();
    jest.useRealTimers();
  });

  it("resumes an interrupted upload and completes the cloud handoff", async () => {
    const view = render(
      <ControllerInfoContext.Provider
        value={{ db: {} as PouchDB.Database, isGuestSession: false } as any}
      >
        <GlobalInfoContext.Provider value={{ churchId: "church-1" } as any}>
          <LocalImageUploadManager />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );

    await waitFor(() => expect(mockUpdateJob).toHaveBeenCalledWith(
      expect.objectContaining({ patch: expect.objectContaining({ status: "complete" }) }),
    ));
    expect(mockDeleteJob).not.toHaveBeenCalled();
    expect(mockUpload).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({ uploadId: "intent-1", publicId: "cloud-public-id" }),
      expect.any(Object),
    );
    expect(mockCommitCloudinary).toHaveBeenCalledWith("church-1", { uploadId: "intent-1", publicId: "cloud-public-id" });
    expect(mockCreateCloudinaryUpload.mock.invocationCallOrder[0]).toBeLessThan(
      mockUpload.mock.invocationCallOrder[0],
    );
    expect(mockUpload.mock.invocationCallOrder[0]).toBeLessThan(
      mockCommitCloudinary.mock.invocationCallOrder[0],
    );
    expect(mockUpdateJob).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "asset-1",
        leaseOwnerId: expect.any(String),
        patch: expect.objectContaining({ status: "uploaded" }),
      }),
    );
    expect(mockClaimJob).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "asset-1",
        leaseOwnerId: expect.any(String),
      }),
    );
    expect(mockPersistCloudCopy).toHaveBeenCalledWith({
      db: expect.any(Object),
      itemId: "item-1",
      assetId: "asset-1",
      mediaId: "stable-media-id",
      url: "https://res.cloudinary.com/example/welcome.png",
    });
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "presentation/attachCloudCopyToLocalImageInPresentation",
      payload: {
        itemId: "item-1",
        assetId: "asset-1",
        mediaId: "stable-media-id",
        url: "https://res.cloudinary.com/example/welcome.png",
      },
    });
    view.unmount();
  });

  it("cleans up a completed Church A Cloudinary upload without dispatching it into Church B", async () => {
    let resolveUpload!: (value: { public_id: string; secure_url: string }) => void;
    mockUpload.mockReturnValueOnce(new Promise((resolve) => { resolveUpload = resolve; }) as any);
    const dbA = {} as PouchDB.Database;
    const dbB = {} as PouchDB.Database;
    const renderManager = (db: PouchDB.Database, churchId: string) => (
      <ControllerInfoContext.Provider value={{ db, isGuestSession: false } as any}>
        <GlobalInfoContext.Provider value={{ churchId } as any}>
          <LocalImageUploadManager />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>
    );
    const view = render(renderManager(dbA, "church-1"));
    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));

    view.rerender(renderManager(dbB, "church-2"));
    await act(async () => {
      resolveUpload({
        public_id: "cloud-public-id",
        secure_url: "https://res.cloudinary.com/example/welcome.png",
      });
    });

    await waitFor(() => expect(mockDeleteCloudinaryAsset).toHaveBeenCalledWith("church-1", "cloud-public-id"));
    expect(mockDispatch).not.toHaveBeenCalled();
    view.unmount();
  });

  it("preserves a resumed cloud checkpoint when the active church changes", async () => {
    let resolveStoredImage!: (value: Awaited<ReturnType<typeof getLocalImage>>) => void;
    mockGetLocalImage.mockReturnValueOnce(new Promise((resolve) => { resolveStoredImage = resolve; }));
    const cloudMedia = {
      id: "stable-media-id",
      name: "Welcome.png",
      type: "image",
      publicId: "cloud-public-id",
      background: "https://res.cloudinary.com/example/welcome.png",
      providerStorage: {
        provider: "cloudinary",
        assetId: "provider-asset-1",
        publicId: "cloud-public-id",
        churchId: "church-1",
        permanent: true,
      },
    } as MediaType;
    const checkpointJob = {
      ...interruptedJob,
      status: "uploaded",
      phase: "finalizing",
      cloudMedia,
    } as LocalImageUploadJob;
    let durableJob = checkpointJob;
    mockListJobs.mockReset().mockImplementation(async () => [durableJob]);
    mockClaimJob.mockImplementation(async ({ leaseOwnerId }) => ({
      ...durableJob,
      leaseOwnerId,
      leaseExpiresAt: Date.now() + 300_000,
    }));
    mockUpdateJob.mockImplementation(async ({ leaseOwnerId, leaseDurationMs, now, patch }) => {
      durableJob = {
        ...durableJob,
        ...patch,
        leaseOwnerId,
        leaseExpiresAt: now + leaseDurationMs,
        updatedAt: new Date(now).toISOString(),
      } as LocalImageUploadJob;
      return durableJob;
    });
    mockReleaseLease.mockImplementation(async () => {
      delete durableJob.leaseOwnerId;
      delete durableJob.leaseExpiresAt;
      return true;
    });
    const dbA = {} as PouchDB.Database;
    const dbB = {} as PouchDB.Database;
    const renderManager = (db: PouchDB.Database, churchId: string) => (
      <ControllerInfoContext.Provider value={{ db, isGuestSession: false } as any}>
        <GlobalInfoContext.Provider value={{ churchId } as any}>
          <LocalImageUploadManager />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>
    );
    const view = render(renderManager(dbA, "church-1"));
    await waitFor(() => expect(mockClaimJob).toHaveBeenCalled());
    view.rerender(renderManager(dbB, "church-2"));
    await act(async () => resolveStoredImage({
      id: "asset-1",
      workspaceId: "church-1",
      blob: new Blob(["image"], { type: "image/png" }),
      fileName: "Welcome.png",
      contentType: "image/png",
      size: 5,
      width: 1920,
      height: 1080,
      createdAt: interruptedJob.createdAt,
    }));

    await waitFor(() => expect(mockUpdateJob).toHaveBeenCalledWith(expect.objectContaining({
      assetId: "asset-1",
      patch: expect.objectContaining({
        status: "uploaded",
        phase: "finalizing",
        cloudMedia,
        nextAttemptAt: 0,
      }),
    })));
    expect(mockDeleteCloudinaryAsset).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockCommitCloudinary).not.toHaveBeenCalled();
    expect(mockReleaseLease).toHaveBeenCalledWith("asset-1", expect.any(String));

    view.rerender(renderManager(dbA, "church-1"));
    await waitFor(() => expect(mockUpdateJob).toHaveBeenCalledWith(expect.objectContaining({
      assetId: "asset-1",
      patch: expect.objectContaining({ status: "complete", cloudMedia }),
    })));
    expect(mockPersistCloudCopy).toHaveBeenCalledWith(expect.objectContaining({
      db: dbA,
      itemId: "item-1",
      assetId: "asset-1",
      mediaId: "stable-media-id",
      url: cloudMedia.background,
    }));
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "presentation/attachCloudCopyToLocalImageInPresentation",
    }));
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockCommitCloudinary).not.toHaveBeenCalled();
    expect(mockDeleteCloudinaryAsset).not.toHaveBeenCalled();
    view.unmount();
  });

  it("cleans an ambiguous provider intent before creating a replacement upload", async () => {
    const ambiguousJob = { ...interruptedJob, providerUploadId: "old-intent" };
    mockListJobs.mockReset().mockResolvedValueOnce([ambiguousJob]).mockResolvedValue([]);
    mockClaimJob.mockImplementation(async ({ leaseOwnerId }) => ({
      ...ambiguousJob,
      leaseOwnerId,
      leaseExpiresAt: Date.now() + 300_000,
    }));

    const view = render(
      <ControllerInfoContext.Provider
        value={{ db: {} as PouchDB.Database, isGuestSession: false } as any}
      >
        <GlobalInfoContext.Provider value={{ churchId: "church-1" } as any}>
          <LocalImageUploadManager />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );

    await waitFor(() => expect(mockUpdateJob).toHaveBeenCalledWith(
      expect.objectContaining({ patch: expect.objectContaining({ status: "complete" }) }),
    ));
    expect(mockCancelCloudinaryUpload).toHaveBeenCalledWith("church-1", "old-intent");
    expect(mockCreateCloudinaryUpload).toHaveBeenCalledWith("church-1", "stable-media-id");
    expect(mockCancelCloudinaryUpload.mock.invocationCallOrder[0]).toBeLessThan(
      mockCreateCloudinaryUpload.mock.invocationCallOrder[0],
    );
    expect(mockUpload).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it("does not process a job claimed by another controller tab", async () => {
    mockClaimJob.mockResolvedValue(undefined);

    const view = render(
      <ControllerInfoContext.Provider
        value={{ db: {} as PouchDB.Database, isGuestSession: false } as any}
      >
        <GlobalInfoContext.Provider value={{ churchId: "church-1" } as any}>
          <LocalImageUploadManager />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );

    await waitFor(() => expect(mockClaimJob).toHaveBeenCalled());
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockGetLocalImage).not.toHaveBeenCalled();
    view.unmount();
  });

  it("attaches a cloud copy to a Media-owned local image without requiring an outline item", async () => {
    const mediaOnlyJob = { ...interruptedJob, itemId: "" };
    mockState.media.list = [
      {
        path: "",
        createdAt: interruptedJob.createdAt,
        updatedAt: interruptedJob.updatedAt,
        format: "png",
        width: 1920,
        height: 1080,
        name: "Welcome Slide",
        publicId: "asset-1",
        type: "image",
        id: "asset-1",
        background: "local-image://asset-1",
        thumbnail: "local-image://asset-1",
        source: "local",
        localImage: {
          id: "asset-1",
          ownerDeviceId: "device-1",
          ownerLabel: "Booth",
          fileName: "Welcome.png",
          contentType: "image/png",
          storagePolicy: "local-and-cloud",
        },
      },
    ];
    store.dispatch(updateMediaList(mockState.media.list));
    mockClaimJob.mockImplementation(async ({ leaseOwnerId }) => ({
      ...mediaOnlyJob,
      leaseOwnerId,
      leaseExpiresAt: Date.now() + 300_000,
    }));
    mockUpdateJob.mockImplementation(
      async ({ leaseOwnerId, leaseDurationMs, now, patch }) => ({
        ...mediaOnlyJob,
        ...patch,
        leaseOwnerId,
        leaseExpiresAt: now + leaseDurationMs,
        updatedAt: new Date(now).toISOString(),
      } as LocalImageUploadJob),
    );

    const view = render(
      <ControllerInfoContext.Provider
        value={{ db: {} as PouchDB.Database, isGuestSession: false } as any}
      >
        <GlobalInfoContext.Provider value={{ churchId: "church-1" } as any}>
          <LocalImageUploadManager />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );

    await waitFor(() => expect(mockUpdateJob).toHaveBeenCalledWith(
      expect.objectContaining({ patch: expect.objectContaining({ status: "complete" }) }),
    ));
    expect(mockDeleteJob).not.toHaveBeenCalled();
    expect(mockPersistCloudCopy).not.toHaveBeenCalled();
    expect(mockCommitCloudinary).toHaveBeenCalledWith("church-1", { uploadId: "intent-1", publicId: "cloud-public-id" });
    expect(mockCommitCloudinary).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "media/updateMediaItemFields",
        payload: expect.objectContaining({
          id: "asset-1",
          patch: expect.objectContaining({
            providerStorage: expect.objectContaining({
              provider: "cloudinary",
              assetId: "provider-asset-1",
              churchId: "church-1",
            }),
            localImage: expect.objectContaining({
              cloudMediaId: "stable-media-id",
              cloudUrl: "https://res.cloudinary.com/example/welcome.png",
            }),
          }),
        }),
      }),
    );
    view.unmount();
  });

  it("retains the successful upload checkpoint when the ownership commit is denied", async () => {
    const ownershipError = Object.assign(
      new Error("The image was not uploaded to this church's media folder."),
      { status: 403 },
    );
    mockCommitCloudinary.mockRejectedValue(ownershipError);

    const view = render(
      <ControllerInfoContext.Provider
        value={{ db: {} as PouchDB.Database, isGuestSession: false } as any}
      >
        <GlobalInfoContext.Provider value={{ churchId: "church-1" } as any}>
          <LocalImageUploadManager />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );

    await waitFor(() => expect(mockUpdateJob).toHaveBeenCalledWith(expect.objectContaining({
      assetId: "asset-1",
      patch: expect.objectContaining({
        status: "failed",
        cloudMedia: expect.objectContaining({ publicId: "cloud-public-id" }),
        nextAttemptAt: 0,
      }),
    })));
    expect(mockUpdateJob).toHaveBeenCalledWith(expect.objectContaining({
      assetId: "asset-1",
      patch: expect.objectContaining({
        status: "uploaded",
        cloudMedia: expect.objectContaining({ publicId: "cloud-public-id" }),
      }),
    }));
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockCommitCloudinary).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it("commits and finalizes a legacy Cloudinary job without an upload intent", async () => {
    const cloudMedia = {
      id: "stable-media-id", name: "Welcome.png", type: "image", publicId: "cloud-public-id",
      background: "https://res.cloudinary.com/example/welcome.png",
    } as MediaType;
    const legacyJob = { ...interruptedJob, cloudMedia, providerUploadId: undefined };
    mockListJobs.mockReset().mockResolvedValueOnce([legacyJob]).mockResolvedValue([]);
    mockClaimJob.mockImplementation(async ({ leaseOwnerId }) => ({
      ...legacyJob, leaseOwnerId, leaseExpiresAt: Date.now() + 300_000,
    }));

    const view = render(
      <ControllerInfoContext.Provider value={{ db: {} as PouchDB.Database, isGuestSession: false } as any}>
        <GlobalInfoContext.Provider value={{ churchId: "church-1" } as any}>
          <LocalImageUploadManager />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );
    await waitFor(() => expect(mockUpdateJob).toHaveBeenCalledWith(expect.objectContaining({
      patch: expect.objectContaining({ status: "complete" }),
    })));
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockCreateCloudinaryUpload).not.toHaveBeenCalled();
    expect(mockCommitCloudinary).toHaveBeenCalledWith("church-1", { publicId: "cloud-public-id" });
    expect(mockUpdateJob).toHaveBeenCalledWith(expect.objectContaining({
      patch: expect.objectContaining({
        status: "uploaded",
        phase: "finalizing",
        cloudMedia: expect.objectContaining({ providerStorage: expect.objectContaining({ assetId: "provider-asset-1" }) }),
      }),
    }));
    view.unmount();
  });

  it("keeps legacy commit failures retryable and leaves committing state", async () => {
    const cloudMedia = {
      id: "stable-media-id", name: "Welcome.png", type: "image", publicId: "cloud-public-id",
      background: "https://res.cloudinary.com/example/welcome.png",
    } as MediaType;
    const legacyJob = { ...interruptedJob, cloudMedia, providerUploadId: undefined };
    mockListJobs.mockReset().mockResolvedValueOnce([legacyJob]).mockResolvedValue([]);
    mockClaimJob.mockImplementation(async ({ leaseOwnerId }) => ({
      ...legacyJob, leaseOwnerId, leaseExpiresAt: Date.now() + 300_000,
    }));
    mockCommitCloudinary.mockRejectedValueOnce(Object.assign(new Error("Temporary commit failure"), { status: 503 }));

    const view = render(
      <ControllerInfoContext.Provider value={{ db: {} as PouchDB.Database, isGuestSession: false } as any}>
        <GlobalInfoContext.Provider value={{ churchId: "church-1" } as any}>
          <LocalImageUploadManager />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );
    await waitFor(() => expect(mockUpdateJob).toHaveBeenCalledWith(expect.objectContaining({
      patch: expect.objectContaining({ status: "failed", phase: "failed", nextAttemptAt: expect.any(Number) }),
    })));
    expect(mockCommitCloudinary).toHaveBeenCalledWith("church-1", { publicId: "cloud-public-id" });
    expect(mockUpload).not.toHaveBeenCalled();
    view.unmount();
  });

  it("keeps legacy ownership mismatch recovery without uploading the asset again", async () => {
    const cloudMedia = {
      id: "stable-media-id", name: "Welcome.png", type: "image", publicId: "cloud-public-id",
      background: "https://res.cloudinary.com/example/welcome.png",
    } as MediaType;
    const legacyJob = { ...interruptedJob, cloudMedia, providerUploadId: undefined };
    mockListJobs.mockReset().mockResolvedValueOnce([legacyJob]).mockResolvedValue([]);
    mockClaimJob.mockImplementation(async ({ leaseOwnerId }) => ({
      ...legacyJob, leaseOwnerId, leaseExpiresAt: Date.now() + 300_000,
    }));
    mockCommitCloudinary.mockRejectedValueOnce(Object.assign(
      new Error("The image was not uploaded to this church's media folder."),
      { status: 403, code: "CLOUDINARY_MEDIA_OWNERSHIP_MISMATCH" },
    ));

    const view = render(
      <ControllerInfoContext.Provider value={{ db: {} as PouchDB.Database, isGuestSession: false } as any}>
        <GlobalInfoContext.Provider value={{ churchId: "church-1" } as any}>
          <LocalImageUploadManager />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );
    await waitFor(() => expect(mockUpdateJob).toHaveBeenCalledWith(expect.objectContaining({
      patch: expect.objectContaining({
        status: "failed",
        cloudMedia: expect.objectContaining({ publicId: "cloud-public-id" }),
        lastErrorCode: "CLOUDINARY_MEDIA_OWNERSHIP_MISMATCH",
        nextAttemptAt: 0,
      }),
    })));
    expect(mockCommitCloudinary).toHaveBeenCalledWith("church-1", { publicId: "cloud-public-id" });
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockCreateCloudinaryUpload).not.toHaveBeenCalled();
    view.unmount();
  });

  it("keeps a failed file isolated while another file completes", async () => {
    const failedJob = {
      ...interruptedJob,
      assetId: "asset-failed",
      itemId: "item-failed",
      mediaId: "media-failed",
    };
    const successfulJob = {
      ...interruptedJob,
      assetId: "asset-successful",
      itemId: "item-successful",
      mediaId: "media-successful",
    };
    mockListJobs.mockReset().mockResolvedValueOnce([failedJob, successfulJob]).mockResolvedValue([]);
    mockClaimJob.mockImplementation(async ({ assetId, leaseOwnerId }) => {
      const job = assetId === failedJob.assetId ? failedJob : successfulJob;
      return { ...job, leaseOwnerId, leaseExpiresAt: Date.now() + 300_000 };
    });
    mockGetLocalImage.mockImplementation(async (assetId) => ({
      id: assetId,
      workspaceId: "church-1",
      blob: new Blob([assetId], { type: "image/png" }),
      fileName: assetId === failedJob.assetId ? "Failed.png" : "Successful.png",
      contentType: "image/png",
      size: 5,
      width: 1920,
      height: 1080,
      createdAt: "2026-08-12T00:00:00.000Z",
    }));
    mockUpload.mockImplementation(async (file) => {
      if (file.name === "Failed.png") throw new Error("Upload failed");
      return {
        secure_url: "https://res.cloudinary.com/example/successful.png",
      } as any;
    });
    mockUpdateJob.mockImplementation(
      async ({ assetId, leaseOwnerId, leaseDurationMs, now, patch }) => {
        const job = assetId === failedJob.assetId ? failedJob : successfulJob;
        return {
          ...job,
          ...patch,
          leaseOwnerId,
          leaseExpiresAt: now + leaseDurationMs,
          updatedAt: new Date(now).toISOString(),
        } as LocalImageUploadJob;
      },
    );

    const view = render(
      <ControllerInfoContext.Provider
        value={{ db: {} as PouchDB.Database, isGuestSession: false } as any}
      >
        <GlobalInfoContext.Provider value={{ churchId: "church-1" } as any}>
          <LocalImageUploadManager />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );

    await waitFor(() => expect(mockUpdateJob).toHaveBeenCalledWith(expect.objectContaining({
      assetId: successfulJob.assetId,
      patch: expect.objectContaining({ status: "complete" }),
    })));
    expect(mockUpdateJob).toHaveBeenCalledWith(expect.objectContaining({
      assetId: failedJob.assetId,
      patch: expect.objectContaining({ status: "failed", nextAttemptAt: expect.any(Number) }),
    }));
    expect(mockUpload).toHaveBeenCalledTimes(2);
    expect(mockCommitCloudinary).toHaveBeenCalledTimes(1);
    expect(mockCommitCloudinary).toHaveBeenCalledWith("church-1", { uploadId: "intent-1", publicId: "cloud-public-id" });
    view.unmount();
  });

  it.each([
    ["transient", 503, undefined, true],
    ["ownership", 403, undefined, false],
    ["quota", 413, "CHURCH_STORAGE_QUOTA_EXCEEDED", false],
    ["in-progress conflict", 409, "CHURCH_STORAGE_MUTATION_IN_PROGRESS", true],
    ["untyped conflict", 409, undefined, false],
  ])("classifies %s cloud commit failures", async (_label, status, code, retryable) => {
    const cloudMedia = {
      id: "stable-media-id",
      name: "Welcome.png",
      type: "image",
      publicId: "cloud-public-id",
      background: "https://res.cloudinary.com/example/welcome.png",
    } as MediaType;
    const checkpointJob = { ...interruptedJob, cloudMedia, providerUploadId: "intent-1" };
    mockListJobs.mockReset().mockResolvedValueOnce([checkpointJob]).mockResolvedValue([]);
    mockClaimJob.mockImplementation(async ({ leaseOwnerId }) => ({
      ...checkpointJob,
      leaseOwnerId,
      leaseExpiresAt: Date.now() + 300_000,
    }));
    mockCommitCloudinary.mockRejectedValue(
      Object.assign(new Error("The image was not uploaded to this church's media folder."), {
        status,
        code,
      }),
    );

    const view = render(
      <ControllerInfoContext.Provider
        value={{ db: {} as PouchDB.Database, isGuestSession: false } as any}
      >
        <GlobalInfoContext.Provider value={{ churchId: "church-1" } as any}>
          <LocalImageUploadManager />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );

    const expectedCheckpoint = status === 413 ? null : cloudMedia;
    await waitFor(() => expect(mockUpdateJob).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({ status: "failed", cloudMedia: expectedCheckpoint }),
      }),
    ));
    const commitFailure = mockUpdateJob.mock.calls.find(([request]) =>
      request.patch.status === "failed",
    )?.[0];
    expect(commitFailure?.patch.lastError).toBe(
      "The image was not uploaded to this church's media folder.",
    );
    expect(
      retryable
        ? (commitFailure?.patch.nextAttemptAt ?? 0) > Date.now()
        : commitFailure?.patch.nextAttemptAt === 0,
    ).toBe(true);
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockCommitCloudinary).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});
