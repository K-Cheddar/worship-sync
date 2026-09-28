import type { MediaFolder, MediaType } from "../types";
import type { MediaReferenceReplacement } from "./mediaReferenceReplacement";

type ReferenceMutationResult = {
  ok: boolean;
  message?: string;
  rollbackStatus?: "not_needed" | "complete" | "uncertain";
};

type MediaFlushResult = {
  ok: boolean;
  error?: unknown;
};

type PersistedMediaState = { list: MediaType[]; folders: MediaFolder[] };

const sameMediaRevision = (left: MediaType | undefined, right: MediaType) =>
  Boolean(left && left.id === right.id && left.updatedAt === right.updatedAt &&
    left.background === right.background && left.publicId === right.publicId &&
    left.muxAssetId === right.muxAssetId && left.canvaImportKey === right.canvaImportKey &&
    left.canvaSource?.revision === right.canvaSource?.revision);

export type CanvaMediaReplacementTransactionArgs = {
  oldMedia: MediaType;
  newMedia: MediaType;
  currentList: MediaType[];
  folders: MediaFolder[];
  replaceReferences: (
    replacement: MediaReferenceReplacement,
  ) => Promise<ReferenceMutationResult>;
  flushMedia: (
    list: MediaType[],
    folders: MediaFolder[],
  ) => Promise<MediaFlushResult>;
  deleteProvider: (
    row: MediaType,
    protectedRow?: MediaType,
  ) => Promise<boolean>;
  applyList: (list: MediaType[], folders: MediaFolder[]) => void;
  applyLiveReferences: (replacement: MediaReferenceReplacement) => void;
  onCleanupFailure: (rows: MediaType[]) => void;
  canCommit?: () => boolean;
  getCurrentList?: () => MediaType[];
  getCurrentFolders?: () => MediaFolder[];
  readPersistedMedia: () => Promise<PersistedMediaState>;
};

/**
 * Commits a Canva rendition replacement in the only safe order: references,
 * Media library, then superseded provider cleanup. Provider cleanup failures
 * are deliberately non-fatal after the replacement is durable.
 */
export async function commitCanvaMediaReplacement({
  oldMedia,
  newMedia,
  currentList,
  folders,
  replaceReferences,
  flushMedia,
  deleteProvider,
  applyList,
  applyLiveReferences,
  onCleanupFailure,
  canCommit,
  getCurrentList,
  getCurrentFolders,
  readPersistedMedia,
}: CanvaMediaReplacementTransactionArgs): Promise<void> {
  const replacement = { oldMedia, newMedia };
  let references: ReferenceMutationResult;
  try {
    references = await replaceReferences(replacement);
  } catch (error) {
    console.error(
      "Could not determine whether Canva media references were migrated; retaining the new provider asset.",
      error,
    );
    throw error;
  }
  if (!references.ok) {
    const rollbackIsKnownSafe =
      references.rollbackStatus === "complete" ||
      references.rollbackStatus === "not_needed";
    if (rollbackIsKnownSafe) {
      if (!(await deleteProvider(newMedia, oldMedia))) {
        onCleanupFailure([newMedia]);
      }
    } else {
      console.error(
        "Canva media reference migration failed with uncertain rollback; retaining the new provider asset for reconciliation.",
        references.message,
      );
    }
    throw new Error(
      rollbackIsKnownSafe
        ? references.message || "Could not update Canva media references."
        : `${references.message || "Could not update Canva media references."} Saved references may still point to the new Canva rendition; reconciliation is required before cleanup.`,
    );
  }

  if (canCommit && !canCommit()) {
    let rollback: ReferenceMutationResult;
    try {
      rollback = await replaceReferences({ oldMedia: newMedia, newMedia: oldMedia });
    } catch (error) {
      rollback = {
        ok: false,
        rollbackStatus: "uncertain",
        message: error instanceof Error ? error.message : String(error),
      };
    }
    if (rollback.ok && (rollback.rollbackStatus === "complete" || rollback.rollbackStatus === "not_needed")) {
      if (!(await deleteProvider(newMedia, oldMedia))) onCleanupFailure([newMedia]);
      throw new Error("Media changed while Canva was refreshing this page. The newer Media version was kept.");
    }
    throw new Error("Media changed while Canva was refreshing this page. The newer version was kept, and provider cleanup needs reconciliation.");
  }

  const latestListBeforeApply = getCurrentList?.() ?? currentList;
  const latestFoldersBeforeApply = getCurrentFolders?.() ?? folders;
  const nextList = latestListBeforeApply.map((media) =>
    media.id === oldMedia.id ? newMedia : media,
  );
  applyList(nextList, latestFoldersBeforeApply);

  let mediaFlush: MediaFlushResult;
  try {
    mediaFlush = await flushMedia(nextList, latestFoldersBeforeApply);
  } catch (error) {
    mediaFlush = { ok: false, error };
  }
  if (!mediaFlush.ok) {
    let rollback: ReferenceMutationResult;
    try {
      rollback = await replaceReferences({
        oldMedia: newMedia,
        newMedia: oldMedia,
      });
    } catch (error) {
      rollback = {
        ok: false,
        rollbackStatus: "uncertain",
        message: error instanceof Error ? error.message : String(error),
      };
    }
    let rollbackIsKnownSafe = rollback.ok &&
      (rollback.rollbackStatus === "complete" ||
        rollback.rollbackStatus === "not_needed");
    let persisted: PersistedMediaState | undefined;
    try {
      persisted = await readPersistedMedia();
    } catch (readError) {
      console.error("Could not inspect persisted Media after Canva replacement failed.", readError);
    }

    const persistedTarget = persisted?.list.find((media) => media.id === oldMedia.id);
    if (persisted && sameMediaRevision(persistedTarget, newMedia)) {
      let forward: ReferenceMutationResult;
      try {
        forward = await replaceReferences(replacement);
      } catch (error) {
        forward = { ok: false, rollbackStatus: "uncertain", message: String(error) };
      }
      applyList(persisted.list, persisted.folders);
      const forwardIsKnownSafe = forward.ok &&
        (forward.rollbackStatus === "complete" || forward.rollbackStatus === "not_needed");
      if (forwardIsKnownSafe) {
        applyLiveReferences(replacement);
        if (!(await deleteProvider(oldMedia, newMedia))) onCleanupFailure([oldMedia]);
        return;
      }
      throw new Error("Could not confirm Canva media references after the Media write. Both provider assets were kept; reconciliation is required.");
    }

    if (persisted && sameMediaRevision(persistedTarget, oldMedia) && !rollbackIsKnownSafe) {
      let retryRollback: ReferenceMutationResult;
      try {
        retryRollback = await replaceReferences({ oldMedia: newMedia, newMedia: oldMedia });
      } catch (error) {
        retryRollback = { ok: false, rollbackStatus: "uncertain", message: String(error) };
      }
      if (retryRollback.ok && (retryRollback.rollbackStatus === "complete" || retryRollback.rollbackStatus === "not_needed")) {
        rollbackIsKnownSafe = true;
      }
    }

    if (persisted) applyList(persisted.list, persisted.folders);
    if (persisted && sameMediaRevision(persistedTarget, oldMedia) && rollbackIsKnownSafe) {
      if (!(await deleteProvider(newMedia, oldMedia))) onCleanupFailure([newMedia]);
      throw new Error("Could not save the refreshed Canva media. The previous version was restored.");
    }

    console.error(
      "Could not establish a consistent Canva media replacement after persistence failed; retaining both provider assets for reconciliation.",
      rollback.message,
    );
    throw new Error("Could not save the refreshed Canva media. The saved state could not be confirmed; both provider assets were kept and reconciliation is required before cleanup.");
  }

  applyLiveReferences(replacement);

  const latestCommittedTarget = (getCurrentList?.() ?? nextList).find((media) => media.id === oldMedia.id);
  if (!sameMediaRevision(latestCommittedTarget, newMedia)) {
    throw new Error("Media changed while Canva was refreshing this page. Both provider assets were kept for reconciliation.");
  }

  if (!(await deleteProvider(oldMedia, newMedia))) {
    onCleanupFailure([oldMedia]);
  }
}
