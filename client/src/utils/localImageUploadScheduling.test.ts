import type { LocalImageUploadJob } from "./localImageAssets";
import {
  getLocalImageUploadRetryDelay,
  getNextLocalImageUploadAttemptAt,
  getRunnableLocalImageUploadJobs,
} from "./localImageUploadScheduling";

const job = (
  status: LocalImageUploadJob["status"],
  nextAttemptAt = 0,
): LocalImageUploadJob => ({
  id: `${status}-${nextAttemptAt}`,
  assetId: `${status}-${nextAttemptAt}`,
  itemId: "item-1",
  workspaceId: "church-1",
  uploadPreset: "preset",
  mediaId: "media-1",
  status,
  attemptCount: 1,
  nextAttemptAt,
  createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z",
});

describe("local image upload scheduling", () => {
  it("recovers only unclaimed or expired uploads and waits for retries", () => {
    const now = 10_000;
    const activeUpload = {
      ...job("uploading"),
      id: "active-upload",
      assetId: "active-upload",
      leaseOwnerId: "tab-1",
      leaseExpiresAt: now + 1_000,
    };
    const expiredUpload = {
      ...job("uploading"),
      id: "expired-upload",
      assetId: "expired-upload",
      leaseOwnerId: "closed-tab",
      leaseExpiresAt: now - 1,
    };
    const result = getRunnableLocalImageUploadJobs(
      [
        job("pending"),
        job("uploading"),
        activeUpload,
        expiredUpload,
        job("uploaded", now),
        job("failed", now - 1),
        job("failed", now + 1),
        job("failed", 0),
      ],
      now,
    );

    expect(result.map((entry) => entry.status)).toEqual([
      "pending",
      "uploading",
      "uploading",
      "uploaded",
      "failed",
    ]);
    expect(result).not.toContain(activeUpload);
  });

  it("uses bounded exponential retry timing and finds the next wake-up", () => {
    expect(getLocalImageUploadRetryDelay(1)).toBe(5_000);
    expect(getLocalImageUploadRetryDelay(3)).toBe(20_000);
    expect(getLocalImageUploadRetryDelay(20)).toBe(300_000);
    expect(
      getNextLocalImageUploadAttemptAt(
        [
          job("failed", 12_000),
          job("failed", 11_000),
          {
            ...job("uploading"),
            leaseOwnerId: "tab-1",
            leaseExpiresAt: 10_500,
          },
        ],
        10_000,
      ),
    ).toBe(10_500);
  });
});
