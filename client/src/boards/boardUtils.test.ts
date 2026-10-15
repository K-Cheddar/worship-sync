import {
  buildBoardPresentationClampFontSize,
  buildBoardPublicUrl,
  buildWorshipSyncModeratorBoardPostAuthorId,
  filterHighlightedBoardPosts,
  filterHighlightedRestreamMessages,
  countHighlightedPresentationItems,
  filterVisibleBoardPosts,
  generateAnonymousDisplayName,
  getAliasDocId,
  getAnonymousDisplayNameUniqueCount,
  getRestreamStatusIssues,
  getBoardAuthorNameColorClass,
  getBoardPostRange,
  getBoardPostsForAttendeeView,
  isBoardAuthorInUse,
  getStaleBoardSessionScope,
  isBoardPostOwnedByParticipant,
  isTimestampFromPreviousLocalDay,
  isWorshipSyncModeratorBoardPost,
  normalizeAliasId,
  sortBoardPostsAscending,
} from "./boardUtils";
import { DBBoardPost } from "../types";

const createPost = (overrides: Partial<DBBoardPost>): DBBoardPost => ({
  _id: "post:board-a:1",
  type: "post",
  docType: "board-post",
  id: "1",
  aliasId: "sunday",
  boardId: "board-a",
  database: "demo",
  text: "Hello",
  author: "Alex",
  timestamp: 1,
  hidden: false,
  highlighted: false,
  ...overrides,
});

describe("getRestreamStatusIssues", () => {
  it("does not repeat a last error already listed as a connection issue", () => {
    expect(
      getRestreamStatusIssues(
        ["YouTube: YouTube livechat ended"],
        "YouTube: YouTube livechat ended",
      ),
    ).toEqual(["YouTube: YouTube livechat ended"]);
  });

  it("keeps distinct connection issues and errors", () => {
    expect(
      getRestreamStatusIssues(["YouTube: YouTube livechat ended"], "Retrying"),
    ).toEqual(["YouTube: YouTube livechat ended", "Retrying"]);
  });
});

describe("boardUtils", () => {
  it("builds presentation font sizes from layout width instead of viewport vw", () => {
    expect(
      buildBoardPresentationClampFontSize(1, {
        minRem: 2.25,
        vwPercent: 3,
        maxRem: 5,
        layoutWidthPx: 1280,
      }),
    ).toBe("clamp(2.25rem, 38.4px, 5rem)");
  });

  it("builds board public URLs as path routes for link previews", () => {
    expect(buildBoardPublicUrl("sunday", "board")).toBe(
      `${window.location.origin}/boards/sunday`,
    );
    expect(buildBoardPublicUrl("sunday", "present")).toBe(
      `${window.location.origin}/boards/present/sunday`,
    );
  });

  it("normalizes alias ids for routes and docs", () => {
    expect(normalizeAliasId(" Sunday Guests / Questions ")).toBe(
      "sunday-guests-questions",
    );
    expect(normalizeAliasId("___")).toBe("");
  });

  it("builds alias and post prefix helpers", () => {
    expect(getAliasDocId("sunday")).toBe("alias:sunday");
    expect(getBoardPostRange("board-a")).toEqual({
      startkey: "post:board-a:",
      endkey: "post:board-a:\ufff0",
    });
  });

  it("detects WorshipSync moderator posts by author id prefix", () => {
    expect(
      isWorshipSyncModeratorBoardPost({ authorId: "worshipsync:abc" }),
    ).toBe(true);
    expect(
      isWorshipSyncModeratorBoardPost({ authorId: " worshipsync:abc " }),
    ).toBe(true);
    expect(isWorshipSyncModeratorBoardPost({ authorId: "device-1" })).toBe(
      false,
    );
    expect(isWorshipSyncModeratorBoardPost({})).toBe(false);
  });

  it("builds WorshipSync moderator author ids", () => {
    expect(buildWorshipSyncModeratorBoardPostAuthorId(" u1 ")).toBe(
      "worshipsync:u1",
    );
  });

  it("generates anonymous church-themed display names within author limits", () => {
    const name = generateAnonymousDisplayName();
    expect(name.trim()).toBe(name);
    expect(name.length).toBeGreaterThan(2);
    expect(name.length).toBeLessThanOrEqual(40);
    for (let i = 0; i < 200; i += 1) {
      expect(generateAnonymousDisplayName().length).toBeLessThanOrEqual(40);
    }
  });

  it("exposes at least 100 distinct anonymous name patterns", () => {
    expect(getAnonymousDisplayNameUniqueCount()).toBeGreaterThanOrEqual(100);
  });

  it("detects display name conflicts the same way as the board server", () => {
    const existing = createPost({
      author: "Alex",
      authorId: "device-a",
    });
    expect(
      isBoardAuthorInUse([existing], { author: "Alex", authorId: "device-b" }),
    ).toBe(true);
    expect(
      isBoardAuthorInUse([existing], { author: "Alex", authorId: "device-a" }),
    ).toBe(false);
    expect(
      isBoardAuthorInUse([existing], {
        author: "Jordan",
        authorId: "device-b",
      }),
    ).toBe(false);
    expect(
      isBoardAuthorInUse(
        [
          existing,
          createPost({ author: "Alex", authorId: "gone", deleted: true }),
        ],
        { author: "Alex", authorId: "device-b" },
      ),
    ).toBe(true);
  });

  it("sorts and filters public and highlighted posts", () => {
    const posts = [
      createPost({ _id: "post:board-a:3", id: "3", timestamp: 3 }),
      createPost({
        _id: "post:board-a:2",
        id: "2",
        timestamp: 2,
        hidden: true,
        highlighted: true,
      }),
      createPost({
        _id: "post:board-a:1",
        id: "1",
        timestamp: 1,
        highlighted: true,
      }),
    ];

    expect(sortBoardPostsAscending(posts).map((post) => post.id)).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(filterVisibleBoardPosts(posts).map((post) => post.id)).toEqual([
      "1",
      "3",
    ]);
    expect(filterHighlightedBoardPosts(posts).map((post) => post.id)).toEqual([
      "1",
    ]);

    const withDeleted = [
      ...posts,
      createPost({
        _id: "post:board-a:4",
        id: "4",
        timestamp: 4,
        deleted: true,
        highlighted: true,
      }),
    ];
    expect(filterVisibleBoardPosts(withDeleted).map((post) => post.id)).toEqual(
      ["1", "3"],
    );
    expect(
      filterHighlightedBoardPosts(withDeleted).map((post) => post.id),
    ).toEqual(["1"]);
  });

  it("filters highlighted restream messages and counts presentation items", () => {
    const posts = [
      createPost({ _id: "post:board-a:1", id: "1", highlighted: true }),
      createPost({
        _id: "post:board-a:2",
        id: "2",
        highlighted: true,
        hidden: true,
      }),
    ];
    const restreamMessages = [
      {
        id: "r1",
        kind: "viewer_message" as const,
        isHighlighted: true,
        hidden: false,
      },
      {
        id: "r2",
        kind: "viewer_message" as const,
        isHighlighted: true,
        hidden: true,
      },
      {
        id: "r3",
        kind: "moderator_reply" as const,
        isHighlighted: true,
        hidden: false,
      },
    ] as Parameters<typeof filterHighlightedRestreamMessages>[0];

    expect(
      filterHighlightedRestreamMessages(restreamMessages).map((m) => m.id),
    ).toEqual(["r1"]);
    expect(
      countHighlightedPresentationItems({
        boardPosts: posts,
        restreamMessages,
      }),
    ).toBe(2);
  });

  it("includes a hidden post only for the matching participant id", () => {
    const posts = [
      createPost({
        _id: "post:board-a:1",
        id: "1",
        authorId: "device-a",
        hidden: true,
      }),
      createPost({
        _id: "post:board-a:2",
        id: "2",
        authorId: "device-b",
        hidden: true,
      }),
      createPost({ _id: "post:board-a:3", id: "3", hidden: false }),
    ];

    expect(
      isBoardPostOwnedByParticipant(posts[0], { authorId: "device-a" }),
    ).toBe(true);
    expect(
      isBoardPostOwnedByParticipant(posts[0], { authorId: "device-b" }),
    ).toBe(false);

    expect(
      getBoardPostsForAttendeeView(posts, { authorId: "device-a" }).map(
        (post) => post.id,
      ),
    ).toEqual(["1", "3"]);
    expect(
      getBoardPostsForAttendeeView(posts, { authorId: "device-b" }).map(
        (post) => post.id,
      ),
    ).toEqual(["2", "3"]);
  });

  it("assigns a stable display color class per author key", () => {
    const a = getBoardAuthorNameColorClass({
      author: "Alex",
      authorId: "device-1",
    });
    const b = getBoardAuthorNameColorClass({
      author: "Alex",
      authorId: "device-1",
    });
    expect(a).toBe(b);
    expect(a.startsWith("text-")).toBe(true);
  });

  it("does not surface hidden posts without author id for any viewer", () => {
    const posts = [
      createPost({
        _id: "post:board-a:1",
        id: "1",
        authorId: undefined,
        hidden: true,
      }),
    ];

    expect(
      getBoardPostsForAttendeeView(posts, { authorId: "any-id" }).map(
        (post) => post.id,
      ),
    ).toEqual([]);
  });
});

describe("isTimestampFromPreviousLocalDay", () => {
  const now = new Date(2026, 5, 14, 10, 0, 0).getTime(); // Jun 14 2026, 10:00 local

  it("returns true for a timestamp on an earlier local calendar day", () => {
    const yesterdayLateNight = new Date(2026, 5, 13, 23, 59, 0).getTime();
    expect(isTimestampFromPreviousLocalDay(yesterdayLateNight, now)).toBe(true);
  });

  it("returns true across a multi-day gap (last week's session)", () => {
    const lastWeek = new Date(2026, 5, 7, 11, 0, 0).getTime();
    expect(isTimestampFromPreviousLocalDay(lastWeek, now)).toBe(true);
  });

  it("returns false for a timestamp earlier the same local day", () => {
    const earlierToday = new Date(2026, 5, 14, 0, 1, 0).getTime();
    expect(isTimestampFromPreviousLocalDay(earlierToday, now)).toBe(false);
  });

  it("returns false for a future timestamp", () => {
    const tomorrow = new Date(2026, 5, 15, 1, 0, 0).getTime();
    expect(isTimestampFromPreviousLocalDay(tomorrow, now)).toBe(false);
  });

  it("returns false for missing or invalid timestamps", () => {
    expect(isTimestampFromPreviousLocalDay(undefined, now)).toBe(false);
    expect(isTimestampFromPreviousLocalDay(Number.NaN, now)).toBe(false);
  });
});

describe("getStaleBoardSessionScope", () => {
  const now = new Date(2026, 9, 15, 12).getTime();
  const october10 = new Date(2026, 9, 10, 12).getTime();

  it("reproduces an empty October 10 board and ended Restream session on October 15", () => {
    expect(
      getStaleBoardSessionScope({
        boardCreatedAt: october10,
        boardPosts: [],
        restreamStartedAt: october10,
        restreamActivityTimestamps: [october10],
        now,
      }),
    ).toBe("both");
  });

  it("does not reset a board with any activity today", () => {
    expect(
      getStaleBoardSessionScope({
        boardCreatedAt: october10,
        boardPosts: [{ timestamp: now }],
        restreamStartedAt: october10,
        restreamActivityTimestamps: [october10],
        now,
      }),
    ).toBe("restream");
  });

  it("does not reset Restream when it has activity today", () => {
    expect(
      getStaleBoardSessionScope({
        boardCreatedAt: october10,
        boardPosts: [],
        restreamStartedAt: october10,
        restreamActivityTimestamps: [now],
        now,
      }),
    ).toBe("board");
  });

  it("returns null when sessions started today", () => {
    expect(
      getStaleBoardSessionScope({
        boardCreatedAt: now,
        boardPosts: [],
        restreamStartedAt: now,
        restreamActivityTimestamps: [],
        now,
      }),
    ).toBeNull();
  });
});
