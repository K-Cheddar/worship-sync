import {
  BOARD_ALIAS_ID_PREFIX,
  BOARD_ID_PREFIX,
  BOARD_POST_ID_PREFIX,
} from "./boardUtils";

export type BoardLiveChange = {
  id?: string;
  deleted?: boolean;
  doc?: unknown;
};

export type BoardChangeHandlerContext = {
  /** Board currently shown in the posts feed. */
  viewedBoardId: string;
  /** Selected alias current board (for highlight badge when viewing archive). */
  currentBoardId: string;
  /** Board ids belonging to the selected alias (current + history). */
  selectedAliasBoardIds: ReadonlySet<string>;
};

export type BoardChangeAction =
  | { type: "ignore" }
  | { type: "reload-aliases-and-selected" }
  | { type: "active-board-post" }
  | { type: "alias-doc" }
  | { type: "reload-selected" };

const getPostBoardId = (changeId: string): string | null => {
  if (!changeId.startsWith(BOARD_POST_ID_PREFIX)) return null;
  const remainder = changeId.slice(BOARD_POST_ID_PREFIX.length);
  const separatorIndex = remainder.indexOf(":");
  if (separatorIndex <= 0) return null;
  return remainder.slice(0, separatorIndex);
};

const getBoardIdFromBoardDocId = (changeId: string): string | null => {
  if (!changeId.startsWith(BOARD_ID_PREFIX)) return null;
  return changeId.slice(BOARD_ID_PREFIX.length) || null;
};

/**
 * Decide how Board Moderation should react to a live PouchDB change.
 * Unrelated church docs (items, media, …) must not trigger full alias/view reloads.
 */
export const classifyBoardControllerChange = (
  change: BoardLiveChange | null | undefined,
  context: BoardChangeHandlerContext,
): BoardChangeAction => {
  if (!change || typeof change.id !== "string") {
    return { type: "reload-aliases-and-selected" };
  }

  const { id } = change;

  if (id.startsWith(BOARD_POST_ID_PREFIX)) {
    const postBoardId = getPostBoardId(id);
    if (!postBoardId) {
      return { type: "ignore" };
    }
    if (context.viewedBoardId && postBoardId === context.viewedBoardId) {
      return { type: "active-board-post" };
    }
    // Archive view still shows the live board's highlight count.
    if (
      context.currentBoardId &&
      postBoardId === context.currentBoardId &&
      postBoardId !== context.viewedBoardId
    ) {
      return { type: "reload-selected" };
    }
    return { type: "ignore" };
  }

  if (id.startsWith(BOARD_ALIAS_ID_PREFIX)) {
    // Missing doc (despite include_docs) must not silently drop the event.
    if (change.deleted || !change.doc) {
      return { type: "reload-aliases-and-selected" };
    }
    return { type: "alias-doc" };
  }

  if (id.startsWith(BOARD_ID_PREFIX)) {
    const boardId = getBoardIdFromBoardDocId(id);
    if (boardId && context.selectedAliasBoardIds.has(boardId)) {
      return { type: "reload-selected" };
    }
    return { type: "ignore" };
  }

  return { type: "ignore" };
};
