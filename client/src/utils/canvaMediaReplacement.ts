import type { MediaFolder, MediaType } from "../types";
import type { MediaReferenceReplacement } from "./mediaReferenceReplacement";

type ReferenceMutationResult = {
  ok: boolean;
  message?: string;
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
  const references = await replaceReferences(replacement);
  if (!references.ok) {
    if (!(await deleteProvider(newMedia, oldMedia))) {
      onCleanupFailure([newMedia]);
    }
    throw new Error(
      references.message || "Could not update Canva media references.",
    );
  }

  const nextList = currentList.map((media) =>
    media.id === oldMedia.id ? newMedia : media,
  );
  applyList(nextList, folders);
  applyLiveReferences(replacement);

  const mediaFlush = await flushMedia(nextList, folders);
  if (!mediaFlush.ok) {
    applyList(currentList, folders);
    const rollback = await replaceReferences({
      oldMedia: newMedia,
      newMedia: oldMedia,
    });
    if (!rollback.ok) {
      console.error(
        "Could not roll back Canva media references after media persistence failed.",
        rollback.message,
      );
    }
    applyLiveReferences({ oldMedia: newMedia, newMedia: oldMedia });
    if (!(await deleteProvider(newMedia, oldMedia))) {
      onCleanupFailure([newMedia]);
    }
    throw new Error("Could not save the refreshed Canva media.");
  }

  if (!(await deleteProvider(oldMedia, newMedia))) {
    onCleanupFailure([oldMedia]);
  }
}
