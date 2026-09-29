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

export class CanvaMediaReconciliationRequiredError extends Error {
  readonly code = "CANVA_MEDIA_RECONCILIATION_REQUIRED";

  constructor(message: string) {
    super(message);
    this.name = "CanvaMediaReconciliationRequiredError";
  }
}

const sameMediaRevision = (left: MediaType | undefined, right: MediaType) =>
  Boolean(left && left.id === right.id && left.updatedAt === right.updatedAt &&
    left.background === right.background && left.publicId === right.publicId &&
    left.muxAssetId === right.muxAssetId && left.canvaImportKey === right.canvaImportKey &&
    left.canvaSource?.revision === right.canvaSource?.revision);

const isNewerCanvaRevision = (candidate: MediaType | undefined, rendition: MediaType) => {
  const candidateSource = candidate?.canvaSource;
  const renditionSource = rendition.canvaSource;
  return Boolean(candidateSource && renditionSource &&
    candidateSource.designId === renditionSource.designId &&
    candidateSource.format === renditionSource.format &&
    [...candidateSource.pageNumbers].sort((a, b) => a - b).join(",") ===
      [...renditionSource.pageNumbers].sort((a, b) => a - b).join(",") &&
    candidateSource.revision > renditionSource.revision);
};

const referenceMutationSucceeded = (result: ReferenceMutationResult) =>
  result.ok && (result.rollbackStatus === "complete" || result.rollbackStatus === "not_needed");

export type CanvaMediaReplacementTransactionArgs = {
  oldMedia: MediaType;
  newMedia: MediaType;
  currentList: MediaType[];
  folders: MediaFolder[];
  replaceReferences: (
    replacement: MediaReferenceReplacement,
  ) => Promise<ReferenceMutationResult>;
  hasSupersededReferences: (
    oldMedia: MediaType,
    currentMedia: MediaType,
  ) => Promise<boolean>;
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
 * Commits a Canva rendition replacement and reconciles ambiguous persistence
 * only from authoritative Media and saved-reference reads. Provider cleanup is
 * non-fatal after a verified replacement.
 */
export async function commitCanvaMediaReplacement({
  oldMedia,
  newMedia,
  currentList,
  folders,
  replaceReferences,
  hasSupersededReferences,
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
  const retainBothError = "Canva refresh needs attention. Saved media references could not be confirmed, so both files were kept. Reload Media before trying again.";
  const cleanup = async (row: MediaType, protectedRow: MediaType) => {
    try {
      if (await deleteProvider(row, protectedRow)) return;
    } catch (error) {
      console.error("Canva provider cleanup failed after media reconciliation.", error);
    }
    onCleanupFailure([row]);
  };
  const reconciliationRequired = (message = retainBothError) =>
    new CanvaMediaReconciliationRequiredError(message);
  const restoreReferences = async (from: MediaType, to: MediaType) => {
    try {
      const result = await replaceReferences({ oldMedia: from, newMedia: to });
      return referenceMutationSucceeded(result) && !await hasSupersededReferences(from, to);
    } catch (error) {
      console.error("Could not verify Canva media reference reconciliation.", error);
      return false;
    }
  };
  const reconcileReferencesTo = async (target: MediaType) => {
    // Saved references may be split between the original and imported rendition.
    const fromOld = await restoreReferences(oldMedia, target);
    const fromImported = sameMediaRevision(newMedia, target) || sameMediaRevision(newMedia, oldMedia)
      ? true
      : await restoreReferences(newMedia, target);
    return fromOld && fromImported &&
      !await hasSupersededReferences(oldMedia, target) &&
      !await hasSupersededReferences(newMedia, target);
  };
  const readAuthoritativeMedia = async () => {
    try {
      return await readPersistedMedia();
    } catch (error) {
      console.error("Could not inspect persisted Media after Canva replacement.", error);
      return undefined;
    }
  };
  const findTarget = (state: PersistedMediaState) =>
    state.list.find((media) => media.id === oldMedia.id);
  const isCurrentInMemory = (expected: MediaType) =>
    sameMediaRevision((getCurrentList?.() ?? currentList).find((media) => media.id === expected.id), expected);
  const applyAuthoritativeTarget = (target: MediaType, state?: PersistedMediaState) => {
    const latestList = getCurrentList?.() ?? currentList;
    const latestFolders = getCurrentFolders?.() ?? folders;
    const merged = [...latestList];
    for (const persistedMedia of state?.list ?? []) {
      if (!merged.some((media) => media.id === persistedMedia.id) &&
        !currentList.some((media) => media.id === persistedMedia.id)) merged.push(persistedMedia);
    }
    applyList(merged.map((media) => media.id === target.id ? target : media), latestFolders);
  };
  const commitLiveReferences = (target: MediaType) => {
    // No await is allowed between the final in-memory identity check and this
    // synchronous dispatch; local Media events cannot interleave in that gap.
    if (!isCurrentInMemory(target)) return false;
    applyLiveReferences({ oldMedia, newMedia: target });
    return true;
  };
  const reconcileConcurrentTarget = async (target: MediaType) => {
    const referencesVerified = await reconcileReferencesTo(target);
    const latest = await readAuthoritativeMedia();
    if (!referencesVerified || !latest || !sameMediaRevision(findTarget(latest), target)) {
      if (latest) applyAuthoritativeTarget(findTarget(latest) ?? target, latest);
      throw reconciliationRequired();
    }
    applyAuthoritativeTarget(target, latest);
    if (!commitLiveReferences(target)) throw reconciliationRequired();
    // The prior rendition may still be referenced by an in-flight reader; a
    // concurrent replacement keeps both assets for explicit cleanup later.
    throw reconciliationRequired("A newer Media version was kept and its references were updated. Both files were kept to avoid interrupting a presentation.");
  };

  let references: ReferenceMutationResult;
  try {
    references = await replaceReferences(replacement);
  } catch (error) {
    console.error("Could not determine whether Canva references were migrated; retaining the new provider asset.", error);
    throw reconciliationRequired();
  }
  if (!referenceMutationSucceeded(references)) {
    if (references.rollbackStatus === "complete" || references.rollbackStatus === "not_needed") {
      await cleanup(newMedia, oldMedia);
    }
    throw references.rollbackStatus === "uncertain"
      ? reconciliationRequired(`${references.message || "Could not update Canva media references."} reconciliation is required; both provider assets were kept.`)
      : new Error(references.message || "Could not update Canva media references.");
  }

  if (canCommit && !canCommit()) {
    if (await restoreReferences(newMedia, oldMedia)) {
      await cleanup(newMedia, oldMedia);
    } else {
      throw reconciliationRequired("Media changed during the Canva refresh. References could not be confirmed, so both files were kept. Reload Media before trying again.");
    }
    throw new Error("Media changed while Canva was refreshing this page. The newer Media version was kept.");
  }

  const latestListBeforeApply = getCurrentList?.() ?? currentList;
  const latestFoldersBeforeApply = getCurrentFolders?.() ?? folders;
  const nextList = latestListBeforeApply.map((media) => media.id === oldMedia.id ? newMedia : media);
  applyList(nextList, latestFoldersBeforeApply);

  let mediaFlush: MediaFlushResult;
  try {
    mediaFlush = await flushMedia(nextList, latestFoldersBeforeApply);
  } catch (error) {
    mediaFlush = { ok: false, error };
  }

  const persisted = await readAuthoritativeMedia();
  if (!persisted) throw reconciliationRequired();
  const persistedTarget = findTarget(persisted);

  // This also catches writes whose acknowledgement was lost. The exact
  // persisted revision wins over the flush return value.
  if (sameMediaRevision(persistedTarget, newMedia)) {
    if (!mediaFlush.ok) {
      const referencesVerified = await reconcileReferencesTo(newMedia);
      const confirmed = await readAuthoritativeMedia();
      if (!referencesVerified || !confirmed || !sameMediaRevision(findTarget(confirmed), newMedia)) {
      if (confirmed) applyAuthoritativeTarget(newMedia, confirmed);
        throw reconciliationRequired();
      }
      applyAuthoritativeTarget(newMedia, confirmed);
      if (!commitLiveReferences(newMedia)) throw reconciliationRequired();
      await cleanup(oldMedia, newMedia);
      return;
    }

    // Validation and Redux dispatch are synchronous after the authoritative
    // read, preventing a stale rendition from being applied after a local edit.
    if (!commitLiveReferences(newMedia)) {
      const latest = await readAuthoritativeMedia();
      if (latest) {
        const target = findTarget(latest);
        if (target && !sameMediaRevision(target, newMedia)) {
          if (!isNewerCanvaRevision(target, newMedia)) throw reconciliationRequired();
          await reconcileConcurrentTarget(target);
        }
      }
      throw reconciliationRequired();
    }
    await cleanup(oldMedia, newMedia);
    return;
  }

  if (persistedTarget && !sameMediaRevision(persistedTarget, oldMedia)) {
    if (!isNewerCanvaRevision(persistedTarget, newMedia)) throw reconciliationRequired();
    await reconcileConcurrentTarget(persistedTarget);
  }

  if (sameMediaRevision(persistedTarget, oldMedia)) {
    const latestTarget = (getCurrentList?.() ?? currentList).find((media) => media.id === oldMedia.id);
    if (latestTarget && !sameMediaRevision(latestTarget, oldMedia) && !sameMediaRevision(latestTarget, newMedia)) {
      throw reconciliationRequired();
    }
    const referencesRestored = await restoreReferences(newMedia, oldMedia);
    const confirmed = await readAuthoritativeMedia();
    if (confirmed && sameMediaRevision(findTarget(confirmed), oldMedia)) applyAuthoritativeTarget(oldMedia, confirmed);
    if (referencesRestored && confirmed && sameMediaRevision(findTarget(confirmed), oldMedia)) {
      await cleanup(newMedia, oldMedia);
      throw new Error("Could not save the refreshed Canva media. The previous version was restored.");
    }
  }

  console.error("Canva Media replacement did not reach a verified commit or rollback.", mediaFlush.error);
  throw reconciliationRequired();
}
