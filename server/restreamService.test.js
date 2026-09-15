import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import axios from "axios";
import {
  beganOnPreviousLocalCalendarDay,
  collectDestinationBroadcastIds,
  createRestreamService,
  decideRestreamSessionBoundary,
  normalizeRestreamPostedAtMs,
  resolveRestreamEventId,
} from "./restreamService.js";
import { RESTREAM_MESSAGE_RETENTION_MS } from "./restreamRetention.js";

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
      let entries = Array.from(getCollectionMap(name).entries()).filter(
        ([, doc]) =>
          filters.every(({ field, value }) => doc?.[field] === value),
      );
      if (ordering) {
        // Firestore orderBy excludes documents that do not contain the field.
        entries = entries.filter(
          ([, doc]) => doc?.[ordering.field] !== undefined,
        );
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
  const queries = [];
  const root = {};
  let transactionChain = Promise.resolve();

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

  const createRef = (path, query = {}) => ({
    orderByChild(field) {
      return createRef(path, { ...query, orderByChild: field });
    },
    limitToLast(limit) {
      return createRef(path, { ...query, limitToLast: limit });
    },
    async get() {
      let value = getAtPath(path);
      if (
        Number.isFinite(query.limitToLast) &&
        query.orderByChild &&
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
      ) {
        const entries = Object.entries(value).sort(
          ([leftId, left], [rightId, right]) => {
            const leftValue = left?.[query.orderByChild] ?? null;
            const rightValue = right?.[query.orderByChild] ?? null;
            if (leftValue === rightValue) {
              return leftId.localeCompare(rightId);
            }
            if (leftValue === null) return -1;
            if (rightValue === null) return 1;
            return leftValue < rightValue ? -1 : 1;
          },
        );
        value = Object.fromEntries(
          entries.slice(-query.limitToLast),
        );
      }
      queries.push({ path, ...query });
      return buildSnapshot(value);
    },
    async set(value) {
      setAtPath(path, value);
    },
    transaction(updateFunction) {
      const run = transactionChain.then(async () => {
        const current = getAtPath(path);
        const next = updateFunction(
          current === undefined ? null : clone(current),
        );
        if (next === undefined || next === null) {
          return {
            committed: false,
            snapshot: buildSnapshot(current),
          };
        }
        setAtPath(path, next);
        return { committed: true, snapshot: buildSnapshot(next) };
      });
      transactionChain = run.catch(() => undefined);
      return run;
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
  });

  return {
    updates,
    queries,
    root,
    ref(path) {
      return createRef(path);
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
  fetchInProgressEvents,
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
    fetchInProgressEvents,
  });

  return { firestore, realtimeDb: database, boardDisplayUpdates, service };
};

const installFakeWebSocket = () => {
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
  return {
    sockets,
    restore: () => {
      globalThis.WebSocket = originalWebSocket;
    },
  };
};

const emitConnectionInfo = (socket, payload) => {
  socket.emit("message", {
    data: JSON.stringify({
      action: "connection_info",
      payload,
    }),
  });
};

const seedConnectedToken = (firestore) => {
  firestore.seed("restreamTokens", "church-1", {
    churchId: "church-1",
    database: "db-1",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    accessTokenExpiresAt: Date.now() + 3_600_000,
    accountLabel: "Main account",
  });
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
    first.service.getStatusForChurch({
      churchId: "church-1",
      database: "db-1",
    }),
    second.service.getStatusForChurch({
      churchId: "church-1",
      database: "db-1",
    }),
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
    messageTimestamp: 10,
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
    messageTimestamp: 20,
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
    field: "messageTimestamp",
    direction: "desc",
  });
});

test("restream service includes migrated messages using their canonical timestamp", async () => {
  const { firestore, service } = createServiceHarness();

  firestore.seed("restreamSessions", "db-1", {
    churchId: "church-1",
    database: "db-1",
    sessionId: "session-migrated",
    startedAt: 100,
    messageCount: 1,
  });
  firestore.seed("restreamMessages", "legacy-received-at", {
    churchId: "church-1",
    database: "db-1",
    sessionId: "session-migrated",
    author: "Alex",
    text: "Migrated message",
    receivedAt: 25,
    messageTimestamp: 25,
    isHighlighted: false,
    hidden: false,
  });

  const messages = await service.listCurrentSessionMessages({
    churchId: "church-1",
    database: "db-1",
  });

  assert.deepEqual(messages.map((message) => message.id), [
    "legacy-received-at",
  ]);
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
      messageTimestamp: index,
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
    field: "messageTimestamp",
    direction: "desc",
  });
});

test("restream service bounds the RTDB session-index read", async () => {
  const realtimeDb = createRealtimeDbMock();
  const { service } = createServiceHarness({
    useFirestore: false,
    realtimeDb,
  });
  await realtimeDb.ref("server/restream/v1/restreamSessions/db-1").set({
    churchId: "church-1",
    database: "db-1",
    sessionId: "session-rtdb-large",
    startedAt: 100,
    messageCount: 501,
  });

  const indexPath =
    "server/restream/v1/restreamMessagesByDatabase/db-1/session-rtdb-large";
  await realtimeDb
    .ref(indexPath)
    .set(
      Object.fromEntries(
        Array.from({ length: 501 }, (_, index) => [
          `message-${index}`,
          {
            database: "db-1",
            sessionId: "session-rtdb-large",
             author: "Viewer",
             text: `Message ${index}`,
             postedAt: index,
             messageTimestamp: index,
             expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000,
           },
        ]),
      ),
    );

  const messages = await service.listCurrentSessionMessages({
    churchId: "church-1",
    database: "db-1",
  });

  assert.equal(messages.length, 500);
  assert.equal(messages[0].postedAt, 500);
  assert.equal(messages.at(-1).postedAt, 1);
  assert.deepEqual(realtimeDb.queries.at(-1), {
    path: indexPath,
    orderByChild: "messageTimestamp",
    limitToLast: 500,
  });
});

test("RTDB Restream reads filter and clean up expired messages", async () => {
  const realtimeDb = createRealtimeDbMock();
  const { service } = createServiceHarness({
    useFirestore: false,
    realtimeDb,
  });
  const now = Date.now();
  const indexPath =
    "server/restream/v1/restreamMessagesByDatabase/db-1/session-rtdb-expiry";
  const expiredMessage = {
    database: "db-1",
    sessionId: "session-rtdb-expiry",
    author: "Viewer",
    text: "Expired message",
    messageTimestamp: now - 90 * 24 * 60 * 60 * 1000 - 1,
    expiresAt: now - 1,
  };
  const currentMessage = {
    database: "db-1",
    sessionId: "session-rtdb-expiry",
    author: "Viewer",
    text: "Current message",
    messageTimestamp: now,
    expiresAt: now + 1_000,
  };

  await realtimeDb.ref("server/restream/v1/restreamSessions/db-1").set({
    churchId: "church-1",
    database: "db-1",
    sessionId: "session-rtdb-expiry",
    startedAt: now,
    messageCount: 2,
  });
  await realtimeDb.ref(indexPath).set({
    expired: expiredMessage,
    current: currentMessage,
  });
  await realtimeDb
    .ref("server/restream/v1/restreamMessages/expired")
    .set(expiredMessage);

  const messages = await service.listCurrentSessionMessages({
    churchId: "church-1",
    database: "db-1",
  });

  assert.deepEqual(messages.map((message) => message.id), ["current"]);
  assert.equal(
    realtimeDb.read("server/restream/v1/restreamMessages/expired"),
    undefined,
  );
  assert.equal(realtimeDb.read(`${indexPath}/expired`), undefined);
});

test("new viewer and moderator Restream messages receive shared retention metadata", async () => {
  const originalClientId = process.env.RESTREAM_CLIENT_ID;
  const originalClientSecret = process.env.RESTREAM_CLIENT_SECRET;
  const fakeWs = installFakeWebSocket();
  process.env.RESTREAM_CLIENT_ID = "client-id";
  process.env.RESTREAM_CLIENT_SECRET = "client-secret";

  try {
    const { firestore, service } = createServiceHarness();
    seedConnectedToken(firestore);
    firestore.seed("restreamSessions", "db-1", {
      churchId: "church-1",
      database: "db-1",
      sessionId: "session-retention",
      startedAt: Date.now(),
      messageCount: 0,
      connected: true,
    });

    await service.ensureReceiver("church-1");
    const postedAtSeconds = Math.floor(Date.now() / 1000);
    fakeWs.sockets[0].emit("message", {
      data: JSON.stringify({
        action: "event",
        timestamp: postedAtSeconds,
        payload: {
          connectionIdentifier: "conn-retention",
          eventIdentifier: "event-retention",
          eventSourceId: 13,
          eventTypeId: 5,
          eventPayload: {
            author: { displayName: "Viewer" },
            text: "Viewer message",
          },
        },
      }),
    });
    fakeWs.sockets[0].emit("message", {
      data: JSON.stringify({
        action: "reply_created",
        timestamp: 1_778_629_520,
        payload: {
          replyUuid: "reply-retention",
          connectionIdentifiers: ["conn-retention"],
          text: "Moderator reply",
        },
      }),
    });

    await waitFor(
      () =>
        firestore.read("restreamSessions", "db-1")?.messageCount === 2,
    );

    const messages = await service.listCurrentSessionMessages({
      churchId: "church-1",
      database: "db-1",
    });
    assert.deepEqual(
      messages.map((message) => message.kind).sort(),
      ["moderator_reply", "viewer_message"],
    );
    messages.forEach((message) => {
      const expiresAt = Date.parse(message.expiresAt);
      assert.equal(
        expiresAt - message.postedAt,
        RESTREAM_MESSAGE_RETENTION_MS,
      );
    });
  } finally {
    fakeWs.restore();
    process.env.RESTREAM_CLIENT_ID = originalClientId;
    process.env.RESTREAM_CLIENT_SECRET = originalClientSecret;
  }
});

test("RTDB Restream writes keep expiration metadata JSON-compatible", async () => {
  const originalClientId = process.env.RESTREAM_CLIENT_ID;
  const originalClientSecret = process.env.RESTREAM_CLIENT_SECRET;
  const fakeWs = installFakeWebSocket();
  process.env.RESTREAM_CLIENT_ID = "client-id";
  process.env.RESTREAM_CLIENT_SECRET = "client-secret";

  try {
    const realtimeDb = createRealtimeDbMock();
    const { service } = createServiceHarness({
      useFirestore: false,
      realtimeDb,
    });
    await realtimeDb.ref("server/restream/v1/restreamTokens/church-1").set({
      churchId: "church-1",
      database: "db-1",
      accessToken: "access-token",
      accessTokenExpiresAt: Date.now() + 3_600_000,
      accountLabel: "Main account",
    });
    await realtimeDb.ref("server/restream/v1/restreamSessions/db-1").set({
      churchId: "church-1",
      database: "db-1",
      sessionId: "session-rtdb-retention",
      startedAt: Date.now(),
      messageCount: 0,
    });

    await service.ensureReceiver("church-1");
    const postedAtSeconds = Math.floor(Date.now() / 1000);
    fakeWs.sockets[0].emit("message", {
      data: JSON.stringify({
        action: "event",
        timestamp: postedAtSeconds,
        payload: {
          connectionIdentifier: "conn-rtdb-retention",
          eventIdentifier: "event-rtdb-retention",
          eventPayload: {
            author: { displayName: "Viewer" },
            text: "RTDB message",
          },
        },
      }),
    });

    await waitFor(
      () =>
        realtimeDb.read("server/restream/v1/restreamSessions/db-1")
          ?.messageCount === 1,
    );
    const messages = await service.listCurrentSessionMessages({
      churchId: "church-1",
      database: "db-1",
    });
    assert.equal(
      typeof messages[0].expiresAt,
      "number",
      JSON.stringify(messages[0]),
    );
    assert.equal(
      messages[0].expiresAt - messages[0].postedAt,
      RESTREAM_MESSAGE_RETENTION_MS,
    );
  } finally {
    fakeWs.restore();
    process.env.RESTREAM_CLIENT_ID = originalClientId;
    process.env.RESTREAM_CLIENT_SECRET = originalClientSecret;
  }
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

test("restream service keeps chat after a long idle reconnect without confirmed Event ID", async () => {
  const originalClientId = process.env.RESTREAM_CLIENT_ID;
  const originalClientSecret = process.env.RESTREAM_CLIENT_SECRET;
  const fakeWs = installFakeWebSocket();
  process.env.RESTREAM_CLIENT_ID = "client-id";
  process.env.RESTREAM_CLIENT_SECRET = "client-secret";

  try {
    const { firestore, boardDisplayUpdates, service } = createServiceHarness({
      fetchInProgressEvents: async () => ({ ok: false, events: [] }),
    });
    seedConnectedToken(firestore);
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
    fakeWs.sockets[0].emit("open");
    emitConnectionInfo(fakeWs.sockets[0], {
      connectionIdentifier: "conn-1",
      connectionUuid: "connection-uuid-1",
      eventSourceId: 13,
      status: "connected",
      target: { owner: { displayName: "Main Channel" }, websiteChannelId: 11 },
    });

    await waitFor(
      () => firestore.read("restreamSessions", "db-1")?.connected === true,
    );

    const session = firestore.read("restreamSessions", "db-1");
    assert.equal(session.sessionId, "session-last-week");
    assert.equal(session.messageCount, 2);
    assert.equal(
      firestore.read("restreamMessages", "m1").sessionId,
      "session-last-week",
    );
    assert.equal(session.sessionSuggestion?.reason, "day_boundary");
    assert.deepEqual(boardDisplayUpdates, []);
  } finally {
    fakeWs.restore();
    process.env.RESTREAM_CLIENT_ID = originalClientId;
    process.env.RESTREAM_CLIENT_SECRET = originalClientSecret;
  }
});

test("restream service serializes chat events behind a session boundary", async () => {
  const originalClientId = process.env.RESTREAM_CLIENT_ID;
  const originalClientSecret = process.env.RESTREAM_CLIENT_SECRET;
  const fakeWs = installFakeWebSocket();
  process.env.RESTREAM_CLIENT_ID = "client-id";
  process.env.RESTREAM_CLIENT_SECRET = "client-secret";

  let releaseEventLookup;
  let resolveEventLookupStarted;
  const eventLookupStarted = new Promise((resolve) => {
    resolveEventLookupStarted = resolve;
  });

  try {
    const { firestore, service } = createServiceHarness({
      fetchInProgressEvents: () =>
        new Promise((resolve) => {
          resolveEventLookupStarted();
          releaseEventLookup = resolve;
        }),
    });
    seedConnectedToken(firestore);
    firestore.seed("restreamSessions", "db-1", {
      churchId: "church-1",
      database: "db-1",
      sessionId: "session-before-boundary",
      startedAt: 100,
      messageCount: 0,
      connected: false,
      restreamEventId: "restream-event-old",
      destinationBroadcastIds: ["youtube-event-old"],
    });

    await service.ensureReceiver("church-1");
    fakeWs.sockets[0].emit("open");
    emitConnectionInfo(fakeWs.sockets[0], {
      connectionIdentifier: "conn-1",
      connectionUuid: "connection-uuid-1",
      eventSourceId: 13,
      status: "connected",
      target: {
        event: { id: "youtube-event-new", title: "New service" },
        owner: { displayName: "Main Channel" },
        websiteChannelId: 11,
      },
    });
    await eventLookupStarted;

    // This event arrives while connection_info is still resolving the session
    // boundary. It must be processed only after resetSession has committed.
    fakeWs.sockets[0].emit("message", {
      data: JSON.stringify({
        action: "event",
        timestamp: 1_778_629_519,
        payload: {
          connectionIdentifier: "conn-1",
          eventIdentifier: "event-after-boundary",
          eventSourceId: 13,
          eventTypeId: 5,
          eventPayload: {
            author: { displayName: "Viewer" },
            text: "Arrived after the boundary",
          },
        },
      }),
    });

    releaseEventLookup({
      ok: true,
      events: [
        {
          id: "restream-event-new",
          destinations: [{ channelId: 11 }],
        },
      ],
    });

    await waitFor(() => {
      const session = firestore.read("restreamSessions", "db-1");
      return session?.sessionId !== "session-before-boundary" &&
        session?.messageCount === 1;
    });

    const messages = await service.listCurrentSessionMessages({
      churchId: "church-1",
      database: "db-1",
    });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].text, "Arrived after the boundary");
    assert.equal(
      messages[0].sessionId,
      firestore.read("restreamSessions", "db-1").sessionId,
    );
  } finally {
    fakeWs.restore();
    process.env.RESTREAM_CLIENT_ID = originalClientId;
    process.env.RESTREAM_CLIENT_SECRET = originalClientSecret;
  }
});

test("restream service keeps chat history across a brief reconnect mid-stream", async () => {
  const originalClientId = process.env.RESTREAM_CLIENT_ID;
  const originalClientSecret = process.env.RESTREAM_CLIENT_SECRET;
  const fakeWs = installFakeWebSocket();
  process.env.RESTREAM_CLIENT_ID = "client-id";
  process.env.RESTREAM_CLIENT_SECRET = "client-secret";

  try {
    const { firestore, boardDisplayUpdates, service } = createServiceHarness({
      fetchInProgressEvents: async () => ({ ok: false, events: [] }),
    });
    seedConnectedToken(firestore);
    firestore.seed("restreamSessions", "db-1", {
      churchId: "church-1",
      database: "db-1",
      sessionId: "session-mid-service",
      startedAt: Date.now() - 60_000,
      messageCount: 2,
      connected: false,
      wentIdleAt: Date.now() - 30 * 1000,
    });

    await service.ensureReceiver("church-1");
    fakeWs.sockets[0].emit("open");
    emitConnectionInfo(fakeWs.sockets[0], {
      connectionIdentifier: "conn-1",
      connectionUuid: "connection-uuid-1",
      eventSourceId: 13,
      status: "connected",
      target: { owner: { displayName: "Main Channel" }, websiteChannelId: 11 },
    });

    await waitFor(
      () => firestore.read("restreamSessions", "db-1")?.connected === true,
    );

    const session = firestore.read("restreamSessions", "db-1");
    assert.equal(session.sessionId, "session-mid-service");
    assert.equal(session.messageCount, 2);
    assert.equal(session.sessionSuggestion ?? null, null);
    assert.deepEqual(boardDisplayUpdates, []);
  } finally {
    fakeWs.restore();
    process.env.RESTREAM_CLIENT_ID = originalClientId;
    process.env.RESTREAM_CLIENT_SECRET = originalClientSecret;
  }
});

test("restream service keeps chat when the same YouTube destination reconnects after a long gap", async () => {
  const originalClientId = process.env.RESTREAM_CLIENT_ID;
  const originalClientSecret = process.env.RESTREAM_CLIENT_SECRET;
  const fakeWs = installFakeWebSocket();
  process.env.RESTREAM_CLIENT_ID = "client-id";
  process.env.RESTREAM_CLIENT_SECRET = "client-secret";

  try {
    const { firestore, boardDisplayUpdates, service } = createServiceHarness({
      fetchInProgressEvents: async () => ({ ok: false, events: [] }),
    });
    seedConnectedToken(firestore);
    firestore.seed("restreamSessions", "db-1", {
      churchId: "church-1",
      database: "db-1",
      sessionId: "session-mid-service",
      startedAt: Date.now() - 60_000,
      messageCount: 2,
      connected: false,
      wentIdleAt: Date.now() - 20 * 60 * 1000,
      destinationBroadcastIds: ["youtube-event-1"],
    });

    await service.ensureReceiver("church-1");
    fakeWs.sockets[0].emit("open");
    emitConnectionInfo(fakeWs.sockets[0], {
      connectionIdentifier: "conn-1",
      connectionUuid: "connection-uuid-1",
      eventSourceId: 13,
      status: "connected",
      target: {
        event: { id: "youtube-event-1", title: "Sunday Live" },
        owner: { displayName: "Main Channel" },
        websiteChannelId: 11,
      },
    });

    await waitFor(
      () => firestore.read("restreamSessions", "db-1")?.connected === true,
    );

    const session = firestore.read("restreamSessions", "db-1");
    assert.equal(session.sessionId, "session-mid-service");
    assert.equal(session.messageCount, 2);
    assert.deepEqual(boardDisplayUpdates, []);
  } finally {
    fakeWs.restore();
    process.env.RESTREAM_CLIENT_ID = originalClientId;
    process.env.RESTREAM_CLIENT_SECRET = originalClientSecret;
  }
});

test("restream service does not reset when preferred platform order flips YouTube to Facebook", async () => {
  const originalClientId = process.env.RESTREAM_CLIENT_ID;
  const originalClientSecret = process.env.RESTREAM_CLIENT_SECRET;
  const fakeWs = installFakeWebSocket();
  process.env.RESTREAM_CLIENT_ID = "client-id";
  process.env.RESTREAM_CLIENT_SECRET = "client-secret";

  try {
    const { firestore, service } = createServiceHarness({
      fetchInProgressEvents: async () => ({
        ok: true,
        events: [
          {
            id: "restream-event-1",
            destinations: [{ channelId: 11 }, { channelId: 22 }],
          },
        ],
      }),
    });
    seedConnectedToken(firestore);
    firestore.seed("restreamSessions", "db-1", {
      churchId: "church-1",
      database: "db-1",
      sessionId: "session-mid-service",
      startedAt: Date.now() - 60_000,
      messageCount: 2,
      connected: false,
      wentIdleAt: Date.now() - 20 * 60 * 1000,
      restreamEventId: "restream-event-1",
      destinationBroadcastIds: ["youtube-event-1"],
    });

    await service.ensureReceiver("church-1");
    fakeWs.sockets[0].emit("open");
    // Facebook arrives first so preferred-connection ordering would have
    // flipped under the old broadcastKey heuristic.
    emitConnectionInfo(fakeWs.sockets[0], {
      connectionIdentifier: "conn-fb",
      connectionUuid: "connection-uuid-fb",
      eventSourceId: 19,
      status: "connected",
      target: {
        liveVideo: { id: "facebook-live-9", title: "Sunday Live" },
        page: { name: "Church Page" },
        websiteChannelId: 22,
      },
    });
    emitConnectionInfo(fakeWs.sockets[0], {
      connectionIdentifier: "conn-yt",
      connectionUuid: "connection-uuid-yt",
      eventSourceId: 13,
      status: "connected",
      target: {
        event: { id: "youtube-event-1", title: "Sunday Live" },
        owner: { displayName: "Main Channel" },
        websiteChannelId: 11,
      },
    });

    await waitFor(() => {
      const ids =
        firestore.read("restreamSessions", "db-1")?.destinationBroadcastIds ||
        [];
      return ids.includes("facebook-live-9") && ids.includes("youtube-event-1");
    });

    const session = firestore.read("restreamSessions", "db-1");
    assert.equal(session.sessionId, "session-mid-service");
    assert.equal(session.messageCount, 2);
    assert.equal(session.restreamEventId, "restream-event-1");
    assert.deepEqual(session.destinationBroadcastIds, [
      "facebook-live-9",
      "youtube-event-1",
    ]);
  } finally {
    fakeWs.restore();
    process.env.RESTREAM_CLIENT_ID = originalClientId;
    process.env.RESTREAM_CLIENT_SECRET = originalClientSecret;
  }
});

test("restream service keeps chat when one platform disappears and returns", async () => {
  const originalClientId = process.env.RESTREAM_CLIENT_ID;
  const originalClientSecret = process.env.RESTREAM_CLIENT_SECRET;
  const fakeWs = installFakeWebSocket();
  process.env.RESTREAM_CLIENT_ID = "client-id";
  process.env.RESTREAM_CLIENT_SECRET = "client-secret";

  try {
    const { firestore, service } = createServiceHarness({
      fetchInProgressEvents: async () => ({
        ok: true,
        events: [
          {
            id: "restream-event-1",
            destinations: [{ channelId: 11 }, { channelId: 22 }],
          },
        ],
      }),
    });
    seedConnectedToken(firestore);
    firestore.seed("restreamSessions", "db-1", {
      churchId: "church-1",
      database: "db-1",
      sessionId: "session-mid-service",
      startedAt: Date.now() - 60_000,
      messageCount: 3,
      connected: true,
      restreamEventId: "restream-event-1",
      destinationBroadcastIds: ["facebook-live-9", "youtube-event-1"],
    });

    await service.ensureReceiver("church-1");
    fakeWs.sockets[0].emit("open");
    emitConnectionInfo(fakeWs.sockets[0], {
      connectionIdentifier: "conn-yt",
      connectionUuid: "connection-uuid-yt",
      eventSourceId: 13,
      status: "connected",
      target: {
        event: { id: "youtube-event-1", title: "Sunday Live" },
        owner: { displayName: "Main Channel" },
        websiteChannelId: 11,
      },
    });
    await waitFor(
      () =>
        (firestore.read("restreamSessions", "db-1")?.activeConnectionCount ||
          0) >= 1,
    );

    // Mark idle, then restore only Facebook first (order change + partial set).
    fakeWs.sockets[0].emit("close");
    await waitFor(
      () => firestore.read("restreamSessions", "db-1")?.connected === false,
    );

    await service.ensureReceiver("church-1");
    fakeWs.sockets.at(-1).emit("open");
    emitConnectionInfo(fakeWs.sockets.at(-1), {
      connectionIdentifier: "conn-fb",
      connectionUuid: "connection-uuid-fb",
      eventSourceId: 19,
      status: "connected",
      target: {
        liveVideo: { id: "facebook-live-9", title: "Sunday Live" },
        page: { name: "Church Page" },
        websiteChannelId: 22,
      },
    });

    await waitFor(
      () => firestore.read("restreamSessions", "db-1")?.connected === true,
    );

    const session = firestore.read("restreamSessions", "db-1");
    assert.equal(session.sessionId, "session-mid-service");
    assert.equal(session.messageCount, 3);
    assert.equal(session.restreamEventId, "restream-event-1");
  } finally {
    fakeWs.restore();
    process.env.RESTREAM_CLIENT_ID = originalClientId;
    process.env.RESTREAM_CLIENT_SECRET = originalClientSecret;
  }
});

test("restream service keeps chat when YouTube and Facebook destination ids differ for the same service", async () => {
  const decision = decideRestreamSessionBoundary({
    previousSession: {
      sessionId: "session-1",
      messageCount: 4,
      startedAt: Date.now() - 60_000,
      destinationBroadcastIds: ["youtube-event-1"],
    },
    currentRestreamEventId: "",
    currentDestinationBroadcastIds: ["facebook-live-9"],
    now: Date.now(),
  });
  assert.equal(decision.action, "keep");
  assert.equal(decision.suggestion?.reason, "possible_new_service");

  const sameServiceWithEvent = decideRestreamSessionBoundary({
    previousSession: {
      sessionId: "session-1",
      messageCount: 4,
      startedAt: Date.now() - 60_000,
      restreamEventId: "restream-event-1",
      destinationBroadcastIds: ["youtube-event-1"],
    },
    currentRestreamEventId: "restream-event-1",
    currentDestinationBroadcastIds: ["facebook-live-9"],
    now: Date.now(),
  });
  assert.equal(sameServiceWithEvent.action, "keep");
  assert.equal(sameServiceWithEvent.reason, "confirmed_same_restream_event");
  assert.equal(sameServiceWithEvent.suggestion, undefined);
});

test("restream service auto-resets only for a confirmed different Restream Event ID", async () => {
  const originalClientId = process.env.RESTREAM_CLIENT_ID;
  const originalClientSecret = process.env.RESTREAM_CLIENT_SECRET;
  const fakeWs = installFakeWebSocket();
  process.env.RESTREAM_CLIENT_ID = "client-id";
  process.env.RESTREAM_CLIENT_SECRET = "client-secret";

  try {
    const { firestore, boardDisplayUpdates, service } = createServiceHarness({
      fetchInProgressEvents: async () => ({
        ok: true,
        events: [
          {
            id: "restream-event-new",
            destinations: [{ channelId: 11 }],
          },
        ],
      }),
    });
    seedConnectedToken(firestore);
    firestore.seed("restreamSessions", "db-1", {
      churchId: "church-1",
      database: "db-1",
      sessionId: "session-last-week",
      startedAt: 100,
      messageCount: 2,
      connected: false,
      wentIdleAt: Date.now() - 20 * 60 * 1000,
      restreamEventId: "restream-event-old",
      destinationBroadcastIds: ["youtube-event-old"],
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
    fakeWs.sockets[0].emit("open");
    emitConnectionInfo(fakeWs.sockets[0], {
      connectionIdentifier: "conn-1",
      connectionUuid: "connection-uuid-1",
      eventSourceId: 13,
      status: "connected",
      target: {
        event: { id: "youtube-event-new", title: "Wednesday Live" },
        owner: { displayName: "Main Channel" },
        websiteChannelId: 11,
      },
    });

    await waitFor(
      () =>
        firestore.read("restreamSessions", "db-1")?.sessionId !==
        "session-last-week",
    );

    const session = firestore.read("restreamSessions", "db-1");
    assert.notEqual(session.sessionId, "session-last-week");
    assert.equal(session.messageCount, 0);
    assert.equal(session.restreamEventId, "restream-event-new");
    assert.equal(
      firestore.read("restreamMessages", "m1").sessionId,
      "session-last-week",
    );
    assert.ok(boardDisplayUpdates.includes("db-1"));

    const currentMessages = await service.listCurrentSessionMessages({
      churchId: "church-1",
      database: "db-1",
    });
    assert.equal(currentMessages.length, 0);
  } finally {
    fakeWs.restore();
    process.env.RESTREAM_CLIENT_ID = originalClientId;
    process.env.RESTREAM_CLIENT_SECRET = originalClientSecret;
  }
});

test("restream service keeps chat for the same confirmed Restream Event ID", async () => {
  const originalClientId = process.env.RESTREAM_CLIENT_ID;
  const originalClientSecret = process.env.RESTREAM_CLIENT_SECRET;
  const fakeWs = installFakeWebSocket();
  process.env.RESTREAM_CLIENT_ID = "client-id";
  process.env.RESTREAM_CLIENT_SECRET = "client-secret";

  try {
    const { firestore, boardDisplayUpdates, service } = createServiceHarness({
      fetchInProgressEvents: async () => ({
        ok: true,
        events: [
          {
            id: "restream-event-1",
            destinations: [{ channelId: 11 }],
          },
        ],
      }),
    });
    seedConnectedToken(firestore);
    firestore.seed("restreamSessions", "db-1", {
      churchId: "church-1",
      database: "db-1",
      sessionId: "session-mid-service",
      startedAt: Date.now() - 60_000,
      messageCount: 2,
      connected: false,
      wentIdleAt: Date.now() - 20 * 60 * 1000,
      restreamEventId: "restream-event-1",
    });

    await service.ensureReceiver("church-1");
    fakeWs.sockets[0].emit("open");
    emitConnectionInfo(fakeWs.sockets[0], {
      connectionIdentifier: "conn-1",
      connectionUuid: "connection-uuid-1",
      eventSourceId: 13,
      status: "connected",
      target: {
        event: { id: "youtube-event-1", title: "Sunday Live" },
        owner: { displayName: "Main Channel" },
        websiteChannelId: 11,
      },
    });

    await waitFor(
      () => firestore.read("restreamSessions", "db-1")?.connected === true,
    );

    const session = firestore.read("restreamSessions", "db-1");
    assert.equal(session.sessionId, "session-mid-service");
    assert.equal(session.messageCount, 2);
    assert.equal(session.restreamEventId, "restream-event-1");
    assert.equal(session.sessionSuggestion ?? null, null);
    assert.deepEqual(boardDisplayUpdates, []);
  } finally {
    fakeWs.restore();
    process.env.RESTREAM_CLIENT_ID = originalClientId;
    process.env.RESTREAM_CLIENT_SECRET = originalClientSecret;
  }
});

test("restream service keeps chat and exposes status suggestion for ambiguous identity", async () => {
  const originalClientId = process.env.RESTREAM_CLIENT_ID;
  const originalClientSecret = process.env.RESTREAM_CLIENT_SECRET;
  const fakeWs = installFakeWebSocket();
  process.env.RESTREAM_CLIENT_ID = "client-id";
  process.env.RESTREAM_CLIENT_SECRET = "client-secret";

  try {
    const { firestore, service } = createServiceHarness({
      fetchInProgressEvents: async () => ({ ok: false, events: [] }),
    });
    seedConnectedToken(firestore);
    firestore.seed("restreamSessions", "db-1", {
      churchId: "church-1",
      database: "db-1",
      sessionId: "session-mid-service",
      startedAt: Date.now() - 60_000,
      messageCount: 2,
      connected: false,
      destinationBroadcastIds: ["youtube-event-old"],
    });

    await service.ensureReceiver("church-1");
    fakeWs.sockets[0].emit("open");
    emitConnectionInfo(fakeWs.sockets[0], {
      connectionIdentifier: "conn-1",
      connectionUuid: "connection-uuid-1",
      eventSourceId: 19,
      status: "connected",
      target: {
        liveVideo: { id: "facebook-live-new", title: "Maybe new" },
        page: { name: "Church Page" },
        websiteChannelId: 22,
      },
    });

    await waitFor(
      () =>
        firestore.read("restreamSessions", "db-1")?.sessionSuggestion
          ?.reason === "possible_new_service",
    );

    const session = firestore.read("restreamSessions", "db-1");
    assert.equal(session.sessionId, "session-mid-service");
    assert.equal(session.messageCount, 2);

    const status = await service.getStatusForChurch({
      churchId: "church-1",
      database: "db-1",
    });
    assert.equal(
      status.session.sessionSuggestion?.reason,
      "possible_new_service",
    );

    const kept = await service.dismissSessionSuggestion({
      churchId: "church-1",
      database: "db-1",
    });
    assert.equal(kept.session.sessionId, "session-mid-service");
    assert.equal(kept.session.sessionSuggestion, null);
    assert.ok(
      firestore.read("restreamSessions", "db-1")?.sessionSuggestionDismissed,
    );
  } finally {
    fakeWs.restore();
    process.env.RESTREAM_CLIENT_ID = originalClientId;
    process.env.RESTREAM_CLIENT_SECRET = originalClientSecret;
  }
});

test("dismissed day-boundary suggestion stays dismissed across a second live transition", async () => {
  const originalClientId = process.env.RESTREAM_CLIENT_ID;
  const originalClientSecret = process.env.RESTREAM_CLIENT_SECRET;
  const fakeWs = installFakeWebSocket();
  process.env.RESTREAM_CLIENT_ID = "client-id";
  process.env.RESTREAM_CLIENT_SECRET = "client-secret";
  const startedAt = Date.now() - 48 * 60 * 60 * 1000;

  try {
    const { firestore, service } = createServiceHarness({
      fetchInProgressEvents: async () => ({ ok: false, events: [] }),
    });
    seedConnectedToken(firestore);
    firestore.seed("restreamSessions", "db-1", {
      churchId: "church-1",
      database: "db-1",
      sessionId: "session-yesterday",
      startedAt,
      messageCount: 2,
      connected: false,
    });

    await service.ensureReceiver("church-1");
    fakeWs.sockets[0].emit("open");
    emitConnectionInfo(fakeWs.sockets[0], {
      connectionIdentifier: "conn-1",
      connectionUuid: "connection-uuid-1",
      eventSourceId: 13,
      status: "connected",
      target: {
        event: { id: "youtube-event-1", title: "Sunday Live" },
        owner: { displayName: "Main Channel" },
        websiteChannelId: 11,
      },
    });

    await waitFor(
      () =>
        firestore.read("restreamSessions", "db-1")?.sessionSuggestion
          ?.reason === "day_boundary",
    );

    await service.dismissSessionSuggestion({
      churchId: "church-1",
      database: "db-1",
    });
    assert.equal(
      firestore.read("restreamSessions", "db-1")?.sessionSuggestion ?? null,
      null,
    );

    fakeWs.sockets[0].emit("close");
    await waitFor(
      () => firestore.read("restreamSessions", "db-1")?.connected === false,
    );
    await service.ensureReceiver("church-1");
    fakeWs.sockets.at(-1).emit("open");
    emitConnectionInfo(fakeWs.sockets.at(-1), {
      connectionIdentifier: "conn-1",
      connectionUuid: "connection-uuid-1",
      eventSourceId: 13,
      status: "connected",
      target: {
        event: { id: "youtube-event-1", title: "Sunday Live" },
        owner: { displayName: "Main Channel" },
        websiteChannelId: 11,
      },
    });
    await waitFor(
      () => firestore.read("restreamSessions", "db-1")?.connected === true,
    );

    const afterSecondLive = firestore.read("restreamSessions", "db-1");
    assert.equal(afterSecondLive.sessionId, "session-yesterday");
    assert.equal(afterSecondLive.sessionSuggestion ?? null, null);
    assert.equal(
      afterSecondLive.lastBoundaryDecision?.reason,
      "day_boundary_activity",
    );
  } finally {
    fakeWs.restore();
    process.env.RESTREAM_CLIENT_ID = originalClientId;
    process.env.RESTREAM_CLIENT_SECRET = originalClientSecret;
  }
});

test("decideRestreamSessionBoundary honors dismissed suggestion fingerprints", () => {
  const startedAt = Date.now() - 48 * 60 * 60 * 1000;
  const fingerprint = ["day_boundary", "", "", String(startedAt)].join("|");
  const decision = decideRestreamSessionBoundary({
    previousSession: {
      sessionId: "session-1",
      messageCount: 2,
      startedAt,
      sessionSuggestionDismissed: {
        reason: "day_boundary",
        fingerprint,
      },
    },
    currentRestreamEventId: "",
    currentDestinationBroadcastIds: [],
    now: Date.now(),
  });
  assert.equal(decision.action, "keep");
  assert.equal(decision.reason, "day_boundary_activity");
  assert.equal(decision.suggestion, undefined);
});

test("unmatched Event channel mapping keeps the session instead of auto-resetting", async () => {
  const originalClientId = process.env.RESTREAM_CLIENT_ID;
  const originalClientSecret = process.env.RESTREAM_CLIENT_SECRET;
  const fakeWs = installFakeWebSocket();
  process.env.RESTREAM_CLIENT_ID = "client-id";
  process.env.RESTREAM_CLIENT_SECRET = "client-secret";

  try {
    const { firestore, boardDisplayUpdates, service } = createServiceHarness({
      fetchInProgressEvents: async () => ({
        ok: true,
        events: [
          {
            id: "unrelated-in-progress-event",
            destinations: [{ channelId: 99 }],
          },
        ],
      }),
    });
    seedConnectedToken(firestore);
    firestore.seed("restreamSessions", "db-1", {
      churchId: "church-1",
      database: "db-1",
      sessionId: "session-mid-service",
      startedAt: Date.now() - 60_000,
      messageCount: 2,
      connected: false,
      restreamEventId: "restream-event-1",
      destinationBroadcastIds: ["youtube-event-1"],
    });

    await service.ensureReceiver("church-1");
    fakeWs.sockets[0].emit("open");
    emitConnectionInfo(fakeWs.sockets[0], {
      connectionIdentifier: "conn-1",
      connectionUuid: "connection-uuid-1",
      eventSourceId: 13,
      status: "connected",
      target: {
        event: { id: "youtube-event-1", title: "Sunday Live" },
        owner: { displayName: "Main Channel" },
        websiteChannelId: 11,
      },
    });

    await waitFor(
      () => firestore.read("restreamSessions", "db-1")?.connected === true,
    );

    const session = firestore.read("restreamSessions", "db-1");
    assert.equal(session.sessionId, "session-mid-service");
    assert.equal(session.messageCount, 2);
    assert.equal(session.restreamEventId, "restream-event-1");
    assert.deepEqual(boardDisplayUpdates, []);
  } finally {
    fakeWs.restore();
    process.env.RESTREAM_CLIENT_ID = originalClientId;
    process.env.RESTREAM_CLIENT_SECRET = originalClientSecret;
  }
});

test("resolveRestreamEventId matches active chat channels to in-progress events", () => {
  const connections = new Map([
    [
      "yt",
      {
        status: "connected",
        target: { websiteChannelId: 11, event: { id: "yt-1" } },
      },
    ],
    [
      "fb",
      {
        status: "connected",
        target: { websiteChannelId: 22, liveVideo: { id: "fb-1" } },
      },
    ],
  ]);
  assert.equal(
    resolveRestreamEventId(
      [
        {
          id: "event-a",
          destinations: [{ channelId: 11 }, { channelId: 22 }],
        },
        {
          id: "event-b",
          destinations: [{ channelId: 99 }],
        },
      ],
      connections,
    ),
    "event-a",
  );
  assert.equal(resolveRestreamEventId([], connections), "");
  assert.equal(
    resolveRestreamEventId(
      [
        { id: "event-a", destinations: [{ channelId: 11 }] },
        { id: "event-b", destinations: [{ channelId: 22 }] },
      ],
      connections,
    ),
    "",
  );
  // Unmatched channels must not fall through to “trust the sole event.”
  assert.equal(
    resolveRestreamEventId(
      [
        {
          id: "stale-or-unrelated-event",
          destinations: [{ channelId: 99 }],
        },
      ],
      connections,
    ),
    "",
  );
  // Without channel ids, a single in-progress event remains usable.
  assert.equal(
    resolveRestreamEventId(
      [{ id: "solo-event", destinations: [{ channelId: 11 }] }],
      new Map([
        [
          "discord",
          {
            status: "connected",
            target: { channel: { id: "c1", name: "general" } },
          },
        ],
      ]),
    ),
    "solo-event",
  );
  assert.deepEqual(collectDestinationBroadcastIds(connections), [
    "fb-1",
    "yt-1",
  ]);
  assert.equal(
    beganOnPreviousLocalCalendarDay(Date.now() - 48 * 60 * 60 * 1000),
    true,
  );
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
  const postedAt = Date.now();
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
      postedAt,
      messageTimestamp: postedAt,
      expiresAt: postedAt + RESTREAM_MESSAGE_RETENTION_MS,
      isHighlighted: false,
      hidden: false,
    });
  await realtimeDb.ref(currentSessionPath).update({
    messageCount: 1,
    lastEventAt: postedAt,
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
      postedAt,
      messageTimestamp: postedAt,
      expiresAt: postedAt + RESTREAM_MESSAGE_RETENTION_MS,
      isHighlighted: false,
      hidden: false,
    },
  );
});

test("RTDB Restream persistence deduplicates concurrent deliveries and counts distinct messages", async () => {
  const fakeWs = installFakeWebSocket();
  const realtimeDb = createRealtimeDbMock();
  const tokenPath = "server/restream/v1/restreamTokens/church-1";
  await realtimeDb.ref(tokenPath).set({
    churchId: "church-1",
    database: "db-1",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    accessTokenExpiresAt: Date.now() + 3_600_000,
    accountLabel: "Main account",
  });

  try {
    const first = createServiceHarness({
      useFirestore: false,
      realtimeDb,
      fetchInProgressEvents: async () => ({ ok: false, events: [] }),
    });
    const second = createServiceHarness({
      useFirestore: false,
      realtimeDb,
      fetchInProgressEvents: async () => ({ ok: false, events: [] }),
    });
    await first.service.resetSession({ churchId: "church-1", database: "db-1" });
    await Promise.all([
      first.service.ensureReceiver("church-1"),
      second.service.ensureReceiver("church-1"),
    ]);

    fakeWs.sockets.forEach((socket) => {
      socket.emit("open");
      emitConnectionInfo(socket, {
        connectionIdentifier: "conn-1",
        connectionUuid: "connection-uuid-1",
        eventSourceId: 13,
        status: "connected",
        target: {
          event: { id: "event-shared", title: "Sunday Live" },
          owner: { displayName: "Main Channel" },
          websiteChannelId: 11,
        },
      });
    });
    await waitFor(
      () =>
        realtimeDb.read("server/restream/v1/restreamSessions/db-1")
          ?.connected === true,
    );

    const eventTimestamp = Math.floor(Date.now() / 1000);
    const makeEvent = (id, timestamp) => ({
      data: JSON.stringify({
        action: "event",
        timestamp,
        payload: {
          connectionIdentifier: "conn-1",
          eventIdentifier: `event-${id}`,
          eventSourceId: 13,
          eventTypeId: 5,
          eventPayload: {
            author: { displayName: "Evan" },
            liveChatMessageId: id,
            text: id,
          },
        },
      }),
    });

    const duplicate = makeEvent("youtube-message-1", eventTimestamp);
    fakeWs.sockets.forEach((socket) => socket.emit("message", duplicate));
    await waitFor(
      () => realtimeDb.read("server/restream/v1/restreamSessions/db-1")?.messageCount === 1,
    );

    fakeWs.sockets[0].emit(
      "message",
      makeEvent("youtube-message-2", eventTimestamp + 1),
    );
    fakeWs.sockets[1].emit(
      "message",
      makeEvent("youtube-message-3", eventTimestamp + 2),
    );
    await waitFor(
      () => realtimeDb.read("server/restream/v1/restreamSessions/db-1")?.messageCount === 3,
    );

    const messages = await first.service.listCurrentSessionMessages({
      churchId: "church-1",
      database: "db-1",
    });
    assert.equal(messages.length, 3);
    assert.equal(
      realtimeDb.read("server/restream/v1/restreamSessions/db-1").messageCount,
      3,
    );
  } finally {
    fakeWs.restore();
  }
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
    await waitFor(
      () => firestore.metrics.queryGets.length >= queryCountBeforeDedupe + 2,
    );

    const dedupeQueries = firestore.metrics.queryGets.slice(
      queryCountBeforeDedupe,
    );
    assert.equal(dedupeQueries.length, 2);
    assert.equal(
      dedupeQueries.every(
        (query) => query.name === "restreamMessages" && query.limit === 1,
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
    assert.equal(
      dedupeQueries.every((query) => query.limit === 1),
      true,
    );
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
      (
        await first.service.listCurrentSessionMessages({
          churchId: "church-1",
          database: "db-1",
        })
      ).length,
      3,
    );
    assert.equal(
      sharedFirestore.read("restreamSessions", "db-1").messageCount,
      3,
    );

    sockets[0].emit("message", retryEvent);
    await waitFor(
      () =>
        sharedFirestore.read("restreamSessions", "db-1")?.messageCount === 4,
    );
    assert.equal(
      (
        await first.service.listCurrentSessionMessages({
          churchId: "church-1",
          database: "db-1",
        })
      ).length,
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
      messageTimestamp: postedAt,
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
    const dedupeQueries = firestore.metrics.queryGets
      .slice(queryCountBeforeDedupe)
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
        scope: "chat.read channels.read stream.read",
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
    assert.equal(
      url.searchParams.get("scope"),
      "chat.read channels.read stream.read",
    );

    const storedState = firestore.read("restreamOauthStates", state);
    assert.equal(storedState?.churchId, "church-1");
    assert.equal(storedState?.database, "db-1");
    assert.equal(storedState?.connectRequestId, connectStart.connectRequestId);
    assert.equal(
      Date.parse(storedState?.ttlExpireAt),
      storedState?.expiresAt,
    );
    const storedConnectRequest = firestore.read(
      "restreamConnectRequests",
      connectStart.connectRequestId,
    );
    assert.equal(
      Date.parse(storedConnectRequest?.ttlExpireAt),
      storedConnectRequest?.expiresAt,
    );

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
