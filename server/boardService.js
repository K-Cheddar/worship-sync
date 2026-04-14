import { randomUUID } from "node:crypto";
import profanityFilter from "leo-profanity";

export const BOARD_DB_NAME = "worship-sync-boards";
export const BOARD_ALIAS_ID_PREFIX = "alias:";
export const BOARD_ID_PREFIX = "board:";
export const BOARD_POST_ID_PREFIX = "post:";
export const MAX_BOARD_TITLE_LENGTH = 80;
export const MAX_BOARD_AUTHOR_LENGTH = 40;
export const MAX_BOARD_POST_LENGTH = 800;
export const DEFAULT_BOARD_PRESENTATION_FONT_SCALE = 1;
export const MIN_BOARD_PRESENTATION_FONT_SCALE = 0.5;
export const MAX_BOARD_PRESENTATION_FONT_SCALE = 2;

const trimString = (value) => (typeof value === "string" ? value.trim() : "");

profanityFilter.loadDictionary("en");

export const containsBoardProfanity = (value) =>
  profanityFilter.check(trimString(String(value || "")));

export const normalizeAliasId = (value) => {
  const trimmed = trimString(value).toLowerCase();
  return trimmed
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
};

export const normalizeBoardTitle = (value) =>
  trimString(value).slice(0, MAX_BOARD_TITLE_LENGTH);

export const normalizeBoardAuthor = (value) =>
  trimString(value).slice(0, MAX_BOARD_AUTHOR_LENGTH);

export const normalizeBoardAuthorKey = (value) =>
  normalizeBoardAuthor(value).toLowerCase();

export const normalizeBoardParticipantId = (value) =>
  trimString(value).slice(0, 120);

export const normalizeBoardText = (value) =>
  trimString(value).slice(0, MAX_BOARD_POST_LENGTH);

export const normalizeBoardPresentationFontScale = (value) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_BOARD_PRESENTATION_FONT_SCALE;
  }

  const clamped = Math.min(
    MAX_BOARD_PRESENTATION_FONT_SCALE,
    Math.max(MIN_BOARD_PRESENTATION_FONT_SCALE, value),
  );

  return Math.round(clamped * 10) / 10;
};

export const getAliasDocId = (aliasId) => `${BOARD_ALIAS_ID_PREFIX}${aliasId}`;
export const getBoardDocId = (boardId) => `${BOARD_ID_PREFIX}${boardId}`;
export const getBoardPostDocId = (boardId, postId) =>
  `${BOARD_POST_ID_PREFIX}${boardId}:${postId}`;

export const createBoardId = () => randomUUID();
export const createBoardPostId = () => randomUUID();

export const validateAliasInput = ({ aliasId, title, database }) => {
  const normalizedAliasId = normalizeAliasId(aliasId);
  const normalizedTitle = normalizeBoardTitle(title);
  const normalizedDatabase = trimString(database);

  if (!normalizedAliasId) {
    return { ok: false, error: "Link name is required." };
  }

  if (!normalizedTitle) {
    return { ok: false, error: "Title is required." };
  }

  if (!normalizedDatabase) {
    return { ok: false, error: "Database is required." };
  }

  return {
    ok: true,
    value: {
      aliasId: normalizedAliasId,
      title: normalizedTitle,
      database: normalizedDatabase,
    },
  };
};

export const validateBoardPostInput = ({ author, authorId, text }) => {
  const normalizedAuthor = normalizeBoardAuthor(author);
  const normalizedAuthorId = normalizeBoardParticipantId(authorId);
  const normalizedText = normalizeBoardText(text);

  if (!normalizedAuthor) {
    return { ok: false, error: "Display name is required." };
  }

  if (!normalizedText) {
    return { ok: false, error: "Post text is required." };
  }

  if (containsBoardProfanity(normalizedAuthor)) {
    return { ok: false, error: "Display name contains profanity." };
  }

  if (containsBoardProfanity(normalizedText)) {
    return { ok: false, error: "Posts with profanity are not allowed." };
  }

  return {
    ok: true,
    value: {
      author: normalizedAuthor,
      authorId: normalizedAuthorId,
      text: normalizedText,
    },
  };
};

/** Attendee update of an existing post (message body only). */
export const validateBoardPostTextUpdate = ({ text }) => {
  const normalizedText = normalizeBoardText(text);

  if (!normalizedText) {
    return { ok: false, error: "Post text is required." };
  }

  if (containsBoardProfanity(normalizedText)) {
    return { ok: false, error: "Posts with profanity are not allowed." };
  }

  return { ok: true, value: { text: normalizedText } };
};

/**
 * Ensures the post belongs to this board alias and current session, and that
 * `requestAuthorId` matches the post's stored participant id.
 */
export const assertAttendeeCanMutateBoardPost = ({
  aliasDoc,
  postDoc,
  requestAuthorId,
}) => {
  if (!postDoc || postDoc.docType !== "board-post") {
    return { ok: false, status: 404, error: "Post not found." };
  }

  if (postDoc.aliasId !== aliasDoc.aliasId) {
    return { ok: false, status: 404, error: "Post not found." };
  }

  if (postDoc.boardId !== aliasDoc.currentBoardId) {
    return {
      ok: false,
      status: 410,
      error: "This post is from a past session and cannot be changed.",
    };
  }

  const postAuthorId = normalizeBoardParticipantId(postDoc.authorId);
  const normalizedRequest = normalizeBoardParticipantId(requestAuthorId);

  if (!postAuthorId) {
    return {
      ok: false,
      status: 403,
      error: "This post cannot be changed from the discussion board.",
    };
  }

  if (!normalizedRequest || normalizedRequest !== postAuthorId) {
    return {
      ok: false,
      status: 403,
      error: "You can only edit or delete your own posts.",
    };
  }

  if (postDoc.deleted) {
    return { ok: false, status: 404, error: "Post not found." };
  }

  return { ok: true };
};

export const isBoardAuthorInUse = (posts, { author, authorId }) => {
  const normalizedAuthorKey = normalizeBoardAuthorKey(author);
  const normalizedAuthorId = normalizeBoardParticipantId(authorId);

  if (!normalizedAuthorKey) return false;

  return posts.some((post) => {
    if (post.deleted) {
      return false;
    }

    const postAuthorKey = normalizeBoardAuthorKey(post.author);
    if (postAuthorKey !== normalizedAuthorKey) {
      return false;
    }

    const postAuthorId = normalizeBoardParticipantId(post.authorId);
    if (normalizedAuthorId && postAuthorId) {
      return postAuthorId !== normalizedAuthorId;
    }

    return true;
  });
};

export const createBoardDoc = ({
  aliasId,
  database,
  boardId = createBoardId(),
  timestamp = Date.now(),
}) => ({
  _id: getBoardDocId(boardId),
  type: "board",
  docType: "board",
  id: boardId,
  aliasId,
  database,
  createdAt: timestamp,
  archived: false,
});

export const createAliasDoc = ({
  aliasId,
  title,
  database,
  boardId,
  presentationFontScale = DEFAULT_BOARD_PRESENTATION_FONT_SCALE,
  timestamp = Date.now(),
}) => ({
  _id: getAliasDocId(aliasId),
  type: "alias",
  docType: "board-alias",
  aliasId,
  title,
  database,
  currentBoardId: boardId,
  history: [],
  presentationFontScale: normalizeBoardPresentationFontScale(
    presentationFontScale,
  ),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const archiveBoardDoc = (boardDoc) => ({
  ...boardDoc,
  archived: true,
});

export const rotateAliasDoc = ({
  aliasDoc,
  nextBoardId,
  timestamp = Date.now(),
}) => ({
  ...aliasDoc,
  currentBoardId: nextBoardId,
  history: aliasDoc.currentBoardId
    ? [...(aliasDoc.history || []), aliasDoc.currentBoardId]
    : [...(aliasDoc.history || [])],
  presentationFontScale: normalizeBoardPresentationFontScale(
    aliasDoc.presentationFontScale,
  ),
  updatedAt: timestamp,
});

export const updateAliasPresentationFontScale = ({
  aliasDoc,
  presentationFontScale,
  timestamp = Date.now(),
}) => ({
  ...aliasDoc,
  presentationFontScale: normalizeBoardPresentationFontScale(
    presentationFontScale,
  ),
  updatedAt: timestamp,
});

export const createBoardPostDoc = ({
  aliasId,
  boardId,
  database,
  author,
  authorId,
  text,
  timestamp = Date.now(),
  postId = createBoardPostId(),
}) => ({
  _id: getBoardPostDocId(boardId, postId),
  type: "post",
  docType: "board-post",
  id: postId,
  aliasId,
  boardId,
  database,
  text,
  author,
  authorId: normalizeBoardParticipantId(authorId),
  timestamp,
  hidden: false,
  highlighted: false,
  deleted: false,
});

export const getBoardPostRange = (boardId) => ({
  startkey: `${BOARD_POST_ID_PREFIX}${boardId}:`,
  endkey: `${BOARD_POST_ID_PREFIX}${boardId}:\ufff0`,
});

export const sortBoardPostsAscending = (posts) =>
  [...posts].sort((a, b) => {
    if (a.timestamp !== b.timestamp) {
      return a.timestamp - b.timestamp;
    }
    return a._id.localeCompare(b._id);
  });

export const filterVisibleBoardPosts = (posts) =>
  sortBoardPostsAscending(posts).filter(
    (post) => !post.hidden && !post.deleted,
  );

export const filterHighlightedBoardPosts = (posts) =>
  filterVisibleBoardPosts(posts).filter((post) => post.highlighted);
