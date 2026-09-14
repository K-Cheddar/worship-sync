import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanupArchivedDiscussionBoards,
  DISCUSSION_BOARD_RETENTION_MS,
  isExpiredArchivedBoard,
  pruneAliasHistory,
} from "./boardMaintenance.js";

const createMaintenanceStore = () => {
  const now = 2_000_000_000_000;
  const aliases = new Map([
    [
      "sunday",
      {
        _id: "alias:sunday",
        aliasId: "sunday",
        database: "db-1",
        currentBoardId: "current-board",
        history: ["expired-board", "recent-board", "missing-board"],
      },
    ],
  ]);
  const boards = new Map([
    [
      "current-board",
      {
        _id: "board:current-board",
        id: "current-board",
        type: "board",
        docType: "board",
        aliasId: "sunday",
        database: "db-1",
        archived: true,
        archivedAt: now - DISCUSSION_BOARD_RETENTION_MS - 1,
      },
    ],
    [
      "expired-board",
      {
        _id: "board:expired-board",
        id: "expired-board",
        type: "board",
        docType: "board",
        aliasId: "sunday",
        database: "db-1",
        archived: true,
        archivedAt: now - DISCUSSION_BOARD_RETENTION_MS - 1,
      },
    ],
    [
      "recent-board",
      {
        _id: "board:recent-board",
        id: "recent-board",
        type: "board",
        docType: "board",
        aliasId: "sunday",
        database: "db-1",
        archived: true,
        archivedAt: now - 100 * 24 * 60 * 60 * 1000,
      },
    ],
  ]);
  const posts = new Map([
    [
      "expired-board",
      [
        {
          _id: "post:expired-board:post-1",
          boardId: "expired-board",
        },
      ],
    ],
  ]);

  return { aliases, boards, posts, now };
};

test("board retention identifies only old archived boards", () => {
  const now = 2_000_000_000_000;
  assert.equal(
    isExpiredArchivedBoard({
      board: {
        docType: "board",
        archived: true,
        createdAt: now - DISCUSSION_BOARD_RETENTION_MS - 1,
      },
      now,
    }),
    true,
  );
  assert.equal(
    isExpiredArchivedBoard({
      board: {
        docType: "board",
        archived: true,
        createdAt: now - DISCUSSION_BOARD_RETENTION_MS + 1,
      },
      now,
    }),
    false,
  );
  assert.equal(
    isExpiredArchivedBoard({
      board: { docType: "board", archived: false, createdAt: 1 },
      now,
    }),
    false,
  );
});

test("alias history pruning removes purged and missing IDs but preserves current", () => {
  const next = pruneAliasHistory({
    aliasDoc: {
      aliasId: "sunday",
      currentBoardId: "current-board",
      history: ["current-board", "old-board", "missing-board"],
    },
    boardDocsById: new Map([
      ["current-board", {}],
      ["old-board", {}],
    ]),
    purgedBoardIds: new Set(["old-board"]),
    timestamp: 123,
  });

  assert.deepEqual(next.history, []);
  assert.equal(next.updatedAt, 123);
});

test("archived-board cleanup protects current boards and is safe to repeat", async () => {
  const store = createMaintenanceStore();
  const deleted = [];
  const deleteDocs = async (docs) => {
    docs.forEach((doc) => {
      deleted.push(doc._id);
      if (doc.docType === "board") {
        store.boards.delete(doc.id);
      } else {
        const boardPosts = store.posts.get(doc.boardId) || [];
        store.posts.set(
          doc.boardId,
          boardPosts.filter((post) => post._id !== doc._id),
        );
      }
    });
  };

  const runCleanup = () =>
    cleanupArchivedDiscussionBoards({
      listAliases: async () => Array.from(store.aliases.values()),
      listBoards: async () => Array.from(store.boards.values()),
      listPosts: async (boardId) => store.posts.get(boardId) || [],
      deleteDocs,
      updateAlias: async (alias) => store.aliases.set(alias.aliasId, alias),
      getAlias: async (aliasId) => store.aliases.get(aliasId) || null,
      getBoard: async (boardId) => store.boards.get(boardId) || null,
      database: "db-1",
      now: () => store.now,
    });

  const first = await runCleanup();

  assert.deepEqual(first.purgedBoards.map(({ boardId }) => boardId), [
    "expired-board",
  ]);
  assert.equal(first.deletedPostCount, 1);
  assert.equal(first.prunedAliasCount, 1);
  assert.equal(store.boards.has("expired-board"), false);
  assert.equal(store.boards.has("current-board"), true);
  assert.equal(store.posts.has("expired-board"), true);
  assert.deepEqual(store.aliases.get("sunday").history, ["recent-board"]);
  assert.deepEqual(deleted, [
    "post:expired-board:post-1",
    "board:expired-board",
  ]);

  const second = await runCleanup();
  assert.deepEqual(second.purgedBoards, []);
  assert.deepEqual(second.failedBoards, []);
  assert.deepEqual(second.failedAliasUpdates, []);
  assert.deepEqual(store.aliases.get("sunday").history, ["recent-board"]);
});

test("archived-board cleanup leaves the board for a later retry when post deletion fails", async () => {
  const store = createMaintenanceStore();
  const firstDeleteBatch = [];
  const report = await cleanupArchivedDiscussionBoards({
    listAliases: async () => Array.from(store.aliases.values()),
    listBoards: async () => Array.from(store.boards.values()),
    listPosts: async (boardId) => store.posts.get(boardId) || [],
    deleteDocs: async (docs) => {
      firstDeleteBatch.push(docs.map((doc) => doc._id));
      throw new Error("temporary CouchDB failure");
    },
    updateAlias: async () => {
      throw new Error("alias should not be updated after a failed purge");
    },
    getAlias: async (aliasId) => store.aliases.get(aliasId) || null,
    getBoard: async (boardId) => store.boards.get(boardId) || null,
    database: "db-1",
    now: () => store.now,
  });

  assert.deepEqual(firstDeleteBatch, [["post:expired-board:post-1"]]);
  assert.equal(report.purgedBoards.length, 0);
  assert.equal(report.failedBoards.length, 1);
  assert.equal(store.boards.has("expired-board"), true);
  assert.deepEqual(store.aliases.get("sunday").history, [
    "expired-board",
    "recent-board",
    "missing-board",
  ]);
});
