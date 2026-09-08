import type { LocalImageUploadJob } from "./localImageAssets";

export const MAX_LOCAL_IMAGE_AUTO_UPLOAD_ATTEMPTS = 5;
export const LOCAL_IMAGE_UPLOAD_LEASE_MS = 5 * 60_000;
export const LOCAL_IMAGE_UPLOAD_LEASE_RENEW_MS = 30_000;
const RETRY_BASE_MS = 5_000;
const MAX_RETRY_MS = 5 * 60_000;

export const getLocalImageUploadRetryDelay = (attemptCount: number) =>
  Math.min(
    MAX_RETRY_MS,
    RETRY_BASE_MS * 2 ** Math.max(0, attemptCount - 1),
  );

export const getRunnableLocalImageUploadJobs = (
  jobs: LocalImageUploadJob[],
  now: number,
) =>
  jobs.filter(
    (job) => isLocalImageUploadJobRunnable(job, now),
  );

export const isLocalImageUploadJobRunnable = (
  job: LocalImageUploadJob,
  now: number,
) => {
  if (job.leaseOwnerId && (job.leaseExpiresAt ?? 0) > now) return false;
  return (
    job.status === "pending" ||
    job.status === "uploading" ||
    (job.status === "uploaded" && job.nextAttemptAt <= now) ||
    (job.status === "failed" &&
      job.nextAttemptAt > 0 &&
      job.nextAttemptAt <= now)
  );
};

export const getNextLocalImageUploadAttemptAt = (
  jobs: LocalImageUploadJob[],
  now: number,
) =>
  jobs
    .flatMap((job) => [job.nextAttemptAt, job.leaseExpiresAt ?? 0])
    .filter((value) => value > now)
    .sort((a, b) => a - b)[0];
