import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import axios from "axios";
import {
  createRestreamService,
  normalizeRestreamPostedAtMs,
} from "./restreamService.js";

const createFirestoreMock = () => {
  const collections = new Map();
  let transactionChain = Promise.resolve();
  let transactionCommitError = null;
  const metrics = {
    documentGets: 0,
    queryGets: [],
  };

  const getCollectionMap = (name) => {
    if (!collections.has(name)) {
      collections.set(name, new Map());
    }
    return collections.get(name);
  };

  const clone = (value) => JSON.parse(JSON.stringify(value));

  const buildDocSnapshot = (id, value) => ({
    id,
    exists: value !== undefined,
    data: () => (value === undefined ? undefined : clone(value)),
  });

  const buildQuery = (
    name,
    filters = [],
    resultLimit = null,
    ordering = null,
  ) => ({
    doc(id) {
      const collection = getCollectionMap(name);
      return {
        async get() {
          metrics.documentGets += 1;
          return buildDocSnapshot(id, collection.get(id));
        },
        async set(data, options = {}) {
          const current = collection.get(id) || {};
          collection.set(
            id,
            options.merge ? { ...current, ...clone(data) } : clone(data),
          );
        },
        async update(data) {
          if (!collection.has(id)) {
            const error = new Error("Not found");
            error.code = 5;
            throw error;
          }
          collection.set(id, { ...collection.get(id), ...clone(data) });
        },
        async create(data) {
          if (collection.has(id)) {
            const error = new Error("Already exists");
            error.code = 6;
            throw error;
          }
          collection.set(id, clone(data));
        },
        async delete() {
          collection.delete(id);
        },
      };
    },
    where(field, operator, value) {
      assert.equal(operator, "==");
      return buildQuery(
        name,
        [...filters, { field, value }],
        resultLimit,
        ordering,
      );
    },
    limit(limitValue) {
      return buildQuery(name, filters, limitValue, ordering);
    },
    orderBy(field, direction = "asc") {
      assert.ok(["asc", "desc"].includes(direction));
      return buildQuery(name, filters, resultLimit, { field, direction });
    },
    async get() {
      const entries = Array.from(getCollectionMap(name).entries())
        .filter(([, doc]) =>
          filters.every(({ field, value }) => doc?.[field] === value),
        );
      if (ordering) {
        entries.sort(([leftId, left], [rightId, right]) => {
          const leftValue = left?.[ordering.field] ?? 0;
          const rightValue = right?.[ordering.field] ?? 0;
          if (leftValue === rightValue) {
            return String(leftId).localeCompare(String(rightId));
          }
          const comparison = leftValue < rightValue ? -1 : 1;
          return ordering.direction === "desc" ? -comparison : comparison;
        });
      }
      const allRows = entries.map(([id, doc]) => buildDocSnapshot(id, doc));
      const rows =
        resultLimit === null ? allRows : allRows.slice(0, resultLimit);
      metrics.queryGets.push({
        name,
        filters,
        limit: resultLimit,
        orderBy: ordering,
        returned: rows.length,
      });
      return { docs: rows, empty: rows.length === 0 };
    },
  });

  const firestore = {
    collection(name) {
      return buildQuery(name);
    },
    runTransaction(callback) {
      const run = transactionChain.then(async () => {
        const writes = [];
        const transaction = {
          get(ref) {
            return ref.get();
          },
          set(ref, data, options = {}) {
            writes.push({ ref, data, options });
          },
          update(ref, data) {
            writes.push({ ref, data });
          },
        };
        const result = await callback(transaction);
        if (transactionCommitError) {
          const error = transactionCommitError;
          transactionCommitError = null;
          throw error;
        }
        for (const write of writes) {
          if (write.options) {
            await write.ref.set(write.data, write.options);
          } else {
            await write.ref.update(write.data);
          }
        }
        return result;
      });
      transactionChain = run.catch(() => undefined);
      return run;
    },
    seed(collectionName, id, value) {
      getCollectionMap(collectionName).set(id, clone(value));
    },
    read(collectionName, id) {
      const value = getCollectionMap(collectionName).get(id);
      return value ? clone(value) : undefined;
    },
    failNextTransactionCommit(error = new Error("Transaction failed")) {
      transactionCommitError = error;
    },
    metrics,
  };
  return firestore;
};

const createRealtimeDbMock = () => {
  const updates = [];
  const root = {};

  const clone = (value) => JSON.parse(JSON.stringify(value));

  const splitPath = (path) =>
    String(path || "")
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean);

  const getAtPath = (path) => {
    const parts = splitPath(path);
    let current = root;
    for (const part of parts) {
      if (!current || typeof current !== "object" || !(part in current)) {
        return undefined;
      }
      current = current[part];
    }
    return current;
  };

  const ensureParent = (path) => {
    const parts = splitPath(path);
    let current = root;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index];
      if (!current[part] || typeof current[part] !== "object") {
        current[part] = {};
      }
      current = current[part];
    }
    return { parent: current, key: parts[parts.length - 1] || "" };
  };

  const setAtPath = (path, value) => {
    const { parent, key } = ensureParent(path);
    parent[key] = clone(value);
  };

  const removeAtPath = (path) => {
    const parts = splitPath(path);
    let current = root;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index];
      if (!current || typeof current !== "object" || !(part in current)) {
        return;
      }
      current = current[part];
    }
    delete current?.[parts[parts.length - 1]];
  };

  const buildSnapshot = (value) => ({
    exists: () => value !== undefined,
    val: () => (value === undefined ? undefined : clone(value)),
  });

  return {
    updates,
    root,
    ref(path) {
      return {
        async get() {
          return buildSnapshot(getAtPath(path));
        },
        async set(value) {
          setAtPath(path, value);
        },
        async update(patch) {
          const current = getAtPath(path);
          const next =
            current && typeof current === "object" ? { ...current } : {};
          Object.assign(next, clone(patch));
          setAtPath(path, next);
          updates.push({ path, patch: JSON.parse(JSON.stringify(patch)) });
        },
        async remove() {
          removeAtPath(path);
        },
      };
    },
    read(path) {
      const value = getAtPath(path);
      return value === undefined ? undefined : clone(value);
    },
  };
};

const createServiceHarness = ({
  useFirestore = true,
  realtimeDb,
  firestore: providedFirestore,
} = {}) => {
  const firestore = providedFirestore || createFirestoreMock();
  const database = realtimeDb || createRealtimeDbMock();
  const boardDisplayUpdates = [];
  const service = createRestreamService({
    getFirestore: useFirestore ? () => firestore : () => null,
    getRealtimeDatabase: () => database,
    getIntegrationsPath: (churchId) => `churches/${churchId}/data/integrations`,
    onBoardDisplayUpdate: (database) => boardDisplayUpdates.push(database),
    redirectBaseUrl: "https://example.com",
  });

  return { firestore, realtimeDb: database, boardDisplayUpdates, service };
};

const waitFor = async (predicate, timeoutMs = 1000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for asynchronous test work");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

test("normalizeRestreamPostedAtMs converts Unix seconds to ms", () => {
  assert.equal(normalizeRestreamPostedAtMs(1778629519), 1778629519000);
});

test("normalizeRestreamPostedAtMs leaves millisecond values unchanged", () => {
  assert.equal(normalizeRestreamPostedAtMs(1778629519000), 1778629519000);
});

test("normalizeRestreamPostedAtMs returns undefined for non-finite", () => {
  assert.equal(normalizeRestreamPostedAtMs(undefined), undefined);
  assert.equal(normalizeRestreamPostedAtMs(Number.NaN), undefined);
});

test("restream service creates a default disconnected session status", async () => {
  const { service } = createServiceHarness();

  const result = await service.getStatusForChurch({
    churchId: "church-1",
    database: "db-1",
  });

  assert.equal(result.oauthConfigured, false);
  assert.equal(result.bestEffortOnly, true);
  assert.equal(result.session.churchId, "church-1");
  assert.equal(result.session.database, "db-1");
  assert.equal(result.session.connected, false);
  assert.equal(result.session.enabled, false);
  assert.equal(result.session.connectionState, "disconnected");
  assert.equal(result.session.messageCount, 0);
});

test("restream service initializes one shared session across instances", async () => {
  const firestore = createFirestoreMock();
  firestore.seed("restreamTokens", "church-1", {
    churchId: "church-1",
    database: "db-1",
    accountLabel: "Main account",
  });
  const first = createServiceHarness({ firestore });
  const second = createServiceHarness({ firestore });

  const [firstStatus, secondStatus] = await Promise.all([
    first.service.getStatusForChurch({ churchId: "church-1", database: "db-1" }),
    second.service.getStatusForChurch({ churchId: "church-1", database: "db-1" }),
  ]);
  const session = firestore.read("restreamSessions", "db-1");

  assert.ok(session?.sessionId);
  assert.equal(firstStatus.session.sessionId, session.sessionId);
  assert.equal(secondStatus.session.sessionId, session.sessionId);
  assert.equal(session.messageCount, 0);
});

test("restream service lists current-session messages newest first", async () => {
  const { firestore, service } = createServiceHarness();

  firestore.seed("restreamSessions", "db-1", {
    churchId: "church-1",
    database: "db-1",
    sessionId: "session-1",
    startedAt: 100,
    messageCount: 2,
  });
  firestore.seed("restreamMessages", "m1", {
    churchId: "church-1",
    database: "db-1",
    sessionId: "session-1",
    author: "Alex",
    text: "First",
    postedAt: 10,
    isHighlighted: false,
    hidden: false,
  });
  firestore.seed("restreamMessages", "m2", {
    churchId: "church-1",
    database: "db-1",
    sessionId: "session-1",
    author: "Jamie",
    text: "Second",
    postedAt: 20,
    isHighlighted: false,
    hidden: false,
  });

  const messages = await service.listCurrentSessionMessages({
    churchId: "church-1",
    database: "db-1",
  });

  assert.deepEqual(
    messages.map((message) => message.id),
    ["m2", "m1"],
  );
  const messageQuery = firestore.metrics.queryGets.at(-1);
  assert.equal(messageQuery.limit, 500);
  assert.deepEqual(messageQuery.orderBy, {
    field: "postedAt",
    direction: "desc",
  });
});

test("restream service limits current-session Firestore reads", async () => {
  const { firestore, service } = createServiceHarness();
  firestore.seed("restreamSessions", "db-1", {
    churchId: "church-1",
    database: "db-1",
    sessionId: "session-large",
    startedAt: 100,
    messageCount: 501,
  });
  for (let index = 0; index < 501; index += 1) {
    firestore.seed("restreamMessages", `message-${index}`, {
      churchId: "church-1",
      database: "db-1",
      sessionId: "session-large",
      author: "Viewer",
      text: `Message ${index}`,
      postedAt: index,
      isHighlighted: false,
      hidden: false,
    });
  }

  const messages = await service.listCurrentSessionMessages({
    churchId: "church-1",
    database: "db-1",
  });
  const messageQuery = firestore.metrics.queryGets.at(-1);

  assert.equal(messages.length, 500);
  assert.equal(messages[0].postedAt, 500);
  assert.equal(messages.at(-1).postedAt, 1);
  assert.equal(messageQuery.limit, 500);
  assert.equal(messageQuery.returned, 500);
  assert.deepEqual(messageQuery.orderBy, {
    field: "postedAt",
    direction: "desc",
  });
});

test("restream service highlights, hides, and filters highlighted messages", async () => {
  const { firestore, boardDisplayUpdates, service } = createServiceHarness();

  firestore.seed("restreamSessions", "db-1", {
    churchId: "church-1",
    database: "db-1",
    sessionId: "session-1",
    startedAt: 100,
    messageCount: 1,
  });
  firestore.seed("restreamMessages", "m1", {
    churchId: "church-1",
    database: "db-1",
    sessionId: "session-1",
    author: "Alex",
    text: "Highlight me",
    postedAt: 10,
    isHighlighted: false,
    hidden: false,
  });

  await service.setMessageHighlighted({
    churchId: "church-1",
    database: "db-1",
    messageId: "m1",
    highlighted: true,
    actorName: "Moderator",
    actorId: "user-1",
  });

  let stored = firestore.read("restreamMessages", "m1");
  assert.equal(stored.isHighlighted, true);
  assert.equal(stored.highlightedBy, "Moderator");
  assert.deepEqual(boardDisplayUpdates, ["db-1"]);

  let highlighted = await service.listHighlightedMessagesForDatabase("db-1");
  assert.deepEqual(
    highlighted.map((message) => message.id),
    ["m1"],
  );

  await service.setMessageHidden({
    churchId: "church-1",
    database: "db-1",
    messageId: "m1",
    hidden: true,
    actorName: "Moderator",
    actorId: "user-1",
  });

  stored = firestore.read("restreamMessages", "m1");
  assert.equal(stored.hidden, true);
  assert.equal(stored.isHighlighted, false);

  highlighted = await service.listHighlightedMessagesForDatabase("db-1");
  assert.deepEqual(highlighted, []);
});

test("restream service rejects highlight updates for moderator reply messages", async () => {
  const { firestore, service } = createServiceHarness();

  firestore.seed("restreamSessions", "db-1", {
    churchId: "church-1",
    database: "db-1",
    sessionId: "session-1",
    startedAt: 100,
    messageCount: 1,
  });
  firestore.seed("restreamMessages", "mod1", {
    churchId: "church-1",
    database: "db-1",
    sessionId: "session-1",
    author: "Host",
    text: "Hello chat",
    postedAt: 10,
    kind: "moderator_reply",
    isHighlighted: false,
    hidden: false,
  });

  await assert.rejects(
    () =>
      service.setMessageHighlighted({
        churchId: "church-1",
        database: "db-1",
        messageId: "mod1",
        highlighted: true,
        actorName: "Moderator",
        actorId: "user-1",
      }),
    /Moderator reply messages cannot be highlighted/,
  );
});

test("restream service omits moderator replies from highlighted display list", async () => {
  const { firestore, service } = createServiceHarness();

  firestore.seed("restreamSessions", "db-1", {
    churchId: "church-1",
    database: "db-1",
    sessionId: "session-1",
    startedAt: 100,
    messageCount: 2,
  });
  firestore.seed("restreamMessages", "mod1", {
    churchId: "church-1",
    database: "db-1",
    sessionId: "session-1",
    author: "Host",
    text: "Mod note",
    postedAt: 15,
    kind: "moderator_reply",
    isHighlighted: true,
    hidden: false,
  });
  firestore.seed("restreamMessages", "v1", {
    churchId: "church-1",
    database: "db-1",
    sessionId: "session-1",
    author: "Fan",
    text: "Hi",
    postedAt: 10,
    kind: "viewer_message",
    isHighlighted: true,
    hidden: false,
  });

  const highlighted = await service.listHighlightedMessagesForDatabase("db-1");
  assert.deepEqual(
    highlighted.map((message) => message.id),
    ["v1"],
  );
});

test("restream service resets the session without touching prior message documents", async () => {
  const { firestore, realtimeDb, boardDisplayUpdates, service } =
    createServiceHarness();

  firestore.seed("restreamTokens", "church-1", {
    churchId: "church-1",
    database: "db-1",
    accountLabel: "Main account",
  });
  firestore.seed("restreamSessions", "db-1", {
    churchId: "church-1",
    database: "db-1",
    sessionId: "session-1",
    startedAt: 100,
    messageCount: 2,
    lastEventAt: 200,
  });
  firestore.seed("restreamMessages", "m1", {
    churchId: "church-1",
    database: "db-1",
    sessionId: "session-1",
    text: "Existing message",
    postedAt: 50,
    isHighlighted: false,
    hidden: false,
  });

  await service.resetSession({
    churchId: "church-1",
    database: "db-1",
  });

  const session = firestore.read("restreamSessions", "db-1");
  assert.notEqual(session.sessionId, "session-1");
  assert.equal(session.messageCount, 0);
  assert.equal(session.accountLabel, "Main account");
  assert.ok(typeof session.startedAt === "number");

  const existingMessage = firestore.read("restreamMessages", "m1");
  assert.equal(existingMessage.sessionId, "session-1");

  assert.deepEqual(boardDisplayUpdates, ["db-1"]);
  assert.ok(
    realtimeDb.updates.some(
      (entry) =>
        entry.path === "churches/church-1/data/integrations/restream" &&
        typeof entry.patch.sessionStartedAt === "number",
    ),
  );
});

test("restream service auto-resets chat once a new stream goes live after a long idle gap", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalClientId = process.env.RESTREAM_CLIENT_ID;
  const originalClientSecret = process.env.RESTREAM_CLIENT_SECRET;

  const sockets = [];
  globalThis.WebSocket = class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      sockets.push(this);
    }

    addEventListener(type, handler) {
      const next = this.listeners.get(type) || [];
      next.push(handler);
      this.listeners.set(type, next);
    }

    emit(type, payload) {
      const handlers = this.listeners.get(type) || [];
      handlers.forEach((handler) => handler(payload));
    }

    close() {
      return undefined;
    }
  };
  process.env.RESTREAM_CLIENT_ID = "client-id";
  process.env.RESTREAM_CLIENT_SECRET = "client-secret";

  try {
    const { firestore, boardDisplayUpdates, service } = createServiceHarness();
    firestore.seed("restreamTokens", "church-1", {
      churchId: "church-1",
      database: "db-1",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      accessTokenExpiresAt: Date.now() + 3_600_000,
      accountLabel: "Main account",
    });
    firestore.seed("restreamSessions", "db-1", {
      churchId: "church-1",
      database: "db-1",
      sessionId: "session-last-week",
      startedAt: 100,
      messageCount: 2,
      connected: false,
      wentIdleAt: Date.now() - 10 * 60 * 1000,
    });
    firestore.seed("restreamMessages", "m1", {
      churchId: "church-1",
      database: "db-1",
      sessionId: "session-last-week",
      text: "Last week's message",
      postedAt: 50,
      isHighlighted: false,
      hidden: false,
    });

    await service.ensureReceiver("church-1");
    sockets[0].emit("open");
    sockets[0].emit("message", {
      data: JSON.stringify({
        action: "connection_info",
        payload: {
          connectionIdentifier: "conn-1",
          connectionUuid: "connection-uuid-1",
          eventSourceId: 13,
          status: "connected",
          target: { owner: { displayName: "Main Channel" } },
        },
      }),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const session = firestore.read("restreamSessions", "db-1");
    assert.notEqual(session.sessionId, "session-last-week");
    assert.equal(session.messageCount, 0);
    assert.deepEqual(boardDisplayUpdates, ["db-1"]);
  } finally {
    globalThis.WebSocket = originalWebSocket;
    process.env.RESTREAM_CLIENT_ID = originalClientId;
    process.env.RESTREAM_CLIENT_SECRET = originalClientSecret;
  }
});

test("restream service keeps chat history across a brief reconnect mid-stream", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalClientId = process.env.RESTREAM_CLIENT_ID;
  const originalClientSecret = process.env.RESTREAM_CLIENT_SECRET;

  const sockets = [];
  globalThis.WebSocket = class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      sockets.push(this);
    }

    addEventListener(type, handler) {
      const next = this.listeners.get(type) || [];
      next.push(handler);
      this.listeners.set(type, next);
    }

    emit(type, payload) {
      const handlers = this.listeners.get(type) || [];
      handlers.forEach((handler) => handler(payload));
    }

    close() {
      return undefined;
    }
  };
  process.env.RESTREAM_CLIENT_ID = "client-id";
  process.env.RESTREAM_CLIENT_SECRET = "client-secret";

  try {
    const { firestore, boardDisplayUpdates, service } = createServiceHarness();
    firestore.seed("restreamTokens", "church-1", {
      churchId: "church-1",
      database: "db-1",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      accessTokenExpiresAt: Date.now() + 3_600_000,
      accountLabel: "Main account",
    });
    firestore.seed("restreamSessions", "db-1", {
      churchId: "church-1",
      database: "db-1",
      sessionId: "session-mid-service",
      startedAt: 100,
      messageCount: 2,
      connected: false,
      wentIdleAt: Date.now() - 30 * 1000,
    });

    await service.ensureReceiver("church-1");
    sockets[0].emit("open");
    sockets[0].emit("message", {
      data: JSON.stringify({
        action: "connection_info",
        payload: {
          connectionIdentifier: "conn-1",
          connectionUuid: "connection-uuid-1",
          eventSourceId: 13,
          status: "connected",
          target: { owner: { displayName: "Main Channel" } },
        },
      }),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const session = firestore.read("restreamSessions", "db-1");
    assert.equal(session.sessionId, "session-mid-service");
    assert.equal(session.messageCount, 2);
    assert.deepEqual(boardDisplayUpdates, []);
  } finally {
    globalThis.WebSocket = originalWebSocket;
    process.env.RESTREAM_CLIENT_ID = originalClientId;
    process.env.RESTREAM_CLIENT_SECRET = originalClientSecret;
  }
});

test("restream service keeps chat history when the same broadcast reconnects, even after a long gap", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalClientId = process.env.RESTREAM_CLIENT_ID;
  const originalClientSecret = process.env.RESTREAM_CLIENT_SECRET;

  const sockets = [];
  globalThis.WebSocket = class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      sockets.push(this);
    }

    addEventListener(type, handler) {
      const next = this.listeners.get(type) || [];
      next.push(handler);
      this.listeners.set(type, next);
    }

    emit(type, payload) {
      const handlers = this.listeners.get(type) || [];
      handlers.forEach((handler) => handler(payload));
    }

    close() {
      return undefined;
    }
  };
  process.env.RESTREAM_CLIENT_ID = "client-id";
  process.env.RESTREAM_CLIENT_SECRET = "client-secret";

  try {
    const { firestore, boardDisplayUpdates, service } = createServiceHarness();
    firestore.seed("restreamTokens", "church-1", {
      churchId: "church-1",
      database: "db-1",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      accessTokenExpiresAt: Date.now() + 3_600_000,
      accountLabel: "Main account",
    });
    // A single-platform connection can drop and recover on Restream's side
    // (flaky venue internet, a YouTube ingest hiccup) without our own socket
    // ever reconnecting. That must never wipe chat for the same broadcast,
    // no matter how long the gap was.
    firestore.seed("restreamSessions", "db-1", {
      churchId: "church-1",
      database: "db-1",
      sessionId: "session-mid-service",
      startedAt: 100,
      messageCount: 2,
      connected: false,
      wentIdleAt: Date.now() - 20 * 60 * 1000,
      broadcastKey: "youtube-event-1",
    });

    await service.ensureReceiver("church-1");
    sockets[0].emit("open");
    sockets[0].emit("message", {
      data: JSON.stringify({
        action: "connection_info",
        payload: {
          connectionIdentifier: "conn-1",
          connectionUuid: "connection-uuid-1",
          eventSourceId: 13,
          status: "connected",
          target: {
            event: { id: "youtube-event-1", title: "Sunday Live" },
            owner: { displayName: "Main Channel" },
          },
        },
      }),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const session = firestore.read("restreamSessions", "db-1");
    assert.equal(session.sessionId, "session-mid-service");
    assert.equal(session.messageCount, 2);
    assert.deepEqual(boardDisplayUpdates, []);
  } finally {
    globalThis.WebSocket = originalWebSocket;
    process.env.RESTREAM_CLIENT_ID = originalClientId;
    process.env.RESTREAM_CLIENT_SECRET = originalClientSecret;
  }
});

test("restream service resets chat when a different broadcast connects after a long gap", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalClientId = process.env.RESTREAM_CLIENT_ID;
  const originalClientSecret = process.env.RESTREAM_CLIENT_SECRET;

  const sockets = [];
  globalThis.WebSocket = class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      sockets.push(this);
    }

    addEventListener(type, handler) {
      const next = this.listeners.get(type) || [];
      next.push(handler);
      this.listeners.set(type, next);
    }

    emit(type, payload) {
      const handlers = this.listeners.get(type) || [];
      handlers.forEach((handler) => handler(payload));
    }

    close() {
      return undefined;
    }
  };
  process.env.RESTREAM_CLIENT_ID = "client-id";
  process.env.RESTREAM_CLIENT_SECRET = "client-secret";

  try {
    const { firestore, boardDisplayUpdates, service } = createServiceHarness();
    firestore.seed("restreamTokens", "church-1", {
      churchId: "church-1",
      database: "db-1",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      accessTokenExpiresAt: Date.now() + 3_600_000,
      accountLabel: "Main account",
    });
    firestore.seed("restreamSessions", "db-1", {
      churchId: "church-1",
      database: "db-1",
      sessionId: "session-last-week",
      startedAt: 100,
      messageCount: 2,
      connected: false,
      wentIdleAt: Date.now() - 20 * 60 * 1000,
      broadcastKey: "youtube-event-old",
    });
    firestore.seed("restreamMessages", "m1", {
      churchId: "church-1",
      database: "db-1",
      sessionId: "session-last-week",
      text: "Last week's message",
      postedAt: 50,
      isHighlighted: false,
      hidden: false,
    });

    await service.ensureReceiver("church-1");
    sockets[0].emit("open");
    sockets[0].emit("message", {
      data: JSON.stringify({
        action: "connection_info",
        payload: {
          connectionIdentifier: "conn-1",
          connectionUuid: "connection-uuid-1",
          eventSourceId: 13,
          status: "connected",
          target: {
            event: { id: "youtube-event-new", title: "Wednesday Live" },
            owner: { displayName: "Main Channel" },
          },
        },
      }),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const session = firestore.read("restreamSessions", "db-1");
    assert.notEqual(session.sessionId, "session-last-week");
    assert.equal(session.messageCount, 0);
    assert.equal(session.broadcastKey, "youtube-event-new");
    assert.deepEqual(boardDisplayUpdates, ["db-1"]);
  } finally {
    globalThis.WebSocket = originalWebSocket;
    process.env.RESTREAM_CLIENT_ID = originalClientId;
    process.env.RESTREAM_CLIENT_SECRET = originalClientSecret;
  }
});

test("restream service resets chat for a different broadcast immediately after receiver startup", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalClientId = process.env.RESTREAM_CLIENT_ID;
  const originalClientSecret = process.env.RESTREAM_CLIENT_SECRET;

  const sockets = [];
  globalThis.WebSocket = class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      sockets.push(this);
    }

    addEventListener(type, handler) {
      const next = this.listeners.get(type) || [];
      next.push(handler);
      this.listeners.set(type, next);
    }

    emit(type, payload) {
      const handlers = this.listeners.get(type) || [];
      handlers.forEach((handler) => handler(payload));
    }

    close() {
      return undefined;
    }
  };
  process.env.RESTREAM_CLIENT_ID = "client-id";
  process.env.RESTREAM_CLIENT_SECRET = "client-secret";

  try {
    const { firestore, boardDisplayUpdates, service } = createServiceHarness();
    firestore.seed("restreamTokens", "church-1", {
      churchId: "church-1",
      database: "db-1",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      accessTokenExpiresAt: Date.now() + 3_600_000,
      accountLabel: "Main account",
    });
    firestore.seed("restreamSessions", "db-1", {
      churchId: "church-1",
      database: "db-1",
      sessionId: "session-last-week",
      startedAt: 100,
      messageCount: 2,
      connected: true,
      broadcastKey: "youtube-event-old",
    });
    firestore.seed("restreamMessages", "m1", {
      churchId: "church-1",
      database: "db-1",
      sessionId: "session-last-week",
      text: "Last week's message",
      postedAt: 50,
      isHighlighted: false,
      hidden: false,
    });

    // Receiver startup first marks the stale persisted connection idle. The
    // next broadcast must still reset immediately even though wentIdleAt was
    // only just recorded during startup.
    await service.ensureReceiver("church-1");
    sockets[0].emit("open");
    sockets[0].emit("message", {
      data: JSON.stringify({
        action: "connection_info",
        payload: {
          connectionIdentifier: "conn-1",
          connectionUuid: "connection-uuid-1",
          eventSourceId: 13,
          status: "connected",
          target: {
            event: { id: "youtube-event-new", title: "Sunday Live" },
            owner: { displayName: "Main Channel" },
          },
        },
      }),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const session = firestore.read("restreamSessions", "db-1");
    assert.notEqual(session.sessionId, "session-last-week");
    assert.equal(session.messageCount, 0);
    assert.equal(session.broadcastKey, "youtube-event-new");
    assert.deepEqual(boardDisplayUpdates, ["db-1"]);
  } finally {
    globalThis.WebSocket = originalWebSocket;
    process.env.RESTREAM_CLIENT_ID = originalClientId;
    process.env.RESTREAM_CLIENT_SECRET = originalClientSecret;
  }
});

test("restream service persists sessions and messages in RTDB when Firestore is unavailable", async () => {
  const realtimeDb = createRealtimeDbMock();
  const firstHarness = createServiceHarness({
    useFirestore: false,
    realtimeDb,
  });

  await firstHarness.service.resetSession({
    churchId: "church-1",
    database: "db-1",
  });

  const currentSessionPath = "server/restream/v1/restreamSessions/db-1";
  const session = realtimeDb.read(currentSessionPath);
  assert.ok(session?.sessionId);
  assert.equal(session?.database, "db-1");

  const messageId = "message-1";
  const freshSession = realtimeDb.read(currentSessionPath);
  await realtimeDb
    .ref(
      `server/restream/v1/restreamMessagesByDatabase/db-1/${freshSession.sessionId}/${messageId}`,
    )
    .set({
      churchId: "church-1",
      database: "db-1",
      sessionId: freshSession.sessionId,
      author: "Evan",
      text: "Saved in RTDB",
      postedAt: 123,
      isHighlighted: false,
      hidden: false,
    });
  await realtimeDb.ref(currentSessionPath).update({
    messageCount: 1,
    lastEventAt: 123,
    sessionId: freshSession.sessionId,
  });

  const secondHarness = createServiceHarness({
    useFirestore: false,
    realtimeDb,
  });

  const status = await secondHarness.service.getStatusForChurch({
    churchId: "church-1",
    database: "db-1",
  });
  const messages = await secondHarness.service.listCurrentSessionMessages({
    churchId: "church-1",
    database: "db-1",
  });

  assert.equal(status.session.messageCount, 1);
  assert.deepEqual(
    messages.map((message) => message.id),
    [messageId],
  );
  assert.equal(messages[0].text, "Saved in RTDB");
  assert.deepEqual(
    realtimeDb.read(
      `server/restream/v1/restreamMessagesByDatabase/db-1/${freshSession.sessionId}/${messageId}`,
    ),
    {
      churchId: "church-1",
      database: "db-1",
      sessionId: freshSession.sessionId,
      author: "Evan",
      text: "Saved in RTDB",
      postedAt: 123,
      isHighlighted: false,
      hidden: false,
    },
  );
});

test("restream service surfaces connection issues when Restream has no live chat source", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalClientId = process.env.RESTREAM_CLIENT_ID;
  const originalClientSecret = process.env.RESTREAM_CLIENT_SECRET;

  const sockets = [];
  globalThis.WebSocket = class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      sockets.push(this);
    }

    addEventListener(type, handler) {
      const next = this.listeners.get(type) || [];
      next.push(handler);
      this.listeners.set(type, next);
    }

    emit(type, payload) {
      const handlers = this.listeners.get(type) || [];
      handlers.forEach((handler) => handler(payload));
    }

    close() {
      return undefined;
    }
  };
  process.env.RESTREAM_CLIENT_ID = "client-id";
  process.env.RESTREAM_CLIENT_SECRET = "client-secret";

  try {
    const { firestore, service } = createServiceHarness();
    firestore.seed("restreamTokens", "church-1", {
      churchId: "church-1",
      database: "db-1",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      accessTokenExpiresAt: Date.now() + 3_600_000,
      accountLabel: "Main account",
    });

    await service.ensureReceiver("church-1");
    assert.equal(sockets.length, 1);

    sockets[0].emit("open");
    sockets[0].emit("message", {
      data: JSON.stringify({
        action: "connection_info",
        payload: {
          connectionIdentifier: "conn-1",
          connectionUuid: "connection-uuid-1",
          eventSourceId: 13,
          status: "error",
          reason: "event_not_started",
          target: {
            owner: {
              displayName: "Main Channel",
            },
          },
        },
      }),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const status = await service.getStatusForChurch({
      churchId: "church-1",
      database: "db-1",
    });

    assert.equal(status.session.connectionState, "connected");
    assert.equal(status.session.connected, false);
    assert.equal(status.session.activeConnectionCount, 0);
    assert.equal(status.session.totalConnectionCount, 1);
    assert.deepEqual(status.session.connectionIssues, [
      "YouTube: Main Channel (event not started)",
    ]);
  } finally {
    globalThis.WebSocket = originalWebSocket;
    process.env.RESTREAM_CLIENT_ID = originalClientId;
    process.env.RESTREAM_CLIENT_SECRET = originalClientSecret;
  }
});

test("restream service stores YouTube messages from the documented chat action envelope", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalClientId = process.env.RESTREAM_CLIENT_ID;
  const originalClientSecret = process.env.RESTREAM_CLIENT_SECRET;

  const sockets = [];
  globalThis.WebSocket = class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      sockets.push(this);
    }

    addEventListener(type, handler) {
      const next = this.listeners.get(type) || [];
      next.push(handler);
      this.listeners.set(type, next);
    }

    emit(type, payload) {
      const handlers = this.listeners.get(type) || [];
      handlers.forEach((handler) => handler(payload));
    }

    close() {
      return undefined;
    }
  };
  process.env.RESTREAM_CLIENT_ID = "client-id";
  process.env.RESTREAM_CLIENT_SECRET = "client-secret";

  try {
    const { firestore, service } = createServiceHarness();
    firestore.seed("restreamTokens", "church-1", {
      churchId: "church-1",
      database: "db-1",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      accessTokenExpiresAt: Date.now() + 3_600_000,
      accountLabel: "Main account",
    });

    await service.ensureReceiver("church-1");
    sockets[0].emit("open");
    const connectionInfoPayload = {
      connectionIdentifier: "conn-1",
      connectionUuid: "connection-uuid-1",
      eventSourceId: 13,
      status: "connecting",
      reason: null,
      target: {
        event: {
          id: "youtube-event-1",
          title: "Sunday Live",
          url: "https://youtube.com/watch?v=video-1",
        },
        owner: {
          id: "youtube-channel-1",
          displayName: "Main Channel",
        },
      },
    };
    sockets[0].emit("message", {
      data: JSON.stringify({
        action: "connection_info",
        timestamp: 1_778_629_500,
        payload: connectionInfoPayload,
      }),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const connectingStatus = await service.getStatusForChurch({
      churchId: "church-1",
      database: "db-1",
    });
    assert.equal(connectingStatus.session.connected, false);
    assert.equal(connectingStatus.session.activeConnectionCount, 0);

    sockets[0].emit("message", {
      data: JSON.stringify({
        action: "connection_info",
        timestamp: 1_778_629_501,
        payload: {
          ...connectionInfoPayload,
          status: "connected",
        },
      }),
    });
    const viewerEvent = {
      data: JSON.stringify({
        action: "event",
        timestamp: 1_778_629_519,
        payload: {
          connectionIdentifier: "conn-1",
          eventIdentifier: "event-1",
          eventSourceId: 13,
          eventTypeId: 5,
          eventPayload: {
            author: {
              id: "viewer-1",
              avatar: "https://example.com/avatar.png",
              displayName: "Evan",
              isChatModerator: false,
              isChatOwner: false,
              isChatSponsor: false,
              isVerified: false,
            },
            bot: false,
            liveChatMessageId: "youtube-message-1",
            text: "Hello from YouTube",
          },
        },
      }),
    };
    const queryCountBeforeDedupe = firestore.metrics.queryGets.length;
    sockets[0].emit("message", viewerEvent);

    await new Promise((resolve) => setTimeout(resolve, 0));

    // Restream may replay an event after a reconnect. The second delivery
    // must use the bounded lookup and leave both the document count and the
    // session count unchanged.
    sockets[0].emit("message", viewerEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const dedupeQueries = firestore.metrics.queryGets.slice(
      queryCountBeforeDedupe,
    );
    assert.equal(dedupeQueries.length, 2);
    assert.equal(
      dedupeQueries.every(
        (query) =>
          query.name === "restreamMessages" && query.limit === 1,
      ),
      true,
    );
    assert.equal(dedupeQueries[0].returned, 0);
    assert.equal(dedupeQueries[1].returned, 1);

    const status = await service.getStatusForChurch({
      churchId: "church-1",
      database: "db-1",
    });
    const messages = await service.listCurrentSessionMessages({
      churchId: "church-1",
      database: "db-1",
    });

    assert.equal(status.session.connected, true);
    assert.equal(status.session.streamTitle, "Sunday Live");
    assert.deepEqual(status.session.platformSummary, ["YouTube: Main Channel"]);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].platform, "YouTube");
    assert.equal(messages[0].author, "Evan");
    assert.equal(messages[0].text, "Hello from YouTube");
    assert.equal(messages[0].postedAt, 1_778_629_519_000);
  } finally {
    globalThis.WebSocket = originalWebSocket;
    process.env.RESTREAM_CLIENT_ID = originalClientId;
    process.env.RESTREAM_CLIENT_SECRET = originalClientSecret;
  }
});

test("restream service deduplicates the same event across receiver instances", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const sockets = [];
  globalThis.WebSocket = class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      sockets.push(this);
    }

    addEventListener(type, handler) {
      const next = this.listeners.get(type) || [];
      next.push(handler);
      this.listeners.set(type, next);
    }

    emit(type, payload) {
      const handlers = this.listeners.get(type) || [];
      handlers.forEach((handler) => handler(payload));
    }

    close() {
      return undefined;
    }
  };

  try {
    const sharedFirestore = createFirestoreMock();
    sharedFirestore.seed("restreamTokens", "church-1", {
      churchId: "church-1",
      database: "db-1",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      accessTokenExpiresAt: Date.now() + 3_600_000,
      accountLabel: "Main account",
    });
    sharedFirestore.seed("restreamSessions", "db-1", {
      churchId: "church-1",
      database: "db-1",
      sessionId: "session-shared",
      startedAt: 100,
      messageCount: 0,
      connected: false,
    });

    const first = createServiceHarness({ firestore: sharedFirestore });
    const second = createServiceHarness({ firestore: sharedFirestore });
    await Promise.all([
      first.service.ensureReceiver("church-1"),
      second.service.ensureReceiver("church-1"),
    ]);
    const firstSseEvents = [];
    const secondSseEvents = [];
    first.service.addSseClient("church-1", {
      write: (event) => firstSseEvents.push(event),
    });
    second.service.addSseClient("church-1", {
      write: (event) => secondSseEvents.push(event),
    });

    const event = {
      data: JSON.stringify({
        action: "event",
        timestamp: 1_778_629_519,
        payload: {
          connectionIdentifier: "conn-1",
          eventIdentifier: "event-shared",
          eventSourceId: 13,
          eventTypeId: 5,
          eventPayload: {
            author: { displayName: "Evan" },
            liveChatMessageId: "youtube-message-shared",
            text: "One shared event",
          },
        },
      }),
    };
    sockets.forEach((socket) => socket.emit("message", event));
    await waitFor(
      () =>
        sharedFirestore.read("restreamSessions", "db-1")?.messageCount === 1,
    );

    const messages = await first.service.listCurrentSessionMessages({
      churchId: "church-1",
      database: "db-1",
    });
    const session = sharedFirestore.read("restreamSessions", "db-1");
    const dedupeQueries = sharedFirestore.metrics.queryGets.filter((query) =>
      query.filters.some((filter) => filter.field === "fingerprint"),
    );

    assert.equal(sockets.length, 2);
    assert.equal(messages.length, 1);
    assert.equal(session.messageCount, 1);
    assert.equal(dedupeQueries.length, 2);
    assert.equal(dedupeQueries.every((query) => query.limit === 1), true);
    assert.equal(
      firstSseEvents.some((event) => event.includes('"message-created"')),
      true,
    );
    assert.equal(
      secondSseEvents.some((event) => event.includes('"message-created"')),
      true,
    );

    // Distinct messages arriving at the same time must both advance the
    // shared count. This exercises the transaction around the counter rather
    // than only the idempotent document create.
    const secondEvent = {
      data: JSON.stringify({
        action: "event",
        timestamp: 1_778_629_520,
        payload: {
          connectionIdentifier: "conn-1",
          eventIdentifier: "event-second",
          eventSourceId: 13,
          eventTypeId: 5,
          eventPayload: {
            author: { displayName: "Evan" },
            liveChatMessageId: "youtube-message-second",
            text: "A second event",
          },
        },
      }),
    };
    const thirdEvent = {
      data: JSON.stringify({
        action: "event",
        timestamp: 1_778_629_521,
        payload: {
          connectionIdentifier: "conn-1",
          eventIdentifier: "event-third",
          eventSourceId: 13,
          eventTypeId: 5,
          eventPayload: {
            author: { displayName: "Evan" },
            liveChatMessageId: "youtube-message-third",
            text: "A third event",
          },
        },
      }),
    };
    sockets[0].emit("message", secondEvent);
    sockets[1].emit("message", thirdEvent);
    await waitFor(
      () =>
        sharedFirestore.read("restreamSessions", "db-1")?.messageCount === 3,
    );

    const allMessages = await first.service.listCurrentSessionMessages({
      churchId: "church-1",
      database: "db-1",
    });
    const finalSession = sharedFirestore.read("restreamSessions", "db-1");
    assert.equal(allMessages.length, 3);
    assert.equal(finalSession.messageCount, 3);

    // Message persistence and the counter must commit together. A failed
    // transaction must leave no message behind that would cause a later
    // replay to skip the count increment.
    const retryEvent = {
      data: JSON.stringify({
        action: "event",
        timestamp: 1_778_629_522,
        payload: {
          connectionIdentifier: "conn-1",
          eventIdentifier: "event-retry",
          eventSourceId: 13,
          eventTypeId: 5,
          eventPayload: {
            author: { displayName: "Evan" },
            liveChatMessageId: "youtube-message-retry",
            text: "A retryable event",
          },
        },
      }),
    };
    sharedFirestore.failNextTransactionCommit(
      new Error("temporary Firestore failure"),
    );
    sockets[0].emit("message", retryEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(
      (await first.service.listCurrentSessionMessages({
        churchId: "church-1",
        database: "db-1",
      })).length,
      3,
    );
    assert.equal(sharedFirestore.read("restreamSessions", "db-1").messageCount, 3);

    sockets[0].emit("message", retryEvent);
    await waitFor(
      () =>
        sharedFirestore.read("restreamSessions", "db-1")?.messageCount === 4,
    );
    assert.equal(
      (await first.service.listCurrentSessionMessages({
        churchId: "church-1",
        database: "db-1",
      })).length,
      4,
    );
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test("restream service deduplicates legacy messages with random document IDs", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const sockets = [];
  globalThis.WebSocket = class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      sockets.push(this);
    }

    addEventListener(type, handler) {
      const next = this.listeners.get(type) || [];
      next.push(handler);
      this.listeners.set(type, next);
    }

    emit(type, payload) {
      const handlers = this.listeners.get(type) || [];
      handlers.forEach((handler) => handler(payload));
    }

    close() {
      return undefined;
    }
  };

  try {
    const { firestore, service } = createServiceHarness();
    firestore.seed("restreamTokens", "church-1", {
      churchId: "church-1",
      database: "db-1",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      accessTokenExpiresAt: Date.now() + 3_600_000,
      accountLabel: "Main account",
    });
    firestore.seed("restreamSessions", "db-1", {
      churchId: "church-1",
      database: "db-1",
      sessionId: "session-legacy",
      startedAt: 100,
      messageCount: 0,
      connected: true,
    });

    const postedAt = 1_778_629_519_000;
    const fingerprint = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          connectionIdentifier: "conn-legacy",
          eventIdentifier: "event-legacy",
          postedAt,
          text: "Legacy message",
          author: "Evan",
        }),
      )
      .digest("hex");
    firestore.seed("restreamMessages", "legacy-random-id", {
      churchId: "church-1",
      database: "db-1",
      sessionId: "session-legacy",
      fingerprint,
      author: "Evan",
      text: "Legacy message",
      postedAt,
      isHighlighted: false,
      hidden: false,
    });

    await service.ensureReceiver("church-1");
    const sseEvents = [];
    service.addSseClient("church-1", {
      write: (event) => sseEvents.push(event),
    });
    const queryCountBeforeDedupe = firestore.metrics.queryGets.length;
    sockets[0].emit("message", {
      data: JSON.stringify({
        action: "event",
        timestamp: 1_778_629_519,
        payload: {
          connectionIdentifier: "conn-legacy",
          eventIdentifier: "event-legacy",
          eventSourceId: 13,
          eventTypeId: 5,
          eventPayload: {
            author: { displayName: "Evan" },
            liveChatMessageId: "youtube-message-legacy",
            text: "Legacy message",
          },
        },
      }),
    });

    await waitFor(
      () => firestore.metrics.queryGets.length > queryCountBeforeDedupe,
    );

    const messages = await service.listCurrentSessionMessages({
      churchId: "church-1",
      database: "db-1",
    });
    const dedupeQueries = firestore.metrics
      .queryGets.slice(queryCountBeforeDedupe)
      .filter((query) =>
        query.filters.some((filter) => filter.field === "fingerprint"),
      );
    const session = firestore.read("restreamSessions", "db-1");

    assert.equal(sockets.length, 1);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].id, "legacy-random-id");
    assert.equal(session.messageCount, 0);
    assert.equal(dedupeQueries.length, 1);
    assert.equal(dedupeQueries[0].limit, 1);
    assert.equal(dedupeQueries[0].returned, 1);
    assert.equal(
      sseEvents.some((event) => event.includes('"message-created"')),
      true,
    );
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test("restream service persists oauth state across the connect callback", async () => {
  const originalClientId = process.env.RESTREAM_CLIENT_ID;
  const originalClientSecret = process.env.RESTREAM_CLIENT_SECRET;
  const originalRedirectUri = process.env.RESTREAM_OAUTH_REDIRECT_URI;
  const originalAxiosPost = axios.post;
  const originalAxiosGet = axios.get;
  const originalWebSocket = globalThis.WebSocket;

  process.env.RESTREAM_CLIENT_ID = "client-id";
  process.env.RESTREAM_CLIENT_SECRET = "client-secret";
  process.env.RESTREAM_OAUTH_REDIRECT_URI =
    "https://example.com/api/restream/oauth/callback";

  axios.post = async (url) => {
    assert.equal(url, "https://api.restream.io/oauth/token");
    return {
      data: {
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
        refreshTokenExpiresIn: 31536000,
        scope: "chat.read channels.read",
      },
    };
  };
  axios.get = async (url) => {
    assert.equal(url, "https://api.restream.io/v2/user/channels");
    return {
      data: {
        channels: [{ displayName: "Main Channel" }],
      },
    };
  };
  globalThis.WebSocket = class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
    }

    addEventListener(type, handler) {
      const next = this.listeners.get(type) || [];
      next.push(handler);
      this.listeners.set(type, next);
    }

    close() {
      return undefined;
    }
  };

  try {
    const { firestore, service } = createServiceHarness();

    const connectStart = await service.startConnect({
      churchId: "church-1",
      database: "db-1",
      userId: "user-1",
      returnTo: "/account?tab=integrations",
    });
    const { authorizeUrl } = connectStart;

    const url = new URL(authorizeUrl);
    const state = url.searchParams.get("state");
    assert.ok(state);

    const storedState = firestore.read("restreamOauthStates", state);
    assert.equal(storedState?.churchId, "church-1");
    assert.equal(storedState?.database, "db-1");
    assert.equal(storedState?.connectRequestId, connectStart.connectRequestId);

    const pendingStatus = await service.getConnectStatus({
      connectRequestId: connectStart.connectRequestId,
      connectRequestSecret: connectStart.connectRequestSecret,
    });
    assert.equal(pendingStatus.status, "pending");

    const result = await service.completeConnect({
      state,
      code: "oauth-code",
    });

    assert.equal(result.success, true);
    assert.equal(result.returnTo, "/account?tab=integrations");
    assert.equal(firestore.read("restreamOauthStates", state), undefined);

    const tokenDoc = firestore.read("restreamTokens", "church-1");
    assert.equal(tokenDoc?.accessToken, "access-token");
    assert.equal(tokenDoc?.refreshToken, "refresh-token");
    assert.equal(tokenDoc?.accountLabel, "Main Channel");

    const completedStatus = await service.getConnectStatus({
      connectRequestId: connectStart.connectRequestId,
      connectRequestSecret: connectStart.connectRequestSecret,
    });
    assert.equal(completedStatus.status, "completed");
    assert.equal(completedStatus.accountLabel, "Main Channel");
  } finally {
    axios.post = originalAxiosPost;
    axios.get = originalAxiosGet;
    globalThis.WebSocket = originalWebSocket;
    process.env.RESTREAM_CLIENT_ID = originalClientId;
    process.env.RESTREAM_CLIENT_SECRET = originalClientSecret;
    process.env.RESTREAM_OAUTH_REDIRECT_URI = originalRedirectUri;
  }
});
