import generateRandomId from "./generateRandomId";
import { cancelCloudinaryMediaUpload } from "../api/providerStorage";
import {
  enqueueLocalImageUploadJobAtomically,
  finishLocalImageUploadCancellationAtomically,
  getLocalImageUploadJob,
  requestLocalImageUploadCancellationAtomically,
  subscribeLocalImageUploadJobChanges,
  retryLocalImageUploadJobAtomically,
  type LocalImageUploadJob,
} from "./localImageAssets";
import {
  cancelLocalImageUpload,
  consumeLocalImageUploadCancellation,
  enqueueLocalImageUpload,
  registerLocalImageUploadRequest,
  retryLocalImageUpload,
  retryLocalImageUploadCancellation,
} from "./localImageUploadQueue";

jest.mock("./generateRandomId", () => jest.fn(() => "media-1"));
jest.mock("./localImageAssets", () => ({
  enqueueLocalImageUploadJobAtomically: jest.fn(),
  retryLocalImageUploadJobAtomically: jest.fn(),
  finishLocalImageUploadCancellationAtomically: jest.fn(),
  getLocalImageUploadJob: jest.fn(),
  requestLocalImageUploadCancellationAtomically: jest.fn(),
  subscribeLocalImageUploadJobChanges: jest.fn(() => () => undefined),
}));
jest.mock("../api/providerStorage", () => ({
  cancelCloudinaryMediaUpload: jest.fn(() => Promise.resolve({ cancelled: true })),
  deleteCloudinaryMediaAsset: jest.fn(() => Promise.resolve({ success: true })),
}));

const mockEnqueueJob = jest.mocked(enqueueLocalImageUploadJobAtomically);
const mockRetryJob = jest.mocked(retryLocalImageUploadJobAtomically);
const mockFinishCancellation = jest.mocked(finishLocalImageUploadCancellationAtomically);
const mockGetJob = jest.mocked(getLocalImageUploadJob);
const mockRequestCancellation = jest.mocked(requestLocalImageUploadCancellationAtomically);
const mockSubscribe = jest.mocked(subscribeLocalImageUploadJobChanges);
const mockCancelProviderUpload = jest.mocked(cancelCloudinaryMediaUpload);

const existingJob = (): LocalImageUploadJob => ({
  id: "asset-1",
  assetId: "asset-1",
  itemId: "item-1",
  workspaceId: "church-1",
  uploadPreset: "preset",
  mediaId: "media-existing",
  status: "failed",
  attemptCount: 3,
  nextAttemptAt: 50_000,
  lastError: "offline",
  createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z",
});

describe("localImageUploadQueue", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnqueueJob.mockImplementation(async (job) => job);
    mockFinishCancellation.mockResolvedValue(undefined);
    mockRequestCancellation.mockResolvedValue(undefined);
    mockSubscribe.mockReturnValue(() => undefined);
  });

  it("creates a durable job with a stable media identity", async () => {
    const result = await enqueueLocalImageUpload({
      assetId: "asset-1",
      itemId: "item-1",
      workspaceId: "church-1",
      uploadPreset: "preset",
    });

    expect(generateRandomId).toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        id: "asset-1",
        mediaId: "media-1",
        status: "pending",
        attemptCount: 0,
      }),
    );
    expect(mockEnqueueJob).toHaveBeenCalledWith(result, expect.any(Number));
  });

  it("retries without changing the media identity", async () => {
    mockRetryJob.mockResolvedValue({
      ...existingJob(),
      status: "pending",
      nextAttemptAt: 0,
      lastError: undefined,
    });

    const result = await retryLocalImageUpload("asset-1");

    expect(result).toEqual(
      expect.objectContaining({
        mediaId: "media-existing",
        status: "pending",
        nextAttemptAt: 0,
        lastError: undefined,
      }),
    );
    expect(mockRetryJob).toHaveBeenCalledWith("asset-1", expect.any(Number));
  });

  it("aborts an active request and records durable cancellation", async () => {
    const abort = jest.fn();
    const uploading = { ...existingJob(), status: "uploading" as const, leaseOwnerId: "worker-1", leaseExpiresAt: Date.now() + 30_000 };
    const cancelled = { ...uploading, status: "cancelled" as const, cancelRequested: true };
    mockGetJob.mockResolvedValueOnce(uploading).mockResolvedValueOnce(cancelled).mockResolvedValueOnce(cancelled);
    registerLocalImageUploadRequest("asset-1", { abort } as unknown as XMLHttpRequest);

    await cancelLocalImageUpload("asset-1");

    expect(abort).toHaveBeenCalled();
    expect(mockRequestCancellation).toHaveBeenCalledWith("asset-1", expect.any(Number));
    expect(mockFinishCancellation).not.toHaveBeenCalled();
    expect(consumeLocalImageUploadCancellation("asset-1")).toBe(true);
    expect(consumeLocalImageUploadCancellation("asset-1")).toBe(false);
  });

  it("cleans the server-created intent before finishing a pending cancellation", async () => {
    mockGetJob.mockResolvedValue({
      ...existingJob(),
      providerUploadId: "intent-1",
      cancelRequested: true,
    });
    mockFinishCancellation.mockResolvedValue({ ...existingJob(), status: "cancelled" });

    await retryLocalImageUploadCancellation("asset-1", "church-1");

    expect(mockCancelProviderUpload).toHaveBeenCalledWith("church-1", "intent-1");
    expect(mockFinishCancellation).toHaveBeenCalledWith("asset-1", expect.any(Number));
  });
});
