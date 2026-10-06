import { useCallback, useContext, useEffect, useRef } from "react";
import { GlobalInfoContext } from "../../context/globalInfo";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { useDispatch, useSelector } from "../../hooks";
import {
  addItemToMediaList,
  updateMediaItemFields,
} from "../../store/mediaSlice";
import type { RootState } from "../../store/store";
import type { MediaType } from "../../types";
import { createCloudinaryImageMediaItem } from "../../containers/Media/utils/cloudinaryMediaItem";
import { uploadImageToCloudinary } from "../../containers/Media/utils/cloudinaryUpload";
import {
  commitCloudinaryMediaAsset,
  deleteCloudinaryMediaAsset,
} from "../../api/providerStorage";
import {
  claimLocalImageUploadJob,
  getLocalImageUploadJob,
  cleanupOrphanedLocalImages,
  getLocalImage,
  listLocalImageUploadJobs,
  persistLocalImageCloudCopy,
  releaseLocalImageUploadJobLease,
  renewLocalImageUploadJobLease,
  subscribeLocalImageUploadJobChanges,
  updateLeasedLocalImageUploadJob,
  type LocalImageUploadJob,
} from "../../utils/localImageAssets";
import generateRandomId from "../../utils/generateRandomId";
import {
  clearLocalImageUploadRequest,
  clearLocalImageUploadProcessing,
  consumeLocalImageUploadCancellation,
  registerLocalImageUploadProcessing,
  registerLocalImageUploadRequest,
  isLocalImageUploadCancellationRequested,
  signalLocalImageUploadCancellation,
} from "../../utils/localImageUploadQueue";
import { dispatchLocalImageCloudCopy } from "../../utils/localImageRedux";
import {
  getLocalImageUploadRetryDelay,
  getNextLocalImageUploadAttemptAt,
  isLocalImageUploadJobRunnable,
  getRunnableLocalImageUploadJobs,
  LOCAL_IMAGE_UPLOAD_LEASE_MS,
  LOCAL_IMAGE_UPLOAD_LEASE_RENEW_MS,
  MAX_LOCAL_IMAGE_AUTO_UPLOAD_ATTEMPTS,
} from "../../utils/localImageUploadScheduling";

const OUTLINE_RETRY_MS = 5_000;

const getCloudinaryCommitFailure = (error: unknown) => {
  const apiError =
    typeof error === "object" && error !== null
      ? (error as { status?: unknown; code?: unknown })
      : undefined;
  const status = typeof apiError?.status === "number" ? apiError.status : undefined;
  const code = typeof apiError?.code === "string" ? apiError.code : undefined;
  const quotaDenied = code === "CHURCH_STORAGE_QUOTA_EXCEEDED" || status === 413;
  const retryableConflict =
    status === 409 && code === "CHURCH_STORAGE_MUTATION_IN_PROGRESS";
  const terminalClientFailure =
    status !== undefined &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429 &&
    !retryableConflict;
  const terminal = quotaDenied || terminalClientFailure;
  return { quotaDenied, terminal };
};

const LocalImageUploadManager = () => {
  const { churchId = "" } = useContext(GlobalInfoContext) || {};
  const { db, isGuestSession = false } =
    useContext(ControllerInfoContext) || {};
  const dispatch = useDispatch();
  const mediaList = useSelector((state: RootState) => state.media.list);
  const mediaIsReady = useSelector(
    (state: RootState) => state.media.isInitialized,
  );
  const mediaIdsRef = useRef(new Set(mediaList.map((item) => item.id)));
  mediaIdsRef.current = new Set(mediaList.map((item) => item.id));
  const mediaByIdRef = useRef(
    new Map(mediaList.map((item) => [item.id, item])),
  );
  mediaByIdRef.current = new Map(mediaList.map((item) => [item.id, item]));
  const processing = useRef(new Set<string>());
  const leaseOwnerId = useRef("");
  if (!leaseOwnerId.current) {
    leaseOwnerId.current = `upload-manager-${generateRandomId()}`;
  }
  const retryTimer = useRef<number | undefined>(undefined);
  const hasSweptWorkspace = useRef("");

  const processJob = useCallback(
    async (claimedJob: LocalImageUploadJob) => {
      if (!db || isGuestSession || processing.current.has(claimedJob.assetId)) {
        return;
      }
      if (!claimedJob.leaseOwnerId) return;
      let job = claimedJob;
      let cloudMedia = claimedJob.cloudMedia;
      const jobLeaseOwnerId = claimedJob.leaseOwnerId;
      let leaseIsActive = true;
      processing.current.add(job.assetId);
      registerLocalImageUploadProcessing(job.assetId);
      const heartbeat = window.setInterval(() => {
        void renewLocalImageUploadJobLease({
          assetId: job.assetId,
          leaseOwnerId: jobLeaseOwnerId,
          now: Date.now(),
          leaseDurationMs: LOCAL_IMAGE_UPLOAD_LEASE_MS,
        })
          .then((renewed) => {
            if (!renewed) leaseIsActive = false;
          })
          .catch((error) =>
            console.error("Local image upload lease could not be renewed:", error),
          );
      }, LOCAL_IMAGE_UPLOAD_LEASE_RENEW_MS);
      const updateClaimedJob = async (
        patch: Parameters<typeof updateLeasedLocalImageUploadJob>[0]["patch"],
      ) => {
        if (!leaseIsActive) return false;
        const updated = await updateLeasedLocalImageUploadJob({
          assetId: job.assetId,
          leaseOwnerId: jobLeaseOwnerId,
          patch,
          now: Date.now(),
          leaseDurationMs: LOCAL_IMAGE_UPLOAD_LEASE_MS,
        });
        if (!updated) {
          leaseIsActive = false;
          return false;
        }
        job = updated;
        return true;
      };
      const stopIfCancelled = async () => {
        const durableJob = await getLocalImageUploadJob(job.assetId);
        if (
          !isLocalImageUploadCancellationRequested(job.assetId) &&
          !durableJob?.cancelRequested
        ) return false;
        try {
          if (cloudMedia?.publicId) {
            await deleteCloudinaryMediaAsset(churchId, cloudMedia.publicId);
          }
        } catch (error) {
          const message = error instanceof Error
            ? error.message
            : "The uploaded image could not be removed. Try cleanup again.";
          await updateClaimedJob({
            status: "failed",
            phase: "failed",
            progress: null,
            cancelRequested: true,
            cloudMedia,
            nextAttemptAt: 0,
            lastError: message,
          });
          consumeLocalImageUploadCancellation(job.assetId);
          return true;
        }
        await updateClaimedJob({
          status: "cancelled",
          phase: "cancelled",
          progress: null,
          cancelRequested: true,
          cloudMedia: null,
          nextAttemptAt: 0,
          lastError: undefined,
        });
        consumeLocalImageUploadCancellation(job.assetId);
        return true;
      };
      const cleanupCloudMedia = async (media?: MediaType) => {
        if (!media?.publicId) return;
        await deleteCloudinaryMediaAsset(churchId, media.publicId);
      };
      try {
        const stored = await getLocalImage(job.assetId);
        if (await stopIfCancelled()) return;
        if (!stored?.blob) {
          await updateClaimedJob({
            status: "failed",
            phase: "failed",
            progress: null,
            lastError: "The local image is missing. Relink it to continue.",
            nextAttemptAt: 0,
          });
          return;
        }

        if (!cloudMedia) {
          const attemptCount = job.attemptCount + 1;
          if (!(await updateClaimedJob({
            status: "uploading",
            phase: "uploading",
            progress: 0,
            attemptCount,
            cancelRequested: false,
          }))) return;
          if (await stopIfCancelled()) return;
          try {
            const file = new File([stored.blob], stored.fileName, {
              type: stored.contentType,
            });
            let lastPersistedAt = 0;
            let progressWrite = Promise.resolve();
            const info = await uploadImageToCloudinary(
              file,
              job.uploadPreset,
              "portable-media",
              {
                setXhr: (xhr) => registerLocalImageUploadRequest(job.assetId, xhr),
                isCancelled: () => isLocalImageUploadCancellationRequested(job.assetId),
                onProgress: (progress) => {
                  const now = Date.now();
                  if (now - lastPersistedAt < 300 && progress < 100) return;
                  lastPersistedAt = now;
                  progressWrite = progressWrite.then(async () => {
                    if (await isLocalImageUploadCancellationRequested(job.assetId)) return;
                    await updateClaimedJob({
                      status: "uploading",
                      phase: "uploading",
                      progress: Math.max(0, Math.min(89, progress * 0.89)),
                    });
                  }).catch((error) => console.warn("Image upload progress could not be saved:", error));
                },
              },
              { folder: `worship-sync/churches/${encodeURIComponent(churchId)}/media` },
            );
            await progressWrite;
            cloudMedia = {
              ...createCloudinaryImageMediaItem(info),
              id: job.mediaId,
            };
            if (await stopIfCancelled()) return;
            if (!(await updateClaimedJob({
              status: "uploaded",
              phase: "committing",
              progress: 90,
              attemptCount,
              cloudMedia,
              nextAttemptAt: 0,
              lastError: undefined,
            }))) {
              await cleanupCloudMedia(cloudMedia);
              return;
            }
            if (await stopIfCancelled()) return;
          } catch (error) {
            if (await stopIfCancelled()) return;
            const canRetry = attemptCount < MAX_LOCAL_IMAGE_AUTO_UPLOAD_ATTEMPTS;
            const retryDelay = getLocalImageUploadRetryDelay(attemptCount);
            await updateClaimedJob({
              status: "failed",
              phase: "failed",
              progress: null,
              attemptCount,
              nextAttemptAt: canRetry ? Date.now() + retryDelay : 0,
              lastError: error instanceof Error ? error.message : "Upload failed.",
            });
            return;
          } finally {
            clearLocalImageUploadRequest(job.assetId);
          }
        }

        if (!cloudMedia?.background) {
          await updateClaimedJob({
            status: "failed",
            phase: "failed",
            progress: null,
            nextAttemptAt: 0,
            lastError: "The cloud copy did not include a usable image URL.",
          });
          return;
        }
        if (!cloudMedia.providerStorage) {
          try {
            await updateClaimedJob({ phase: "committing", progress: 90 });
            const committed = await commitCloudinaryMediaAsset(churchId, cloudMedia.publicId);
            cloudMedia = { ...cloudMedia, providerStorage: committed.asset };
            if (!(await updateClaimedJob({
              status: "uploaded",
              phase: "finalizing",
              progress: 95,
              cloudMedia,
              nextAttemptAt: 0,
              lastError: undefined,
            }))) return;
          } catch (error) {
            const { quotaDenied, terminal } = getCloudinaryCommitFailure(error);
            if (quotaDenied) cloudMedia = undefined;
            await updateClaimedJob({
              status: "failed",
              phase: "failed",
              progress: null,
              cloudMedia: cloudMedia ?? null,
              nextAttemptAt: terminal ? 0 : Date.now() + OUTLINE_RETRY_MS,
              lastError: error instanceof Error ? error.message : "Image storage failed.",
            });
            return;
          }
        }
        if (await stopIfCancelled()) return;
        await updateClaimedJob({ phase: "finalizing", progress: 95 });
        const localMedia =
          mediaByIdRef.current.get(job.assetId) ??
          Array.from(mediaByIdRef.current.values()).find(
            (item) => item.localImage?.id === job.assetId,
          );
        if (localMedia?.localImage) {
          dispatch(updateMediaItemFields({
            id: localMedia.id,
            patch: {
              updatedAt: new Date().toISOString(),
              publicId: cloudMedia.publicId,
              providerStorage: cloudMedia.providerStorage,
              cloudUploadRequest: null,
              localImage: {
                ...localMedia.localImage,
                storagePolicy: "local-and-cloud",
                cloudMediaId: cloudMedia.id,
                cloudUrl: cloudMedia.background,
              },
            },
          }));
        } else if (!mediaIdsRef.current.has(cloudMedia.id)) {
          dispatch(addItemToMediaList(cloudMedia));
        }
        if (job.itemId) {
          try {
            await persistLocalImageCloudCopy({
              db,
              itemId: job.itemId,
              assetId: job.assetId,
              mediaId: cloudMedia.id,
              url: cloudMedia.background,
            });
            dispatchLocalImageCloudCopy(dispatch, {
              itemId: job.itemId,
              assetId: job.assetId,
              mediaId: cloudMedia.id,
              url: cloudMedia.background,
            });
          } catch (error) {
            await updateClaimedJob({
              status: "uploaded",
              phase: "finalizing",
              progress: 95,
              cloudMedia,
              nextAttemptAt: Date.now() + OUTLINE_RETRY_MS,
              lastError: error instanceof Error ? error.message : "The outline item could not be updated.",
            });
            return;
          }
        }
        await updateClaimedJob({
          status: "complete",
          phase: "complete",
          progress: 100,
          cloudMedia,
          cancelRequested: false,
          nextAttemptAt: 0,
          lastError: undefined,
        });
      } finally {
        window.clearInterval(heartbeat);
        processing.current.delete(job.assetId);
        clearLocalImageUploadProcessing(job.assetId);
        await releaseLocalImageUploadJobLease(job.assetId, jobLeaseOwnerId).catch(
          (error) => console.error("Local image upload lease could not be released:", error),
        );
      }
    },
    [churchId, db, dispatch, isGuestSession],
  );

  const drainQueue = useCallback(async () => {
    if (!churchId || !db || isGuestSession || !mediaIsReady) return;
    try {
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
      const jobs = await listLocalImageUploadJobs(churchId);
      const now = Date.now();
      const ready = getRunnableLocalImageUploadJobs(jobs, now);
      for (let index = 0; index < ready.length; index += 2) {
        const batch = ready.slice(index, index + 2);
        await Promise.all(batch.map(async (job) => {
          const claimed = await claimLocalImageUploadJob({
            assetId: job.assetId,
            leaseOwnerId: leaseOwnerId.current,
            now: Date.now(),
            leaseDurationMs: LOCAL_IMAGE_UPLOAD_LEASE_MS,
          });
          if (claimed) await processJob(claimed);
        }));
      }
      const refreshed = await listLocalImageUploadJobs(churchId);
      const nextAttemptAt = getNextLocalImageUploadAttemptAt(
        refreshed,
        Date.now(),
      );
      if (nextAttemptAt) {
        retryTimer.current = window.setTimeout(
          () => void drainQueue(),
          Math.max(250, nextAttemptAt - Date.now()),
        );
      }
    } catch (error) {
      console.error("Local image upload queue could not be read:", error);
    }
  }, [churchId, db, isGuestSession, mediaIsReady, processJob]);

  useEffect(() => {
    void drainQueue();
    const unsubscribe = subscribeLocalImageUploadJobChanges((assetId) => {
      void getLocalImageUploadJob(assetId).then((job) => {
        if (!job) return;
        if (job.cancelRequested) {
          signalLocalImageUploadCancellation(assetId);
          return;
        }
        if (isLocalImageUploadJobRunnable(job, Date.now())) void drainQueue();
      }).catch((error) => console.error("Local image upload status could not be read:", error));
    });
    const onOnline = () => void drainQueue();
    const safetyInterval = window.setInterval(() => void drainQueue(), 30_000);
    window.addEventListener("online", onOnline);
    return () => {
      unsubscribe();
      window.removeEventListener("online", onOnline);
      window.clearInterval(safetyInterval);
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
    };
  }, [drainQueue]);

  useEffect(() => {
    if (!db || !churchId || hasSweptWorkspace.current === churchId) return;
    hasSweptWorkspace.current = churchId;
    void cleanupOrphanedLocalImages({ db, workspaceId: churchId }).catch(
      (error) => console.error("Local image orphan cleanup failed:", error),
    );
  }, [churchId, db]);

  return null;
};

export default LocalImageUploadManager;
