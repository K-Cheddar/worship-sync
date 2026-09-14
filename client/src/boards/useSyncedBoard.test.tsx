import { act, render, screen, waitFor } from "@testing-library/react";
import type PouchDB from "pouchdb-browser";
import { useBoardSync } from "./BoardSyncContext";
import {
  useSyncedBoardPosts,
} from "./useSyncedBoard";
import type { BoardSyncChange } from "./BoardSyncContext";
import type { DBBoardAlias, DBBoardPost } from "../types";
import { filterHighlightedBoardPosts } from "./boardUtils";

jest.mock("./BoardSyncContext", () => ({
  __esModule: true,
  useBoardSync: jest.fn(),
}));

const mockUseBoardSync = jest.mocked(useBoardSync);

const makeAlias = (
  aliasId: string,
  currentBoardId: string,
  history: string[] = [],
): DBBoardAlias => ({
  _id: `alias:${aliasId}`,
  _rev: "1-a",
  type: "alias",
  aliasId,
  title: `${aliasId} board`,
  database: "test",
  currentBoardId,
  history,
  createdAt: 1,
  updatedAt: 1,
});

const makePost = (
  boardId: string,
  id: string,
  text: string,
  highlighted: boolean,
  timestamp: number,
): DBBoardPost => ({
  _id: `post:${boardId}:${id}`,
  _rev: "1-p",
  type: "post",
  id,
  aliasId: "sunday",
  boardId,
  database: "test",
  text,
  author: "Operator",
  timestamp,
  hidden: false,
  highlighted,
});

const HighlightedPostsProbe = ({ aliasId }: { aliasId: string }) => {
  const { posts, hasLoadedOnce, error } = useSyncedBoardPosts(aliasId);
  return (
    <div>
      <output data-testid="loaded">{String(hasLoadedOnce)}</output>
      <output data-testid="error">{error}</output>
      <ul>
        {filterHighlightedBoardPosts(posts).map((post) => (
          <li key={post._id}>{post.text}</li>
        ))}
      </ul>
    </div>
  );
};

type TestBoardDb = {
  db: PouchDB.Database;
  setAlias: (alias: DBBoardAlias) => void;
  setPosts: (boardId: string, posts: DBBoardPost[]) => void;
  emit: (change: BoardSyncChange) => void;
  listeners: BoardSyncChangeListener[];
};

type BoardSyncChangeListener = (change: BoardSyncChange) => void;

const createTestBoardDb = (): TestBoardDb => {
  const aliases: Record<string, DBBoardAlias> = {
    sunday: makeAlias("sunday", "board-current"),
    other: makeAlias("other", "board-other"),
  };
  const postsByBoard: Record<string, DBBoardPost[]> = {
    "board-current": [
      makePost("board-current", "initial", "Initial highlight", true, 1),
    ],
    "board-other": [
      makePost("board-other", "other", "Other highlight", true, 2),
    ],
    "board-next": [
      makePost("board-next", "next", "Next highlight", true, 3),
    ],
  };
  const listeners: BoardSyncChangeListener[] = [];

  const db = {
    get: jest.fn(async (id: string) => {
      const aliasId = id.replace(/^alias:/, "");
      const alias = aliases[aliasId];
      if (!alias) throw new Error(`Missing alias: ${aliasId}`);
      return alias;
    }),
    allDocs: jest.fn(async (options: { startkey: string }) => {
      const boardId = options.startkey
        .replace(/^post:/, "")
        .replace(/:$/, "");
      return {
        rows: (postsByBoard[boardId] ?? []).map((doc) => ({ doc })),
      };
    }),
  } as unknown as PouchDB.Database;

  return {
    db,
    setAlias: (alias) => {
      aliases[alias.aliasId] = alias;
    },
    setPosts: (boardId, posts) => {
      postsByBoard[boardId] = posts;
    },
    emit: (change) => {
      listeners.forEach((listener) => listener(change));
    },
    listeners,
  };
};

const renderSyncedPosts = (testDb: TestBoardDb, aliasId = "sunday") => {
  mockUseBoardSync.mockReturnValue({
    db: testDb.db,
    status: "connected",
    connectionStatus: { status: "connected", retryCount: 0 },
    subscribeToChanges: (listener) => {
      testDb.listeners.push(listener);
      return () => undefined;
    },
    pullFromRemote: jest.fn(),
    retryNow: jest.fn(),
  });

  return render(<HighlightedPostsProbe aliasId={aliasId} />);
};

describe("useSyncedBoardPosts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("loads highlighted posts locally and applies one-document changes without an HTTP refresh", async () => {
    const testDb = createTestBoardDb();
    renderSyncedPosts(testDb);

    expect(await screen.findByText("Initial highlight")).toBeInTheDocument();
    expect(testDb.db.allDocs).toHaveBeenCalledTimes(1);

    const updatedPost = makePost(
      "board-current",
      "updated",
      "Newly highlighted",
      true,
      4,
    );
    await act(async () => {
      testDb.emit({ id: updatedPost._id, doc: updatedPost });
    });
    expect(await screen.findByText("Newly highlighted")).toBeInTheDocument();
    expect(testDb.db.allDocs).toHaveBeenCalledTimes(1);

    await act(async () => {
      testDb.emit({
        id: updatedPost._id,
        doc: { ...updatedPost, highlighted: false },
      });
    });
    await waitFor(() =>
      expect(screen.queryByText("Newly highlighted")).not.toBeInTheDocument(),
    );
  });

  it("removes deleted highlighted posts and shows newly created highlighted posts", async () => {
    const testDb = createTestBoardDb();
    renderSyncedPosts(testDb);

    expect(await screen.findByText("Initial highlight")).toBeInTheDocument();

    await act(async () => {
      testDb.emit({
        id: "post:board-current:initial",
        deleted: true,
      });
    });
    await waitFor(() =>
      expect(screen.queryByText("Initial highlight")).not.toBeInTheDocument(),
    );

    const createdPost = makePost(
      "board-current",
      "created",
      "Created highlight",
      true,
      5,
    );
    await act(async () => {
      testDb.emit({ id: createdPost._id, doc: createdPost });
    });
    expect(await screen.findByText("Created highlight")).toBeInTheDocument();
  });

  it("does not let a previous board or alias change mutate the new view", async () => {
    const testDb = createTestBoardDb();
    const { rerender } = renderSyncedPosts(testDb);

    expect(await screen.findByText("Initial highlight")).toBeInTheDocument();
    const oldListener = testDb.listeners[0];

    testDb.setAlias(makeAlias("other", "board-other"));
    rerender(<HighlightedPostsProbe aliasId="other" />);
    expect(await screen.findByText("Other highlight")).toBeInTheDocument();

    await act(async () => {
      oldListener?.({
        id: "post:board-current:late",
        doc: makePost("board-current", "late", "Stale old post", true, 6),
      });
    });
    expect(screen.queryByText("Stale old post")).not.toBeInTheDocument();

    testDb.setAlias(makeAlias("other", "board-next", ["board-other"]));
    await act(async () => {
      testDb.emit({
        id: "alias:other",
        doc: makeAlias("other", "board-next", ["board-other"]),
      });
      testDb.emit({
        id: "post:board-other:late",
        doc: makePost("board-other", "late", "Stale current post", true, 7),
      });
    });

    expect(await screen.findByText("Next highlight")).toBeInTheDocument();
    expect(screen.queryByText("Stale current post")).not.toBeInTheDocument();
  });
});
