import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import {
  createRestreamService,
  normalizeRestreamPostedAtMs,
} from "./restreamService.js";

const createFirestoreMock = () => {
  const collections = new Map();

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

  const buildQuery = (name, filters = []) => ({
    doc(id) {
      const collection = getCollectionMap(name);
      return {
        async get() {
          return buildDocSnapshot(id, collection.get(id));
        },
        async set(data, options = {}) {
          const current = collection.get(id) || {};
          collection.set(
            id,
            options.merge ? { ...current, ...clone(data) } : clone(data),
          );
        },
        async delete() {
          collection.delete(id);
        },
      };
    },
    where(field, operator, value) {
      assert.equal(operator, "==");
      return buildQuery(name, [...filters, { field, value }]);
    },
    async get() {
      const rows = Array.from(getCollectionMap(name).entries())
        .filter(([, doc]) =>
          filters.every(({ field, value }) => doc?.[field] === value),
        )
        .map(([id, doc]) => buildDocSnapshot(id, doc));
      return { docs: rows };
    },
  });

  return {
    collection(name) {
      return buildQuery(name);
    },
    seed(collectionName, id, value) {
      getCollectionMap(collectionName).set(id, clone(value));
    },
    read(collectionName, id) {
      const value = getCollectionMap(collectionName).get(id);
      return value ? clone(value) : undefined;
    },
  };
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

const createServiceHarness = ({ useFirestore = true, realtimeDb } = {}) => {
  const firestore = createFirestoreMock();
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
        connectionIdentifier: "conn-1",
        status: "error",
        reason: "event_not_started",
        eventSourceName: "YouTube",
        target: {
          owner: {
            displayName: "Main Channel",
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
