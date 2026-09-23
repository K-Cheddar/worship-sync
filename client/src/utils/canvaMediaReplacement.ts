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

  const nextList = currentList.map((media) =>
    media.id === oldMedia.id ? newMedia : media,
  );
  applyList(nextList, folders);
  applyLiveReferences(replacement);

  let mediaFlush: MediaFlushResult;
  try {
    mediaFlush = await flushMedia(nextList, folders);
  } catch (error) {
    mediaFlush = { ok: false, error };
  }
  if (!mediaFlush.ok) {
    applyList(currentList, folders);
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
    const rollbackIsKnownSafe = rollback.ok &&
      (rollback.rollbackStatus === "complete" ||
        rollback.rollbackStatus === "not_needed");
    if (!rollbackIsKnownSafe) {
      console.error(
        "Could not safely roll back Canva media references after media persistence failed; retaining both provider assets for reconciliation.",
        rollback.message,
      );
    }
    applyLiveReferences({ oldMedia: newMedia, newMedia: oldMedia });
    if (rollbackIsKnownSafe) {
      if (!(await deleteProvider(newMedia, oldMedia))) {
        onCleanupFailure([newMedia]);
      }
    }
    throw new Error(
      rollbackIsKnownSafe
        ? "Could not save the refreshed Canva media."
        : "Could not save the refreshed Canva media. Saved references may still point to the new Canva rendition; reconciliation is required before cleanup.",
    );
  }

  if (!(await deleteProvider(oldMedia, newMedia))) {
    onCleanupFailure([oldMedia]);
  }
}
