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
import { uploadImageToCloudinarySigned } from "../../containers/Media/utils/cloudinaryUpload";
import {
  cancelCloudinaryMediaUpload,
  commitCloudinaryMediaAsset,
  createCloudinaryMediaUpload,
  deleteCloudinaryMediaAsset,
} from "../../api/providerStorage";
import {
  claimLocalImageUploadJob,
  getLocalImageUploadJob,
  activateStagedLocalVideoInputThumbnailUploadJobAtomically,
  cleanupOrphanedLocalImages,
  discardStagedLocalVideoInputThumbnailUploadJobAtomically,
  deleteLocalImage,
  getLocalImage,
  listLocalImageUploadJobs,
  persistLocalImageCloudCopy,
  putLocalImageUploadJob,
  isLocalImageUploadStagingSessionActive,
  registerLocalImageUploadManagerSession,
  releaseLocalImageUploadJobLease,
  renewLocalImageUploadJobLease,
  subscribeLocalImageUploadJobChanges,
  stageLocalImageUploadCleanupJobAtomically,
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
import { extractPublicId } from "../../utils/cloudinaryUtils";
import { flushMediaLibraryDocToPouch } from "../../utils/flushMediaLibraryDoc";
import { loadMediaLibrary } from "../../utils/mediaDocUtils";
import store from "../../store/store";
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

const isCloudinaryAssetReferenced = (
  media: MediaType[],
  cloudAsset: { publicId?: string; url?: string },
) => {
  if (!cloudAsset.publicId && !cloudAsset.url) return false;
  return media.some((item) => {
    const urls = [item.background, item.thumbnail, item.localImage?.cloudUrl].filter(
      (value): value is string => Boolean(value),
    );
    if (cloudAsset.url && urls.includes(cloudAsset.url)) return true;
    if (!cloudAsset.publicId) return false;
    return (
      item.localImage?.cloudPublicId === cloudAsset.publicId ||
      urls.some((url) => extractPublicId(url) === cloudAsset.publicId)
    );
  });
};

const stageThumbnailAssetCleanup = async ({
  assetId,
  targetMediaId,
  workspaceId,
  cloudPublicId,
  keepCloudCopy = false,
}: {
  assetId: string;
  targetMediaId: string;
  workspaceId: string;
  cloudPublicId?: string;
  keepCloudCopy?: boolean;
}) => {
  const previous = await getLocalImageUploadJob(assetId);
  if (previous?.cleanupOnly) return true;
  if (
    previous &&
    previous.status !== "complete" &&
    previous.status !== "cancelled"
  ) return false;

  const now = new Date().toISOString();
  const cleanupCloudPublicId = keepCloudCopy
    ? undefined
    : cloudPublicId || (
        previous?.localVideoInputThumbnail?.staleCloudCleanupComplete
          ? undefined
          : previous?.cloudMedia?.publicId
      );
  const candidate: LocalImageUploadJob = {
    ...(previous ?? {}),
    id: assetId,
    assetId,
    itemId: "",
    workspaceId: previous?.workspaceId || workspaceId,
    uploadPreset: previous?.uploadPreset || "bpqu4ma5",
    mediaId: previous?.mediaId || generateRandomId(),
    status: "pending",
    phase: "queued",
    progress: 0,
    cancelRequested: false,
    attemptCount: previous?.attemptCount ?? 0,
    nextAttemptAt: 0,
    cleanupOnly: true,
    cleanupReady: true,
    cleanupTargetMediaId: targetMediaId,
    cleanupCloudPublicId,
    cleanupCloudComplete: !cleanupCloudPublicId,
    leaseOwnerId: undefined,
    leaseExpiresAt: undefined,
    providerUploadId: undefined,
    providerExpectedPublicId: undefined,
    cloudMedia: undefined,
    lastError: undefined,
    lastErrorCode: undefined,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
  };
  const staged = await stageLocalImageUploadCleanupJobAtomically(candidate, Date.now());
  if (staged) return true;
  return Boolean((await getLocalImageUploadJob(assetId))?.cleanupOnly);
};

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
  const activeScopeRef = useRef({ db, churchId });
  activeScopeRef.current = { db, churchId };
  const dispatch = useDispatch();
  const mediaList = useSelector((state: RootState) => state.media.list);
  const mediaIsReady = useSelector(
    (state: RootState) => state.media.isInitialized,
  );
  const mediaIdsRef = useRef(new Set(mediaList.map((item) => item.id)));
  mediaIdsRef.current = new Set(mediaList.map((item) => item.id));
  const processing = useRef(new Set<string>());
  const leaseOwnerId = useRef("");
  if (!leaseOwnerId.current) {
    leaseOwnerId.current = `upload-manager-${generateRandomId()}`;
  }
  const retryTimer = useRef<number | undefined>(undefined);
  const hasSweptWorkspace = useRef<{ db: PouchDB.Database; workspaceId: string } | null>(null);

  useEffect(() => registerLocalImageUploadManagerSession(), []);

  const processJob = useCallback(
    async (claimedJob: LocalImageUploadJob) => {
      if (!db || isGuestSession || processing.current.has(claimedJob.assetId)) {
        return;
      }
      if (!claimedJob.leaseOwnerId) return;
      let job = claimedJob;
      let cloudMedia = claimedJob.cloudMedia;
      const resumedCloudCheckpoint = Boolean(claimedJob.cloudMedia);
      const jobLeaseOwnerId = claimedJob.leaseOwnerId;
      let providerUploadId = claimedJob.providerUploadId;
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
          if (providerUploadId) {
            const cleanup = await cancelCloudinaryMediaUpload(churchId, providerUploadId);
            if (cleanup.committed) return false;
          } else if (cloudMedia?.publicId) {
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
          providerUploadId: null,
          providerExpectedPublicId: null,
          nextAttemptAt: 0,
          lastError: undefined,
        });
        consumeLocalImageUploadCancellation(job.assetId);
        return true;
      };
      const cleanupCloudMedia = async (media?: MediaType) => {
        if (!media?.publicId) return;
        if (providerUploadId) {
          await cancelCloudinaryMediaUpload(churchId, providerUploadId);
        } else {
          await deleteCloudinaryMediaAsset(churchId, media.publicId);
        }
      };
      try {
        if (job.cleanupOnly) {
          if (!job.cleanupReady) return;
          try {
            const cleanupTarget = job.localVideoInputThumbnail;
            const predecessorAssets = new Map<
              string,
              { cloudPublicId?: string; localCleanupScheduled?: boolean }
            >();
            for (const previous of cleanupTarget?.previousAssets ?? []) {
              predecessorAssets.set(previous.assetId, previous);
            }
            if (cleanupTarget?.previousAssetId) {
              const previous = predecessorAssets.get(cleanupTarget.previousAssetId);
              const cloudAlreadyTracked = Boolean(
                cleanupTarget.previousCloudPublicId &&
                [...predecessorAssets.entries()].some(([assetId, candidate]) =>
                  assetId !== cleanupTarget.previousAssetId &&
                  candidate.cloudPublicId === cleanupTarget.previousCloudPublicId,
                ),
              );
              predecessorAssets.set(cleanupTarget.previousAssetId, {
                cloudPublicId:
                  (cloudAlreadyTracked ? undefined : cleanupTarget.previousCloudPublicId) ||
                  previous?.cloudPublicId,
                localCleanupScheduled: previous?.localCleanupScheduled,
              });
            }
            for (const [previousAssetId, previous] of predecessorAssets) {
              if (previousAssetId === job.assetId || previous.localCleanupScheduled) continue;
              const staged = await stageThumbnailAssetCleanup({
                assetId: previousAssetId,
                targetMediaId: job.cleanupTargetMediaId || cleanupTarget?.targetMediaId || "",
                workspaceId: job.workspaceId,
                cloudPublicId: previous.cloudPublicId,
              });
              if (!staged) {
                await updateClaimedJob({
                  status: "failed",
                  phase: "failed",
                  progress: null,
                  nextAttemptAt: Date.now() + OUTLINE_RETRY_MS,
                  lastError: "A previous thumbnail upload is still being reconciled.",
                });
                return;
              }
            }

            const latestBeforeCleanup = await loadMediaLibrary(db);
            const assetIsReferenced = latestBeforeCleanup.list.some(
              (item) => item.localImage?.id === job.assetId,
            );
            const cloudIsReferenced = isCloudinaryAssetReferenced(
              latestBeforeCleanup.list,
              { publicId: job.cleanupCloudPublicId },
            );
            if (assetIsReferenced || cloudIsReferenced) {
              await updateClaimedJob({
                status: "failed",
                phase: "failed",
                progress: null,
                nextAttemptAt: Date.now() + OUTLINE_RETRY_MS,
                lastError: "The thumbnail is still referenced by Media; cleanup will retry.",
              });
              return;
            }
            if (job.cleanupCloudPublicId && !job.cleanupCloudComplete) {
              if (
                job.workspaceId !== churchId ||
                activeScopeRef.current.db !== db ||
                activeScopeRef.current.churchId !== churchId
              ) return;
              await deleteCloudinaryMediaAsset(churchId, job.cleanupCloudPublicId);
              await updateClaimedJob({ cleanupCloudComplete: true });
            }
            const latestBeforeLocalDelete = await loadMediaLibrary(db);
            if (latestBeforeLocalDelete.list.some((item) => item.localImage?.id === job.assetId)) {
              await updateClaimedJob({
                status: "failed",
                phase: "failed",
                progress: null,
                nextAttemptAt: Date.now() + OUTLINE_RETRY_MS,
                lastError: "The thumbnail is still referenced by Media; cleanup will retry.",
              });
              return;
            }
            if (
              job.workspaceId !== churchId ||
              activeScopeRef.current.db !== db ||
              activeScopeRef.current.churchId !== churchId
            ) return;
            await deleteLocalImage(job.assetId);
          } catch (error) {
            await updateClaimedJob({
              status: "failed",
              phase: "failed",
              progress: null,
              nextAttemptAt: Date.now() + OUTLINE_RETRY_MS,
              lastError: error instanceof Error
                ? error.message
                : "The removed thumbnail could not be cleaned up.",
            });
          }
          return;
        }

        const stored = await getLocalImage(job.assetId);
        if (await stopIfCancelled()) return;
        if (!cloudMedia && providerUploadId) {
          try {
            const cleanup = await cancelCloudinaryMediaUpload(churchId, providerUploadId);
            if (cleanup.committed) {
              await updateClaimedJob({
                status: "failed",
                phase: "failed",
                progress: null,
                nextAttemptAt: 0,
                lastError: "The cloud image was saved, but its local upload details are missing. Contact support before retrying.",
                lastErrorCode: "CLOUDINARY_UPLOAD_ALREADY_COMMITTED",
              });
              return;
            }
          } catch (error) {
            await updateClaimedJob({
              status: "failed",
              phase: "failed",
              progress: null,
              nextAttemptAt: 0,
              lastError: error instanceof Error ? error.message : "The previous cloud upload could not be cleaned up.",
              lastErrorCode:
                typeof error === "object" && error !== null &&
                typeof (error as { code?: unknown }).code === "string"
                  ? (error as { code: string }).code
                  : undefined,
            });
            return;
          }
          providerUploadId = undefined;
          await updateClaimedJob({
            providerUploadId: null,
            providerExpectedPublicId: null,
          });
        }
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
            const intent = await createCloudinaryMediaUpload(churchId, job.mediaId);
            providerUploadId = intent.uploadId;
            if (!(await updateClaimedJob({
              providerUploadId,
              providerExpectedPublicId: intent.publicId,
            }))) {
              await cancelCloudinaryMediaUpload(churchId, providerUploadId);
              return;
            }
            if (await stopIfCancelled()) return;
            const info = await uploadImageToCloudinarySigned(
              file,
              intent,
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
              lastErrorCode: undefined,
            }))) {
              await cleanupCloudMedia(cloudMedia);
              return;
            }
            if (await stopIfCancelled()) return;
          } catch (error) {
            if (await stopIfCancelled()) return;
            const { terminal } = getCloudinaryCommitFailure(error);
            const canRetry = !terminal && attemptCount < MAX_LOCAL_IMAGE_AUTO_UPLOAD_ATTEMPTS;
            const retryDelay = getLocalImageUploadRetryDelay(attemptCount);
            await updateClaimedJob({
              status: "failed",
              phase: "failed",
              progress: null,
              attemptCount,
              nextAttemptAt: canRetry ? Date.now() + retryDelay : 0,
              lastError: error instanceof Error ? error.message : "Upload failed.",
              lastErrorCode:
                typeof error === "object" && error !== null &&
                typeof (error as { code?: unknown }).code === "string"
                  ? (error as { code: string }).code
                  : undefined,
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
            const committed = await commitCloudinaryMediaAsset(
              churchId,
              { ...(providerUploadId ? { uploadId: providerUploadId } : {}), publicId: cloudMedia.publicId },
            );
            cloudMedia = { ...cloudMedia, providerStorage: committed.asset };
            if (!(await updateClaimedJob({
              status: "uploaded",
              phase: "finalizing",
              progress: 95,
              cloudMedia,
              nextAttemptAt: 0,
              lastError: undefined,
              lastErrorCode: undefined,
            }))) return;
          } catch (error) {
            const { quotaDenied, terminal } = getCloudinaryCommitFailure(error);
            if (quotaDenied) cloudMedia = undefined;
            const attemptCount = job.attemptCount + 1;
            const canRetry = !terminal && attemptCount < MAX_LOCAL_IMAGE_AUTO_UPLOAD_ATTEMPTS;
            await updateClaimedJob({
              status: "failed",
              phase: "failed",
              progress: null,
              attemptCount,
              cloudMedia: cloudMedia ?? null,
              nextAttemptAt: canRetry ? Date.now() + OUTLINE_RETRY_MS : 0,
              lastError: error instanceof Error ? error.message : "Image storage failed.",
              lastErrorCode:
                typeof error === "object" && error !== null &&
                typeof (error as { code?: unknown }).code === "string"
                  ? (error as { code: string }).code
                  : undefined,
            });
            return;
          }
        }
        if (await stopIfCancelled()) return;
        await updateClaimedJob({ phase: "finalizing", progress: 95 });
        if (activeScopeRef.current.db !== db || activeScopeRef.current.churchId !== churchId) {
          if (resumedCloudCheckpoint) {
            await updateClaimedJob({
              status: "uploaded",
              phase: "finalizing",
              progress: 95,
              cloudMedia,
              nextAttemptAt: 0,
            });
            return;
          }
          try {
            await deleteCloudinaryMediaAsset(churchId, cloudMedia.publicId);
            await updateClaimedJob({
              status: "cancelled",
              phase: "cancelled",
              progress: null,
              cloudMedia: null,
              providerUploadId: null,
              providerExpectedPublicId: null,
              nextAttemptAt: 0,
              lastError: undefined,
            });
          } catch (error) {
            await updateClaimedJob({
              status: "failed",
              phase: "failed",
              progress: null,
              cloudMedia,
              nextAttemptAt: 0,
              lastError: error instanceof Error ? error.message : "Church changed during upload; cloud cleanup needs attention.",
            });
          }
          return;
        }
        const thumbnailTarget = job.localVideoInputThumbnail;
        const authoritativeMedia = thumbnailTarget
          ? await loadMediaLibrary(db)
          : undefined;
        const currentMediaList: MediaType[] = store.getState().media.list;
        const localMedia = thumbnailTarget
          ? authoritativeMedia?.list.find((item) => item.id === thumbnailTarget.targetMediaId)
          : currentMediaList.find((item) => item.id === job.assetId) ??
            currentMediaList.find(
              (item) => item.localImage?.id === job.assetId,
            );
        if (thumbnailTarget) {
          const thumbnailCloudMedia = cloudMedia;
          if (!thumbnailCloudMedia) {
            await updateClaimedJob({
              status: "failed",
              phase: "failed",
              progress: null,
              nextAttemptAt: 0,
              lastError: "The uploaded thumbnail result is missing.",
            });
            return;
          }
          const recordStaleThumbnailCleanup = async (
            patch: Partial<typeof thumbnailTarget>,
          ) => {
            const nextTarget = { ...thumbnailTarget, ...patch };
            if (!(await updateClaimedJob({ localVideoInputThumbnail: nextTarget }))) {
              return false;
            }
            Object.assign(thumbnailTarget, nextTarget);
            return true;
          };
          const cleanupStaleThumbnailUpload = async () => {
            try {
              if (
                thumbnailCloudMedia.publicId &&
                !thumbnailTarget.staleCloudCleanupComplete
              ) {
                if (
                  job.workspaceId !== churchId ||
                  activeScopeRef.current.db !== db ||
                  activeScopeRef.current.churchId !== churchId
                ) return;
                const latestMedia = await loadMediaLibrary(db);
                if (isCloudinaryAssetReferenced(latestMedia.list, {
                  publicId: thumbnailCloudMedia.publicId,
                  url: thumbnailCloudMedia.background,
                })) {
                  throw new Error("The uploaded thumbnail is still referenced by Media; cloud cleanup will retry.");
                }
                if (
                  activeScopeRef.current.db !== db ||
                  activeScopeRef.current.churchId !== churchId
                ) return;
                await deleteCloudinaryMediaAsset(churchId, thumbnailCloudMedia.publicId);
                if (!(await recordStaleThumbnailCleanup({ staleCloudCleanupComplete: true }))) {
                  return;
                }
              }
              const previousAssets = new Map<string, {
                assetId: string;
                cloudPublicId?: string;
                localCleanupScheduled?: boolean;
              }>();
              for (const previous of thumbnailTarget.previousAssets ?? []) {
                previousAssets.set(previous.assetId, previous);
              }
              if (thumbnailTarget.previousAssetId) {
                const previous = previousAssets.get(thumbnailTarget.previousAssetId);
                const cloudAlreadyTracked = Boolean(
                  thumbnailTarget.previousCloudPublicId &&
                  [...previousAssets.entries()].some(([assetId, candidate]) =>
                    assetId !== thumbnailTarget.previousAssetId &&
                    candidate.cloudPublicId === thumbnailTarget.previousCloudPublicId,
                  ),
                );
                previousAssets.set(thumbnailTarget.previousAssetId, {
                  assetId: thumbnailTarget.previousAssetId,
                  cloudPublicId:
                    (cloudAlreadyTracked ? undefined : thumbnailTarget.previousCloudPublicId) ||
                    previous?.cloudPublicId,
                  localCleanupScheduled:
                    previous?.localCleanupScheduled ||
                    thumbnailTarget.previousLocalCleanupScheduled,
                });
              }
              for (const [previousAssetId, previous] of previousAssets) {
                if (previousAssetId === job.assetId || previous.localCleanupScheduled) continue;
                const staged = await stageThumbnailAssetCleanup({
                  assetId: previousAssetId,
                  targetMediaId: thumbnailTarget.targetMediaId,
                  workspaceId: job.workspaceId,
                  cloudPublicId: previous.cloudPublicId,
                });
                if (!staged) {
                  throw new Error("A previous thumbnail upload is still being reconciled.");
                }
                const updatedPreviousAssets = [...previousAssets.values()].map((entry) =>
                  entry.assetId === previousAssetId
                    ? { ...entry, localCleanupScheduled: true }
                    : entry,
                );
                if (!(await recordStaleThumbnailCleanup({
                  previousAssets: updatedPreviousAssets,
                  ...(previousAssetId === thumbnailTarget.previousAssetId
                    ? { previousLocalCleanupScheduled: true }
                    : {}),
                }))) return;
              }
              if (!thumbnailTarget.staleLocalCleanupComplete) {
                if (
                  job.workspaceId !== churchId ||
                  activeScopeRef.current.db !== db ||
                  activeScopeRef.current.churchId !== churchId
                ) return;
                await deleteLocalImage(job.assetId);
              }
            } catch (error) {
              await updateClaimedJob({
                status: "failed",
                phase: "failed",
                progress: null,
                nextAttemptAt: Date.now() + OUTLINE_RETRY_MS,
                lastError: error instanceof Error
                  ? error.message
                  : "The replaced thumbnail could not be cleaned up.",
              });
            }
          };
          if (
            !localMedia?.localVideoInput ||
            localMedia.localImage?.id !== job.assetId
          ) {
            await cleanupStaleThumbnailUpload();
            return;
          }

          const updatedAt = new Date().toISOString();
          const cloudThumbnailRef = {
            ...localMedia.localImage!,
            storagePolicy: "local-and-cloud" as const,
            cloudMediaId: cloudMedia.id,
            cloudPublicId: cloudMedia.publicId,
            cloudUrl: cloudMedia.background,
          };
          const updatedMedia = {
            ...localMedia,
            updatedAt,
            thumbnail: cloudMedia.background,
            localImage: cloudThumbnailRef,
          };
          const mediaList: MediaType[] = authoritativeMedia!.list.map((item: MediaType) =>
            item.id === updatedMedia.id ? updatedMedia : item,
          );
          const persisted = await flushMediaLibraryDocToPouch(
            db,
            mediaList,
            authoritativeMedia!.folders,
            undefined,
            authoritativeMedia,
            {
              canPersist: () =>
                activeScopeRef.current.db === db &&
                activeScopeRef.current.churchId === churchId,
              publishIfCurrent: () =>
                activeScopeRef.current.db === db &&
                activeScopeRef.current.churchId === churchId,
            },
          );
          if (!persisted.ok) {
            await updateClaimedJob({
              status: "uploaded",
              phase: "finalizing",
              progress: 95,
              cloudMedia,
              nextAttemptAt: Date.now() + OUTLINE_RETRY_MS,
              lastError: "The thumbnail is uploaded, but its Media update could not be saved.",
            });
            return;
          }

          const committedState = await loadMediaLibrary(db);
          const committedMedia = committedState.list.find(
            (item) => item.id === updatedMedia.id,
          );
          const thumbnailWasCommitted =
            committedMedia?.localImage?.id === job.assetId &&
            committedMedia.thumbnail === cloudMedia.background &&
            committedMedia.localImage.cloudPublicId === cloudMedia.publicId;
          if (!thumbnailWasCommitted) {
            await cleanupStaleThumbnailUpload();
            return;
          }

          const latestReduxMedia = store
            .getState()
            .media.list.find((item: MediaType) => item.id === updatedMedia.id);
          if (
            activeScopeRef.current.db === db &&
            activeScopeRef.current.churchId === churchId &&
            latestReduxMedia?.localImage?.id === job.assetId
          ) {
            dispatch(updateMediaItemFields({
              id: updatedMedia.id,
              patch: {
                updatedAt,
                thumbnail: cloudMedia.background,
                localImage: cloudThumbnailRef,
              },
            }));
          }

          try {
            const previousAssets = new Map<string, {
              assetId: string;
              cloudPublicId?: string;
              cloudCleanupComplete?: boolean;
              cloudCleanupScheduled?: boolean;
              localCleanupScheduled?: boolean;
            }>();
            for (const previous of thumbnailTarget.previousAssets ?? []) {
              previousAssets.set(previous.assetId, previous);
            }
            if (thumbnailTarget.previousAssetId) {
              const previous = previousAssets.get(thumbnailTarget.previousAssetId);
              const cloudAlreadyTracked = Boolean(
                thumbnailTarget.previousCloudPublicId &&
                [...previousAssets.entries()].some(([assetId, candidate]) =>
                  assetId !== thumbnailTarget.previousAssetId &&
                  candidate.cloudPublicId === thumbnailTarget.previousCloudPublicId,
                ),
              );
              previousAssets.set(thumbnailTarget.previousAssetId, {
                ...previous,
                assetId: thumbnailTarget.previousAssetId,
                cloudPublicId:
                  (cloudAlreadyTracked ? undefined : thumbnailTarget.previousCloudPublicId) ||
                  previous?.cloudPublicId,
              });
            }

            const scheduledCloudIds = new Set<string>();
            for (const previous of previousAssets.values()) {
              if (previous.cloudCleanupScheduled || previous.cloudCleanupComplete) {
                if (previous.cloudPublicId) scheduledCloudIds.add(previous.cloudPublicId);
              }
            }
            if (
              thumbnailTarget.previousCloudCleanupScheduled ||
              thumbnailTarget.previousCloudCleanupComplete
            ) {
              if (thumbnailTarget.previousCloudPublicId) {
                scheduledCloudIds.add(thumbnailTarget.previousCloudPublicId);
              }
            }

            for (const previous of previousAssets.values()) {
              if (previous.assetId === job.assetId || previous.localCleanupScheduled) continue;
              const cloudPublicId =
                previous.cloudPublicId && !scheduledCloudIds.has(previous.cloudPublicId)
                  ? previous.cloudPublicId
                  : undefined;
              const staged = await stageThumbnailAssetCleanup({
                assetId: previous.assetId,
                targetMediaId: thumbnailTarget.targetMediaId,
                workspaceId: job.workspaceId,
                cloudPublicId,
                keepCloudCopy: !cloudPublicId,
              });
              if (!staged) {
                throw new Error("A previous thumbnail upload is still being reconciled.");
              }
              if (cloudPublicId) scheduledCloudIds.add(cloudPublicId);
              previous.localCleanupScheduled = true;
              if (cloudPublicId) previous.cloudCleanupScheduled = true;
            }

            if (
              thumbnailTarget.previousCloudPublicId &&
              !scheduledCloudIds.has(thumbnailTarget.previousCloudPublicId)
            ) {
              const staged = await stageThumbnailAssetCleanup({
                assetId: `thumbnail-cloud-cleanup-${encodeURIComponent(thumbnailTarget.previousCloudPublicId)}`,
                targetMediaId: thumbnailTarget.targetMediaId,
                workspaceId: job.workspaceId,
                cloudPublicId: thumbnailTarget.previousCloudPublicId,
              });
              if (!staged) {
                throw new Error("The previous cloud thumbnail cleanup could not be scheduled.");
              }
              scheduledCloudIds.add(thumbnailTarget.previousCloudPublicId);
              thumbnailTarget.previousCloudCleanupScheduled = true;
            }

            const nextTarget = {
              ...thumbnailTarget,
              previousAssets: [...previousAssets.values()],
              ...(thumbnailTarget.previousAssetId &&
                previousAssets.get(thumbnailTarget.previousAssetId)?.localCleanupScheduled
                ? { previousLocalCleanupScheduled: true }
                : {}),
              ...(thumbnailTarget.previousCloudPublicId &&
                scheduledCloudIds.has(thumbnailTarget.previousCloudPublicId)
                ? { previousCloudCleanupScheduled: true }
                : {}),
            };
            if (!(await updateClaimedJob({ localVideoInputThumbnail: nextTarget }))) return;
            Object.assign(thumbnailTarget, nextTarget);
          } catch (error) {
            await updateClaimedJob({
              status: "failed",
              phase: "failed",
              progress: null,
              nextAttemptAt: Date.now() + OUTLINE_RETRY_MS,
              lastError: error instanceof Error
                ? error.message
                : "The previous thumbnail could not be scheduled for cleanup.",
            });
            return;
          }
        } else if (localMedia?.localImage) {
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
                cloudPublicId: cloudMedia.publicId,
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
            if (activeScopeRef.current.db !== db || activeScopeRef.current.churchId !== churchId) return;
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
          lastErrorCode: undefined,
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
      for (let index = 0; index < jobs.length; index += 1) {
        const job = jobs[index];
        if (!job.cleanupOnly || job.cleanupReady) continue;
        const target = job.cleanupTargetMediaId
          ? (store.getState().media.list as MediaType[]).find(
              (item: MediaType) => item.id === job.cleanupTargetMediaId,
            )
          : undefined;
        if (target?.localImage?.id === job.assetId) continue;
        const readyJob = {
          ...job,
          status: "pending",
          phase: "queued",
          cleanupReady: true,
          nextAttemptAt: 0,
          updatedAt: new Date().toISOString(),
        } as LocalImageUploadJob;
        await putLocalImageUploadJob(readyJob);
        jobs[index] = readyJob;
      }
      for (let index = 0; index < jobs.length; index += 1) {
        const job = jobs[index];
        const intent = job.localVideoInputThumbnail;
        if (
          !intent?.mediaReferencePending ||
          job.workspaceId !== churchId ||
          activeScopeRef.current.db !== db ||
          activeScopeRef.current.churchId !== churchId
        ) continue;
        try {
          const authoritative = await loadMediaLibrary(db);
          if (
            activeScopeRef.current.db !== db ||
            activeScopeRef.current.churchId !== churchId
          ) continue;
          const target = authoritative.list.find(
            (item) => item.id === intent.targetMediaId,
          );
          const referenceCommitted = Boolean(
            intent.targetSourceId &&
            target?.localVideoInput?.sourceId === intent.targetSourceId &&
            target.localImage?.id === job.assetId &&
            target.localImage.storagePolicy === "local-and-cloud",
          );
          if (referenceCommitted) {
            const activated = await activateStagedLocalVideoInputThumbnailUploadJobAtomically(
              job.assetId,
              Date.now(),
            );
            if (activated && activated.status !== "staged") {
              jobs[index] = activated;
            }
            continue;
          }

          if (isLocalImageUploadStagingSessionActive(intent.stagingSessionId)) {
            // Another active tab may still be writing this Media row. It can
            // be retired after that session exits and its heartbeat expires.
            continue;
          }

          const assetIsReferenced = authoritative.list.some(
            (item) => item.localImage?.id === job.assetId,
          );
          const discarded = await discardStagedLocalVideoInputThumbnailUploadJobAtomically({
            assetId: job.assetId,
            workspaceId: churchId,
            targetMediaId: intent.targetMediaId,
          });
          if (!discarded) continue;
          if (!assetIsReferenced) {
            if (
              activeScopeRef.current.db !== db ||
              activeScopeRef.current.churchId !== churchId
            ) continue;
            const latest = await loadMediaLibrary(db);
            if (
              activeScopeRef.current.db === db &&
              activeScopeRef.current.churchId === churchId &&
              !latest.list.some((item) => item.localImage?.id === job.assetId)
            ) {
              await deleteLocalImage(job.assetId);
            }
          }
          jobs.splice(index, 1);
          index -= 1;
        } catch (error) {
          // A staged image is never made runnable on an uncertain Media read.
          console.warn("A staged thumbnail upload could not be reconciled:", error);
        }
      }
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
        if (job.localVideoInputThumbnail?.mediaReferencePending) {
          void drainQueue();
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
    if (!db || !churchId || (hasSweptWorkspace.current?.db === db && hasSweptWorkspace.current.workspaceId === churchId)) return;
    let active = true;
    let running = false;
    const tryCleanup = async () => {
      if (hasSweptWorkspace.current?.db === db && hasSweptWorkspace.current.workspaceId === churchId) return true;
      if (running) return false;
      running = true;
      try {
        const result = await cleanupOrphanedLocalImages({ db, workspaceId: churchId });
        if (result === null || !active) return false;
        if (active) hasSweptWorkspace.current = { db, workspaceId: churchId };
        return true;
      } catch (error) {
        console.error("Local image orphan cleanup failed:", error);
        return false;
      } finally {
        running = false;
      }
    };
    void tryCleanup();
    const interval = window.setInterval(() => { void tryCleanup(); }, 30_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [churchId, db]);

  return null;
};

export default LocalImageUploadManager;
