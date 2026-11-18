import type { LinkedVideoReplacementSnapshot, MediaType } from "../../types";
import type { ElectronLocalAsset } from "../../types/electron";
import {
  loadMediaLibrary,
  readMediaItemForDeletion,
  updateMediaItem,
} from "../../utils/mediaDocUtils";
import {
  buildLocalVideoFileUrl,
  deleteLocalVideoFile,
  getLocalVideoFile,
  saveLocalVideoFile,
} from "../../utils/localVideoFileAssets";
import {
  removeDownloadedVideoAssetIfUnreferenced,
  removeDownloadedVideoMuxAssetIfUnreferenced,
} from "../../components/DesktopVideoDownloadManager/persistDownloadedVideoMedia";
import type {
  DesktopVideoDownloadDependencies,
  DesktopVideoDownloadOwner,
} from "../../components/DesktopVideoDownloadManager/desktopVideoDownloadController";
import { claimMediaUpload } from "../../utils/mediaOperationClaims";
import { registerLocalAssetCleanupRetry } from "../../utils/mediaCleanupActivity";
import { updateMediaItemFields } from "../../store/mediaSlice";
import type { AppDispatch } from "../../store/store";

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const replacementKeys = [
  "width",
  "height",
  "duration",
  "format",
  "background",
  "thumbnail",
  "placeholderImage",
  "muxAssetId",
  "muxPlaybackId",
  "providerStorage",
  "localVideoFile",
  "updatedAt",
] as const;
const replacementSnapshot = (
  item: LinkedVideoReplacementSnapshot,
): LinkedVideoReplacementSnapshot =>
  Object.fromEntries(
    replacementKeys.map((key) => [key, item[key]]),
  ) as LinkedVideoReplacementSnapshot;

/** Commit only replacement-owned fields against the latest document revision. */
export const persistLinkedVideoReplacement = async ({
  original,
  linked,
  candidateAssetId,
  previousContentHash,
  owner,
  isOwnerCurrent,
}: {
  original: MediaType;
  linked: MediaType;
  candidateAssetId: string;
  previousContentHash?: string;
  owner: DesktopVideoDownloadOwner;
  isOwnerCurrent: () => boolean;
}) => {
  const db = owner.dbAtStart as PouchDB.Database | undefined;
  if (!db || !isOwnerCurrent())
    throw new Error(
      "The active church changed before the video could be saved.",
    );
  const reference = original.localVideoFile!;
  const originalHash = previousContentHash ?? reference.contentHash;
  const changed =
    !originalHash || originalHash !== linked.localVideoFile?.contentHash;
  const muxAssetIds = changed
    ? [
        ...new Set(
          [
            original.muxAssetId,
            original.providerStorage?.provider === "mux"
              ? original.providerStorage.assetId
              : undefined,
            reference.cloudMediaId,
          ].filter((id): id is string => Boolean(id)),
        ),
      ]
    : [];
  const patch: Partial<MediaType> = {
    width: linked.width,
    height: linked.height,
    duration: linked.duration,
    format: linked.format,
    background: buildLocalVideoFileUrl(reference.id),
    updatedAt: new Date().toISOString(),
    localVideoFile: {
      ...reference,
      ...linked.localVideoFile,
      id: reference.id,
      audioEnabled: reference.audioEnabled,
      storagePolicy: changed ? "local-only" : reference.storagePolicy,
      cloudUrl: changed ? undefined : reference.cloudUrl,
      cloudMediaId: changed ? undefined : reference.cloudMediaId,
      preferCloudPlayback: changed ? undefined : reference.preferCloudPlayback,
    },
    ...(changed
      ? {
          thumbnail: "",
          placeholderImage: "",
          muxPlaybackId: undefined,
          muxAssetId: undefined,
          providerStorage: undefined,
        }
      : {}),
  };
  await updateMediaItem(
    db,
    original.id,
    (current) => {
      if (
        !current ||
        !same(
          { ...current.localVideoFile, audioEnabled: reference.audioEnabled },
          reference,
        ) ||
        !same(current.providerStorage, original.providerStorage) ||
        current.muxAssetId !== original.muxAssetId ||
        current.muxPlaybackId !== original.muxPlaybackId
      ) {
        throw new Error(
          "This video changed while the replacement was being checked. Try relinking again.",
        );
      }
      patch.localVideoFile = {
        ...patch.localVideoFile!,
        audioEnabled: current.localVideoFile?.audioEnabled,
      };
      return {
        ...patch,
        pendingLinkedVideoCleanup: [
          ...(current.pendingLinkedVideoCleanup ?? []),
          {
            localAssetId: candidateAssetId,
            muxAssetIds,
            linkedAssetId: reference.id,
            contentHash: linked.localVideoFile!.contentHash!,
            previousContentHash: reference.contentHash,
            nativePreviousContentHash: originalHash,
            contentChanged: changed,
            previousFields: replacementSnapshot(current),
            proposedFields: replacementSnapshot({ ...current, ...patch }),
          },
        ],
      };
    },
    isOwnerCurrent,
  );
  const saved = await readMediaItemForDeletion(db, original.id);
  if (!saved || !same(saved.item.localVideoFile, patch.localVideoFile)) {
    throw new Error(
      "The replacement could not be confirmed. The previous file was kept. Retry after Media Library reconnects.",
    );
  }
  return { item: saved.item, patch, changed };
};

/** A failed/unknown commit must be reconciled before disposing of a candidate. */
export const discardUnadoptedLinkedVideo = async (
  asset: ElectronLocalAsset,
  owner: DesktopVideoDownloadOwner,
  isOwnerCurrent: () => boolean,
  getInMemoryMediaItems: () => MediaType[],
) => {
  if (!owner.dbAtStart || !isOwnerCurrent()) return;
  const { list } = await loadMediaLibrary(owner.dbAtStart as PouchDB.Database, {
    forCleanup: true,
  });
  if (
    list.some((item) =>
      item.pendingLinkedVideoCleanup?.some(
        (entry) => entry.localAssetId === asset.assetId,
      ),
    )
  )
    return;
  return removeDownloadedVideoAssetIfUnreferenced({
    assetId: asset.assetId,
    media: undefined,
    owner,
    isOwnerCurrent,
    deleteAsset: deleteLocalVideoFile,
    getInMemoryMediaItem: (id) =>
      getInMemoryMediaItems().find((item) => item.localVideoFile?.id === id),
  });
};

/** Finish the durable checkpoint before retiring any old provider storage. */
export const finalizeLinkedVideoReplacement = async (
  item: MediaType,
  isOwnerCurrent: () => boolean,
  workspaceId: string,
) => {
  const reference = item.localVideoFile;
  const pending = item.pendingLinkedVideoCleanup?.findLast(
    (entry) =>
      !entry.rolledBack &&
      entry.linkedAssetId === reference?.id &&
      entry.contentHash === reference?.contentHash,
  );
  if (!pending || !reference) return;
  if (!isOwnerCurrent())
    throw new Error(
      "Switch back to the original church to finish relinking this video.",
    );
  const api = window.electronAPI;
  if (!api?.commitRelinkLocalVideoFile)
    throw new Error("Restart WorshipSync before finishing this relink.");
  const nativeStatus = await api.getLocalVideoRelinkStatus(
    reference.id,
    pending.localAssetId,
  );
  if (nativeStatus.asset?.workspaceId !== workspaceId || !isOwnerCurrent()) {
    throw new Error(
      "This local video belongs to a different church or is no longer registered. Its source was kept.",
    );
  }
  // Native commit is idempotent. A lost IPC acknowledgement is reconciled by
  // retrying the same trusted candidate, never by selecting a different file.
  const asset = await api.commitRelinkLocalVideoFile(
    pending.linkedAssetId,
    pending.localAssetId,
  );
  if (!isOwnerCurrent())
    throw new Error(
      "The active church or video changed. Retry relinking from the original church.",
    );
  if (asset.contentHash !== pending.contentHash)
    throw new Error(
      "The replacement could not be confirmed. Retry relinking this video.",
    );
  const stored = await getLocalVideoFile(reference.id);
  if (!isOwnerCurrent())
    throw new Error(
      "The active church or video changed. Retry relinking from the original church.",
    );
  if (
    stored?.contentHash === pending.contentHash &&
    stored.fileName === reference.fileName &&
    stored.contentType === reference.contentType &&
    stored.width === item.width &&
    stored.height === item.height &&
    stored.duration === (item.duration ?? 0)
  )
    return;
  await saveLocalVideoFile(
    {
      id: reference.id,
      contentHash: pending.contentHash,
      workspaceId: asset.workspaceId,
      fileName: reference.fileName,
      contentType: reference.contentType,
      size: asset.size,
      width: item.width,
      height: item.height,
      duration: item.duration ?? 0,
      createdAt: item.createdAt,
    },
    {
      deferThumbnail: true,
      invalidateThumbnail:
        pending.contentChanged && stored?.contentHash !== pending.contentHash,
    },
  );
  // Native adoption and the IndexedDB thumbnail transaction are separate
  // commits. Outputs must also retire anything acquired between those steps.
  if (
    (await api.notifyLocalVideoAssetChanged?.(
      reference.id,
      pending.contentHash,
    )) === false
  ) {
    throw new Error(
      "This video changed while its local metadata was being saved. Retry relinking.",
    );
  }
};

/** Restore only our fields, and only while the old native source is confirmed. */
export const restoreUncommittedLinkedVideo = async (
  original: MediaType,
  patch: Partial<MediaType>,
  candidateId: string,
  owner: DesktopVideoDownloadOwner,
  isOwnerCurrent: () => boolean,
  previousContentHash = original.localVideoFile?.contentHash,
) => {
  const native = await window.electronAPI?.getLocalVideoRelinkStatus(
    original.localVideoFile!.id,
    candidateId,
  );
  if (
    native?.status !== "pending" ||
    native.asset?.workspaceId !== owner.workspaceId ||
    native.asset?.contentHash !== previousContentHash ||
    !isOwnerCurrent()
  )
    return;
  await updateMediaItem(
    owner.dbAtStart as PouchDB.Database,
    original.id,
    (current) => {
      if (
        !current?.localVideoFile ||
        !same(
          {
            ...current.localVideoFile,
            audioEnabled: patch.localVideoFile?.audioEnabled,
          },
          patch.localVideoFile,
        )
      )
        return {};
      const restored: Partial<MediaType> = {};
      const previous =
        current.pendingLinkedVideoCleanup?.find(
          (entry) => entry.localAssetId === candidateId,
        )?.previousFields ?? replacementSnapshot(original);
      for (const key of replacementKeys) {
        if (key !== "localVideoFile" && same(current[key], patch[key])) {
          Object.assign(restored, { [key]: previous[key] });
        }
      }
      return {
        ...restored,
        localVideoFile: {
          ...previous.localVideoFile!,
          audioEnabled: current.localVideoFile.audioEnabled,
        },
        pendingLinkedVideoCleanup: current.pendingLinkedVideoCleanup?.map(
          (entry) =>
            entry.localAssetId === candidateId
              ? { ...entry, rolledBack: true }
              : entry,
        ),
      };
    },
    isOwnerCurrent,
  );
};

/** Reconcile a resumed commit without replacing unrelated local edits. */
export const linkedVideoRecoveryPatch = (
  saved: MediaType,
  current: MediaType | undefined,
): Partial<MediaType> | undefined => {
  const pending = saved.pendingLinkedVideoCleanup?.findLast((entry) =>
    entry.rolledBack
      ? entry.previousContentHash === saved.localVideoFile?.contentHash
      : entry.contentHash === saved.localVideoFile?.contentHash,
  );
  if (
    !pending ||
    !current?.localVideoFile ||
    current.localVideoFile.id !== pending.linkedAssetId ||
    (current.localVideoFile.contentHash !== pending.previousContentHash &&
      current.localVideoFile.contentHash !== pending.contentHash)
  )
    return;
  return {
    width: saved.width,
    height: saved.height,
    duration: saved.duration,
    format: saved.format,
    background: saved.background,
    thumbnail: saved.thumbnail,
    placeholderImage: saved.placeholderImage,
    muxAssetId: saved.muxAssetId,
    muxPlaybackId: saved.muxPlaybackId,
    providerStorage: saved.providerStorage,
    localVideoFile: {
      ...saved.localVideoFile!,
      audioEnabled: current.localVideoFile.audioEnabled,
    },
    pendingLinkedVideoCleanup: saved.pendingLinkedVideoCleanup,
  };
};

/** Retry always rechecks references, using the captured church and database. */
export const cleanupLinkedVideoReplacement = async (
  mediaId: string,
  owner: DesktopVideoDownloadOwner,
  isOwnerCurrent: () => boolean,
  getInMemoryMediaItems: () => MediaType[],
  onRetired?: (
    entry: NonNullable<MediaType["pendingLinkedVideoCleanup"]>[number],
  ) => void,
  onAdopted?: (item: MediaType) => void,
) => {
  const db = owner.dbAtStart as PouchDB.Database;
  const saved = await readMediaItemForDeletion(db, mediaId);
  if (saved) {
    for (const pending of saved.item.pendingLinkedVideoCleanup ?? []) {
      if (!isOwnerCurrent())
        throw new Error("Switch back to the original church to retry cleanup.");
      const nativeStatus = await window.electronAPI?.getLocalVideoRelinkStatus(
        pending.linkedAssetId,
        pending.localAssetId,
      );
      if (!nativeStatus)
        throw new Error(
          "Native relink status is unavailable. Its recovery checkpoint was kept.",
        );
      if (
        nativeStatus.asset &&
        nativeStatus.asset.workspaceId !== owner.workspaceId
      ) {
        throw new Error(
          "This local video belongs to a different church. Its files were kept.",
        );
      }
      const isCurrentReplacement =
        !pending.rolledBack &&
        saved.item.localVideoFile?.id === pending.linkedAssetId &&
        saved.item.localVideoFile.contentHash === pending.contentHash;
      if (nativeStatus.status === "committed" && !isCurrentReplacement) {
        throw new Error(
          "Native adoption conflicts with the saved relink checkpoint. Its files were kept.",
        );
      }
    }
    await finalizeLinkedVideoReplacement(
      saved.item,
      isOwnerCurrent,
      owner.workspaceId,
    );
    if (isOwnerCurrent()) onAdopted?.(saved.item);
  }
  for (const pending of saved?.item.pendingLinkedVideoCleanup ?? []) {
    if (!isOwnerCurrent())
      throw new Error("Switch back to the original church to retry cleanup.");
    await removeDownloadedVideoAssetIfUnreferenced({
      assetId: pending.localAssetId,
      media: undefined,
      owner,
      isOwnerCurrent,
      deleteAsset: deleteLocalVideoFile,
      getInMemoryMediaItem: (id) =>
        getInMemoryMediaItems().find((item) => item.localVideoFile?.id === id),
    });
    for (const assetId of pending.rolledBack ? [] : pending.muxAssetIds) {
      // A shared asset is retained. Its remaining owning item will retire it.
      await removeDownloadedVideoMuxAssetIfUnreferenced({
        result: { assetId },
        owner,
        isOwnerCurrent,
        getInMemoryMediaItems,
      });
    }
    await updateMediaItem(
      db,
      mediaId,
      (current) => ({
        pendingLinkedVideoCleanup: current?.pendingLinkedVideoCleanup?.filter(
          (entry) => !same(entry, pending),
        ),
      }),
      isOwnerCurrent,
    );
    if (isOwnerCurrent()) onRetired?.(pending);
  }
};

/** Activity retries share the same exclusion boundary as a new relink/upload. */
export const retryLinkedVideoReplacement = async (
  ...args: Parameters<typeof cleanupLinkedVideoReplacement>
) => {
  const [mediaId, owner, isOwnerCurrent, getItems, onRetired, onAdopted] = args;
  const claim = claimMediaUpload(mediaId);
  if (!claim)
    throw new Error(
      "Wait for the current video operation to finish, then retry relinking.",
    );
  try {
    await cleanupLinkedVideoReplacement(
      mediaId,
      owner,
      () => claim.isCurrent() && isOwnerCurrent(),
      getItems,
      onRetired,
      onAdopted,
    );
  } catch (error) {
    // Route retirement/restart must not lose the original playback metadata.
    // Only a fresh native check can authorize reverting a staged non-commit.
    const current = await readMediaItemForDeletion(
      owner.dbAtStart as PouchDB.Database,
      mediaId,
    ).catch(() => null);
    const pending = current?.item.pendingLinkedVideoCleanup?.findLast(
      (entry) =>
        !entry.rolledBack &&
        entry.contentHash === current.item.localVideoFile?.contentHash,
    );
    // A legacy checkpoint without the proposed values cannot establish which
    // fields still belong to this replacement. Preserve it for native retry.
    if (!current || !pending?.previousFields || !pending.proposedFields)
      throw error;
    const original = {
      ...current.item,
      ...replacementSnapshot(pending.previousFields),
    };
    const canContinue = () => claim.isCurrent() && isOwnerCurrent();
    await restoreUncommittedLinkedVideo(
      original,
      replacementSnapshot(pending.proposedFields),
      pending.localAssetId,
      owner,
      canContinue,
      pending.nativePreviousContentHash,
    );
    const reconciled = await readMediaItemForDeletion(
      owner.dbAtStart as PouchDB.Database,
      mediaId,
    );
    if (
      !reconciled?.item.pendingLinkedVideoCleanup?.some(
        (entry) =>
          entry.localAssetId === pending.localAssetId && entry.rolledBack,
      )
    )
      throw error;
    await cleanupLinkedVideoReplacement(
      mediaId,
      owner,
      canContinue,
      getItems,
      onRetired,
      onAdopted,
    );
  } finally {
    claim.release();
  }
};

/** All retained recovery actions publish and retire the same durable fields. */
export const registerLinkedVideoReplacementRecovery = ({
  item,
  owner,
  isOwnerCurrent,
  getItems,
  dispatch,
  transfer,
  error,
}: {
  item: MediaType;
  owner: DesktopVideoDownloadOwner;
  isOwnerCurrent: () => boolean;
  getItems: () => MediaType[];
  dispatch: AppDispatch;
  transfer?: DesktopVideoDownloadDependencies["transfer"];
  error?: unknown;
}) =>
  registerLocalAssetCleanupRetry(
    item,
    () =>
      retryLinkedVideoReplacement(
        item.id,
        owner,
        isOwnerCurrent,
        getItems,
        (retired) => {
          if (!isOwnerCurrent()) return;
          const current = getItems().find((row) => row.id === item.id);
          dispatch(
            updateMediaItemFields({
              id: item.id,
              patch: {
                pendingLinkedVideoCleanup:
                  current?.pendingLinkedVideoCleanup?.filter(
                    (entry) => !same(entry, retired),
                  ),
              },
            }),
          );
        },
        (saved) => {
          const patch = linkedVideoRecoveryPatch(
            saved,
            getItems().find((row) => row.id === item.id),
          );
          if (patch && isOwnerCurrent())
            dispatch(updateMediaItemFields({ id: item.id, patch }));
        },
      ),
    error,
    transfer?.updateTransfer,
    transfer?.registerTransferAction,
    transfer?.removeTransfer,
    {
      relinked: true,
      rolledBack: Boolean(
        item.pendingLinkedVideoCleanup?.length &&
        item.pendingLinkedVideoCleanup.every((entry) => entry.rolledBack),
      ),
      churchId: owner.churchId,
    },
  );
