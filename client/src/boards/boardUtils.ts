import { DBBoard, DBBoardAlias, DBBoardPost } from "../types";
import { buildShareableHashRouterUrl } from "../utils/environment";

export const BOARD_REMOTE_DB_NAME = "worship-sync-boards";
export const BOARD_ALIAS_ID_PREFIX = "alias:";
export const BOARD_ID_PREFIX = "board:";
export const BOARD_POST_ID_PREFIX = "post:";
export const BOARD_LOCAL_NAME_STORAGE_KEY = "worshipsyncBoardName";
export const BOARD_LOCAL_PARTICIPANT_ID_STORAGE_KEY =
  "worshipsyncBoardParticipantId";
export const BOARD_DISPLAY_ALIAS_STORAGE_KEY = "worshipsyncBoardDisplayAliasId";
export const BOARD_DISPLAY_ALIAS_CHANNEL_NAME = "worshipsync-board-display";

const trimString = (value: string) => value.trim();

/** Matches server `MAX_BOARD_AUTHOR_LENGTH` for client-side validation. */
export const MAX_BOARD_AUTHOR_LENGTH = 40;

/** Matches server `MAX_BOARD_TITLE_LENGTH` in `server/boardService.js`. */
export const BOARD_TITLE_MAX_LENGTH = 80;
/** Show length counter when approaching the limit (same idea as the board post composer). */
export const BOARD_TITLE_WARNING_THRESHOLD = 40;

/** Matches server `MAX_BOARD_POST_LENGTH` in `server/boardService.js`. */
export const BOARD_POST_MAX_LENGTH = 800;
/** Show length counter when approaching the post length limit. */
export const BOARD_POST_WARNING_THRESHOLD = 400;
export const DEFAULT_BOARD_PRESENTATION_FONT_SCALE = 1;
export const MIN_BOARD_PRESENTATION_FONT_SCALE = 0.5;
export const MAX_BOARD_PRESENTATION_FONT_SCALE = 2;
export const BOARD_PRESENTATION_FONT_SCALE_STEP = 0.1;

export const normalizeBoardAuthorKey = (value: string): string =>
  trimString(value).slice(0, MAX_BOARD_AUTHOR_LENGTH).toLowerCase();

export const normalizeBoardParticipantId = (
  value: string | undefined,
): string => (typeof value === "string" ? value.trim() : "").slice(0, 120);

/** Board posts created from WorshipSync (board controller) use this `authorId` prefix. */
export const WORSHIPSYNC_BOARD_POST_AUTHOR_ID_PREFIX = "worshipsync:";

export const buildWorshipSyncModeratorBoardPostAuthorId = (
  userId: string,
): string =>
  `${WORSHIPSYNC_BOARD_POST_AUTHOR_ID_PREFIX}${normalizeBoardParticipantId(userId)}`.slice(
    0,
    120,
  );

export const isWorshipSyncModeratorBoardPost = (post: {
  authorId?: string;
}): boolean =>
  normalizeBoardParticipantId(post.authorId).startsWith(
    WORSHIPSYNC_BOARD_POST_AUTHOR_ID_PREFIX,
  );

export const normalizeBoardPresentationFontScale = (value?: number): number => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_BOARD_PRESENTATION_FONT_SCALE;
  }

  const clamped = Math.min(
    MAX_BOARD_PRESENTATION_FONT_SCALE,
    Math.max(MIN_BOARD_PRESENTATION_FONT_SCALE, value),
  );

  return Math.round(clamped * 10) / 10;
};

/** Build responsive board post typography from a known layout width (not viewport `vw`). */
export const buildBoardPresentationClampFontSize = (
  presentationFontScale: number,
  {
    minRem,
    vwPercent,
    maxRem,
    layoutWidthPx,
  }: {
    minRem: number;
    vwPercent: number;
    maxRem: number;
    layoutWidthPx: number;
  },
): string => {
  const preferredPx = (vwPercent * presentationFontScale * layoutWidthPx) / 100;
  return `clamp(${minRem * presentationFontScale}rem, ${preferredPx}px, ${maxRem * presentationFontScale}rem)`;
};

/**
 * Same rules as server `isBoardAuthorInUse`: same display name is allowed only when
 * both the new participant and an existing post share the same author id.
 */
export const isBoardAuthorInUse = (
  posts: DBBoardPost[],
  { author, authorId }: { author: string; authorId: string },
): boolean => {
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

export const normalizeAliasId = (value: string): string =>
  trimString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");

export const getAliasDocId = (aliasId: string): string =>
  `${BOARD_ALIAS_ID_PREFIX}${aliasId}`;

export const getBoardDocId = (boardId: string): string =>
  `${BOARD_ID_PREFIX}${boardId}`;

export const getBoardPostRange = (boardId: string) => ({
  startkey: `${BOARD_POST_ID_PREFIX}${boardId}:`,
  endkey: `${BOARD_POST_ID_PREFIX}${boardId}:\ufff0`,
});

export const sortBoardPostsAscending = (posts: DBBoardPost[]): DBBoardPost[] =>
  [...posts].sort((a, b) => {
    if (a.timestamp !== b.timestamp) {
      return a.timestamp - b.timestamp;
    }
    return a._id.localeCompare(b._id);
  });

export const filterVisibleBoardPosts = (posts: DBBoardPost[]): DBBoardPost[] =>
  sortBoardPostsAscending(posts).filter(
    (post) => !post.hidden && !post.deleted,
  );

/**
 * True when the post was written by this participant (stable `authorId` match).
 * Used so a moderator-hidden post can still appear only to its author.
 */
export const isBoardPostOwnedByParticipant = (
  post: DBBoardPost,
  { authorId }: { authorId: string },
): boolean => {
  const postAuthorId = normalizeBoardParticipantId(post.authorId);
  const viewerId = normalizeBoardParticipantId(authorId);
  return Boolean(postAuthorId && viewerId && postAuthorId === viewerId);
};

/**
 * Attendee list: public posts plus hidden posts only for the participant who wrote them.
 * Legacy posts without `authorId` never surface as hidden-for-viewer (cannot prove ownership).
 */
export const getBoardPostsForAttendeeView = (
  posts: DBBoardPost[],
  viewer: { authorId: string },
): DBBoardPost[] =>
  sortBoardPostsAscending(posts).filter((post) => {
    if (post.deleted) {
      return false;
    }
    if (!post.hidden) return true;
    return isBoardPostOwnedByParticipant(post, viewer);
  });

/** Stable pastel text colors for author names (Tailwind safelist). */
const BOARD_AUTHOR_NAME_COLOR_CLASSES = [
  "text-sky-300",
  "text-emerald-300",
  "text-violet-300",
  "text-rose-300",
  "text-cyan-300",
  "text-fuchsia-300",
  "text-teal-300",
  "text-orange-300",
  "text-indigo-300",
  "text-amber-300",
] as const;

/** Hex equivalents of BOARD_AUTHOR_NAME_COLOR_CLASSES (same order, same index). */
const BOARD_AUTHOR_NAME_HEX_COLORS = [
  "#7dd3fc", // sky-300
  "#6ee7b7", // emerald-300
  "#c4b5fd", // violet-300
  "#fda4af", // rose-300
  "#67e8f9", // cyan-300
  "#f0abfc", // fuchsia-300
  "#5eead4", // teal-300
  "#fdba74", // orange-300
  "#a5b4fc", // indigo-300
  "#fcd34d", // amber-300
] as const;

const boardAuthorNameHashIndex = (post: {
  author: string;
  authorId?: string;
}): number | null => {
  const key =
    normalizeBoardParticipantId(post.authorId) ||
    normalizeBoardAuthorKey(post.author);
  if (!key) return null;
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % BOARD_AUTHOR_NAME_COLOR_CLASSES.length;
};

/**
 * Deterministic display color per author, preferring `authorId` when set so renames keep the same hue.
 */
export const getBoardAuthorNameColorClass = (post: {
  author: string;
  authorId?: string;
}): string => {
  const idx = boardAuthorNameHashIndex(post);
  if (idx === null) return "text-stone-200";
  return BOARD_AUTHOR_NAME_COLOR_CLASSES[idx];
};

/** Hex equivalent of {@link getBoardAuthorNameColorClass} for use in inline styles. */
export const getBoardAuthorNameHexColor = (post: {
  author: string;
  authorId?: string;
}): string => {
  const idx = boardAuthorNameHashIndex(post);
  if (idx === null) return "#e7e5e4"; // stone-200
  return BOARD_AUTHOR_NAME_HEX_COLORS[idx];
};

export const filterHighlightedBoardPosts = (
  posts: DBBoardPost[],
): DBBoardPost[] =>
  filterVisibleBoardPosts(posts).filter((post) => post.highlighted);

export const buildBoardRoute = (aliasId: string): string =>
  `/boards/${aliasId}`;

export const buildBoardPresentRoute = (aliasId: string): string =>
  `/boards/present/${aliasId}`;

export const buildBoardDisplayRoute = (): string => "/boards/display";

const buildBoardHashRouteUrl = (route: string): string =>
  buildShareableHashRouterUrl(route);

export const buildBoardPublicUrl = (
  aliasId: string,
  route: "board" | "present" = "board",
): string => {
  const hashRoute =
    route === "present"
      ? buildBoardPresentRoute(aliasId)
      : buildBoardRoute(aliasId);
  return buildBoardHashRouteUrl(hashRoute);
};

export const buildBoardDisplayUrl = (): string =>
  buildBoardHashRouteUrl(buildBoardDisplayRoute());

export const getStoredBoardDisplayAliasId = (): string =>
  normalizeAliasId(localStorage.getItem(BOARD_DISPLAY_ALIAS_STORAGE_KEY) ?? "");

export const setStoredBoardDisplayAliasId = (aliasId: string): string => {
  const normalizedAliasId = normalizeAliasId(aliasId);

  if (normalizedAliasId) {
    localStorage.setItem(BOARD_DISPLAY_ALIAS_STORAGE_KEY, normalizedAliasId);
  } else {
    localStorage.removeItem(BOARD_DISPLAY_ALIAS_STORAGE_KEY);
  }

  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(BOARD_DISPLAY_ALIAS_CHANNEL_NAME);
    channel.postMessage({
      type: "board-display-alias-changed",
      aliasId: normalizedAliasId,
    });
    channel.close();
  }

  return normalizedAliasId;
};

export const isCurrentBoardView = (
  alias: DBBoardAlias | null,
  boardId: string | null,
): boolean => {
  if (!alias) return false;
  return (boardId || alias.currentBoardId) === alias.currentBoardId;
};

export const formatBoardTimestamp = (timestamp?: number): string => {
  if (!timestamp) return "Unknown time";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
};

export const getBoardLabel = (board: DBBoard | undefined): string => {
  if (!board) return "Unknown session";
  return formatBoardTimestamp(board.createdAt);
};

/**
 * True when `timestamp` falls on an earlier local calendar day than `now`.
 * Used to auto-roll the discussion board and Restream sessions when the
 * operator opens the controller on a new day. Invalid or future timestamps
 * return false so we never reset a session we cannot confidently age.
 */
export const isTimestampFromPreviousLocalDay = (
  timestamp: number | undefined,
  now: number = Date.now(),
): boolean => {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    return false;
  }
  const then = new Date(timestamp);
  const today = new Date(now);
  const thenStartOfDay = new Date(
    then.getFullYear(),
    then.getMonth(),
    then.getDate(),
  ).getTime();
  const todayStartOfDay = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();
  return thenStartOfDay < todayStartOfDay;
};

/**
 * True when a board still holds posts and every one of them is from an earlier
 * local day — i.e. leftover content from a previous gathering with no activity
 * today. A single post from today means the session is in active use, so this
 * returns false and we never offer to roll it. Drives the "start fresh session"
 * prompt; we key on post activity, never on the board's creation date, because a
 * board created earlier can be filled with today's live posts.
 */
export const boardHasOnlyPreviousDayPosts = (
  posts: Pick<DBBoardPost, "timestamp">[],
  now: number = Date.now(),
): boolean =>
  posts.length > 0 &&
  posts.every((post) => isTimestampFromPreviousLocalDay(post.timestamp, now));

/**
 * True when a Restream session still has chat whose most recent activity was on
 * an earlier local day. Keyed on the last message/event time, never the session
 * start time, so a session that started earlier but is receiving today's chat is
 * treated as active. Drives the (permanent) "clear Restream chat" prompt.
 */
export const isRestreamChatFromPreviousDay = (
  session:
    | {
        enabled?: boolean;
        messageCount?: number;
        lastMessageAt?: number;
        lastEventAt?: number;
      }
    | null
    | undefined,
  now: number = Date.now(),
): boolean => {
  if (!session?.enabled) return false;
  if ((session.messageCount ?? 0) <= 0) return false;
  const lastActivityAt = session.lastMessageAt ?? session.lastEventAt;
  return (
    typeof lastActivityAt === "number" &&
    isTimestampFromPreviousLocalDay(lastActivityAt, now)
  );
};

const CHURCH_ADJECTIVES = [
  "Joyful",
  "Faithful",
  "Hopeful",
  "Graceful",
  "Peaceful",
  "Thankful",
  "Blessed",
  "Humble",
  "Prayerful",
  "Welcoming",
  "Singing",
  "Renewed",
  "Rejoicing",
  "Merciful",
  "Cheerful",
] as const;

const CHURCH_NOUNS = [
  "Visitor",
  "Friend",
  "Neighbor",
  "Guest",
  "Pilgrim",
  "Seeker",
  "Worshiper",
  "Steward",
  "Encourager",
  "Helper",
  "Traveler",
  "Peacemaker",
  "Listener",
] as const;

/** Short fun phrases (still moderator-safe). */
const CHURCH_FUN_PHRASES = [
  "Coffee Hour Hero",
  "Sunday School Star",
  "Pew Pal",
  "Potluck Pro",
  "Fellowship Fan",
  "Steeple Spotter",
  "Hymn Sing Hero",
  "Greeter Friend",
  "Welcome Team Pro",
  "Snack Table Star",
  "Sanctuary Seeker",
  "Bulletin Buddy",
  "Choir Loft Fan",
  "Offering Helper",
  "Altar Guild Ally",
  "Youth Group Guide",
  "Prayer Chain Pal",
  "Bible Study Buddy",
  "Hospitality Hero",
  "Sound Booth Star",
  "Welcome Desk Pro",
] as const;

const uniqueAnonymousNameSet = (() => {
  const set = new Set<string>();
  for (const adj of CHURCH_ADJECTIVES) {
    for (const noun of CHURCH_NOUNS) {
      set.add(`${adj} ${noun}`);
    }
  }
  for (const phrase of CHURCH_FUN_PHRASES) {
    set.add(phrase);
  }
  return set;
})();

/** Count of distinct strings the anonymous name generator can produce (adj+noun and phrases, deduped). */
export const getAnonymousDisplayNameUniqueCount = (): number =>
  uniqueAnonymousNameSet.size;

/** Random display name for attendees who prefer not to type a name (stays under server author limits). */
export const generateAnonymousDisplayName = (): string => {
  const rng = new Uint32Array(3);
  crypto.getRandomValues(rng);
  const usePhrase = rng[2] % 2 === 0;
  if (usePhrase) {
    return CHURCH_FUN_PHRASES[rng[0] % CHURCH_FUN_PHRASES.length];
  }
  const adj = CHURCH_ADJECTIVES[rng[0] % CHURCH_ADJECTIVES.length];
  const noun = CHURCH_NOUNS[rng[1] % CHURCH_NOUNS.length];
  return `${adj} ${noun}`;
};

const RANDOM_NAME_ATTEMPTS = 400;
const GUEST_FALLBACK_ATTEMPTS = 80;

export const generateAnonymousDisplayNameAvoidingDuplicates = (
  posts: DBBoardPost[],
  participantId: string,
): { ok: true; name: string } | { ok: false; error: string } => {
  const isFree = (name: string) =>
    !isBoardAuthorInUse(posts, { author: name, authorId: participantId });

  for (let i = 0; i < RANDOM_NAME_ATTEMPTS; i++) {
    const name = generateAnonymousDisplayName();
    if (isFree(name)) {
      return { ok: true, name };
    }
  }

  for (let i = 0; i < GUEST_FALLBACK_ATTEMPTS; i++) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const num = 100000 + (buf[0] % 900000);
    const name = `Guest ${num}`.slice(0, MAX_BOARD_AUTHOR_LENGTH);
    if (isFree(name)) {
      return { ok: true, name };
    }
  }

  return {
    ok: false,
    error: "Could not find an available display name. Try again in a moment.",
  };
};

export const getOrCreateBoardParticipantId = (): string => {
  const existing = localStorage
    .getItem(BOARD_LOCAL_PARTICIPANT_ID_STORAGE_KEY)
    ?.trim();

  if (existing) {
    return existing;
  }

  const nextId =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  localStorage.setItem(BOARD_LOCAL_PARTICIPANT_ID_STORAGE_KEY, nextId);
  return nextId;
};
