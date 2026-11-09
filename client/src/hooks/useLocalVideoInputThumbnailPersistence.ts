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
  activateStagedLocalImageUploadCleanupJobAtomically,
  saveLocalImage,
  restoreCommittedLocalVideoThumbnailUploadJobAtomically,
  stageLocalImageUploadCleanupJobAtomically,
  restoreStagedLocalImageUploadCleanupJob,
  type LocalImageUploadJob,
  type StoredLocalImage,
} from "../utils/localImageAssets";
import {
  cancelLocalImageUpload,
  stageLocalVideoInputThumbnailUpload,
  renewStagedLocalVideoThumbnailReference,
  confirmStagedLocalVideoThumbnailReference,
  releaseStagedLocalVideoThumbnailReference,
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

export class VideoInputMediaWriteOutcomeUnknownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoInputMediaWriteOutcomeUnknownError";
  }
}

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
  if (
    previous?.cleanupOnly &&
    previous.cleanupReady === false &&
    previous.cleanupTargetMediaId === mediaId &&
    previous.cleanupCloudPublicId === cloudPublicId
  ) {
    return { job: previous };
  }
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
  await activateStagedLocalImageUploadCleanupJobAtomically(job, Date.now());
};

const reconcileStagedThumbnailRemoval = async (
  db: PouchDB.Database | undefined,
  staged: Array<{ job: LocalImageUploadJob; previous?: LocalImageUploadJob }>,
  mediaId: string,
  expectedSourceId: string,
  expectedAssetId?: string,
  expectedThumbnail?: string,
) => {
  if (staged.length === 0 || !db) return;
  let authoritative: Awaited<ReturnType<typeof loadMediaLibrary>>;
  try {
    authoritative = await loadMediaLibrary(db);
  } catch {
    // Keep cleanupReady=false so the upload manager can reconcile after restart.
    return;
  }
  const target = authoritative.list.find((item) => item.id === mediaId);
  const stillReferencesOriginal = target?.localVideoInput?.sourceId === expectedSourceId &&
    (expectedAssetId
      ? target.localImage?.id === expectedAssetId
      : target.thumbnail === expectedThumbnail);
  if (stillReferencesOriginal) {
    await Promise.all(staged.map(({ job, previous }) =>
      restoreStagedLocalImageUploadCleanupJob(job, previous),
    ));
    return;
  }
  await Promise.all(staged.map(({ job }) =>
    activateThumbnailCleanupJob(job).catch(() => undefined),
  ));
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
  const activeScopeRef = useRef({ db, churchId });
  activeScopeRef.current = { db, churchId };

  const writeVideoInputPatch = useCallback(
    async (
      mediaId: string,
      expectedSourceId: string,
      patchOrCreate: Partial<MediaType> | ((current: MediaType) => Partial<MediaType>),
      failureMessage = "The video input could not be saved to Media. Try again.",
      allowCreate = false,
      verifyPersisted?: (item: MediaType) => boolean,
      canUpdatePersistedRow?: (item: MediaType) => boolean | Promise<boolean>,
    ) => {
      const isActiveScope = () =>
        activeScopeRef.current.db === db &&
        activeScopeRef.current.churchId === churchId;
      if (!db) {
        throw new Error("Media storage is unavailable. Try again.");
      }
      const currentReduxState = getMediaState();
      const currentRedux = currentReduxState.list.find(
        (item) => item.id === mediaId,
      );
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
      if (
        persistedCurrent &&
        (!persistedCurrent.localVideoInput ||
          persistedCurrent.localVideoInput.sourceId !== expectedSourceId)
      ) {
        throw new Error("This video input changed. Reopen it and try again.");
      }
      const current = persistedCurrent ?? currentRedux;
      if (
        !current?.localVideoInput ||
        current.localVideoInput.sourceId !== expectedSourceId
      ) {
        throw new Error("This video input is no longer in Media.");
      }
      const patch = typeof patchOrCreate === "function"
        ? patchOrCreate(current)
        : patchOrCreate;
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
          allowOriginalOwnerPersistenceAfterScopeChange: true,
          canPersist: () => true,
          publishIfCurrent: isActiveScope,
          canUpdateMediaItem: async (id, item) => {
            if (id !== mediaId) return true;
            if (!item) {
              return allowCreate &&
                (await canUpdatePersistedRow?.(current) ?? true);
            }
            return Boolean(
              item.localVideoInput?.sourceId === expectedSourceId &&
                (await canUpdatePersistedRow?.(item) ?? true),
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
        throw new VideoInputMediaWriteOutcomeUnknownError(failureMessage);
      }
      const persistedItem = persisted.list.find((item) => item.id === mediaId);
      const patchWasPersisted = persistedItem && (verifyPersisted
        ? verifyPersisted(persistedItem)
        : Object.entries(patch).every(
            ([key, value]) =>
              JSON.stringify(
                (persistedItem as unknown as Record<string, unknown>)[key],
              ) === JSON.stringify(value),
          ));
      if (!patchWasPersisted) {
        throw new Error(failureMessage);
      }

      const latest = getMediaState().list.find(
        (item) => item.id === mediaId,
      );
      if (
        isActiveScope() &&
        latest?.localVideoInput?.sourceId === expectedSourceId
      ) {
        const reduxPatch = { ...patch } as Record<string, unknown>;
        const latestFields = latest as unknown as Record<string, unknown>;
        const initialFields = (currentRedux ?? current) as unknown as Record<string, unknown>;
        const persistedFields = persistedItem as unknown as Record<string, unknown>;
        for (const key of Object.keys(reduxPatch)) {
          if (
            JSON.stringify(latestFields[key]) !== JSON.stringify(initialFields[key]) &&
            JSON.stringify(latestFields[key]) !== JSON.stringify(reduxPatch[key])
          ) {
            delete reduxPatch[key];
            continue;
          }
          // PouchDB may have kept a concurrent field edit while committing
          // this patch's other fields. Keep Redux aligned with that row.
          reduxPatch[key] = persistedFields[key];
        }
        if (allowCreate && persistedCurrent) {
          for (const key of new Set([
          ...Object.keys(currentRedux ?? current),
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
        if (Object.keys(reduxPatch).length > 0) {
          dispatch(
            updateMediaItemFields({
              id: mediaId,
              patch: reduxPatch as Partial<MediaType>,
            }),
          );
        }
      }
      return { previous: current, next };
    },
    [db, churchId, dispatch, getMediaState],
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
    (
      mediaId: string,
      frame: LocalVideoThumbnailFrame,
      options: {
        mediaPatch?: Partial<MediaType>;
        allowCreate?: boolean;
      } = {},
    ) => {
      const requestedCurrent = getMediaState().list.find((item) => item.id === mediaId);
      return runVideoInputMutation(db, mediaId, async () => {
      const { mediaPatch = {}, allowCreate = false } = options;
      const current = requestedCurrent;
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
      const contentType = frame.blob.type;
      if (contentType !== "image/webp" && contentType !== "image/jpeg") {
        throw new Error("The thumbnail format is unsupported. Capture the frame again.");
      }
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
      let latestBeforeWrite: MediaType | undefined;
      const stagedCleanup: Array<{
        job: LocalImageUploadJob;
        previous?: LocalImageUploadJob;
      }> = [];
      let previousUploadJob: LocalImageUploadJob | undefined;
      let previousThumbnailAssets: Array<{
        assetId: string;
        cloudPublicId?: string;
      }> = [];
      let stagedUpload: { job: LocalImageUploadJob; ownerId: string } | undefined;
      let referenceLeaseHeartbeat: number | undefined;
      let stagedReferenceOwnershipLost = false;
      try {
        if (!db || activeScopeRef.current.db !== db || activeScopeRef.current.churchId !== churchId) {
          throw new Error("Media storage is unavailable. Try again.");
        }
        const latestState = await loadMediaLibrary(db);
        const persistedLatest = latestState.list.find((item) => item.id === mediaId);
        const latest = persistedLatest ?? (allowCreate ? current : undefined);
        if (!latest?.localVideoInput) {
          throw new Error("This video input is no longer in Media.");
        }
        if (latest.localVideoInput.sourceId !== expectedSourceId) {
          throw new Error("This video input changed. Reopen it and try again.");
        }
        if (latest.localImage?.id !== current.localImage?.id) {
          throw new Error("This thumbnail changed. Reopen it and try again.");
        }
        latestBeforeWrite = latest;
        const expectedPreviousAssetId = latest.localImage?.id;
        if (latest.localImage?.id) {
          previousUploadJob = await getLocalImageUploadJob(latest.localImage.id);
        }
        const previousAssetsById = new Map<string, { assetId: string; cloudPublicId?: string }>();
        const rememberPreviousAsset = (previousAssetId?: string, cloudPublicId?: string) => {
          if (!previousAssetId || previousAssetId === assetId) return;
          const existing = previousAssetsById.get(previousAssetId);
          previousAssetsById.set(previousAssetId, {
            assetId: previousAssetId,
            cloudPublicId: cloudPublicId || existing?.cloudPublicId,
          });
        };
        rememberPreviousAsset(latest.localImage?.id);
        const visitedPreviousAssets = new Set([assetId, latest.localImage?.id].filter(Boolean) as string[]);
        let oldThumbnailJob = previousUploadJob?.localVideoInputThumbnail;
        while (oldThumbnailJob) {
          for (const previousAsset of oldThumbnailJob.previousAssets ?? []) {
            rememberPreviousAsset(previousAsset.assetId, previousAsset.cloudPublicId);
          }
          const previousAssetId = oldThumbnailJob.previousAssetId;
          if (!previousAssetId || visitedPreviousAssets.has(previousAssetId)) break;
          visitedPreviousAssets.add(previousAssetId);
          rememberPreviousAsset(previousAssetId, oldThumbnailJob.previousCloudPublicId);
          oldThumbnailJob = (await getLocalImageUploadJob(previousAssetId))
            ?.localVideoInputThumbnail;
        }
        previousThumbnailAssets = [...previousAssetsById.values()];
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
          } else if (!hasUnsettledPreviousUpload && churchId && !isGuestSession) {
            const cleanupAssets = new Map<string, string | undefined>(
              previousThumbnailAssets.map(({ assetId: oldAssetId, cloudPublicId }) => [
                oldAssetId,
                cloudPublicId,
              ]),
            );
            if (
              previousCloudPublicId &&
              ![...cleanupAssets.values()].includes(previousCloudPublicId)
            ) {
              cleanupAssets.set(
                `thumbnail-cloud-cleanup-${generateRandomId()}`,
                previousCloudPublicId,
              );
            }
            for (const [oldAssetId, cloudPublicId] of cleanupAssets) {
              stagedCleanup.push(
                await createThumbnailCleanupJob({
                  assetId: oldAssetId,
                  mediaId,
                  workspaceId,
                  cloudPublicId,
                }),
              );
            }
          }
        }

        if (storagePolicy === "local-and-cloud") {
          stagedUpload = await stageLocalVideoInputThumbnailUpload({
            assetId,
            workspaceId,
            uploadPreset: "bpqu4ma5",
            mediaId: generateRandomId(),
            localVideoInputThumbnail: {
              targetMediaId: mediaId,
              targetSourceId: expectedSourceId,
              ...(latest.localImage?.id
                ? { previousAssetId: latest.localImage.id }
                : {}),
              ...(previousCloudPublicId ? { previousCloudPublicId } : {}),
              ...(previousThumbnailAssets.length > 0
                ? { previousAssets: previousThumbnailAssets }
                : {}),
            },
          });
          if (
            !stagedUpload ||
            stagedUpload.job.thumbnailReferenceState !== "staged" ||
            stagedUpload.job.thumbnailReferenceOwnerId !== stagedUpload.ownerId
          ) {
            stagedReferenceOwnershipLost = Boolean(stagedUpload);
            throw new Error("The cloud thumbnail upload is already being recovered. Try again shortly.");
          }
          referenceLeaseHeartbeat = window.setInterval(() => {
            void renewStagedLocalVideoThumbnailReference(
              assetId,
              stagedUpload!.ownerId,
            ).catch((error) =>
              console.warn("The thumbnail reference lease could not be renewed:", error),
            );
          }, 30_000);
        }

        if (stagedUpload) {
          const renewedStage = await renewStagedLocalVideoThumbnailReference(
            assetId,
            stagedUpload.ownerId,
          );
          if (
            renewedStage?.thumbnailReferenceState !== "staged" ||
            renewedStage.thumbnailReferenceOwnerId !== stagedUpload.ownerId
          ) {
            stagedReferenceOwnershipLost = true;
            throw new Error("The cloud thumbnail upload is already being recovered. Try again shortly.");
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
              ...mediaPatch,
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
          allowCreate,
          (persistedItem) =>
            persistedItem.localVideoInput?.sourceId === expectedSourceId &&
            persistedItem.localImage?.id === assetId,
          async (persistedItem) => {
            if (persistedItem.localImage?.id !== expectedPreviousAssetId) return false;
            if (!stagedUpload) return true;
            const renewedStage = await renewStagedLocalVideoThumbnailReference(
              assetId,
              stagedUpload.ownerId,
            );
            const stillOwnsReference =
              renewedStage?.thumbnailReferenceState === "staged" &&
              renewedStage.thumbnailReferenceOwnerId === stagedUpload.ownerId;
            if (!stillOwnsReference) stagedReferenceOwnershipLost = true;
            return stillOwnsReference;
          },
        );
      } catch (error) {
        let authoritativeReadSucceeded = false;
        let persistedTarget: MediaType | undefined;
        let assetIsReferenced = false;
        try {
          const authoritative = await loadMediaLibrary(db!);
          authoritativeReadSucceeded = true;
          persistedTarget = authoritative.list.find((item) => item.id === mediaId);
          assetIsReferenced = authoritative.list.some(
            (item) => item.localImage?.id === assetId,
          );
        } catch {
          // The write outcome is unknown. Preserve the blob until a later
          // authoritative read can prove that no Media row references it.
        }
        if (
          persistedTarget?.localVideoInput?.sourceId === expectedSourceId &&
          persistedTarget.localImage?.id === assetId
        ) {
          // A concurrent edit may have won an unrelated field, or the
          // verification read may have failed after PouchDB committed. The
          // new asset is adopted, so continue the upload/cleanup lifecycle.
          savedRow = {
            previous: latestBeforeWrite ?? current,
            next: persistedTarget,
          };
          const confirmedPatch = Object.fromEntries(
            Object.entries(mediaPatch).filter(([key, value]) =>
              JSON.stringify(
                (persistedTarget as unknown as Record<string, unknown>)[key],
              ) === JSON.stringify(value),
            ),
          ) as Partial<MediaType>;
          confirmedPatch.localImage = persistedTarget.localImage;
          if (storagePolicy === "local-only") {
            confirmedPatch.thumbnail = persistedTarget.thumbnail;
          }
          await writeVideoInputPatch(
            mediaId,
            expectedSourceId,
            confirmedPatch,
            "The thumbnail could not be saved to Media. Try again.",
            false,
            (item) =>
              item.localVideoInput?.sourceId === expectedSourceId &&
              item.localImage?.id === assetId,
          ).catch(() => undefined);
        } else {
          if (authoritativeReadSucceeded) {
            const stillReferencesPrevious =
              persistedTarget?.localVideoInput?.sourceId === expectedSourceId &&
              persistedTarget.localImage?.id === current.localImage?.id;
            if (stillReferencesPrevious) {
              await Promise.all(stagedCleanup.map(({ job, previous }) =>
                restoreStagedLocalImageUploadCleanupJob(job, previous),
              ));
            } else {
              await Promise.all(stagedCleanup.map(({ job }) =>
                activateThumbnailCleanupJob(job).catch(() => undefined),
              ));
            }
          }
          if (stagedUpload) {
            if (
              authoritativeReadSucceeded &&
              !assetIsReferenced &&
              !stagedReferenceOwnershipLost
            ) {
              await deleteLocalImageUploadJob(assetId).catch(() => undefined);
            } else {
              await releaseStagedLocalVideoThumbnailReference(
                assetId,
                stagedUpload.ownerId,
              ).catch(() => undefined);
            }
          }
          if (
            authoritativeReadSucceeded &&
            !assetIsReferenced &&
            !stagedReferenceOwnershipLost
          ) {
            await deleteLocalImage(assetId).catch(() => undefined);
          }
          const initialRowMayBeCommitted =
            allowCreate &&
            (persistedTarget?.localVideoInput?.sourceId === expectedSourceId ||
              (!authoritativeReadSucceeded &&
                error instanceof VideoInputMediaWriteOutcomeUnknownError));
          if (initialRowMayBeCommitted) {
            throw new VideoInputMediaWriteOutcomeUnknownError(
              error instanceof Error
                ? error.message
                : "The thumbnail could not be saved to Media. Try again.",
            );
          }
          if (
            allowCreate &&
            authoritativeReadSucceeded &&
            error instanceof VideoInputMediaWriteOutcomeUnknownError
          ) {
            // The recovery read proved that this initial row was not committed;
            // callers can safely remove their optimistic copy.
            throw new Error(error.message);
          }
          throw error;
        }
      } finally {
        if (referenceLeaseHeartbeat !== undefined) {
          window.clearInterval(referenceLeaseHeartbeat);
        }
      }
      const previous = savedRow.previous;

      if (storagePolicy === "local-and-cloud") {
        try {
          if (!stagedUpload) {
            throw new Error("The cloud thumbnail upload intent was not saved.");
          }
          let activatedUpload = await confirmStagedLocalVideoThumbnailReference(
            assetId,
            stagedUpload.ownerId,
          );
          if (activatedUpload?.thumbnailReferenceState !== "confirmed") {
            const authoritative = await loadMediaLibrary(db!);
            const committedTarget = authoritative.list.find(
              (item) => item.id === mediaId,
            );
            if (
              committedTarget?.localVideoInput?.sourceId === expectedSourceId &&
              committedTarget.localImage?.id === assetId &&
              committedTarget.localImage.storagePolicy === "local-and-cloud"
            ) {
              // The recovery tab may have deleted the staged job and bytes
              // after its last Media read but before this write committed.
              await saveLocalImage(storedImage);
              activatedUpload = await restoreCommittedLocalVideoThumbnailUploadJobAtomically(
                stagedUpload.job,
                Date.now(),
              );
            }
          }
          onStorageUsageChanged?.();
          return activatedUpload?.thumbnailReferenceState === "confirmed"
            ? "Thumbnail saved here. Uploading its cloud copy."
            : "Thumbnail saved here. Its cloud upload will resume automatically.";
        } catch {
          await releaseStagedLocalVideoThumbnailReference(
            assetId,
            stagedUpload?.ownerId ?? "",
          ).catch(() => undefined);
          onStorageUsageChanged?.();
          return "Thumbnail saved here. Its cloud upload will resume automatically.";
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
            const cleanupAssets = new Map<string, string | undefined>(
              previousThumbnailAssets.map((asset) => [
                asset.assetId,
                asset.cloudPublicId,
              ]),
            );
            if (
              !settledJob?.localVideoInputThumbnail?.staleCloudCleanupComplete &&
              settledJob?.cloudMedia?.publicId
            ) {
              cleanupAssets.set(
                previousAssetId,
                settledJob.cloudMedia.publicId,
              );
            }
            const scheduledCloudIds = new Set(
              stagedCleanup.flatMap(({ job }) =>
                job.cleanupCloudPublicId ? [job.cleanupCloudPublicId] : [],
              ),
            );
            for (const [assetIdToClean, cloudPublicId] of cleanupAssets) {
              if (churchId && !isGuestSession) {
                const cleanup = await createThumbnailCleanupJob({
                  assetId: assetIdToClean,
                  mediaId,
                  workspaceId,
                  cloudPublicId:
                    cloudPublicId && !scheduledCloudIds.has(cloudPublicId)
                      ? cloudPublicId
                      : undefined,
                });
                await activateThumbnailCleanupJob(cleanup.job);
                if (cloudPublicId) scheduledCloudIds.add(cloudPublicId);
              } else {
                const latestState = db ? await loadMediaLibrary(db) : undefined;
                const isStillReferenced = latestState?.list.some(
                  (row) => row.localImage?.id === assetIdToClean,
                );
                if (!isStillReferenced) await deleteLocalImage(assetIdToClean);
              }
            }
          }
        } else if (!churchId || isGuestSession) {
          for (const { assetId: assetIdToClean } of previousThumbnailAssets) {
            const latestState = db ? await loadMediaLibrary(db) : undefined;
            const isStillReferenced = latestState?.list.some(
              (row) => row.localImage?.id === assetIdToClean,
            );
            if (!isStillReferenced) await deleteLocalImage(assetIdToClean);
          }
        }
        onStorageUsageChanged?.();
        return "Thumbnail saved on this computer.";
      }

      onStorageUsageChanged?.();
      return "Thumbnail saved on this computer.";
      });
    },
    [db, churchId, isGuestSession, getMediaState, onStorageUsageChanged, writeVideoInputPatch],
  );

  const removeVideoInputThumbnail = useCallback(
    (mediaId: string) => {
      const current = getMediaState().list.find((item) => item.id === mediaId);
      return runVideoInputMutation(db, mediaId, async () => {
      if (!current?.localVideoInput) {
        throw new Error("This video input is no longer in Media.");
      }
      const expectedSourceId = current.localVideoInput.sourceId;
      const expectedAssetId = current.localImage?.id;
      if (!current.localImage) {
        const expectedThumbnail = current.thumbnail;
        const cloudPublicId = current.thumbnail
          ? extractPublicId(current.thumbnail)
          : undefined;
        if (cloudPublicId && (!churchId || isGuestSession)) {
          throw new Error("Cloud storage is unavailable. Reconnect and try again.");
        }
        const staged = cloudPublicId
          ? await createThumbnailCleanupJob({
              assetId: `thumbnail-cloud-cleanup-${generateRandomId()}`,
              mediaId,
              workspaceId: churchId || getOrCreateDeviceId(),
              cloudPublicId,
            })
          : undefined;
        if (current.thumbnail) {
          try {
            await writeVideoInputPatch(
              mediaId,
              expectedSourceId,
              (latest) => {
                if (latest.thumbnail !== expectedThumbnail) {
                  throw new Error("This thumbnail changed. Reopen it and try again.");
                }
                return {
                  thumbnail: "",
                  updatedAt: new Date().toISOString(),
                };
              },
              "The thumbnail could not be removed from Media. Try again.",
              false,
              (persistedItem) =>
                persistedItem.localVideoInput?.sourceId === expectedSourceId &&
                persistedItem.thumbnail === "",
              (persistedItem) => persistedItem.thumbnail === expectedThumbnail,
            );
          } catch (error) {
            if (staged) await reconcileStagedThumbnailRemoval(
              db,
              [staged],
              mediaId,
              expectedSourceId,
              undefined,
              expectedThumbnail,
            );
            throw error;
          }
        }
        if (staged) await activateThumbnailCleanupJob(staged.job);
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
      const latestState = db ? await loadMediaLibrary(db) : undefined;
      const latest = latestState?.list.find((item) => item.id === mediaId);
      if (!latest?.localImage) return;
      if (latest.localImage.id !== expectedAssetId) {
        throw new Error("This thumbnail changed. Reopen it and try again.");
      }
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
      const visitedAssets = new Set([latest.localImage.id]);
      let previousAssetId = latestJob?.localVideoInputThumbnail?.previousAssetId;
      while (previousAssetId && !visitedAssets.has(previousAssetId)) {
        visitedAssets.add(previousAssetId);
        const previousJob = await getLocalImageUploadJob(previousAssetId);
        const predecessor = previousJob?.localVideoInputThumbnail;
        for (const previousAsset of predecessor?.previousAssets ?? []) {
          addCleanup(previousAsset.assetId, previousAsset.cloudPublicId);
        }
        addCleanup(
          predecessor?.previousAssetId,
          predecessor?.previousCloudPublicId,
        );
        previousAssetId = predecessor?.previousAssetId;
      }
      const cloudCleanupIds = [...cleanupAssets.values()].flatMap((asset) =>
        asset.cloudPublicId ? [asset.cloudPublicId] : [],
      );
      if (cloudCleanupIds.length > 0 && (!churchId || isGuestSession)) {
        throw new Error("Cloud storage is unavailable. Reconnect and try again.");
      }

      for (const assetId of cleanupAssets.keys()) {
        let uploadJob = await getLocalImageUploadJob(assetId);
        if (
          uploadJob &&
          uploadJob.status !== "complete" &&
          uploadJob.status !== "cancelled" &&
          !uploadJob.cleanupOnly
        ) {
          await cancelLocalImageUpload(assetId);
          uploadJob = await getLocalImageUploadJob(assetId);
          if (
            uploadJob &&
            uploadJob.status !== "complete" &&
            uploadJob.status !== "cancelled" &&
            !uploadJob.cleanupOnly
          ) {
            throw new Error("The previous thumbnail upload is still finishing. Try again shortly.");
          }
        }
      }

      const staged: Array<{
        job: LocalImageUploadJob;
        previous?: LocalImageUploadJob;
      }> = [];
      try {
        if (churchId && !isGuestSession) {
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
        }
        await writeVideoInputPatch(
          mediaId,
          expectedSourceId,
          (persistedLatest) => {
            if (persistedLatest.localImage?.id !== expectedAssetId) {
              throw new Error("This thumbnail changed. Reopen it and try again.");
            }
            return {
              localImage: undefined,
              thumbnail: "",
              updatedAt: new Date().toISOString(),
            };
          },
          "The thumbnail could not be removed from Media. Try again.",
          false,
          (item) => item.localVideoInput?.sourceId === expectedSourceId &&
            !item.localImage && !item.thumbnail,
          (item) => item.localImage?.id === expectedAssetId,
        );
      } catch (error) {
        await reconcileStagedThumbnailRemoval(
          db,
          staged,
          mediaId,
          expectedSourceId,
          expectedAssetId,
          current.thumbnail,
        );
        throw error;
      }

      if (churchId && !isGuestSession) {
        for (const { job } of staged) {
          await activateThumbnailCleanupJob(job);
        }
      } else {
        const persisted = db ? await loadMediaLibrary(db) : undefined;
        for (const assetId of cleanupAssets.keys()) {
          const stillReferenced = persisted?.list.some(
            (row) => row.localImage?.id === assetId,
          );
          if (!stillReferenced) await deleteLocalImage(assetId);
        }
      }
      onStorageUsageChanged?.();
      });
    },
    [db, churchId, isGuestSession, getMediaState, onStorageUsageChanged, writeVideoInputPatch],
  );

  return {
    persistVideoInputMediaPatch,
    removeOptimisticVideoInputMediaRow,
    saveVideoInputThumbnail,
    removeVideoInputThumbnail,
  };
};
