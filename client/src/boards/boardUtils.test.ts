import {
  buildBoardPresentationClampFontSize,
  buildBoardPublicUrl,
  buildWorshipSyncModeratorBoardPostAuthorId,
  filterHighlightedBoardPosts,
  filterVisibleBoardPosts,
  generateAnonymousDisplayName,
  getAliasDocId,
  getAnonymousDisplayNameUniqueCount,
  getBoardAuthorNameColorClass,
  getBoardPostRange,
  getBoardPostsForAttendeeView,
  isBoardAuthorInUse,
  boardHasOnlyPreviousDayPosts,
  isBoardPostOwnedByParticipant,
  isRestreamChatFromPreviousDay,
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

  it("builds board public URLs from the current window location in the browser", () => {
    expect(buildBoardPublicUrl("sunday", "board")).toBe(
      `${window.location.origin}${window.location.pathname}${window.location.search}#/boards/sunday`,
    );
    expect(buildBoardPublicUrl("sunday", "present")).toBe(
      `${window.location.origin}${window.location.pathname}${window.location.search}#/boards/present/sunday`,
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

describe("boardHasOnlyPreviousDayPosts", () => {
  const now = new Date(2026, 5, 14, 10, 0, 0).getTime();
  const yesterday = new Date(2026, 5, 13, 18, 0, 0).getTime();
  const lastWeek = new Date(2026, 5, 7, 18, 0, 0).getTime();
  const today = new Date(2026, 5, 14, 9, 30, 0).getTime();

  it("returns false when the board has no posts (nothing to roll)", () => {
    expect(boardHasOnlyPreviousDayPosts([], now)).toBe(false);
  });

  it("returns true when every post is from an earlier day", () => {
    const posts = [{ timestamp: lastWeek }, { timestamp: yesterday }];
    expect(boardHasOnlyPreviousDayPosts(posts, now)).toBe(true);
  });

  it("returns false when any post is from today (active session)", () => {
    const posts = [{ timestamp: yesterday }, { timestamp: today }];
    expect(boardHasOnlyPreviousDayPosts(posts, now)).toBe(false);
  });

  it("returns false when all posts are from today", () => {
    const posts = [{ timestamp: today }, { timestamp: today + 1000 }];
    expect(boardHasOnlyPreviousDayPosts(posts, now)).toBe(false);
  });
});

describe("isRestreamChatFromPreviousDay", () => {
  const now = new Date(2026, 5, 14, 10, 0, 0).getTime();
  const yesterday = new Date(2026, 5, 13, 20, 0, 0).getTime();
  const today = new Date(2026, 5, 14, 9, 0, 0).getTime();

  const base = {
    enabled: true,
    messageCount: 5,
    lastMessageAt: yesterday,
    lastEventAt: yesterday,
  };

  it("returns true for an enabled session whose last message was an earlier day", () => {
    expect(isRestreamChatFromPreviousDay(base, now)).toBe(true);
  });

  it("returns false when the last message is from today (active chat)", () => {
    expect(
      isRestreamChatFromPreviousDay(
        { ...base, lastMessageAt: today, lastEventAt: today },
        now,
      ),
    ).toBe(false);
  });

  it("returns false when there are no messages", () => {
    expect(
      isRestreamChatFromPreviousDay({ ...base, messageCount: 0 }, now),
    ).toBe(false);
  });

  it("returns false when the session is disabled", () => {
    expect(
      isRestreamChatFromPreviousDay({ ...base, enabled: false }, now),
    ).toBe(false);
  });

  it("returns false for a null session or missing activity timestamp", () => {
    expect(isRestreamChatFromPreviousDay(null, now)).toBe(false);
    expect(
      isRestreamChatFromPreviousDay({ enabled: true, messageCount: 3 }, now),
    ).toBe(false);
  });

  it("falls back to lastEventAt when lastMessageAt is absent", () => {
    expect(
      isRestreamChatFromPreviousDay(
        { enabled: true, messageCount: 2, lastEventAt: yesterday },
        now,
      ),
    ).toBe(true);
  });
});
