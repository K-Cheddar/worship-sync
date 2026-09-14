export type BoardSyncDebugDetails = Record<string, unknown>;

/** Development-only timing breadcrumbs for authenticated board replication. */
export const debugBoardSync = (
  event: string,
  details: BoardSyncDebugDetails = {},
): void => {
  if (!import.meta.env.DEV) return;

  console.debug(`[board-sync] ${event}`, {
    timestamp: Date.now(),
    ...details,
  });
};
