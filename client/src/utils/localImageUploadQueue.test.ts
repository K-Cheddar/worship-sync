import generateRandomId from "./generateRandomId";
import {
  deleteLocalImageUploadJob,
  enqueueLocalImageUploadJobAtomically,
  retryLocalImageUploadJobAtomically,
  type LocalImageUploadJob,
} from "./localImageAssets";
import {
  cancelLocalImageUpload,
  consumeLocalImageUploadCancellation,
  enqueueLocalImageUpload,
  registerLocalImageUploadRequest,
  retryLocalImageUpload,
} from "./localImageUploadQueue";

jest.mock("./generateRandomId", () => jest.fn(() => "media-1"));
jest.mock("./localImageAssets", () => ({
  enqueueLocalImageUploadJobAtomically: jest.fn(),
  retryLocalImageUploadJobAtomically: jest.fn(),
  deleteLocalImageUploadJob: jest.fn(),
}));

const mockEnqueueJob = jest.mocked(enqueueLocalImageUploadJobAtomically);
const mockRetryJob = jest.mocked(retryLocalImageUploadJobAtomically);
const mockDeleteJob = jest.mocked(deleteLocalImageUploadJob);

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
    mockDeleteJob.mockResolvedValue();
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

  it("aborts an active request and removes its durable job", async () => {
    const abort = jest.fn();
    registerLocalImageUploadRequest("asset-1", {
      abort,
    } as unknown as XMLHttpRequest);

    await cancelLocalImageUpload("asset-1");

    expect(abort).toHaveBeenCalled();
    expect(mockDeleteJob).toHaveBeenCalledWith("asset-1");
    expect(consumeLocalImageUploadCancellation("asset-1")).toBe(true);
    expect(consumeLocalImageUploadCancellation("asset-1")).toBe(false);
  });
});
