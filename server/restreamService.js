import crypto from "node:crypto";
import axios from "axios";

const RESTREAM_TOKEN_COLLECTION = "restreamTokens";
const RESTREAM_SESSION_COLLECTION = "restreamSessions";
const RESTREAM_MESSAGE_COLLECTION = "restreamMessages";
const RESTREAM_OAUTH_STATE_COLLECTION = "restreamOauthStates";
const RESTREAM_CONNECT_REQUEST_COLLECTION = "restreamConnectRequests";
const RESTREAM_RTDB_ROOT = "server/restream/v1";
const RESTREAM_RTDB_MESSAGE_INDEX = "restreamMessagesByDatabase";
const STATE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_EXPIRY_SKEW_MS = 60 * 1000;
const MAX_MESSAGE_QUERY = 500;
const RESTREAM_CONNECT_POLL_INTERVAL_MS = 1500;

const RESTREAM_MESSAGE_KIND_VIEWER = "viewer_message";
const RESTREAM_MESSAGE_KIND_MODERATOR_REPLY = "moderator_reply";

const CONNECT_STATUS_PENDING = "pending";
const CONNECT_STATUS_COMPLETED = "completed";
const CONNECT_STATUS_FAILED = "failed";
const CONNECT_STATUS_EXPIRED = "expired";

const nowMs = () => Date.now();
const createId = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const hashValue = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex");

const clampRoute = (value) => {
  const raw = String(value || "").trim();
  if (!raw.startsWith("/")) return "/boards/controller";
  return raw;
};

const toTimestamp = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return asNumber;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

/** Restream / YouTube events often send Unix seconds; store and expose UNIX ms. */
export const normalizeRestreamPostedAtMs = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  if (value < 1e12) {
    return Math.round(value * 1000);
  }
  return Math.round(value);
};

const mapEventTypeIdToPlatform = (eventTypeId) => {
  const id = Number(eventTypeId);
  if ([1].includes(id)) return "Discord";
  if ([2, 3].includes(id)) return "DLive";
  if ([4].includes(id)) return "Twitch";
  if ([5, 7, 8, 23, 28, 29].includes(id)) return "YouTube";
  if ([11, 12, 13, 14].includes(id)) return "Facebook";
  if ([21].includes(id)) return "LinkedIn";
  if ([22].includes(id)) return "Trovo";
  if ([24].includes(id)) return "X";
  if ([25, 26].includes(id)) return "Kick";
  if ([32].includes(id)) return "Rumble";
  return "Restream";
};

const readAuthorName = (payload) => {
  const author = payload?.author;
  const names = [
    author?.displayName,
    author?.name,
    author?.username,
    author?.id,
  ];
  const resolved = names.find(
    (value) => typeof value === "string" && value.trim(),
  );
  return resolved?.trim() || "Unknown author";
};

const readAuthorAvatarUrl = (payload) => {
  const author = payload?.author;
  const urls = [author?.avatar, author?.avatarUrl, author?.picture];
  const resolved = urls.find(
    (value) => typeof value === "string" && value.trim(),
  );
  return resolved?.trim() || "";
};

const readConnectionDisplayName = (connectionInfo) => {
  const target = connectionInfo?.target ?? {};
  const candidates = [
    target?.owner?.displayName,
    target?.owner?.name,
    target?.page?.name,
    target?.user?.name,
    target?.organization?.name,
    target?.channel?.name,
    target?.event?.title,
  ];
  const resolved = candidates.find(
    (value) => typeof value === "string" && value.trim(),
  );
  return resolved?.trim() || "";
};

const readConnectionStreamTitle = (connectionInfo) => {
  const target = connectionInfo?.target ?? {};
  const candidates = [
    target?.event?.title,
    target?.liveVideo?.title,
    target?.broadcast?.title,
    target?.stream?.title,
  ];
  const resolved = candidates.find(
    (value) => typeof value === "string" && value.trim(),
  );
  return resolved?.trim() || "";
};

const readConnectionPlatform = (connectionInfo, eventTypeId) => {
  const direct = [
    connectionInfo?.eventSourceName,
    connectionInfo?.eventSource?.name,
    connectionInfo?.platform,
  ].find((value) => typeof value === "string" && value.trim());
  if (direct) return direct.trim();
  return mapEventTypeIdToPlatform(eventTypeId);
};

const buildPlatformSummary = (connectionMap) =>
  Array.from(connectionMap.values())
    .map((connectionInfo) => {
      const platform = readConnectionPlatform(connectionInfo);
      const name = readConnectionDisplayName(connectionInfo);
      return name ? `${platform}: ${name}` : platform;
    })
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

const readConnectionStatus = (connectionInfo) =>
  String(connectionInfo?.status || "")
    .trim()
    .toLowerCase();

const readConnectionReason = (connectionInfo) =>
  String(connectionInfo?.reason || "").trim();

const readConnectionIdentifier = (connectionInfo) =>
  String(connectionInfo?.connectionIdentifier || "").trim();

const readConnectionUuid = (connectionInfo) =>
  String(connectionInfo?.connectionUuid || "").trim();

const getConnectionMapKey = (connectionInfo) =>
  readConnectionIdentifier(connectionInfo) ||
  (readConnectionUuid(connectionInfo)
    ? `uuid:${readConnectionUuid(connectionInfo)}`
    : "");

const getEventTextValue = (payload) => {
  const eventPayload =
    payload && typeof payload === "object" && payload.eventPayload
      ? payload.eventPayload
      : payload;
  const candidates = [
    eventPayload?.text,
    eventPayload?.message,
    eventPayload?.body,
    eventPayload?.content,
    eventPayload?.parent?.text,
    eventPayload?.parent?.body,
  ];
  const resolved = candidates.find(
    (value) => typeof value === "string" && value.trim(),
  );
  return resolved ? resolved.trim() : "";
};

const unwrapEventPayload = (payload) =>
  payload && typeof payload === "object" && payload.eventPayload
    ? payload.eventPayload
    : payload;

const normalizeEventAction = (action) => {
  const rawPayload = action?.payload;
  const wrapper =
    rawPayload &&
    typeof rawPayload === "object" &&
    ("eventPayload" in rawPayload ||
      "eventTypeId" in rawPayload ||
      "connectionIdentifier" in rawPayload)
      ? rawPayload
      : action;

  return {
    connectionIdentifier: String(wrapper?.connectionIdentifier || "").trim(),
    connectionUuid: String(wrapper?.connectionUuid || "").trim(),
    eventIdentifier: String(wrapper?.eventIdentifier || "").trim(),
    eventTypeId:
      wrapper?.eventTypeId === undefined
        ? action?.eventTypeId
        : wrapper.eventTypeId,
    createdAt: wrapper?.createdAt ?? action?.createdAt,
    timestamp: wrapper?.timestamp ?? action?.timestamp,
    payload: unwrapEventPayload(wrapper?.eventPayload ?? rawPayload),
  };
};

const isConnectionHealthy = (connectionInfo) =>
  readConnectionStatus(connectionInfo) !== "error";

const formatConnectionIssue = (connectionInfo) => {
  const platform = readConnectionPlatform(connectionInfo);
  const name = readConnectionDisplayName(connectionInfo);
  const reason = readConnectionReason(connectionInfo) || "unknown";
  const target = name ? `${platform}: ${name}` : platform;
  return `${target} (${reason.replace(/_/g, " ")})`;
};

const buildConnectionInsights = (connectionMap) => {
  const connections = Array.from(connectionMap.values());
  const preferredConnection =
    connections.find(isConnectionHealthy) || connections[0] || null;
  return {
    platformSummary: buildPlatformSummary(connectionMap),
    streamTitle: preferredConnection
      ? readConnectionStreamTitle(preferredConnection)
      : "",
    totalConnectionCount: connections.length,
    activeConnectionCount: connections.filter(isConnectionHealthy).length,
    connectionIssues: connections
      .filter((connectionInfo) => !isConnectionHealthy(connectionInfo))
      .map(formatConnectionIssue)
      .sort((a, b) => a.localeCompare(b)),
  };
};

const createMemoryStore = () => ({
  tokens: new Map(),
  sessions: new Map(),
  messages: new Map(),
  oauthStates: new Map(),
  connectRequests: new Map(),
});

const encodeRtdbKey = (value) => encodeURIComponent(String(value || ""));
const decodeRtdbKey = (value) => decodeURIComponent(String(value || ""));

export const createRestreamService = ({
  getFirestore,
  getRealtimeDatabase,
  getIntegrationsPath,
  onBoardDisplayUpdate,
  redirectBaseUrl,
}) => {
  const store = createMemoryStore();
  const receivers = new Map();
  const sseClients = new Map();

  const isOauthConfigured = () =>
    Boolean(
      String(process.env.RESTREAM_CLIENT_ID || "").trim() &&
      String(process.env.RESTREAM_CLIENT_SECRET || "").trim() &&
      String(redirectBaseUrl || "").trim(),
    );

  const getRedirectUri = () =>
    process.env.RESTREAM_OAUTH_REDIRECT_URI?.trim() ||
    `${String(redirectBaseUrl || "").replace(/\/$/, "")}/api/restream/oauth/callback`;

  const getCollectionMap = (collectionName) => {
    if (collectionName === RESTREAM_TOKEN_COLLECTION) return store.tokens;
    if (collectionName === RESTREAM_SESSION_COLLECTION) return store.sessions;
    if (collectionName === RESTREAM_MESSAGE_COLLECTION) return store.messages;
    if (collectionName === RESTREAM_OAUTH_STATE_COLLECTION)
      return store.oauthStates;
    if (collectionName === RESTREAM_CONNECT_REQUEST_COLLECTION) {
      return store.connectRequests;
    }
    throw new Error(`Unsupported Restream collection: ${collectionName}`);
  };

  const getRtdb = () => {
    const db = getFirestore?.();
    if (db) return null;
    return getRealtimeDatabase?.() || null;
  };

  const getRtdbCollectionPath = (collectionName) =>
    `${RESTREAM_RTDB_ROOT}/${collectionName}`;

  const getRtdbDocPath = (collectionName, id) =>
    `${getRtdbCollectionPath(collectionName)}/${encodeRtdbKey(id)}`;

  const getRtdbMessageIndexPath = ({ database, sessionId, messageId }) =>
    `${RESTREAM_RTDB_ROOT}/${RESTREAM_RTDB_MESSAGE_INDEX}/${encodeRtdbKey(
      database,
    )}/${encodeRtdbKey(sessionId)}/${encodeRtdbKey(messageId)}`;

  const listRtdbCollection = async (collectionName) => {
    const rtdb = getRtdb();
    if (!rtdb) return null;
    const snapshot = await rtdb
      .ref(getRtdbCollectionPath(collectionName))
      .get();
    if (!snapshot.exists()) return [];
    const value = snapshot.val();
    if (!value || typeof value !== "object") return [];
    return Object.entries(value).map(([id, doc]) => ({
      id: decodeRtdbKey(id),
      ...(doc && typeof doc === "object" ? doc : {}),
    }));
  };

  const collectionAll = async (collectionName) => {
    const db = getFirestore?.();
    if (db) {
      const snapshot = await db.collection(collectionName).get();
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }

    const rtdbRows = await listRtdbCollection(collectionName);
    if (rtdbRows) return rtdbRows;

    const map = getCollectionMap(collectionName);
    return Array.from(map.entries()).map(([id, value]) => ({ id, ...value }));
  };

  const getDoc = async (collectionName, id) => {
    const db = getFirestore?.();
    if (db) {
      const snapshot = await db.collection(collectionName).doc(id).get();
      return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
    }

    const rtdb = getRtdb();
    if (rtdb) {
      const snapshot = await rtdb.ref(getRtdbDocPath(collectionName, id)).get();
      if (!snapshot.exists()) return null;
      const value = snapshot.val();
      return value && typeof value === "object" ? { id, ...value } : { id };
    }

    const map = getCollectionMap(collectionName);
    const current = map.get(id);
    return current ? { id, ...current } : null;
  };

  const setDoc = async (collectionName, id, data, { merge = false } = {}) => {
    const db = getFirestore?.();
    if (db) {
      await db.collection(collectionName).doc(id).set(data, { merge });
      return;
    }

    const rtdb = getRtdb();
    if (rtdb) {
      const docRef = rtdb.ref(getRtdbDocPath(collectionName, id));
      const existingSnapshot = await docRef.get();
      const existingValue =
        existingSnapshot.exists() &&
        existingSnapshot.val() &&
        typeof existingSnapshot.val() === "object"
          ? existingSnapshot.val()
          : {};
      const nextValue = merge ? { ...existingValue, ...data } : data;
      if (merge) {
        await docRef.set(nextValue);
      } else {
        await docRef.set(data);
      }

      if (collectionName === RESTREAM_MESSAGE_COLLECTION) {
        const existingDatabase = String(existingValue.database || "").trim();
        const existingSessionId = String(existingValue.sessionId || "").trim();
        const nextDatabase = String(nextValue?.database || "").trim();
        const nextSessionId = String(nextValue?.sessionId || "").trim();

        if (
          existingDatabase &&
          existingSessionId &&
          (existingDatabase !== nextDatabase ||
            existingSessionId !== nextSessionId)
        ) {
          await rtdb
            .ref(
              getRtdbMessageIndexPath({
                database: existingDatabase,
                sessionId: existingSessionId,
                messageId: id,
              }),
            )
            .remove();
        }

        if (nextDatabase && nextSessionId) {
          await rtdb
            .ref(
              getRtdbMessageIndexPath({
                database: nextDatabase,
                sessionId: nextSessionId,
                messageId: id,
              }),
            )
            .set(nextValue);
        }
      }
      return;
    }

    const map = getCollectionMap(collectionName);
    const current = map.get(id) || {};
    map.set(id, merge ? { ...current, ...data } : { ...data });
  };

  const deleteDoc = async (collectionName, id) => {
    const db = getFirestore?.();
    if (db) {
      await db.collection(collectionName).doc(id).delete();
      return;
    }

    const rtdb = getRtdb();
    if (rtdb) {
      if (collectionName === RESTREAM_MESSAGE_COLLECTION) {
        const snapshot = await rtdb
          .ref(getRtdbDocPath(collectionName, id))
          .get();
        const value =
          snapshot.exists() &&
          snapshot.val() &&
          typeof snapshot.val() === "object"
            ? snapshot.val()
            : null;
        if (value?.database && value?.sessionId) {
          await rtdb
            .ref(
              getRtdbMessageIndexPath({
                database: value.database,
                sessionId: value.sessionId,
                messageId: id,
              }),
            )
            .remove();
        }
      }
      await rtdb.ref(getRtdbDocPath(collectionName, id)).remove();
      return;
    }

    const map = getCollectionMap(collectionName);
    map.delete(id);
  };

  const queryMessages = async ({ database, sessionId }) => {
    const db = getFirestore?.();
    if (db) {
      const snapshot = await db
        .collection(RESTREAM_MESSAGE_COLLECTION)
        .where("database", "==", database)
        .where("sessionId", "==", sessionId)
        .get();
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }

    const rtdb = getRtdb();
    if (rtdb) {
      const indexedSnapshot = await rtdb
        .ref(
          `${RESTREAM_RTDB_ROOT}/${RESTREAM_RTDB_MESSAGE_INDEX}/${encodeRtdbKey(
            database,
          )}/${encodeRtdbKey(sessionId)}`,
        )
        .get();
      if (indexedSnapshot.exists()) {
        const value = indexedSnapshot.val();
        if (value && typeof value === "object") {
          return Object.entries(value).map(([id, doc]) => ({
            id: decodeRtdbKey(id),
            ...(doc && typeof doc === "object" ? doc : {}),
          }));
        }
      }

      const rtdbRows = await listRtdbCollection(RESTREAM_MESSAGE_COLLECTION);
      return rtdbRows.filter(
        (item) => item.database === database && item.sessionId === sessionId,
      );
    }

    return Array.from(store.messages.entries())
      .map(([id, value]) => ({ id, ...value }))
      .filter(
        (item) => item.database === database && item.sessionId === sessionId,
      );
  };

  const emitSse = (churchId, type, payload = {}) => {
    const clients = sseClients.get(churchId);
    if (!clients?.size) return;
    const body = JSON.stringify({
      type,
      churchId,
      timestamp: nowMs(),
      ...payload,
    });
    clients.forEach((res) => res.write(`data: ${body}\n\n`));
  };

  const addSseClient = (churchId, res) => {
    const current = sseClients.get(churchId);
    if (current) {
      current.add(res);
      return;
    }
    sseClients.set(churchId, new Set([res]));
  };

  const removeSseClient = (churchId, res) => {
    const current = sseClients.get(churchId);
    if (!current) return;
    current.delete(res);
    if (current.size === 0) {
      sseClients.delete(churchId);
    }
  };

  const persistIntegrationStatus = async (churchId, patch) => {
    try {
      const rtdb = getRealtimeDatabase?.();
      if (!rtdb) return;
      await rtdb.ref(`${getIntegrationsPath(churchId)}/restream`).update(patch);
    } catch (error) {
      console.warn("Could not persist Restream integration status:", error);
    }
  };

  const getTokenDoc = async (churchId) =>
    getDoc(RESTREAM_TOKEN_COLLECTION, churchId);

  const saveTokenDoc = async (churchId, data, { merge = true } = {}) =>
    setDoc(RESTREAM_TOKEN_COLLECTION, churchId, data, { merge });

  const getOauthStateDoc = async (state) =>
    getDoc(RESTREAM_OAUTH_STATE_COLLECTION, state);

  const saveOauthStateDoc = async (state, data) =>
    setDoc(RESTREAM_OAUTH_STATE_COLLECTION, state, data, { merge: false });

  const deleteOauthStateDoc = async (state) =>
    deleteDoc(RESTREAM_OAUTH_STATE_COLLECTION, state);

  const getConnectRequestDoc = async (connectRequestId) =>
    getDoc(RESTREAM_CONNECT_REQUEST_COLLECTION, connectRequestId);

  const saveConnectRequestDoc = async (
    connectRequestId,
    data,
    { merge = true } = {},
  ) =>
    setDoc(RESTREAM_CONNECT_REQUEST_COLLECTION, connectRequestId, data, {
      merge,
    });

  const expireConnectRequestIfNeeded = async (request) => {
    if (!request) return null;
    if (request.status === CONNECT_STATUS_COMPLETED) return request;
    const expiresAt = Number(request.expiresAt || 0);
    if (!expiresAt || expiresAt > nowMs()) {
      return request;
    }
    const expired = {
      status: CONNECT_STATUS_EXPIRED,
      expiredAt: nowMs(),
      errorMessage: "This Restream connection attempt expired. Start again.",
    };
    await saveConnectRequestDoc(request.id, expired);
    return { ...request, ...expired };
  };

  const readConnectRequestForSecret = async ({
    connectRequestId,
    connectRequestSecret,
  }) => {
    const request = await expireConnectRequestIfNeeded(
      await getConnectRequestDoc(connectRequestId),
    );
    if (!request) {
      throw new Error(
        "This Restream connection attempt was not found. Start again.",
      );
    }
    if (request.secretHash !== hashValue(connectRequestSecret)) {
      throw new Error("That Restream connection request is not valid.");
    }
    return request;
  };

  const markConnectRequestFailed = async (connectRequestId, errorMessage) => {
    if (!connectRequestId) return;
    const current = await getConnectRequestDoc(connectRequestId);
    if (!current || current.status === CONNECT_STATUS_COMPLETED) {
      return;
    }
    await saveConnectRequestDoc(connectRequestId, {
      status:
        current.status === CONNECT_STATUS_EXPIRED
          ? CONNECT_STATUS_EXPIRED
          : CONNECT_STATUS_FAILED,
      failedAt: nowMs(),
      errorMessage:
        String(errorMessage || "").trim() || "Could not connect Restream.",
    });
  };

  const getCurrentSession = async ({ churchId, database }) => {
    const existing = await getDoc(RESTREAM_SESSION_COLLECTION, database);
    if (existing) return existing;

    const startedAt = nowMs();
    const session = {
      churchId,
      database,
      sessionId: createId("restream_session"),
      startedAt,
      messageCount: 0,
      connectionState: "disconnected",
      lastError: "",
      platformSummary: [],
      streamTitle: "",
      connectionIssues: [],
      activeConnectionCount: 0,
      totalConnectionCount: 0,
      accountLabel: "",
      enabled: false,
      connected: false,
    };
    await setDoc(RESTREAM_SESSION_COLLECTION, database, session);
    return { id: database, ...session };
  };

  const updateSession = async (database, patch) => {
    await setDoc(RESTREAM_SESSION_COLLECTION, database, patch, { merge: true });
    return getDoc(RESTREAM_SESSION_COLLECTION, database);
  };

  const getStatusForChurch = async ({ churchId, database }) => {
    const tokenDoc = await getTokenDoc(churchId);
    const session = await getCurrentSession({ churchId, database });
    const receiver = receivers.get(churchId);
    const connectionState =
      receiver?.state || session.connectionState || "disconnected";
    const receiverInsights = receiver
      ? buildConnectionInsights(receiver.connections)
      : null;
    const liveConnectionCount = receiverInsights
      ? receiverInsights.activeConnectionCount
      : typeof session.activeConnectionCount === "number"
        ? session.activeConnectionCount
        : 0;
    const totalConnectionCount = receiverInsights
      ? receiverInsights.totalConnectionCount
      : typeof session.totalConnectionCount === "number"
        ? session.totalConnectionCount
        : 0;
    const connectionIssues = receiverInsights
      ? receiverInsights.connectionIssues
      : Array.isArray(session.connectionIssues)
        ? session.connectionIssues
        : [];
    const streamTitle =
      receiverInsights?.streamTitle || session.streamTitle || "";
    return {
      oauthConfigured: isOauthConfigured(),
      bestEffortOnly: true,
      session: {
        churchId,
        database,
        sessionId: session.sessionId,
        startedAt: session.startedAt,
        lastEventAt: session.lastEventAt,
        messageCount: session.messageCount || 0,
        enabled: Boolean(tokenDoc),
        connected:
          receiver?.state === "connected"
            ? liveConnectionCount > 0 || Number(session.messageCount || 0) > 0
            : Boolean(session.connected),
        connectionState,
        accountLabel: tokenDoc?.accountLabel || session.accountLabel || "",
        streamTitle,
        lastError: receiver?.lastError || session.lastError || "",
        lastMessageAt: session.lastEventAt,
        activeConnectionCount: liveConnectionCount,
        totalConnectionCount,
        connectionIssues,
        platformSummary: receiverInsights?.platformSummary?.length
          ? receiverInsights.platformSummary
          : session.platformSummary || [],
      },
    };
  };

  const listCurrentSessionMessages = async ({ churchId, database }) => {
    const session = await getCurrentSession({ churchId, database });
    const messages = await queryMessages({
      database,
      sessionId: session.sessionId,
    });
    return messages
      .sort((a, b) => {
        if ((b.postedAt || 0) !== (a.postedAt || 0)) {
          return (b.postedAt || 0) - (a.postedAt || 0);
        }
        return String(b.id).localeCompare(String(a.id));
      })
      .slice(0, MAX_MESSAGE_QUERY);
  };

  const normalizeRestreamMessageKind = (message) =>
    message?.kind === RESTREAM_MESSAGE_KIND_MODERATOR_REPLY
      ? RESTREAM_MESSAGE_KIND_MODERATOR_REPLY
      : RESTREAM_MESSAGE_KIND_VIEWER;

  const listHighlightedMessagesForDatabase = async (database) => {
    const session = await getDoc(RESTREAM_SESSION_COLLECTION, database);
    if (!session?.sessionId) return [];
    const messages = await queryMessages({
      database,
      sessionId: session.sessionId,
    });
    return messages
      .filter(
        (message) =>
          message.isHighlighted &&
          !message.hidden &&
          normalizeRestreamMessageKind(message) !==
            RESTREAM_MESSAGE_KIND_MODERATOR_REPLY,
      )
      .sort((a, b) => {
        if ((a.postedAt || 0) !== (b.postedAt || 0)) {
          return (a.postedAt || 0) - (b.postedAt || 0);
        }
        return String(a.id).localeCompare(String(b.id));
      });
  };

  const syncSessionSnapshot = async ({
    churchId,
    database,
    patch,
    emitType,
    emitPayload,
  }) => {
    const nextSession = await updateSession(database, patch);
    if (emitType) {
      emitSse(churchId, emitType, emitPayload);
    }
    return nextSession;
  };

  const updateIntegrationFromSession = async (churchId, sessionPatch) => {
    await persistIntegrationStatus(churchId, {
      enabled: Boolean(sessionPatch.enabled),
      connected: Boolean(sessionPatch.connected),
      accountLabel: sessionPatch.accountLabel || "",
      ...(sessionPatch.streamTitle
        ? { streamTitle: sessionPatch.streamTitle }
        : {}),
      lastError: sessionPatch.lastError || "",
      ...(sessionPatch.lastEventAt
        ? { lastEventAt: sessionPatch.lastEventAt }
        : {}),
      ...(sessionPatch.startedAt
        ? { sessionStartedAt: sessionPatch.startedAt }
        : {}),
      platformSummary: sessionPatch.platformSummary || [],
    });
  };

  const createAuthorizeUrl = (state) => {
    const url = new URL("https://api.restream.io/login");
    url.searchParams.set("response_type", "code");
    url.searchParams.set(
      "client_id",
      String(process.env.RESTREAM_CLIENT_ID || ""),
    );
    url.searchParams.set("redirect_uri", getRedirectUri());
    url.searchParams.set("state", state);
    url.searchParams.set("scope", "chat.read channels.read");
    return url.toString();
  };

  const tokenHeaders = () => ({
    Authorization:
      "Basic " +
      Buffer.from(
        `${process.env.RESTREAM_CLIENT_ID}:${process.env.RESTREAM_CLIENT_SECRET}`,
      ).toString("base64"),
    "Content-Type": "application/x-www-form-urlencoded",
  });

  const exchangeCode = async (code) => {
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      redirect_uri: getRedirectUri(),
      code,
    });
    const response = await axios.post(
      "https://api.restream.io/oauth/token",
      params.toString(),
      { headers: tokenHeaders() },
    );
    return response.data;
  };

  const refreshAccessToken = async (refreshToken) => {
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    const response = await axios.post(
      "https://api.restream.io/oauth/token",
      params.toString(),
      { headers: tokenHeaders() },
    );
    return response.data;
  };

  const revokeToken = async (token) => {
    const params = new URLSearchParams({
      token,
      token_type_hint: "refresh_token",
    });
    await axios.post(
      "https://api.restream.io/oauth/revoke",
      params.toString(),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      },
    );
  };

  const fetchChannelSummary = async (accessToken) => {
    try {
      const response = await axios.get(
        "https://api.restream.io/v2/user/channels",
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      const channels = Array.isArray(response.data?.channels)
        ? response.data.channels
        : [];
      const labels = channels
        .map((channel) => String(channel?.displayName || "").trim())
        .filter(Boolean);
      if (!labels.length) return "";
      if (labels.length <= 3) return labels.join(", ");
      return `${labels.slice(0, 3).join(", ")} +${labels.length - 3} more`;
    } catch {
      return "";
    }
  };

  const ensureValidToken = async (churchId) => {
    const current = await getTokenDoc(churchId);
    if (!current) {
      throw new Error("Restream is not connected for this church.");
    }

    const expiresAt = Number(current.accessTokenExpiresAt || 0);
    if (expiresAt > nowMs() + ACCESS_TOKEN_EXPIRY_SKEW_MS) {
      return current;
    }

    const refreshed = await refreshAccessToken(current.refreshToken);
    const next = {
      ...current,
      accessToken: refreshed.access_token || refreshed.accessToken,
      refreshToken:
        refreshed.refresh_token ||
        refreshed.refreshToken ||
        current.refreshToken,
      accessTokenExpiresAt:
        nowMs() +
        Number(refreshed.expires_in || refreshed.accessTokenExpiresIn || 3600) *
          1000,
      refreshTokenExpiresAt:
        nowMs() + Number(refreshed.refreshTokenExpiresIn || 31536000) * 1000,
      scope: refreshed.scope || current.scope || "",
      updatedAt: nowMs(),
    };
    await saveTokenDoc(churchId, next);
    return { id: churchId, ...next };
  };

  const persistReceiverSnapshot = async (receiver) => {
    const insights = buildConnectionInsights(receiver.connections);
    const liveChatReady =
      receiver.state === "connected" && insights.activeConnectionCount > 0;
    const connectionIssueMessage = insights.connectionIssues[0] || "";
    const patch = {
      connectionState: receiver.state,
      lastError: receiver.lastError || connectionIssueMessage,
      connected: liveChatReady,
      enabled: true,
      accountLabel: receiver.accountLabel || "",
      platformSummary: insights.platformSummary,
      streamTitle: insights.streamTitle,
      connectionIssues: insights.connectionIssues,
      activeConnectionCount: insights.activeConnectionCount,
      totalConnectionCount: insights.totalConnectionCount,
    };
    await syncSessionSnapshot({
      churchId: receiver.churchId,
      database: receiver.database,
      patch,
      emitType: "status-updated",
      emitPayload: { connectionState: receiver.state },
    });
    await updateIntegrationFromSession(receiver.churchId, {
      ...patch,
      startedAt: receiver.sessionStartedAt,
    });
  };

  const scheduleReconnect = (receiver) => {
    if (receiver.closedManually) return;
    const delay = Math.min(
      30000,
      2000 * 2 ** Math.max(receiver.reconnectAttempt, 0),
    );
    receiver.reconnectAttempt += 1;
    receiver.state = "reconnecting";
    void persistReceiverSnapshot(receiver);
    receiver.reconnectTimer = setTimeout(() => {
      void connectReceiver(receiver.churchId);
    }, delay);
  };

  const upsertMessage = async ({ churchId, database, sessionId, message }) => {
    await setDoc(RESTREAM_MESSAGE_COLLECTION, message.id, {
      ...message,
      churchId,
      database,
      sessionId,
    });

    const currentSession = await getDoc(RESTREAM_SESSION_COLLECTION, database);
    const nextMessageCount = Number(currentSession?.messageCount || 0) + 1;
    await syncSessionSnapshot({
      churchId,
      database,
      patch: {
        lastEventAt: message.postedAt,
        messageCount: nextMessageCount,
        connected: true,
        enabled: true,
      },
      emitType: "message-created",
      emitPayload: { messageId: message.id },
    });
    await updateIntegrationFromSession(churchId, {
      enabled: true,
      connected: true,
      accountLabel: currentSession?.accountLabel || "",
      lastError: "",
      lastEventAt: message.postedAt,
      startedAt: currentSession?.startedAt,
      platformSummary: currentSession?.platformSummary || [],
      streamTitle: currentSession?.streamTitle || "",
    });
  };

  const createReceiverMessage = ({ action, connectionInfo }) => {
    const normalizedAction = normalizeEventAction(action);
    const payload = normalizedAction.payload;
    const text = getEventTextValue(payload);
    if (!text) return null;

    const rawPostedAt =
      toTimestamp(normalizedAction.createdAt) ||
      toTimestamp(normalizedAction.timestamp) ||
      toTimestamp(payload?.createdAt);
    const postedAt =
      rawPostedAt !== undefined
        ? (normalizeRestreamPostedAtMs(rawPostedAt) ?? rawPostedAt)
        : nowMs();

    return {
      id: createId("restream_msg"),
      kind: RESTREAM_MESSAGE_KIND_VIEWER,
      fingerprint: hashValue(
        JSON.stringify({
          connectionIdentifier: normalizedAction.connectionIdentifier || "",
          eventIdentifier: normalizedAction.eventIdentifier || "",
          postedAt,
          text,
          author: readAuthorName(payload),
        }),
      ),
      platform: readConnectionPlatform(
        connectionInfo,
        normalizedAction.eventTypeId,
      ),
      connectionIdentifier: normalizedAction.connectionIdentifier,
      author: readAuthorName(payload),
      authorAvatarUrl: readAuthorAvatarUrl(payload),
      text,
      postedAt,
      receivedAt: nowMs(),
      rawEventType: String(normalizedAction.eventTypeId || "").trim(),
      isHighlighted: false,
      hidden: false,
    };
  };

  const actionTimestampToPostedAt = (action) => {
    const raw = action?.timestamp;
    const asNumber = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(asNumber)) {
      return normalizeRestreamPostedAtMs(asNumber) ?? nowMs();
    }
    return nowMs();
  };

  const createModeratorReplyMessage = ({ receiver, action }) => {
    const actionName = String(action?.action || "").trim();
    if (actionName !== "reply_created") return null;
    const payload =
      action?.payload && typeof action.payload === "object"
        ? action.payload
        : {};
    const replyUuid = String(
      payload.replyUuid || payload.clientReplyUuid || "",
    ).trim();
    const text = String(payload.text || "").trim();
    if (!text) return null;

    const postedAt = actionTimestampToPostedAt(action);

    const ids = Array.isArray(payload.connectionIdentifiers)
      ? payload.connectionIdentifiers
      : [];
    const connectionIdentifier = String(ids[0] || "").trim();

    const connectionInfo = receiver.connections.get(
      getConnectionMapKey({
        connectionIdentifier,
        connectionUuid: "",
      }),
    );
    const platform = connectionInfo
      ? readConnectionPlatform(
          connectionInfo,
          payload?.eventTypeId ?? action?.eventTypeId,
        )
      : "Restream";

    const fingerprintKey =
      replyUuid ||
      `reply_created:${connectionIdentifier}:${postedAt}:${text.slice(0, 80)}`;

    const author = String(receiver.accountLabel || "").trim() || "Moderator";

    return {
      id: createId("restream_msg"),
      kind: RESTREAM_MESSAGE_KIND_MODERATOR_REPLY,
      fingerprint: hashValue(
        JSON.stringify({
          moderatorReply: true,
          action: "reply_created",
          replyUuid: fingerprintKey,
          text,
        }),
      ),
      platform,
      connectionIdentifier,
      author,
      authorAvatarUrl: "",
      text,
      postedAt,
      receivedAt: nowMs(),
      rawEventType: actionName,
      isHighlighted: false,
      hidden: false,
    };
  };

  const receiverHasFingerprint = async (database, sessionId, fingerprint) => {
    const messages = await queryMessages({ database, sessionId });
    return messages.some((message) => message.fingerprint === fingerprint);
  };

  const ensureReceiverOutboundMaps = (receiver) => {
    if (!receiver.pendingOutboundByClientUuid) {
      receiver.pendingOutboundByClientUuid = new Map();
    }
    if (!receiver.pendingReplyUuidToMessageId) {
      receiver.pendingReplyUuidToMessageId = new Map();
    }
    if (!receiver.suppressReplyCreatedClientUuids) {
      receiver.suppressReplyCreatedClientUuids = new Set();
    }
  };

  const mergeOutboundReplyCreated = async (receiver, action) => {
    const payload =
      action?.payload && typeof action.payload === "object"
        ? action.payload
        : {};
    const clientReplyUuid = String(payload.clientReplyUuid || "").trim();
    if (!clientReplyUuid) return false;
    const messageId = receiver.pendingOutboundByClientUuid.get(clientReplyUuid);
    if (!messageId) return false;

    const ids = Array.isArray(payload.connectionIdentifiers)
      ? payload.connectionIdentifiers
      : [];
    const connectionIdentifier = String(ids[0] || "").trim();
    const connectionInfo = receiver.connections.get(
      getConnectionMapKey({
        connectionIdentifier,
        connectionUuid: "",
      }),
    );
    const platform = connectionInfo
      ? readConnectionPlatform(
          connectionInfo,
          payload?.eventTypeId ?? action?.eventTypeId,
        )
      : "Restream";
    const replyUuid = String(payload.replyUuid || "").trim();
    const postedAt = actionTimestampToPostedAt(action);

    await setDoc(
      RESTREAM_MESSAGE_COLLECTION,
      messageId,
      {
        replyDeliveryStatus: "sent",
        postedAt,
        platform,
        connectionIdentifier,
        rawEventType: "reply_created",
        ...(replyUuid ? { replyUuid } : {}),
      },
      { merge: true },
    );

    receiver.pendingOutboundByClientUuid.delete(clientReplyUuid);
    if (replyUuid) {
      receiver.pendingReplyUuidToMessageId.set(replyUuid, messageId);
    }
    emitSse(receiver.churchId, "message-updated", { messageId });
    onBoardDisplayUpdate?.(receiver.database);
    return true;
  };

  const handleReplyFailedAction = async (receiver, action) => {
    const payload =
      action?.payload && typeof action.payload === "object"
        ? action.payload
        : {};
    const replyUuid = String(payload.replyUuid || "").trim();
    if (!replyUuid) return;
    const messageId = receiver.pendingReplyUuidToMessageId.get(replyUuid);
    if (!messageId) return;

    receiver.pendingReplyUuidToMessageId.delete(replyUuid);
    const reason = String(payload.reason || "").trim() || "internal";
    const failedConnectionIdentifier = String(
      payload.connectionIdentifier || "",
    ).trim();

    await setDoc(
      RESTREAM_MESSAGE_COLLECTION,
      messageId,
      {
        replyDeliveryStatus: "failed",
        replyFailureReason: reason,
        ...(failedConnectionIdentifier ? { failedConnectionIdentifier } : {}),
      },
      { merge: true },
    );
    emitSse(receiver.churchId, "message-updated", { messageId });
    onBoardDisplayUpdate?.(receiver.database);
  };

  const handleSocketAction = async (receiver, rawData) => {
    let action;
    try {
      action = JSON.parse(String(rawData));
    } catch {
      return;
    }

    if (action?.action === "connection_info") {
      const connectionKey = getConnectionMapKey(action);
      if (connectionKey) {
        receiver.connections.set(connectionKey, action);
      }
      const insights = buildConnectionInsights(receiver.connections);
      receiver.platformSummary = insights.platformSummary;
      receiver.streamTitle = insights.streamTitle;
      receiver.state = "connected";
      receiver.lastError = "";
      await persistReceiverSnapshot(receiver);
      return;
    }

    if (action?.action === "connection_closed") {
      const closedUuid = String(action.connectionUuid || "").trim();
      if (closedUuid) {
        for (const [
          identifier,
          connectionInfo,
        ] of receiver.connections.entries()) {
          if (
            String(connectionInfo?.connectionUuid || "").trim() === closedUuid
          ) {
            receiver.connections.delete(identifier);
          }
        }
        const insights = buildConnectionInsights(receiver.connections);
        receiver.platformSummary = insights.platformSummary;
        receiver.streamTitle = insights.streamTitle;
        await persistReceiverSnapshot(receiver);
      }
      return;
    }

    const actionName = String(action?.action || "").trim();

    if (actionName === "reply_created") {
      const payload =
        action?.payload && typeof action.payload === "object"
          ? action.payload
          : {};
      const clientReplyUuid = String(payload.clientReplyUuid || "").trim();
      ensureReceiverOutboundMaps(receiver);
      if (
        clientReplyUuid &&
        receiver.suppressReplyCreatedClientUuids.has(clientReplyUuid)
      ) {
        receiver.suppressReplyCreatedClientUuids.delete(clientReplyUuid);
        return;
      }
      if (await mergeOutboundReplyCreated(receiver, action)) {
        return;
      }
      const currentSession = await getCurrentSession({
        churchId: receiver.churchId,
        database: receiver.database,
      });
      const modMessage = createModeratorReplyMessage({ receiver, action });
      if (!modMessage) {
        return;
      }
      if (
        await receiverHasFingerprint(
          receiver.database,
          currentSession.sessionId,
          modMessage.fingerprint,
        )
      ) {
        return;
      }
      await upsertMessage({
        churchId: receiver.churchId,
        database: receiver.database,
        sessionId: currentSession.sessionId,
        message: modMessage,
      });
      return;
    }

    if (actionName === "reply_failed") {
      ensureReceiverOutboundMaps(receiver);
      await handleReplyFailedAction(receiver, action);
      return;
    }

    if (actionName !== "event") {
      return;
    }

    const normalizedAction = normalizeEventAction(action);
    const currentSession = await getCurrentSession({
      churchId: receiver.churchId,
      database: receiver.database,
    });
    const connectionInfo = receiver.connections.get(
      getConnectionMapKey({
        connectionIdentifier: normalizedAction.connectionIdentifier,
        connectionUuid: normalizedAction.connectionUuid,
      }),
    );
    const message = createReceiverMessage({ action, connectionInfo });
    if (!message) {
      return;
    }
    if (
      await receiverHasFingerprint(
        receiver.database,
        currentSession.sessionId,
        message.fingerprint,
      )
    ) {
      return;
    }

    await upsertMessage({
      churchId: receiver.churchId,
      database: receiver.database,
      sessionId: currentSession.sessionId,
      message,
    });
  };

  const connectReceiver = async (churchId) => {
    const existing = receivers.get(churchId);
    if (
      existing?.ws &&
      (existing.state === "connecting" || existing.state === "connected")
    ) {
      ensureReceiverOutboundMaps(existing);
      return existing;
    }

    const tokenDoc = await ensureValidToken(churchId);
    const receiver = {
      churchId,
      database: tokenDoc.database,
      ws: null,
      reconnectTimer: null,
      reconnectAttempt: existing?.reconnectAttempt || 0,
      connections: existing?.connections || new Map(),
      platformSummary: existing?.platformSummary || [],
      streamTitle: existing?.streamTitle || "",
      lastError: "",
      state: "connecting",
      closedManually: false,
      accountLabel: tokenDoc.accountLabel || "",
      sessionStartedAt: (
        await getCurrentSession({
          churchId,
          database: tokenDoc.database,
        })
      ).startedAt,
      pendingOutboundByClientUuid:
        existing?.pendingOutboundByClientUuid || new Map(),
      pendingReplyUuidToMessageId:
        existing?.pendingReplyUuidToMessageId || new Map(),
      suppressReplyCreatedClientUuids:
        existing?.suppressReplyCreatedClientUuids || new Set(),
    };

    receivers.set(churchId, receiver);
    await persistReceiverSnapshot(receiver);

    const ws = new WebSocket(
      `wss://chat.api.restream.io/ws?accessToken=${encodeURIComponent(tokenDoc.accessToken)}`,
    );
    receiver.ws = ws;

    ws.addEventListener("open", () => {
      receiver.state = "connected";
      receiver.lastError = "";
      receiver.reconnectAttempt = 0;
      void persistReceiverSnapshot(receiver);
    });
    ws.addEventListener("message", (event) => {
      void handleSocketAction(receiver, event.data);
    });
    ws.addEventListener("error", () => {
      receiver.lastError = "Could not connect to Restream chat.";
      void persistReceiverSnapshot(receiver);
    });
    ws.addEventListener("close", () => {
      receiver.ws = null;
      receiver.connections.clear();
      receiver.platformSummary = [];
      receiver.streamTitle = "";
      scheduleReconnect(receiver);
    });

    return receiver;
  };

  const stopReceiver = (churchId) => {
    const receiver = receivers.get(churchId);
    if (!receiver) return;
    receiver.closedManually = true;
    receiver.state = "disconnected";
    receiver.platformSummary = [];
    receiver.streamTitle = "";
    if (receiver.reconnectTimer) {
      clearTimeout(receiver.reconnectTimer);
      receiver.reconnectTimer = null;
    }
    if (receiver.ws) {
      receiver.ws.close();
      receiver.ws = null;
    }
    receivers.delete(churchId);
    void persistReceiverSnapshot(receiver);
  };

  const startConnect = async ({ churchId, database, userId, returnTo }) => {
    if (!isOauthConfigured()) {
      throw new Error("Restream OAuth is not configured on this server.");
    }

    const connectRequestId = createId("restream_connect");
    const connectRequestSecret = crypto.randomBytes(24).toString("hex");
    const expiresAt = nowMs() + STATE_TTL_MS;
    const state = createId("restream_state");
    await saveConnectRequestDoc(
      connectRequestId,
      {
        churchId,
        database,
        userId,
        returnTo: clampRoute(returnTo),
        secretHash: hashValue(connectRequestSecret),
        status: CONNECT_STATUS_PENDING,
        createdAt: nowMs(),
        expiresAt,
        completedAt: null,
        expiredAt: null,
        failedAt: null,
        errorMessage: "",
        accountLabel: "",
      },
      { merge: false },
    );
    await saveOauthStateDoc(state, {
      churchId,
      database,
      userId,
      returnTo: clampRoute(returnTo),
      connectRequestId,
      expiresAt,
    });
    return {
      authorizeUrl: createAuthorizeUrl(state),
      connectRequestId,
      connectRequestSecret,
      expiresAt,
      pollIntervalMs: RESTREAM_CONNECT_POLL_INTERVAL_MS,
    };
  };

  const completeConnect = async ({ state, code, denied }) => {
    const stateId = String(state || "").trim();
    const current = await getOauthStateDoc(stateId);
    if (current) {
      await deleteOauthStateDoc(stateId);
    }
    if (!current || current.expiresAt < nowMs()) {
      throw new Error("This Restream connection attempt expired. Start again.");
    }
    if (denied || !code) {
      await markConnectRequestFailed(
        current.connectRequestId,
        "Restream connection was not completed.",
      );
      throw new Error("Restream connection was not completed.");
    }

    try {
      const tokenResponse = await exchangeCode(code);
      const accessToken =
        tokenResponse.access_token || tokenResponse.accessToken;
      const refreshToken =
        tokenResponse.refresh_token || tokenResponse.refreshToken;
      const accountLabel = await fetchChannelSummary(accessToken);

      await saveTokenDoc(current.churchId, {
        churchId: current.churchId,
        database: current.database,
        accessToken,
        refreshToken,
        accessTokenExpiresAt:
          nowMs() +
          Number(
            tokenResponse.expires_in ||
              tokenResponse.accessTokenExpiresIn ||
              3600,
          ) *
            1000,
        refreshTokenExpiresAt:
          nowMs() +
          Number(tokenResponse.refreshTokenExpiresIn || 31536000) * 1000,
        scope: tokenResponse.scope || "",
        accountLabel,
        createdAt: nowMs(),
        updatedAt: nowMs(),
      });

      const session = await getCurrentSession({
        churchId: current.churchId,
        database: current.database,
      });
      await updateSession(current.database, {
        enabled: true,
        connected: false,
        accountLabel,
        lastError: "",
        startedAt: session.startedAt,
        streamTitle: "",
      });
      await updateIntegrationFromSession(current.churchId, {
        enabled: true,
        connected: false,
        accountLabel,
        lastError: "",
        startedAt: session.startedAt,
        platformSummary: [],
      });

      await saveConnectRequestDoc(current.connectRequestId, {
        status: CONNECT_STATUS_COMPLETED,
        completedAt: nowMs(),
        errorMessage: "",
        accountLabel,
      });

      await connectReceiver(current.churchId);
      return {
        success: true,
        returnTo: current.returnTo,
        accountLabel,
      };
    } catch (error) {
      await markConnectRequestFailed(
        current.connectRequestId,
        error instanceof Error
          ? error.message
          : "Could not finish the Restream connection.",
      );
      throw error;
    }
  };

  const getConnectStatus = async ({
    connectRequestId,
    connectRequestSecret,
  }) => {
    const request = await readConnectRequestForSecret({
      connectRequestId,
      connectRequestSecret,
    });
    return {
      status: request.status || CONNECT_STATUS_PENDING,
      errorMessage: request.errorMessage || "",
      completedAt: request.completedAt,
      expiresAt: request.expiresAt,
      accountLabel: request.accountLabel || "",
    };
  };

  const disconnect = async ({ churchId, database }) => {
    const tokenDoc = await getTokenDoc(churchId);
    if (tokenDoc?.refreshToken) {
      try {
        await revokeToken(tokenDoc.refreshToken);
      } catch (error) {
        console.warn("Could not revoke Restream token:", error);
      }
    }
    stopReceiver(churchId);
    await deleteDoc(RESTREAM_TOKEN_COLLECTION, churchId);
    await syncSessionSnapshot({
      churchId,
      database,
      patch: {
        enabled: false,
        connected: false,
        connectionState: "disconnected",
        accountLabel: "",
        lastError: "",
        platformSummary: [],
        streamTitle: "",
        connectionIssues: [],
        activeConnectionCount: 0,
        totalConnectionCount: 0,
      },
      emitType: "status-updated",
      emitPayload: { connectionState: "disconnected" },
    });
    await persistIntegrationStatus(churchId, {
      enabled: false,
      connected: false,
      accountLabel: "",
      lastError: "",
      platformSummary: [],
    });
  };

  const setMessageHidden = async ({
    churchId,
    database,
    messageId,
    hidden,
    actorName,
    actorId,
  }) => {
    const existing = await getDoc(RESTREAM_MESSAGE_COLLECTION, messageId);
    if (!existing || existing.database !== database) {
      throw new Error("Restream message not found.");
    }
    const next = {
      hidden: Boolean(hidden),
      hiddenAt: Boolean(hidden) ? nowMs() : undefined,
      hiddenBy: Boolean(hidden) ? actorName : undefined,
      hiddenById: Boolean(hidden) ? actorId : undefined,
      isHighlighted: Boolean(hidden) ? false : Boolean(existing.isHighlighted),
      highlightedAt: Boolean(hidden) ? undefined : existing.highlightedAt,
    };
    await setDoc(RESTREAM_MESSAGE_COLLECTION, messageId, next, { merge: true });
    emitSse(churchId, "message-updated", { messageId });
    onBoardDisplayUpdate?.(database);
  };

  const setMessageHighlighted = async ({
    churchId,
    database,
    messageId,
    highlighted,
    actorName,
    actorId,
  }) => {
    const existing = await getDoc(RESTREAM_MESSAGE_COLLECTION, messageId);
    if (!existing || existing.database !== database) {
      throw new Error("Restream message not found.");
    }
    if (
      (existing.kind || RESTREAM_MESSAGE_KIND_VIEWER) ===
      RESTREAM_MESSAGE_KIND_MODERATOR_REPLY
    ) {
      throw new Error("Moderator reply messages cannot be highlighted.");
    }
    const nextHighlighted = existing.hidden ? false : Boolean(highlighted);
    await setDoc(
      RESTREAM_MESSAGE_COLLECTION,
      messageId,
      {
        isHighlighted: nextHighlighted,
        highlightedAt: nextHighlighted ? nowMs() : undefined,
        highlightedBy: nextHighlighted ? actorName : undefined,
        highlightedById: nextHighlighted ? actorId : undefined,
      },
      { merge: true },
    );
    emitSse(churchId, "message-updated", { messageId });
    onBoardDisplayUpdate?.(database);
  };

  const resetSession = async ({ churchId, database }) => {
    const nextStartedAt = nowMs();
    const receiver = receivers.get(churchId);
    const insights = receiver
      ? buildConnectionInsights(receiver.connections)
      : {
          platformSummary: [],
          streamTitle: "",
          connectionIssues: [],
          activeConnectionCount: 0,
          totalConnectionCount: 0,
        };
    const tokenDoc = await getTokenDoc(churchId);
    await setDoc(
      RESTREAM_SESSION_COLLECTION,
      database,
      {
        churchId,
        database,
        sessionId: createId("restream_session"),
        startedAt: nextStartedAt,
        messageCount: 0,
        lastEventAt: undefined,
        enabled: Boolean(tokenDoc),
        connected:
          receiver?.state === "connected" && insights.activeConnectionCount > 0,
        connectionState: receiver?.state || "disconnected",
        accountLabel: tokenDoc?.accountLabel || "",
        lastError: receiver?.lastError || insights.connectionIssues[0] || "",
        platformSummary: insights.platformSummary,
        streamTitle: insights.streamTitle,
        connectionIssues: insights.connectionIssues,
        activeConnectionCount: insights.activeConnectionCount,
        totalConnectionCount: insights.totalConnectionCount,
      },
      { merge: false },
    );
    await persistIntegrationStatus(churchId, {
      ...(nextStartedAt ? { sessionStartedAt: nextStartedAt } : {}),
    });
    emitSse(churchId, "session-reset", {});
    onBoardDisplayUpdate?.(database);
  };

  const initializeConnections = async () => {
    const tokens = await collectionAll(RESTREAM_TOKEN_COLLECTION);
    await Promise.all(
      tokens
        .filter((tokenDoc) => tokenDoc?.churchId && tokenDoc?.database)
        .map(async (tokenDoc) => {
          try {
            await connectReceiver(tokenDoc.churchId);
          } catch (error) {
            console.warn("Could not initialize Restream receiver:", error);
          }
        }),
    );
  };

  return {
    addSseClient,
    removeSseClient,
    getStatusForChurch,
    listCurrentSessionMessages,
    listHighlightedMessagesForDatabase,
    startConnect,
    completeConnect,
    getConnectStatus,
    disconnect,
    setMessageHidden,
    setMessageHighlighted,
    resetSession,
    initializeConnections,
    ensureReceiver: connectReceiver,
    isOauthConfigured,
  };
};
