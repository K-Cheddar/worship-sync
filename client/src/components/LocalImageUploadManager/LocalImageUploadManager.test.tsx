import { render, waitFor } from "@testing-library/react";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { uploadImageToCloudinary } from "../../containers/Media/utils/cloudinaryUpload";
import { commitCloudinaryMediaAsset } from "../../api/providerStorage";
import {
  claimLocalImageUploadJob,
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
  uploadImageToCloudinary: jest.fn(),
}));
jest.mock("../../api/providerStorage", () => ({
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
const mockUpload = jest.mocked(uploadImageToCloudinary);
const mockCommitCloudinary = jest.mocked(commitCloudinaryMediaAsset);
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
      "preset",
      "portable-media",
      expect.any(Object),
      { assetFolder: "worship-sync/churches/church-1/media" },
    );
    expect(mockCommitCloudinary).toHaveBeenCalledWith("church-1", "cloud-public-id");
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
    expect(mockCommitCloudinary).toHaveBeenCalledWith("church-1", "cloud-public-id");
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
    expect(mockCommitCloudinary).toHaveBeenCalledWith("church-1", "cloud-public-id");
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
    const checkpointJob = { ...interruptedJob, cloudMedia };
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
