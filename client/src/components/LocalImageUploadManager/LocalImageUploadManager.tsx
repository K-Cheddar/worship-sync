import { useCallback, useContext, useEffect, useRef } from "react";
import { GlobalInfoContext } from "../../context/globalInfo";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { ToastContext } from "../../context/toastContext";
import { useDispatch, useSelector } from "../../hooks";
import {
  addItemToMediaList,
  updateMediaItemFields,
} from "../../store/mediaSlice";
import type { RootState } from "../../store/store";
import { createCloudinaryImageMediaItem } from "../../containers/Media/utils/cloudinaryMediaItem";
import { uploadImageToCloudinary } from "../../containers/Media/utils/cloudinaryUpload";
import {
  claimLocalImageUploadJob,
  deleteLocalImageUploadJob,
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
} from "../../utils/localImageUploadQueue";
import { dispatchLocalImageCloudCopy } from "../../utils/localImageRedux";
import {
  getLocalImageUploadRetryDelay,
  getNextLocalImageUploadAttemptAt,
  getRunnableLocalImageUploadJobs,
  LOCAL_IMAGE_UPLOAD_LEASE_MS,
  LOCAL_IMAGE_UPLOAD_LEASE_RENEW_MS,
  MAX_LOCAL_IMAGE_AUTO_UPLOAD_ATTEMPTS,
} from "../../utils/localImageUploadScheduling";

const OUTLINE_RETRY_MS = 5_000;

const LocalImageUploadManager = () => {
  const { churchId = "" } = useContext(GlobalInfoContext) || {};
  const { db, isGuestSession = false } =
    useContext(ControllerInfoContext) || {};
  const toast = useContext(ToastContext);
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
            console.error(
              "Local image upload lease could not be renewed:",
              error,
            ),
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
        if (!consumeLocalImageUploadCancellation(job.assetId)) return false;
        // Cancellation can race an IndexedDB status write. Delete again here so
        // that write cannot resurrect a job the operator chose to stop.
        await deleteLocalImageUploadJob(job.assetId);
        return true;
      };
      try {
        const stored = await getLocalImage(job.assetId);
        if (await stopIfCancelled()) return;
        if (!stored?.blob) {
          await updateClaimedJob({
            status: "failed",
            lastError: "The local image is missing. Relink it to continue.",
            nextAttemptAt: 0,
          });
          await stopIfCancelled();
          return;
        }

        let cloudMedia = job.cloudMedia;
        if (!cloudMedia) {
          const attemptCount = job.attemptCount + 1;
          if (
            !(await updateClaimedJob({
              status: "uploading",
              attemptCount,
            }))
          )
            return;
          if (await stopIfCancelled()) return;
          try {
            const file = new File([stored.blob], stored.fileName, {
              type: stored.contentType,
            });
            const info = await uploadImageToCloudinary(
              file,
              job.uploadPreset,
              "portable-media",
              {
                setXhr: (xhr) =>
                  registerLocalImageUploadRequest(job.assetId, xhr),
              },
            );
            if (await stopIfCancelled()) return;
            cloudMedia = {
              ...createCloudinaryImageMediaItem(info),
              id: job.mediaId,
            };
            if (
              !(await updateClaimedJob({
                status: "uploaded",
                attemptCount,
                cloudMedia,
                nextAttemptAt: 0,
                lastError: undefined,
              }))
            )
              return;
            if (await stopIfCancelled()) return;
          } catch (error) {
            if (await stopIfCancelled()) return;
            const canRetry =
              attemptCount < MAX_LOCAL_IMAGE_AUTO_UPLOAD_ATTEMPTS;
            const retryDelay = getLocalImageUploadRetryDelay(attemptCount);
            await updateClaimedJob({
              status: "failed",
              attemptCount,
              nextAttemptAt: canRetry ? Date.now() + retryDelay : 0,
              lastError:
                error instanceof Error ? error.message : "Upload failed.",
            });
            await stopIfCancelled();
            return;
          } finally {
            clearLocalImageUploadRequest(job.assetId);
          }
        }

        if (!cloudMedia?.background) {
          await updateClaimedJob({
            status: "failed",
            nextAttemptAt: 0,
            lastError: "The cloud copy did not include a usable image URL.",
          });
          await stopIfCancelled();
          return;
        }
        if (await stopIfCancelled()) return;
        const localMedia =
          mediaByIdRef.current.get(job.assetId) ??
          Array.from(mediaByIdRef.current.values()).find(
            (item) => item.localImage?.id === job.assetId,
          );
        if (localMedia?.localImage) {
          dispatch(
            updateMediaItemFields({
              id: localMedia.id,
              patch: {
                updatedAt: new Date().toISOString(),
                publicId: cloudMedia.publicId,
                cloudUploadRequest: null,
                localImage: {
                  ...localMedia.localImage,
                  storagePolicy: "local-and-cloud",
                  cloudMediaId: cloudMedia.id,
                  cloudUrl: cloudMedia.background,
                },
              },
            }),
          );
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
              cloudMedia,
              nextAttemptAt: Date.now() + OUTLINE_RETRY_MS,
              lastError:
                error instanceof Error
                  ? error.message
                  : "The outline item could not be updated.",
            });
            return;
          }
        }
        await deleteLocalImageUploadJob(job.assetId);
        toast?.showToast(
          `${stored.fileName} is available in Media and on other devices.`,
          "success",
        );
      } finally {
        window.clearInterval(heartbeat);
        processing.current.delete(job.assetId);
        clearLocalImageUploadProcessing(job.assetId);
        await releaseLocalImageUploadJobLease(
          job.assetId,
          jobLeaseOwnerId,
        ).catch((error) =>
          console.error(
            "Local image upload lease could not be released:",
            error,
          ),
        );
      }
    },
    [db, dispatch, isGuestSession, toast],
  );

  const drainQueue = useCallback(async () => {
    if (!churchId || !db || isGuestSession || !mediaIsReady) return;
    try {
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
      const jobs = await listLocalImageUploadJobs(churchId);
      const now = Date.now();
      const ready = getRunnableLocalImageUploadJobs(jobs, now);
      await Promise.all(
        ready.map(async (job) => {
          const claimed = await claimLocalImageUploadJob({
            assetId: job.assetId,
            leaseOwnerId: leaseOwnerId.current,
            now: Date.now(),
            leaseDurationMs: LOCAL_IMAGE_UPLOAD_LEASE_MS,
          });
          if (claimed) await processJob(claimed);
        }),
      );
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
    const unsubscribe = subscribeLocalImageUploadJobChanges(
      () => void drainQueue(),
    );
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
