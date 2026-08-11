import crypto from "node:crypto";

export const CHAT_MESSAGE_COLLECTION = "chatMessages";
export const CHAT_SETTINGS_COLLECTION = "chatSettings";
export const CHAT_MESSAGE_MAX_LENGTH = 1000;
export const CHAT_RETENTION_DAYS = 365;
export const CHAT_REACTION_EMOJIS = Object.freeze([
  "👍",
  "❤️",
  "😂",
  "🎉",
  "👏",
  "👀",
]);

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CLIENT_MESSAGE_ID_PATTERN = /^[A-Za-z0-9:_-]{8,160}$/;
const MAX_PAGE_SIZE = 100;
const LIVE_QUERY_LIMIT = 500;
const MESSAGE_RATE_LIMIT = 30;
const MESSAGE_RATE_WINDOW_MS = 60_000;

const createChatError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const timestampMs = (value) => {
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (typeof value === "string") return Date.parse(value);
  return 0;
};

export const isValidChatTimeZone = (value) => {
  const timeZone = String(value || "").trim();
  if (!timeZone || timeZone.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
};

export const chatDayKey = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${value.year}-${value.month}-${value.day}`;
};

const normalizeMessageText = (value) => {
  const text = String(value || "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (!text) throw createChatError("Write a message before sending it.");
  if (text.length > CHAT_MESSAGE_MAX_LENGTH) {
    throw createChatError(
      `Keep messages under ${CHAT_MESSAGE_MAX_LENGTH.toLocaleString()} characters.`,
    );
  }
  return text;
};

const normalizeClientMessageId = (value) => {
  const id = String(value || "").trim();
  if (!CLIENT_MESSAGE_ID_PATTERN.test(id)) {
    throw createChatError("That message could not be prepared. Try again.");
  }
  return id;
};

const chatMessageId = ({ churchId, actorId, clientMessageId }) =>
  `chat_${crypto
    .createHash("sha256")
    .update(`${churchId}:${actorId}:${clientMessageId}`)
    .digest("hex")
    .slice(0, 32)}`;

const isAlreadyExistsError = (error) =>
  error?.code === 6 ||
  error?.code === "already-exists" ||
  /already exists/i.test(String(error?.message || ""));

const normalizeDayKey = (value) => {
  const dayKey = String(value || "").trim();
  if (!DAY_KEY_PATTERN.test(dayKey)) {
    throw createChatError("Choose a valid chat date.");
  }
  return dayKey;
};

const serializeReaction = (reaction) => ({
  emoji: String(reaction?.emoji || ""),
  actors: Array.isArray(reaction?.actors)
    ? reaction.actors
        .map((actor) => ({
          actorId: String(actor?.actorId || ""),
          name: String(actor?.name || "Operator"),
        }))
        .filter((actor) => actor.actorId)
    : [],
});

export const serializeChatMessage = (doc) => ({
  messageId: String(doc?.messageId || doc?.id || ""),
  clientMessageId: String(doc?.clientMessageId || ""),
  churchId: String(doc?.churchId || ""),
  dayKey: String(doc?.dayKey || ""),
  text: String(doc?.text || ""),
  authorId: String(doc?.authorId || ""),
  authorName: String(doc?.authorName || "Operator"),
  authorSessionKind:
    doc?.authorSessionKind === "workstation" ? "workstation" : "human",
  createdAt: timestampMs(doc?.createdAt),
  editedAt: timestampMs(doc?.editedAt) || undefined,
  deletedAt: timestampMs(doc?.deletedAt) || undefined,
  reactions: Array.isArray(doc?.reactions)
    ? doc.reactions.map(serializeReaction).filter((reaction) => reaction.emoji)
    : [],
});

const actorFromSession = (session) => {
  const actorId = String(session?.actorId || session?.userId || "").trim();
  if (!actorId) {
    throw createChatError("This session cannot send chat messages.", 403);
  }
  return {
    actorId,
    name:
      String(session?.username || "Operator")
        .trim()
        .slice(0, 80) || "Operator",
    sessionKind:
      session?.sessionKind === "workstation" ? "workstation" : "human",
  };
};

export const createChatService = ({
  getFirestore,
  now = () => new Date(),
} = {}) => {
  const memoryMessages = new Map();
  const memorySettings = new Map();
  const memorySubscribers = new Map();
  const liveWatches = new Map();
  const rateWindows = new Map();

  const getDb = () => getFirestore?.() || null;
  const liveKey = (churchId, dayKey) => `${churchId}:${dayKey}`;

  const emitMemoryEvent = (churchId, dayKey, event) => {
    const subscribers = memorySubscribers.get(liveKey(churchId, dayKey));
    subscribers?.forEach((subscriber) => subscriber(event));
  };

  const resolveTimeZone = async (churchId, hint) => {
    const fallback = isValidChatTimeZone(hint) ? String(hint).trim() : "UTC";
    const db = getDb();
    if (!db) {
      if (!memorySettings.has(churchId)) memorySettings.set(churchId, fallback);
      return memorySettings.get(churchId);
    }

    const ref = db.collection(CHAT_SETTINGS_COLLECTION).doc(churchId);
    const existing = await ref.get();
    if (existing.exists && isValidChatTimeZone(existing.data()?.timeZone)) {
      return existing.data().timeZone;
    }
    await ref.set(
      { churchId, timeZone: fallback, createdAt: now(), updatedAt: now() },
      { merge: true },
    );
    return fallback;
  };

  const getContext = async ({ churchId, session, timeZoneHint }) => {
    const actor = actorFromSession(session);
    const timeZone = await resolveTimeZone(churchId, timeZoneHint);
    return {
      actorId: actor.actorId,
      actorName: actor.name,
      timeZone,
      todayKey: chatDayKey(now(), timeZone),
      retentionDays: CHAT_RETENTION_DAYS,
      reactionEmojis: [...CHAT_REACTION_EMOJIS],
    };
  };

  const assertDayInRetention = (dayKey, todayKey) => {
    const normalized = normalizeDayKey(dayKey);
    if (normalized > todayKey) {
      throw createChatError("That chat day has not started yet.");
    }
    const earliest = new Date(`${todayKey}T00:00:00.000Z`);
    earliest.setUTCDate(earliest.getUTCDate() - CHAT_RETENTION_DAYS);
    if (normalized < earliest.toISOString().slice(0, 10)) {
      throw createChatError("That chat day is no longer available.", 404);
    }
    return normalized;
  };

  const listMessages = async ({
    churchId,
    session,
    dayKey,
    timeZoneHint,
    limit = 50,
    before,
  }) => {
    const context = await getContext({ churchId, session, timeZoneHint });
    const selectedDayKey = assertDayInRetention(
      dayKey || context.todayKey,
      context.todayKey,
    );
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(limit) || 50));
    const beforeMs = Number(before) || 0;
    const db = getDb();

    let messages;
    if (db) {
      let query = db
        .collection(CHAT_MESSAGE_COLLECTION)
        .where("churchId", "==", churchId)
        .where("dayKey", "==", selectedDayKey)
        .orderBy("createdAt", "desc");
      if (beforeMs > 0)
        query = query.where("createdAt", "<", new Date(beforeMs));
      const snapshot = await query.limit(pageSize).get();
      messages = snapshot.docs
        .map((snapshotDoc) =>
          serializeChatMessage({ id: snapshotDoc.id, ...snapshotDoc.data() }),
        )
        .reverse();
    } else {
      messages = Array.from(memoryMessages.values())
        .filter(
          (message) =>
            message.churchId === churchId &&
            message.dayKey === selectedDayKey &&
            (!beforeMs || timestampMs(message.createdAt) < beforeMs),
        )
        .sort((a, b) => timestampMs(b.createdAt) - timestampMs(a.createdAt))
        .slice(0, pageSize)
        .reverse()
        .map(serializeChatMessage);
    }

    return {
      context,
      dayKey: selectedDayKey,
      messages,
      hasMore: messages.length === pageSize,
    };
  };

  const enforceMessageRateLimit = (churchId, actorId) => {
    const key = `${churchId}:${actorId}`;
    const currentMs = now().getTime();
    const recent = (rateWindows.get(key) || []).filter(
      (entry) => currentMs - entry < MESSAGE_RATE_WINDOW_MS,
    );
    if (recent.length >= MESSAGE_RATE_LIMIT) {
      throw createChatError(
        "Too many messages at once. Wait a moment and try again.",
        429,
      );
    }
    recent.push(currentMs);
    rateWindows.set(key, recent);
  };

  const createMessage = async ({
    churchId,
    session,
    text,
    clientMessageId,
    timeZoneHint,
  }) => {
    const actor = actorFromSession(session);
    enforceMessageRateLimit(churchId, actor.actorId);
    const normalizedText = normalizeMessageText(text);
    const normalizedClientId = normalizeClientMessageId(clientMessageId);
    const context = await getContext({ churchId, session, timeZoneHint });
    const messageId = chatMessageId({
      churchId,
      actorId: actor.actorId,
      clientMessageId: normalizedClientId,
    });
    const createdAt = now();
    const expiresAt = new Date(
      createdAt.getTime() + CHAT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const message = {
      messageId,
      clientMessageId: normalizedClientId,
      churchId,
      dayKey: context.todayKey,
      text: normalizedText,
      authorId: actor.actorId,
      authorName: actor.name,
      authorSessionKind: actor.sessionKind,
      createdAt,
      expiresAt,
      reactions: [],
    };
    const db = getDb();
    if (db) {
      const ref = db.collection(CHAT_MESSAGE_COLLECTION).doc(messageId);
      try {
        await ref.create(message);
      } catch (error) {
        if (!isAlreadyExistsError(error)) throw error;
        const existing = await ref.get();
        if (!existing.exists) throw error;
        return serializeChatMessage({ id: existing.id, ...existing.data() });
      }
    } else {
      const existing = memoryMessages.get(messageId);
      if (existing) return serializeChatMessage(existing);
      memoryMessages.set(messageId, message);
      emitMemoryEvent(churchId, message.dayKey, {
        type: "message-updated",
        message: serializeChatMessage(message),
      });
    }
    return serializeChatMessage(message);
  };

  const updateMessage = async ({ churchId, session, messageId, text }) => {
    const actor = actorFromSession(session);
    const normalizedText = normalizeMessageText(text);
    const db = getDb();
    let updated;
    if (db) {
      const ref = db.collection(CHAT_MESSAGE_COLLECTION).doc(messageId);
      updated = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists)
          throw createChatError("That message is no longer available.", 404);
        const current = { id: snapshot.id, ...snapshot.data() };
        if (current.churchId !== churchId)
          throw createChatError("That message is not available.", 403);
        if (current.authorId !== actor.actorId)
          throw createChatError("You can only edit your own messages.", 403);
        if (current.deletedAt)
          throw createChatError("That message was already removed.", 409);
        const next = { ...current, text: normalizedText, editedAt: now() };
        transaction.update(ref, { text: next.text, editedAt: next.editedAt });
        return next;
      });
    } else {
      const current = memoryMessages.get(messageId);
      if (!current)
        throw createChatError("That message is no longer available.", 404);
      if (current.churchId !== churchId)
        throw createChatError("That message is not available.", 403);
      if (current.authorId !== actor.actorId)
        throw createChatError("You can only edit your own messages.", 403);
      if (current.deletedAt)
        throw createChatError("That message was already removed.", 409);
      updated = { ...current, text: normalizedText, editedAt: now() };
      memoryMessages.set(messageId, updated);
      emitMemoryEvent(churchId, updated.dayKey, {
        type: "message-updated",
        message: serializeChatMessage(updated),
      });
    }
    return serializeChatMessage(updated);
  };

  const deleteMessage = async ({ churchId, session, messageId }) => {
    const actor = actorFromSession(session);
    const canModerate = session?.role === "admin";
    const db = getDb();
    let updated;
    if (db) {
      const ref = db.collection(CHAT_MESSAGE_COLLECTION).doc(messageId);
      updated = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists)
          throw createChatError("That message is no longer available.", 404);
        const current = { id: snapshot.id, ...snapshot.data() };
        if (current.churchId !== churchId)
          throw createChatError("That message is not available.", 403);
        if (current.authorId !== actor.actorId && !canModerate) {
          throw createChatError("You can only remove your own messages.", 403);
        }
        const next = { ...current, text: "", deletedAt: now(), reactions: [] };
        transaction.update(ref, {
          text: "",
          deletedAt: next.deletedAt,
          reactions: [],
        });
        return next;
      });
    } else {
      const current = memoryMessages.get(messageId);
      if (!current)
        throw createChatError("That message is no longer available.", 404);
      if (current.churchId !== churchId)
        throw createChatError("That message is not available.", 403);
      if (current.authorId !== actor.actorId && !canModerate) {
        throw createChatError("You can only remove your own messages.", 403);
      }
      updated = { ...current, text: "", deletedAt: now(), reactions: [] };
      memoryMessages.set(messageId, updated);
      emitMemoryEvent(churchId, updated.dayKey, {
        type: "message-updated",
        message: serializeChatMessage(updated),
      });
    }
    return serializeChatMessage(updated);
  };

  const toggleReaction = async ({ churchId, session, messageId, emoji }) => {
    const actor = actorFromSession(session);
    const normalizedEmoji = String(emoji || "").trim();
    if (!CHAT_REACTION_EMOJIS.includes(normalizedEmoji)) {
      throw createChatError("Choose an available reaction.");
    }

    const applyToggle = (current) => {
      if (current.deletedAt)
        throw createChatError("That message was removed.", 409);
      const reactions = Array.isArray(current.reactions)
        ? current.reactions.map(serializeReaction)
        : [];
      const reaction = reactions.find((item) => item.emoji === normalizedEmoji);
      if (!reaction) {
        reactions.push({
          emoji: normalizedEmoji,
          actors: [{ actorId: actor.actorId, name: actor.name }],
        });
      } else {
        const alreadyReacted = reaction.actors.some(
          (item) => item.actorId === actor.actorId,
        );
        reaction.actors = alreadyReacted
          ? reaction.actors.filter((item) => item.actorId !== actor.actorId)
          : [...reaction.actors, { actorId: actor.actorId, name: actor.name }];
      }
      return {
        ...current,
        reactions: reactions.filter((item) => item.actors.length > 0),
        updatedAt: now(),
      };
    };

    const db = getDb();
    let updated;
    if (db) {
      const ref = db.collection(CHAT_MESSAGE_COLLECTION).doc(messageId);
      updated = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists)
          throw createChatError("That message is no longer available.", 404);
        const current = { id: snapshot.id, ...snapshot.data() };
        if (current.churchId !== churchId)
          throw createChatError("That message is not available.", 403);
        const next = applyToggle(current);
        transaction.update(ref, {
          reactions: next.reactions,
          updatedAt: next.updatedAt,
        });
        return next;
      });
    } else {
      const current = memoryMessages.get(messageId);
      if (!current)
        throw createChatError("That message is no longer available.", 404);
      if (current.churchId !== churchId)
        throw createChatError("That message is not available.", 403);
      updated = applyToggle(current);
      memoryMessages.set(messageId, updated);
      emitMemoryEvent(churchId, updated.dayKey, {
        type: "message-updated",
        message: serializeChatMessage(updated),
      });
    }
    return serializeChatMessage(updated);
  };

  const subscribe = ({ churchId, dayKey, onEvent }) => {
    const selectedDayKey = normalizeDayKey(dayKey);
    const key = liveKey(churchId, selectedDayKey);
    const db = getDb();
    if (!db) {
      const subscribers = memorySubscribers.get(key) || new Set();
      subscribers.add(onEvent);
      memorySubscribers.set(key, subscribers);
      queueMicrotask(() => {
        if (subscribers.has(onEvent)) onEvent({ type: "stream-ready" });
      });
      return () => {
        subscribers.delete(onEvent);
        if (!subscribers.size) memorySubscribers.delete(key);
      };
    }

    let entry = liveWatches.get(key);
    if (!entry) {
      const listeners = new Set();
      entry = { listeners, unsubscribe: null, initialized: false };
      liveWatches.set(key, entry);
      const query = db
        .collection(CHAT_MESSAGE_COLLECTION)
        .where("churchId", "==", churchId)
        .where("dayKey", "==", selectedDayKey)
        .orderBy("createdAt", "desc")
        .limit(LIVE_QUERY_LIMIT);
      const unsubscribe = query.onSnapshot(
        (snapshot) => {
          snapshot.docChanges().forEach((change) => {
            if (change.type === "removed") return;
            const message = serializeChatMessage({
              id: change.doc.id,
              ...change.doc.data(),
            });
            listeners.forEach((listener) =>
              listener({ type: "message-updated", message }),
            );
          });
          if (!entry.initialized) {
            entry.initialized = true;
            listeners.forEach((listener) =>
              listener({ type: "stream-ready" }),
            );
          }
        },
        (error) => {
          listeners.forEach((listener) =>
            listener({
              type: "stream-error",
              message: error?.message || "Chat updates paused.",
            }),
          );
        },
      );
      entry.unsubscribe = unsubscribe;
    }
    entry.listeners.add(onEvent);
    if (entry.initialized) onEvent({ type: "stream-ready" });
    return () => {
      entry.listeners.delete(onEvent);
      if (!entry.listeners.size) {
        entry.unsubscribe?.();
        liveWatches.delete(key);
      }
    };
  };

  return {
    getContext,
    listMessages,
    createMessage,
    updateMessage,
    deleteMessage,
    toggleReaction,
    subscribe,
  };
};
