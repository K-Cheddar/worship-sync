import test from "node:test";
import assert from "node:assert/strict";
import {
  archiveBoardDoc,
  containsBoardProfanity,
  createAliasDoc,
  createBoardDoc,
  createBoardPostDoc,
  DEFAULT_BOARD_PRESENTATION_FONT_SCALE,
  filterHighlightedBoardPosts,
  filterVisibleBoardPosts,
  getBoardPostRange,
  isBoardAuthorInUse,
  normalizeAliasId,
  normalizeBoardPresentationFontScale,
  rotateAliasDoc,
  updateAliasPresentationFontScale,
  validateAliasInput,
  validateBoardPostInput,
} from "./boardService.js";

test("normalizeAliasId keeps board aliases URL safe", () => {
  assert.equal(normalizeAliasId(" Sunday Q&A / Guests "), "sunday-q-a-guests");
  assert.equal(normalizeAliasId("___"), "");
});

test("validateAliasInput normalizes and validates create payloads", () => {
  assert.deepEqual(
    validateAliasInput({
      aliasId: " Easter Night ",
      title: " Easter Night Board ",
      database: " demo ",
    }),
    {
      ok: true,
      value: {
        aliasId: "easter-night",
        title: "Easter Night Board",
        database: "demo",
      },
    },
  );

  assert.deepEqual(
    validateAliasInput({ aliasId: "", title: "Board", database: "demo" }),
    { ok: false, error: "Link name is required." },
  );
});

test("validateBoardPostInput trims attendee submissions", () => {
  assert.deepEqual(
    validateBoardPostInput({
      author: "  Alex  ",
      authorId: " participant-1 ",
      text: "  Please pray for our team.  ",
    }),
    {
      ok: true,
      value: {
        author: "Alex",
        authorId: "participant-1",
        text: "Please pray for our team.",
      },
    },
  );

  assert.deepEqual(validateBoardPostInput({ author: "", text: "Hello" }), {
    ok: false,
    error: "Display name is required.",
  });
});

test("validateBoardPostInput blocks profanity in names and messages", () => {
  assert.equal(containsBoardProfanity("shit"), true);

  assert.deepEqual(
    validateBoardPostInput({ author: "shit", text: "Hello there" }),
    {
      ok: false,
      error: "Display name contains profanity.",
    },
  );

  assert.deepEqual(
    validateBoardPostInput({ author: "Alex", text: "This is shit rude" }),
    {
      ok: false,
      error: "Posts with profanity are not allowed.",
    },
  );
});

test("isBoardAuthorInUse blocks duplicate names from different devices only", () => {
  const existingPost = createBoardPostDoc({
    aliasId: "sunday",
    boardId: "board-1",
    database: "demo",
    postId: "post-1",
    author: "Alex",
    authorId: "device-1",
    text: "One",
    timestamp: 1,
  });

  assert.equal(
    isBoardAuthorInUse([existingPost], {
      author: " alex ",
      authorId: "device-1",
    }),
    false,
  );

  assert.equal(
    isBoardAuthorInUse([existingPost], {
      author: "ALEX",
      authorId: "device-2",
    }),
    true,
  );

  assert.equal(
    isBoardAuthorInUse(
      [
        {
          ...existingPost,
          authorId: "",
        },
      ],
      {
        author: "Alex",
        authorId: "device-1",
      },
    ),
    true,
  );
});

test("rotateAliasDoc preserves board history order", () => {
  const aliasDoc = createAliasDoc({
    aliasId: "sunday",
    title: "Sunday Board",
    database: "demo",
    boardId: "board-a",
    timestamp: 100,
  });

  const rotated = rotateAliasDoc({
    aliasDoc,
    nextBoardId: "board-b",
    timestamp: 200,
  });

  assert.equal(rotated.currentBoardId, "board-b");
  assert.deepEqual(rotated.history, ["board-a"]);
  assert.equal(rotated.presentationFontScale, DEFAULT_BOARD_PRESENTATION_FONT_SCALE);
  assert.equal(rotated.updatedAt, 200);
});

test("presentation font scale is clamped and saved on alias docs", () => {
  const aliasDoc = createAliasDoc({
    aliasId: "sunday",
    title: "Sunday Board",
    database: "demo",
    boardId: "board-a",
    presentationFontScale: 9,
    timestamp: 100,
  });

  assert.equal(aliasDoc.presentationFontScale, 2);
  assert.equal(normalizeBoardPresentationFontScale(0.1), 0.5);

  const updated = updateAliasPresentationFontScale({
    aliasDoc,
    presentationFontScale: 1.2,
    timestamp: 200,
  });

  assert.equal(updated.presentationFontScale, 1.2);
  assert.equal(updated.updatedAt, 200);
});

test("board docs and archived docs keep expected identifiers", () => {
  const boardDoc = createBoardDoc({
    aliasId: "youth",
    database: "demo",
    boardId: "board-youth",
    timestamp: 123,
  });

  assert.equal(boardDoc._id, "board:board-youth");
  assert.equal(boardDoc.docType, "board");
  assert.equal(archiveBoardDoc(boardDoc).archived, true);
});

test("post helpers build deterministic prefixes and public filters", () => {
  const visibleHighlighted = createBoardPostDoc({
    aliasId: "sunday",
    boardId: "board-1",
    database: "demo",
    postId: "post-1",
    author: "A",
    text: "One",
    timestamp: 2,
  });
  visibleHighlighted.highlighted = true;

  const hiddenHighlighted = createBoardPostDoc({
    aliasId: "sunday",
    boardId: "board-1",
    database: "demo",
    postId: "post-2",
    author: "B",
    text: "Two",
    timestamp: 1,
  });
  hiddenHighlighted.hidden = true;
  hiddenHighlighted.highlighted = true;

  const visiblePlain = createBoardPostDoc({
    aliasId: "sunday",
    boardId: "board-1",
    database: "demo",
    postId: "post-3",
    author: "C",
    text: "Three",
    timestamp: 3,
  });

  assert.deepEqual(getBoardPostRange("board-1"), {
    startkey: "post:board-1:",
    endkey: "post:board-1:\ufff0",
  });
  assert.deepEqual(
    filterVisibleBoardPosts([
      visiblePlain,
      hiddenHighlighted,
      visibleHighlighted,
    ]).map((post) => post.id),
    ["post-1", "post-3"],
  );
  assert.deepEqual(
    filterHighlightedBoardPosts([
      visiblePlain,
      hiddenHighlighted,
      visibleHighlighted,
    ]).map((post) => post.id),
    ["post-1"],
  );
});
