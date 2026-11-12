import type { MediaType } from "../types";
import type { Transfer } from "../context/transferModel";

export const registerLocalAssetCleanupRetry = (
  media: MediaType,
  retryCleanup: () => Promise<void>,
  initialError: unknown,
  updateTransfer?: (transfer: Transfer) => void,
  registerTransferAction?: (id: string, key: string, handler: () => void | Promise<void>) => () => void,
  removeTransfer?: (id: string) => void,
  options: { relinked?: boolean; churchId?: string } = {},
) => {
  if (!updateTransfer || !registerTransferAction) return false;
  const transferId = options.relinked
    ? `media-relink-cleanup-${options.churchId}:${media.id}`
    : `media-cleanup-${media.id}`;
  const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Local asset cleanup failed. Try again.";
  const phase = options.relinked ? "Video relink needs attention" : "Upload cancelled";
  const publish = (error?: unknown) => updateTransfer({
    id: transferId,
    type: "Media upload",
    name: media.name,
    status: options.relinked ? "failed" : "cancelled",
    progress: options.relinked ? null : 0,
    phase: { key: options.relinked ? "cleanup" : "cancelled", label: phase },
    detail: options.relinked ? "Retry to finish relinking and clean up unused storage." : "The local asset still needs cleanup.",
    files: [{ id: media.id, name: media.name, status: options.relinked ? "failed" : "cancelled", progress: options.relinked ? null : 0, phase }],
    ...(error ? { error: { message: errorMessage(error) } } : {}),
    canCancel: false,
    blocksUnload: false,
    actions: [{ key: "retry-cleanup", label: options.relinked ? "Retry relink" : "Retry cleanup" }, { key: "dismiss", label: "Dismiss" }],
  });
  let unregisterRetry = () => {};
  let unregisterDismiss = () => {};
  unregisterRetry = registerTransferAction(transferId, "retry-cleanup", async () => {
    try {
      await retryCleanup();
      unregisterRetry();
      unregisterDismiss();
      removeTransfer?.(transferId);
    } catch (error) {
      publish(error);
    }
  });
  unregisterDismiss = registerTransferAction(transferId, "dismiss", () => {
    unregisterRetry();
    unregisterDismiss();
    removeTransfer?.(transferId);
  });
  publish(initialError);
  return true;
};
