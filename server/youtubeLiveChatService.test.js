import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import {
  createYouTubeLiveChatService,
  normalizeYouTubeVideoId,
  YOUTUBE_LIVE_CHAT_MAX_LENGTH,
} from "./youtubeLiveChatService.js";

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

  return {
    collection(name) {
      return {
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
      };
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
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i];
      if (!current[part] || typeof current[part] !== "object") {
        current[part] = {};
      }
      current = current[part];
    }
    return { parent: current, key: parts[parts.length - 1] };
  };

  return {
    updates,
    ref(path) {
      return {
        async get() {
          const value = getAtPath(path);
          return {
            exists: () => value !== undefined,
            val: () => (value === undefined ? null : clone(value)),
          };
        },
        async set(value) {
          const { parent, key } = ensureParent(path);
          parent[key] = clone(value);
        },
        async update(patch) {
          updates.push({ path, patch: clone(patch) });
          const existing = getAtPath(path);
          const { parent, key } = ensureParent(path);
          parent[key] = {
            ...(existing && typeof existing === "object" ? existing : {}),
            ...clone(patch),
          };
        },
        async remove() {
          const parts = splitPath(path);
          if (!parts.length) return;
          let current = root;
          for (let i = 0; i < parts.length - 1; i += 1) {
            current = current[parts[i]];
            if (!current || typeof current !== "object") return;
          }
          delete current[parts[parts.length - 1]];
        },
      };
    },
  };
};

test("normalizeYouTubeVideoId accepts ids and common URLs", () => {
  assert.equal(normalizeYouTubeVideoId("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(
    normalizeYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    "dQw4w9WgXcQ",
  );
  assert.equal(
    normalizeYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ"),
    "dQw4w9WgXcQ",
  );
  assert.equal(
    normalizeYouTubeVideoId("https://www.youtube.com/live/dQw4w9WgXcQ"),
    "dQw4w9WgXcQ",
  );
  assert.equal(normalizeYouTubeVideoId("not-a-valid-youtube-id"), "");
});

test("YouTube connect stores tokens and marks integration connected", async (t) => {
  const previousId = process.env.YOUTUBE_CLIENT_ID;
  const previousSecret = process.env.YOUTUBE_CLIENT_SECRET;
  process.env.YOUTUBE_CLIENT_ID = "yt-client";
  process.env.YOUTUBE_CLIENT_SECRET = "yt-secret";
  t.after(() => {
    process.env.YOUTUBE_CLIENT_ID = previousId;
    process.env.YOUTUBE_CLIENT_SECRET = previousSecret;
  });

  const firestore = createFirestoreMock();
  const rtdb = createRealtimeDbMock();
  const service = createYouTubeLiveChatService({
    getFirestore: () => firestore,
    getRealtimeDatabase: () => rtdb,
    getIntegrationsPath: (churchId) => `churches/${churchId}/data/integrations`,
    redirectBaseUrl: "https://local.worshipsync.net:5000",
  });

  const start = await service.startConnect({
    churchId: "church-1",
    database: "db-1",
    userId: "user-1",
    returnTo: "/account/integrations",
    desktop: true,
  });
  assert.ok(start.authorizeUrl.includes("accounts.google.com"));
  assert.ok(start.connectRequestId);
  assert.ok(start.connectRequestSecret);

  const authorizeUrl = new URL(start.authorizeUrl);
  const state = authorizeUrl.searchParams.get("state");

  const originalPost = axios.post;
  const originalGet = axios.get;
  axios.post = async (url) => {
    assert.equal(url, "https://oauth2.googleapis.com/token");
    return {
      data: {
        access_token: "access-1",
        refresh_token: "refresh-1",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/youtube.force-ssl",
      },
    };
  };
  axios.get = async (url) => {
    assert.match(String(url), /\/channels\?/);
    return {
      data: {
        items: [{ snippet: { title: "Church Live" } }],
      },
    };
  };
  t.after(() => {
    axios.post = originalPost;
    axios.get = originalGet;
  });

  const result = await service.completeConnect({
    state,
    code: "auth-code",
  });
  assert.equal(result.success, true);
  assert.equal(result.accountLabel, "Church Live");
  assert.equal(result.desktop, true);
  assert.equal(result.returnTo, "/account/integrations");

  const token = firestore.read("youtubeTokens", "church-1");
  assert.equal(token.accessToken, "access-1");
  assert.equal(token.refreshToken, "refresh-1");
  assert.equal(token.accountLabel, "Church Live");

  const statusUpdate = rtdb.updates.find(
    (entry) =>
      entry.path === "churches/church-1/data/integrations/youtube" &&
      entry.patch.connected === true,
  );
  assert.ok(statusUpdate);

  const status = await service.getConnectStatus({
    connectRequestId: start.connectRequestId,
    connectRequestSecret: start.connectRequestSecret,
  });
  assert.equal(status.status, "completed");
  assert.equal(status.accountLabel, "Church Live");
});

test("sendLiveChatMessage posts to active broadcast live chat", async (t) => {
  const previousId = process.env.YOUTUBE_CLIENT_ID;
  const previousSecret = process.env.YOUTUBE_CLIENT_SECRET;
  process.env.YOUTUBE_CLIENT_ID = "yt-client";
  process.env.YOUTUBE_CLIENT_SECRET = "yt-secret";
  t.after(() => {
    process.env.YOUTUBE_CLIENT_ID = previousId;
    process.env.YOUTUBE_CLIENT_SECRET = previousSecret;
  });

  const firestore = createFirestoreMock();
  const rtdb = createRealtimeDbMock();
  firestore.seed("youtubeTokens", "church-1", {
    churchId: "church-1",
    database: "db-1",
    accessToken: "access-1",
    refreshToken: "refresh-1",
    accessTokenExpiresAt: Date.now() + 60 * 60 * 1000,
    accountLabel: "Church Live",
  });

  const service = createYouTubeLiveChatService({
    getFirestore: () => firestore,
    getRealtimeDatabase: () => rtdb,
    getIntegrationsPath: (churchId) => `churches/${churchId}/data/integrations`,
    redirectBaseUrl: "https://local.worshipsync.net:5000",
  });

  const originalPost = axios.post;
  const originalGet = axios.get;
  axios.get = async (url) => {
    assert.match(String(url), /\/liveBroadcasts\?/);
    return {
      data: {
        items: [
          {
            id: "video-1",
            snippet: {
              title: "Sunday Live",
              liveChatId: "chat-1",
            },
          },
        ],
      },
    };
  };
  axios.post = async (url, body) => {
    assert.equal(
      url,
      "https://www.googleapis.com/youtube/v3/liveChat/messages",
    );
    assert.equal(body.snippet.liveChatId, "chat-1");
    assert.equal(body.snippet.textMessageDetails.messageText, "Welcome");
    return { data: { id: "msg-1" } };
  };
  t.after(() => {
    axios.post = originalPost;
    axios.get = originalGet;
  });

  const result = await service.sendLiveChatMessage({
    churchId: "church-1",
    messageText: "Welcome",
  });
  assert.equal(result.success, true);
  assert.equal(result.messageId, "msg-1");
  assert.equal(result.liveChatId, "chat-1");
  assert.equal(result.broadcastTitle, "Sunday Live");
});

test("sendLiveChatMessage rejects oversized messages", async () => {
  const service = createYouTubeLiveChatService({
    getFirestore: () => createFirestoreMock(),
    getRealtimeDatabase: () => createRealtimeDbMock(),
    getIntegrationsPath: (churchId) => `churches/${churchId}/data/integrations`,
    redirectBaseUrl: "https://local.worshipsync.net:5000",
  });

  await assert.rejects(
    () =>
      service.sendLiveChatMessage({
        churchId: "church-1",
        messageText: "x".repeat(YOUTUBE_LIVE_CHAT_MAX_LENGTH + 1),
      }),
    (error) =>
      error.statusCode === 400 && /too long/i.test(String(error.message)),
  );
});

test("sendLiveChatMessage rejects an invalid live video URL", async () => {
  const service = createYouTubeLiveChatService({
    getFirestore: () => createFirestoreMock(),
    getRealtimeDatabase: () => createRealtimeDbMock(),
    getIntegrationsPath: (churchId) => `churches/${churchId}/data/integrations`,
    redirectBaseUrl: "https://local.worshipsync.net:5000",
  });

  await assert.rejects(
    () =>
      service.sendLiveChatMessage({
        churchId: "church-1",
        messageText: "Hello",
        videoIdOrUrl: "https://example.com/not-youtube",
      }),
    (error) =>
      error.statusCode === 400 &&
      error.message === "Enter a valid YouTube live video URL or video ID.",
  );
});

test("sendLiveChatMessage uses client-safe errors for operator failures", async (t) => {
  const firestore = createFirestoreMock();
  const rtdb = createRealtimeDbMock();
  const service = createYouTubeLiveChatService({
    getFirestore: () => firestore,
    getRealtimeDatabase: () => rtdb,
    getIntegrationsPath: (churchId) => `churches/${churchId}/data/integrations`,
    redirectBaseUrl: "https://local.worshipsync.net:5000",
  });

  await assert.rejects(
    () =>
      service.sendLiveChatMessage({
        churchId: "church-1",
        messageText: "Hello",
      }),
    (error) =>
      error.statusCode === 400 &&
      error.message === "YouTube is not connected for this church.",
  );

  firestore.seed("youtubeTokens", "church-1", {
    churchId: "church-1",
    database: "db-1",
    accessToken: "access-1",
    refreshToken: "refresh-1",
    accessTokenExpiresAt: Date.now() + 60 * 60 * 1000,
    accountLabel: "Church Live",
  });

  const originalGet = axios.get;
  const originalPost = axios.post;
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  axios.get = async () => {
    const err = new Error("Request failed with status code 403");
    err.response = {
      data: {
        error: {
          message:
            "The request cannot be completed because you have exceeded your quota.",
        },
      },
    };
    throw err;
  };
  t.after(() => {
    axios.get = originalGet;
    axios.post = originalPost;
    console.warn = originalWarn;
  });

  await assert.rejects(
    () =>
      service.sendLiveChatMessage({
        churchId: "church-1",
        messageText: "Hello",
      }),
    (error) =>
      error.statusCode === 400 &&
      !/quota/i.test(error.message) &&
      /active YouTube live chat/i.test(error.message),
  );
  assert.equal(warnings.length, 1);

  const statusUpdate = rtdb.updates.find(
    (entry) =>
      entry.path === "churches/church-1/data/integrations/youtube" &&
      entry.patch.lastError,
  );
  assert.ok(statusUpdate);
  assert.equal(/quota/i.test(String(statusUpdate.patch.lastError)), false);
});
