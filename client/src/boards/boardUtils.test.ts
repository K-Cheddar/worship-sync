import {
  buildBoardPublicUrl,
  filterHighlightedBoardPosts,
  filterVisibleBoardPosts,
  generateAnonymousDisplayName,
  getAliasDocId,
  getAnonymousDisplayNameUniqueCount,
  getBoardAuthorNameColorClass,
  getBoardPostRange,
  getBoardPostsForAttendeeView,
  isBoardAuthorInUse,
  isBoardPostOwnedByParticipant,
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
