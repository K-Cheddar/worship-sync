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
  cleanupOrphanedLocalImages,
  deleteLocalImageUploadJob,
  getLocalImage,
  listLocalImageUploadJobs,
  persistLocalImageCloudCopy,
  releaseLocalImageUploadJobLease,
  renewLocalImageUploadJobLease,
  updateLeasedLocalImageUploadJob,
  type LocalImageUploadJob,
} from "../../utils/localImageAssets";
import LocalImageUploadManager from "./LocalImageUploadManager";
import type { MediaType } from "../../types";

const mockDispatch = jest.fn();
const mockState = {
  media: { list: [] as MediaType[], isInitialized: true },
};
jest.mock("../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: typeof mockState) => unknown) =>
    selector(mockState),
}));
jest.mock("../../utils/localImageAssets", () => ({
  claimLocalImageUploadJob: jest.fn(),
  cleanupOrphanedLocalImages: jest.fn(() => Promise.resolve(0)),
  deleteLocalImageUploadJob: jest.fn(),
  getLocalImage: jest.fn(),
  getLocalImageUploadJob: jest.fn(() => Promise.resolve(undefined)),
  listLocalImageUploadJobs: jest.fn(),
  persistLocalImageCloudCopy: jest.fn(),
  releaseLocalImageUploadJobLease: jest.fn(),
  renewLocalImageUploadJobLease: jest.fn(),
  subscribeLocalImageUploadJobChanges: jest.fn(() => jest.fn()),
  updateLeasedLocalImageUploadJob: jest.fn(),
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
const mockGetLocalImage = jest.mocked(getLocalImage);
const mockUpload = jest.mocked(uploadImageToCloudinarySigned);
const mockCommitCloudinary = jest.mocked(commitCloudinaryMediaAsset);
const mockCancelCloudinaryUpload = jest.mocked(cancelCloudinaryMediaUpload);
const mockDeleteCloudinaryAsset = jest.mocked(deleteCloudinaryMediaAsset);
const mockCreateCloudinaryUpload = jest.mocked(createCloudinaryMediaUpload);
const mockPersistCloudCopy = jest.mocked(persistLocalImageCloudCopy);
const mockDeleteJob = jest.mocked(deleteLocalImageUploadJob);
const mockReleaseLease = jest.mocked(releaseLocalImageUploadJobLease);
const mockRenewLease = jest.mocked(renewLocalImageUploadJobLease);
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

describe("LocalImageUploadManager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.media.list = [];
    mockListJobs.mockResolvedValueOnce([interruptedJob]).mockResolvedValue([]);
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
    mockReleaseLease.mockResolvedValue(true);
    mockRenewLease.mockResolvedValue(true);
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
