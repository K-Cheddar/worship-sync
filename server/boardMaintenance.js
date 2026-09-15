export const DISCUSSION_BOARD_RETENTION_DAYS = 365;
export const DISCUSSION_BOARD_RETENTION_MS =
  DISCUSSION_BOARD_RETENTION_DAYS * 24 * 60 * 60 * 1000;

const toTimestampMs = (value) => {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : undefined;
  }
  if (value && typeof value.toMillis === "function") {
    const timestamp = value.toMillis();
    return Number.isFinite(timestamp) ? timestamp : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

/**
 * Older board documents have no archive timestamp. Their creation time is the
 * safest available fallback; new rotations write archivedAt explicitly.
 */
export const getBoardArchiveTimestampMs = (board) =>
  toTimestampMs(board?.archivedAt) ?? toTimestampMs(board?.createdAt);

export const isExpiredArchivedBoard = ({
  board,
  cutoffMs,
  now = Date.now(),
}) => {
  const archiveTimestamp = getBoardArchiveTimestampMs(board);
  const boundary = Number.isFinite(cutoffMs)
    ? cutoffMs
    : now - DISCUSSION_BOARD_RETENTION_MS;
  return Boolean(
    (board?.docType === "board" || board?.type === "board") &&
      board?.archived === true &&
      Number.isFinite(archiveTimestamp) &&
      archiveTimestamp < boundary,
  );
};

/**
 * Return a complete alias document only when its history would change. Missing
 * board IDs are stale; the current board is never treated as purgeable.
 */
export const pruneAliasHistory = ({
  aliasDoc,
  boardDocsById,
  purgedBoardIds = new Set(),
  timestamp = Date.now(),
}) => {
  if (!aliasDoc || !Array.isArray(aliasDoc.history)) return null;

  const currentBoardId = String(aliasDoc.currentBoardId || "").trim();
  const history = aliasDoc.history.map((value) => String(value || "").trim());
  const nextHistory = history.filter((boardId) => {
    if (!boardId || boardId === currentBoardId) return false;
    if (purgedBoardIds.has(boardId)) return false;
    const board = boardDocsById.get(boardId);
    return (
      board &&
      (!board.aliasId || board.aliasId === aliasDoc.aliasId) &&
      (!board.database || board.database === aliasDoc.database)
    );
  });

  if (
    nextHistory.length === history.length &&
    nextHistory.every((boardId, index) => boardId === history[index])
  ) {
    return null;
  }

  return {
    ...aliasDoc,
    history: nextHistory,
    updatedAt: timestamp,
  };
};

/**
 * Run one bounded maintenance pass. Deletion is deliberately supplied by the
 * caller so the same safety rules can be used with CouchDB bulk-doc requests
 * without putting cleanup on ordinary page/API requests.
 */
export const cleanupArchivedDiscussionBoards = async ({
  listAliases,
  listBoards,
  listPosts,
  deleteDocs,
  updateAlias,
  getAlias,
  getBoard,
  database,
  dryRun = false,
  maxBoards = 100,
  deleteBatchSize = 100,
  now = Date.now,
} = {}) => {
  const [listedAliases, listedBoards] = await Promise.all([
    listAliases(),
    listBoards(),
  ]);
  const aliases = (Array.isArray(listedAliases) ? listedAliases : []).filter(
    (alias) => !database || alias?.database === database,
  );
  const allAliases = Array.isArray(listedAliases) ? listedAliases : [];
  const boards = Array.isArray(listedBoards) ? listedBoards : [];
  const boardDocsById = new Map(
    boards
      .map((board) => [String(board?.id || "").trim(), board])
      .filter(([boardId]) => boardId),
  );
  const currentBoardIds = new Set(
    allAliases
      .map((alias) => String(alias?.currentBoardId || "").trim())
      .filter(Boolean),
  );
  const cutoffMs = now() - DISCUSSION_BOARD_RETENTION_MS;
  const eligibleBoards = boards
    .filter(
      (board) =>
        (!database || board?.database === database) &&
        isExpiredArchivedBoard({ board, cutoffMs }),
    )
    .sort(
      (left, right) =>
        (getBoardArchiveTimestampMs(left) || 0) -
        (getBoardArchiveTimestampMs(right) || 0),
    );
  const selectedBoards = eligibleBoards.slice(0, Math.max(0, maxBoards));
  const plannedPurgeIds = new Set(
    selectedBoards
      .map((board) => String(board?.id || "").trim())
      .filter((boardId) => boardId && !currentBoardIds.has(boardId)),
  );

  const report = {
    inspectedAliasCount: aliases.length,
    inspectedBoardCount: boards.length,
    eligibleBoardCount: eligibleBoards.length,
    selectedBoardCount: selectedBoards.length,
    retainedRecentBoardCount: boards.filter(
      (board) =>
        (!database || board?.database === database) &&
        board?.archived === true &&
        !isExpiredArchivedBoard({ board, cutoffMs }),
    ).length,
    skippedCurrentBoardCount: 0,
    skippedMissingTimestampCount: boards.filter(
      (board) =>
        (!database || board?.database === database) &&
        board?.archived === true &&
        !Number.isFinite(getBoardArchiveTimestampMs(board)),
    ).length,
    purgedBoards: [],
    wouldPurgeBoards: [],
    failedBoards: [],
    deletedPostCount: 0,
    wouldDeletePostCount: 0,
    prunedAliasCount: 0,
    failedAliasUpdates: [],
  };

  for (const listedBoard of selectedBoards) {
    const listedBoardId = String(listedBoard?.id || "").trim();
    if (!listedBoardId) continue;

    try {
      const board = getBoard ? await getBoard(listedBoardId) : listedBoard;
      if (!board || !isExpiredArchivedBoard({ board, cutoffMs })) {
        plannedPurgeIds.delete(listedBoardId);
        continue;
      }

      const alias = board.aliasId
        ? getAlias
          ? await getAlias(board.aliasId)
          : allAliases.find((item) => item?.aliasId === board.aliasId)
        : null;
      if (alias?.currentBoardId === board.id || currentBoardIds.has(board.id)) {
        report.skippedCurrentBoardCount += 1;
        plannedPurgeIds.delete(board.id);
        continue;
      }

      const posts = await listPosts(board.id);
      if (dryRun) {
        report.wouldDeletePostCount += posts.length;
      } else {
        // Keep the board document in a separate final request. If a post
        // batch partially fails, the board remains available for the next
        // pass instead of leaving an orphaned post set behind.
        await deleteDocs(posts, { batchSize: deleteBatchSize });
        await deleteDocs([board], { batchSize: deleteBatchSize });
        report.deletedPostCount += posts.length;
      }

      const purge = {
        boardId: board.id,
        aliasId: board.aliasId || null,
        postCount: posts.length,
        archiveTimestamp: getBoardArchiveTimestampMs(board),
      };
      if (dryRun) report.wouldPurgeBoards.push(purge);
      else report.purgedBoards.push(purge);
    } catch (error) {
      plannedPurgeIds.delete(listedBoardId);
      report.failedBoards.push({
        boardId: listedBoardId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const historyPurgeIds = dryRun
    ? plannedPurgeIds
    : new Set(report.purgedBoards.map(({ boardId }) => boardId));
  for (const listedAlias of aliases) {
    try {
      const alias = getAlias
        ? await getAlias(listedAlias.aliasId)
        : listedAlias;
      const nextAlias = pruneAliasHistory({
        aliasDoc: alias,
        boardDocsById,
        purgedBoardIds: historyPurgeIds,
        timestamp: now(),
      });
      if (!nextAlias) continue;

      if (!dryRun) await updateAlias(nextAlias);
      report.prunedAliasCount += 1;
    } catch (error) {
      report.failedAliasUpdates.push({
        aliasId: listedAlias.aliasId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return report;
};
