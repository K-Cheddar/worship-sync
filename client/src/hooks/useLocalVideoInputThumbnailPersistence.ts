import { useCallback, useContext, useRef } from "react";
import { ReactReduxContext } from "react-redux";
import { useDispatch } from "./index";
import { ControllerInfoContext } from "../context/controllerInfo";
import { GlobalInfoContext } from "../context/globalInfo";
import type { RootState } from "../store/store";
import {
  removeItemFromMediaList,
  updateMediaItemFields,
} from "../store/mediaSlice";
import type { MediaType } from "../types";
import {
  deleteLocalImage,
  deleteLocalImageUploadJob,
  getLocalImageUploadJob,
  getRememberedLocalImagePolicy,
  putLocalImageUploadJob,
  saveLocalImage,
  stageLocalImageUploadCleanupJobAtomically,
  type LocalImageUploadJob,
  type StoredLocalImage,
} from "../utils/localImageAssets";
import {
  cancelLocalImageUpload,
  enqueueLocalImageUpload,
} from "../utils/localImageUploadQueue";
import { extractPublicId } from "../utils/cloudinaryUtils";
import { flushMediaLibraryDocToPouch } from "../utils/flushMediaLibraryDoc";
import { loadMediaLibrary } from "../utils/mediaDocUtils";
import generateRandomId from "../utils/generateRandomId";
import type { LocalVideoThumbnailFrame } from "../utils/localVideoInputThumbnail";
import { getOrCreateDeviceId } from "../utils/authStorage";
import { getTrustedDeviceLabel } from "../utils/deviceInfo";

const videoInputMutationQueues = new WeakMap<
  object,
  Map<string, Promise<void>>
>();
const EMPTY_MEDIA_STATE: Pick<RootState["media"], "list" | "folders"> = {
  list: [],
  folders: [],
};

const runVideoInputMutation = <T,>(
  db: PouchDB.Database | undefined,
  mediaId: string,
  mutation: () => Promise<T>,
): Promise<T> => {
  if (!db) return mutation();
  const queue = videoInputMutationQueues.get(db) ?? new Map();
  const previous = queue.get(mediaId) ?? Promise.resolve();
  const next = previous.then(mutation, mutation);
  const settled = next.then(() => undefined, () => undefined);
  queue.set(mediaId, settled);
  videoInputMutationQueues.set(db, queue);
  void settled.then(() => {
    if (queue.get(mediaId) !== settled) return;
    queue.delete(mediaId);
    if (queue.size === 0) videoInputMutationQueues.delete(db);
  });
  return next;
};

const createThumbnailCleanupJob = async ({
  assetId,
  mediaId,
  workspaceId,
  cloudPublicId,
}: {
  assetId: string;
  mediaId: string;
  workspaceId: string;
  cloudPublicId?: string;
}) => {
  const previous = await getLocalImageUploadJob(assetId);
  const now = new Date().toISOString();
  const job: LocalImageUploadJob = {
    ...(previous ?? {}),
    id: assetId,
    assetId,
    itemId: "",
    workspaceId,
    uploadPreset: "bpqu4ma5",
    mediaId: previous?.mediaId || generateRandomId(),
    status: "failed",
    phase: "failed",
    progress: null,
    cancelRequested: false,
    attemptCount: 0,
    nextAttemptAt: 0,
    cleanupOnly: true,
    cleanupReady: false,
    cleanupTargetMediaId: mediaId,
    cleanupCloudPublicId: cloudPublicId,
    cleanupCloudComplete: !cloudPublicId,
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
  const staged = await stageLocalImageUploadCleanupJobAtomically(job, Date.now());
  if (!staged) {
    throw new Error("The previous thumbnail upload still needs to finish.");
  }
  return staged;
};

const activateThumbnailCleanupJob = async (job: LocalImageUploadJob) => {
  await putLocalImageUploadJob({
    ...job,
    status: "pending",
    phase: "queued",
    cleanupReady: true,
    nextAttemptAt: 0,
    updatedAt: new Date().toISOString(),
  });
};

/**
 * Local video input stills are Media row fields, so every entry point uses this
 * one persistence and upload/cleanup path.
 */
export const useLocalVideoInputThumbnailPersistence = (
  onStorageUsageChanged?: () => void,
) => {
  const dispatch = useDispatch();
  const reduxStore = useContext(ReactReduxContext)?.store as
    | { getState: () => RootState }
    | undefined;
  const getMediaState = useCallback(
    () => reduxStore?.getState().media ?? EMPTY_MEDIA_STATE,
    [reduxStore],
  );
  const { db, isGuestSession = false } = useContext(ControllerInfoContext) || {};
  const { churchId = "" } = useContext(GlobalInfoContext) || {};
  const activeDbRef = useRef(db);
  activeDbRef.current = db;

  const writeVideoInputPatch = useCallback(
    async (
      mediaId: string,
      expectedSourceId: string,
      patchOrCreate: Partial<MediaType> | ((current: MediaType) => Partial<MediaType>),
      failureMessage = "The video input could not be saved to Media. Try again.",
      allowCreate = false,
    ) => {
      if (!db || activeDbRef.current !== db) {
        throw new Error("Media storage is unavailable. Try again.");
      }
      const currentReduxState = getMediaState();
      const currentRedux = currentReduxState.list.find(
        (item) => item.id === mediaId,
      );
      if (
        !currentRedux?.localVideoInput ||
        currentRedux.localVideoInput.sourceId !== expectedSourceId
      ) {
        throw new Error("This video input is no longer in Media.");
      }
      let beforeState;
      try {
        beforeState = await loadMediaLibrary(db);
      } catch {
        throw new Error(failureMessage);
      }
      const persistedCurrent = beforeState.list.find(
        (item) => item.id === mediaId,
      );
      if (!persistedCurrent && !allowCreate) {
        throw new Error("This video input no longer exists in Media.");
      }
      const current = persistedCurrent ?? currentRedux;
      const patch = typeof patchOrCreate === "function"
        ? patchOrCreate(current)
        : patchOrCreate;
      if (
        persistedCurrent &&
        (!persistedCurrent.localVideoInput ||
          persistedCurrent.localVideoInput.sourceId !== expectedSourceId)
      ) {
        throw new Error("This video input changed. Reopen it and try again.");
      }
      const next = { ...current, ...patch, id: mediaId };
      const list = persistedCurrent
        ? beforeState.list.map((item) => item.id === mediaId ? next : item)
        : [...beforeState.list, next];
      const result = await flushMediaLibraryDocToPouch(
        db,
        list,
        beforeState.folders,
        undefined,
        { list: beforeState.list, folders: beforeState.folders },
        {
          canPersist: () => {
            if (activeDbRef.current !== db) return false;
            const latest = getMediaState().list.find(
              (item) => item.id === mediaId,
            );
            return Boolean(
              latest?.localVideoInput &&
                latest.localVideoInput.sourceId === expectedSourceId,
            );
          },
        },
      );
      if (!result.ok) {
        throw new Error(failureMessage);
      }

      let persisted;
      try {
        persisted = await loadMediaLibrary(db);
      } catch {
        throw new Error(failureMessage);
      }
      const persistedItem = persisted.list.find((item) => item.id === mediaId);
      const patchWasPersisted = persistedItem && Object.entries(patch).every(
        ([key, value]) =>
          JSON.stringify(
            (persistedItem as unknown as Record<string, unknown>)[key],
          ) === JSON.stringify(value),
      );
      if (!patchWasPersisted) {
        throw new Error(failureMessage);
      }

      const latest = getMediaState().list.find(
        (item) => item.id === mediaId,
      );
      if (
        activeDbRef.current === db &&
        latest?.localVideoInput?.sourceId === expectedSourceId &&
        Object.entries(patch).every(([key, value]) => {
          const latestValue = (latest as unknown as Record<string, unknown>)[key];
          const previousValue =
            (currentRedux as unknown as Record<string, unknown>)[key];
          return (
            JSON.stringify(latestValue) === JSON.stringify(previousValue) ||
            JSON.stringify(latestValue) === JSON.stringify(value)
          );
        })
      ) {
        const reduxPatch = { ...patch } as Record<string, unknown>;
        if (allowCreate && persistedCurrent) {
          const latestFields = latest as unknown as Record<string, unknown>;
          const initialFields = currentRedux as unknown as Record<string, unknown>;
          const persistedFields = persistedItem as unknown as Record<string, unknown>;
          for (const key of new Set([
            ...Object.keys(currentRedux),
            ...Object.keys(persistedFields),
          ])) {
            if (key === "id" || Object.hasOwn(patch, key)) continue;
            if (
              JSON.stringify(latestFields[key]) ===
              JSON.stringify(initialFields[key])
            ) {
              reduxPatch[key] = persistedFields[key];
            }
          }
        }
        dispatch(
          updateMediaItemFields({
            id: mediaId,
            patch: reduxPatch as Partial<MediaType>,
          }),
        );
      }
      return { previous: current, next };
    },
    [db, dispatch, getMediaState],
  );

  const persistVideoInputMediaPatch = useCallback(
    (
      mediaId: string,
      sourceId: string,
      patch: Partial<MediaType>,
      allowCreate = false,
    ) => runVideoInputMutation(db, mediaId, async () => {
      await writeVideoInputPatch(
        mediaId,
        sourceId,
        patch,
        undefined,
        allowCreate,
      );
    }),
    [db, writeVideoInputPatch],
  );

  const removeOptimisticVideoInputMediaRow = useCallback(
    (mediaId: string, expectedRow: MediaType) => {
      const current = getMediaState().list.find((item) => item.id === mediaId);
      if (current && JSON.stringify(current) === JSON.stringify(expectedRow)) {
        dispatch(removeItemFromMediaList(mediaId));
      }
    },
    [dispatch, getMediaState],
  );

  const saveVideoInputThumbnail = useCallback(
    (mediaId: string, frame: LocalVideoThumbnailFrame) =>
      runVideoInputMutation(db, mediaId, async () => {
      const current = getMediaState().list.find(
        (item) => item.id === mediaId,
      );
      if (!current?.localVideoInput) {
        throw new Error("This video input is no longer in Media.");
      }
      const expectedSourceId = current.localVideoInput.sourceId;
      const ownerDeviceId = getOrCreateDeviceId();
      const workspaceId = churchId || ownerDeviceId;
      const storagePolicy =
        churchId && !isGuestSession
          ? getRememberedLocalImagePolicy(ownerDeviceId)
          : "local-only";
      const now = new Date().toISOString();
      const assetId = generateRandomId();
      const contentType = frame.blob.type || "image/jpeg";
      const fileName = `${current.name || "Video input"}-thumbnail.${contentType === "image/webp" ? "webp" : "jpg"}`;
      const storedImage: StoredLocalImage = {
        id: assetId,
        workspaceId,
        blob: frame.blob,
        fileName,
        contentType,
        size: frame.blob.size,
        width: frame.width,
        height: frame.height,
        createdAt: now,
      };
      await saveLocalImage(storedImage);

      let previousCloudPublicId: string | undefined;
      let savedRow: { previous: MediaType; next: MediaType };
      const stagedCleanup: Array<{
        job: LocalImageUploadJob;
        previous?: LocalImageUploadJob;
      }> = [];
      let previousUploadJob: LocalImageUploadJob | undefined;
      try {
        if (!db || activeDbRef.current !== db) {
          throw new Error("Media storage is unavailable. Try again.");
        }
        const latestState = await loadMediaLibrary(db);
        const latest = latestState.list.find((item) => item.id === mediaId);
        if (!latest?.localVideoInput) {
          throw new Error("This video input is no longer in Media.");
        }
        if (latest.localVideoInput.sourceId !== expectedSourceId) {
          throw new Error("This video input changed. Reopen it and try again.");
        }
        const expectedPreviousAssetId = latest.localImage?.id;
        if (latest.localImage?.id) {
          previousUploadJob = await getLocalImageUploadJob(latest.localImage.id);
        }
        previousCloudPublicId =
          latest.localImage?.cloudPublicId ||
          (latest.localImage?.cloudUrl
            ? extractPublicId(latest.localImage.cloudUrl)
            : latest.thumbnail
              ? extractPublicId(latest.thumbnail)
              : undefined) ||
          previousUploadJob?.cloudMedia?.publicId;

        if (storagePolicy === "local-only") {
          const hasUnsettledPreviousUpload = Boolean(
            previousUploadJob &&
              previousUploadJob.status !== "complete" &&
              previousUploadJob.status !== "cancelled",
          );
          if (previousCloudPublicId && (!churchId || isGuestSession)) {
            throw new Error("Cloud storage is unavailable. Reconnect and try again.");
          }
          if (hasUnsettledPreviousUpload && previousCloudPublicId) {
            // Keep the upload job intact while its lease or provider checkpoint
            // is live. This separate job retires only the old cloud copy.
            stagedCleanup.push(
              await createThumbnailCleanupJob({
                assetId: `thumbnail-cloud-cleanup-${generateRandomId()}`,
                mediaId,
                workspaceId,
                cloudPublicId: previousCloudPublicId,
              }),
            );
          } else if (
            churchId &&
            !isGuestSession &&
            (latest.localImage?.id || previousCloudPublicId)
          ) {
            stagedCleanup.push(
              await createThumbnailCleanupJob({
                assetId: latest.localImage?.id || `thumbnail-cloud-cleanup-${generateRandomId()}`,
                mediaId,
                workspaceId,
                cloudPublicId: previousCloudPublicId,
              }),
            );
          }
        }

        savedRow = await writeVideoInputPatch(
          mediaId,
          expectedSourceId,
          (latest) => {
            if (latest.localImage?.id !== expectedPreviousAssetId) {
              throw new Error("This thumbnail changed. Reopen it and try again.");
            }
            return {
              updatedAt: now,
              ...(storagePolicy === "local-only" ? { thumbnail: "" } : {}),
              localImage: {
                id: assetId,
                ownerDeviceId,
                ownerLabel: getTrustedDeviceLabel(),
                fileName,
                contentType,
                storagePolicy,
                ...(storagePolicy === "local-and-cloud" && previousCloudPublicId
                  ? { cloudPublicId: previousCloudPublicId }
                  : {}),
              },
            };
          },
          "The thumbnail could not be saved to Media. Try again.",
        );
      } catch (error) {
        await Promise.all(
          stagedCleanup.map(({ job, previous }) =>
            previous
              ? putLocalImageUploadJob(previous)
              : deleteLocalImageUploadJob(job.assetId),
          ),
        );
        await deleteLocalImage(assetId).catch(() => undefined);
        throw error;
      }
      const previous = savedRow.previous;

      if (storagePolicy === "local-and-cloud") {
        try {
          await enqueueLocalImageUpload({
            assetId,
            itemId: "",
            workspaceId,
            uploadPreset: "bpqu4ma5",
            localVideoInputThumbnail: {
              targetMediaId: mediaId,
              ...(previous.localImage?.id
                ? { previousAssetId: previous.localImage.id }
                : {}),
              ...(previousCloudPublicId ? { previousCloudPublicId } : {}),
            },
          });
          onStorageUsageChanged?.();
          return "Thumbnail saved here. Uploading its cloud copy.";
        } catch {
          const latestMedia = getMediaState().list.find(
            (item) => item.id === mediaId,
          );
          if (latestMedia?.localImage?.id === assetId) {
            const localOnly = {
              ...latestMedia.localImage,
              storagePolicy: "local-only" as const,
            };
            await writeVideoInputPatch(mediaId, expectedSourceId, {
              localImage: localOnly,
            }).catch(() => undefined);
          }
          return "Thumbnail saved on this computer. Cloud upload could not be queued.";
        }
      }

      if (storagePolicy === "local-only") {
        for (const { job } of stagedCleanup) {
          await activateThumbnailCleanupJob(job);
        }
        const previousAssetId = previous.localImage?.id;
        const previousJob = previousAssetId
          ? previousUploadJob || await getLocalImageUploadJob(previousAssetId)
          : undefined;
        const previousUploadIsUnsettled = Boolean(
          previousAssetId &&
            previousJob &&
            previousJob.status !== "complete" &&
            previousJob.status !== "cancelled",
        );
        if (previousUploadIsUnsettled && previousAssetId) {
          try {
            await cancelLocalImageUpload(previousAssetId);
          } catch {
            // A missing job means its owner completed cleanup. A retained job
            // still owns provider reconciliation and must not be replaced.
          }
          const settledJob = await getLocalImageUploadJob(previousAssetId);
          const canRetirePreviousUpload =
            !settledJob ||
            settledJob.status === "complete" ||
            settledJob.status === "cancelled";
          if (canRetirePreviousUpload) {
            const cleanupAssets = new Map<string, string | undefined>([
              [
                previousAssetId,
                settledJob?.localVideoInputThumbnail?.staleCloudCleanupComplete
                  ? undefined
                  : settledJob?.cloudMedia?.publicId,
              ],
            ]);
            const replacedAssetId = previousJob?.localVideoInputThumbnail?.previousAssetId;
            if (replacedAssetId && replacedAssetId !== previousAssetId) {
              cleanupAssets.set(replacedAssetId, undefined);
            }
            for (const [assetIdToClean, cloudPublicId] of cleanupAssets) {
              if (churchId && !isGuestSession) {
                const cleanup = await createThumbnailCleanupJob({
                  assetId: assetIdToClean,
                  mediaId,
                  workspaceId,
                  cloudPublicId,
                });
                await activateThumbnailCleanupJob(cleanup.job);
              } else {
                await deleteLocalImage(assetIdToClean);
              }
            }
          }
        } else if ((!churchId || isGuestSession) && previous.localImage?.id) {
          await deleteLocalImage(previous.localImage.id);
        }
        onStorageUsageChanged?.();
        return "Thumbnail saved on this computer.";
      }

      onStorageUsageChanged?.();
      return "Thumbnail saved on this computer.";
    }),
    [db, churchId, isGuestSession, getMediaState, onStorageUsageChanged, writeVideoInputPatch],
  );

  const removeVideoInputThumbnail = useCallback(
    (mediaId: string) => runVideoInputMutation(db, mediaId, async () => {
      const current = getMediaState().list.find(
        (item) => item.id === mediaId,
      );
      if (!current?.localVideoInput) {
        throw new Error("This video input is no longer in Media.");
      }
      const expectedSourceId = current.localVideoInput.sourceId;
      if (!current.localImage) {
        if (current.thumbnail) {
          await writeVideoInputPatch(mediaId, expectedSourceId, {
            thumbnail: "",
            updatedAt: new Date().toISOString(),
          }, "The thumbnail could not be removed from Media. Try again.");
        }
        return;
      }

      const pendingJob = await getLocalImageUploadJob(current.localImage.id);
      if (
        pendingJob &&
        pendingJob.status !== "complete" &&
        pendingJob.status !== "cancelled" &&
        !pendingJob.cleanupOnly
      ) {
        await cancelLocalImageUpload(current.localImage.id);
      }
      const latest = getMediaState().list.find(
        (item) => item.id === mediaId,
      );
      if (!latest?.localImage) return;
      const latestJob = await getLocalImageUploadJob(latest.localImage.id);
      const workspaceId = churchId || getOrCreateDeviceId();
      const cleanupAssets = new Map<
        string,
        { cloudPublicId?: string; workspaceId: string }
      >();
      const addCleanup = (assetId?: string, cloudPublicId?: string) => {
        if (!assetId) return;
        const previous = cleanupAssets.get(assetId);
        cleanupAssets.set(assetId, {
          workspaceId,
          cloudPublicId: cloudPublicId || previous?.cloudPublicId,
        });
      };
      const currentCloudPublicId =
        latest.localImage.cloudPublicId ||
        (latest.localImage.cloudUrl
          ? extractPublicId(latest.localImage.cloudUrl)
          : latest.thumbnail
            ? extractPublicId(latest.thumbnail)
            : undefined) ||
        latestJob?.cloudMedia?.publicId;
      addCleanup(latest.localImage.id, currentCloudPublicId);
      addCleanup(
        latestJob?.localVideoInputThumbnail?.previousAssetId,
        latestJob?.localVideoInputThumbnail?.previousCloudPublicId,
      );
      const cloudCleanupIds = [...cleanupAssets.values()].flatMap((asset) =>
        asset.cloudPublicId ? [asset.cloudPublicId] : [],
      );
      if (cloudCleanupIds.length > 0 && (!churchId || isGuestSession)) {
        throw new Error("Cloud storage is unavailable. Reconnect and try again.");
      }

      const staged: Array<{
        job: LocalImageUploadJob;
        previous?: LocalImageUploadJob;
      }> = [];
      try {
        for (const [assetId, cleanup] of cleanupAssets) {
          staged.push(
            await createThumbnailCleanupJob({
              assetId,
              mediaId: latest.id,
              workspaceId: cleanup.workspaceId,
              cloudPublicId: cleanup.cloudPublicId,
            }),
          );
        }
        await writeVideoInputPatch(mediaId, expectedSourceId, {
          localImage: undefined,
          thumbnail: "",
          updatedAt: new Date().toISOString(),
        }, "The thumbnail could not be removed from Media. Try again.");
      } catch (error) {
        await Promise.all(
          staged.map(({ job, previous }) =>
            previous
              ? putLocalImageUploadJob(previous)
              : deleteLocalImageUploadJob(job.assetId),
          ),
        );
        throw error;
      }

      for (const { job } of staged) {
        await activateThumbnailCleanupJob(job);
      }
      if (staged.length === 0) {
        await deleteLocalImage(latest.localImage.id);
      }
      onStorageUsageChanged?.();
    }),
    [db, churchId, isGuestSession, getMediaState, onStorageUsageChanged, writeVideoInputPatch],
  );

  return {
    persistVideoInputMediaPatch,
    removeOptimisticVideoInputMediaRow,
    saveVideoInputThumbnail,
    removeVideoInputThumbnail,
  };
};
