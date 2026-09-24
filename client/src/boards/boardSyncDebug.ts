export type BoardSyncDebugDetails = Record<string, unknown>;

/** Retained as a no-op hook for callers that may need local board tracing again. */
export const debugBoardSync = (
  _event: string,
  _details: BoardSyncDebugDetails = {},
): void => {
};
