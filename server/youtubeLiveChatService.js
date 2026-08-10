import crypto from "node:crypto";
import axios from "axios";

const YOUTUBE_TOKEN_COLLECTION = "youtubeTokens";
const YOUTUBE_OAUTH_STATE_COLLECTION = "youtubeOauthStates";
const YOUTUBE_CONNECT_REQUEST_COLLECTION = "youtubeConnectRequests";
const YOUTUBE_RTDB_ROOT = "server/youtube/v1";

const STATE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_EXPIRY_SKEW_MS = 60 * 1000;
const YOUTUBE_CONNECT_POLL_INTERVAL_MS = 1500;
export const YOUTUBE_LIVE_CHAT_MAX_LENGTH = 200;

const CONNECT_STATUS_PENDING = "pending";
const CONNECT_STATUS_COMPLETED = "completed";
const CONNECT_STATUS_FAILED = "failed";
const CONNECT_STATUS_EXPIRED = "expired";

const YOUTUBE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/youtube.force-ssl",
].join(" ");

const nowMs = () => Date.now();
const createId = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const hashValue = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex");

const clampRoute = (value) => {
  const raw = String(value || "").trim();
  if (!raw.startsWith("/")) return "/account?tab=integrations";
  return raw;
};

const encodeRtdbKey = (value) => encodeURIComponent(String(value || ""));
const decodeRtdbKey = (value) => decodeURIComponent(String(value || ""));

const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export const normalizeYouTubeVideoId = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (YOUTUBE_VIDEO_ID_PATTERN.test(raw)) {
    return raw;
  }

  try {
    const parsed = new URL(raw);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "youtu.be" || hostname === "www.youtu.be") {
      const id = parsed.pathname.split("/").filter(Boolean)[0] || "";
      return YOUTUBE_VIDEO_ID_PATTERN.test(id) ? id : "";
    }
    if (
      hostname === "youtube.com" ||
      hostname === "www.youtube.com" ||
      hostname === "m.youtube.com" ||
      hostname === "music.youtube.com" ||
      hostname === "youtube-nocookie.com" ||
      hostname === "www.youtube-nocookie.com"
    ) {
      const pathParts = parsed.pathname.split("/").filter(Boolean);
      if (parsed.pathname === "/watch") {
        const id = String(parsed.searchParams.get("v") || "");
        return YOUTUBE_VIDEO_ID_PATTERN.test(id) ? id : "";
      }
      if (["embed", "shorts", "live"].includes(pathParts[0])) {
        const id = pathParts[1] || "";
        return YOUTUBE_VIDEO_ID_PATTERN.test(id) ? id : "";
      }
    }
  } catch {
    return "";
  }

  return "";
};

const createMemoryStore = () => ({
  tokens: new Map(),
  oauthStates: new Map(),
  connectRequests: new Map(),
});

const createClientError = (message, statusCode = 400) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

export const createYouTubeLiveChatService = ({
  getFirestore,
  getRealtimeDatabase,
  getIntegrationsPath,
  redirectBaseUrl,
}) => {
  const store = createMemoryStore();

  const isOauthConfigured = () =>
    Boolean(
      String(process.env.YOUTUBE_CLIENT_ID || "").trim() &&
      String(process.env.YOUTUBE_CLIENT_SECRET || "").trim() &&
      String(redirectBaseUrl || "").trim(),
    );

  const getRedirectUri = () =>
    process.env.YOUTUBE_OAUTH_REDIRECT_URI?.trim() ||
    `${String(redirectBaseUrl || "").replace(/\/$/, "")}/api/youtube/oauth/callback`;

  const getCollectionMap = (collectionName) => {
    if (collectionName === YOUTUBE_TOKEN_COLLECTION) return store.tokens;
    if (collectionName === YOUTUBE_OAUTH_STATE_COLLECTION)
      return store.oauthStates;
    if (collectionName === YOUTUBE_CONNECT_REQUEST_COLLECTION) {
      return store.connectRequests;
    }
    throw new Error(`Unsupported YouTube collection: ${collectionName}`);
  };

  const getRtdb = () => {
    const db = getFirestore?.();
    if (db) return null;
    return getRealtimeDatabase?.() || null;
  };

  const getRtdbCollectionPath = (collectionName) =>
    `${YOUTUBE_RTDB_ROOT}/${collectionName}`;

  const getRtdbDocPath = (collectionName, id) =>
    `${getRtdbCollectionPath(collectionName)}/${encodeRtdbKey(id)}`;

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
      if (merge) {
        const existingSnapshot = await docRef.get();
        const existingValue =
          existingSnapshot.exists() &&
          existingSnapshot.val() &&
          typeof existingSnapshot.val() === "object"
            ? existingSnapshot.val()
            : {};
        await docRef.set({ ...existingValue, ...data });
      } else {
        await docRef.set(data);
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
      await rtdb.ref(getRtdbDocPath(collectionName, id)).remove();
      return;
    }

    getCollectionMap(collectionName).delete(id);
  };

  const persistIntegrationStatus = async (churchId, patch) => {
    try {
      const rtdb = getRealtimeDatabase?.();
      if (!rtdb) return;
      await rtdb.ref(`${getIntegrationsPath(churchId)}/youtube`).update(patch);
    } catch (error) {
      console.warn("Could not persist YouTube integration status:", error);
    }
  };

  const getTokenDoc = async (churchId) =>
    getDoc(YOUTUBE_TOKEN_COLLECTION, churchId);

  const saveTokenDoc = async (churchId, data, { merge = true } = {}) =>
    setDoc(YOUTUBE_TOKEN_COLLECTION, churchId, data, { merge });

  const getOauthStateDoc = async (state) =>
    getDoc(YOUTUBE_OAUTH_STATE_COLLECTION, state);

  const saveOauthStateDoc = async (state, data) =>
    setDoc(YOUTUBE_OAUTH_STATE_COLLECTION, state, data, { merge: false });

  const deleteOauthStateDoc = async (state) =>
    deleteDoc(YOUTUBE_OAUTH_STATE_COLLECTION, state);

  const getConnectRequestDoc = async (connectRequestId) =>
    getDoc(YOUTUBE_CONNECT_REQUEST_COLLECTION, connectRequestId);

  const saveConnectRequestDoc = async (
    connectRequestId,
    data,
    { merge = true } = {},
  ) =>
    setDoc(YOUTUBE_CONNECT_REQUEST_COLLECTION, connectRequestId, data, {
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
      errorMessage: "This YouTube connection attempt expired. Start again.",
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
        "This YouTube connection attempt was not found. Start again.",
      );
    }
    if (request.secretHash !== hashValue(connectRequestSecret)) {
      throw new Error("That YouTube connection request is not valid.");
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
        String(errorMessage || "").trim() || "Could not connect YouTube.",
    });
  };

  const createAuthorizeUrl = (state) => {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set(
      "client_id",
      String(process.env.YOUTUBE_CLIENT_ID || ""),
    );
    url.searchParams.set("redirect_uri", getRedirectUri());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", YOUTUBE_OAUTH_SCOPES);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);
    return url.toString();
  };

  const exchangeCode = async (code) => {
    const params = new URLSearchParams({
      code,
      client_id: String(process.env.YOUTUBE_CLIENT_ID || ""),
      client_secret: String(process.env.YOUTUBE_CLIENT_SECRET || ""),
      redirect_uri: getRedirectUri(),
      grant_type: "authorization_code",
    });
    const response = await axios.post(
      "https://oauth2.googleapis.com/token",
      params.toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );
    return response.data;
  };

  const refreshAccessToken = async (refreshToken) => {
    const params = new URLSearchParams({
      client_id: String(process.env.YOUTUBE_CLIENT_ID || ""),
      client_secret: String(process.env.YOUTUBE_CLIENT_SECRET || ""),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });
    const response = await axios.post(
      "https://oauth2.googleapis.com/token",
      params.toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );
    return response.data;
  };

  const revokeToken = async (token) => {
    const params = new URLSearchParams({ token });
    await axios.post(
      "https://oauth2.googleapis.com/revoke",
      params.toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );
  };

  const youtubeGet = async (accessToken, path, params = {}) => {
    const url = new URL(`https://www.googleapis.com/youtube/v3${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
    const response = await axios.get(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return response.data;
  };

  const fetchChannelSummary = async (accessToken) => {
    try {
      const data = await youtubeGet(accessToken, "/channels", {
        part: "snippet",
        mine: "true",
        maxResults: "1",
      });
      const title = String(data?.items?.[0]?.snippet?.title || "").trim();
      return title;
    } catch {
      return "";
    }
  };

  const ensureValidToken = async (churchId) => {
    const current = await getTokenDoc(churchId);
    if (!current?.refreshToken && !current?.accessToken) {
      throw createClientError("YouTube is not connected for this church.");
    }

    const expiresAt = Number(current.accessTokenExpiresAt || 0);
    if (
      current.accessToken &&
      expiresAt > nowMs() + ACCESS_TOKEN_EXPIRY_SKEW_MS
    ) {
      return current;
    }

    if (!current.refreshToken) {
      throw createClientError(
        "YouTube access expired. Disconnect and connect YouTube again.",
      );
    }

    try {
      const refreshed = await refreshAccessToken(current.refreshToken);
      const next = {
        accessToken: refreshed.access_token || refreshed.accessToken,
        accessTokenExpiresAt:
          nowMs() +
          Number(
            refreshed.expires_in || refreshed.accessTokenExpiresIn || 3600,
          ) *
            1000,
        scope: refreshed.scope || current.scope || "",
        updatedAt: nowMs(),
      };
      if (refreshed.refresh_token || refreshed.refreshToken) {
        next.refreshToken = refreshed.refresh_token || refreshed.refreshToken;
      }
      await saveTokenDoc(churchId, next);
      return { ...current, ...next };
    } catch (error) {
      console.warn("Could not refresh YouTube token:", error);
      const message =
        "Could not refresh the YouTube connection. Disconnect and connect YouTube again.";
      await persistIntegrationStatus(churchId, {
        lastError: message,
        connected: false,
      });
      throw createClientError(message);
    }
  };

  const resolveLiveChatIdFromVideo = async (accessToken, videoId) => {
    const data = await youtubeGet(accessToken, "/videos", {
      part: "liveStreamingDetails,snippet",
      id: videoId,
    });
    const item = data?.items?.[0];
    const liveChatId = String(
      item?.liveStreamingDetails?.activeLiveChatId || "",
    ).trim();
    const title = String(item?.snippet?.title || "").trim();
    return { liveChatId, videoId, broadcastTitle: title };
  };

  const resolveLiveChatIdFromActiveBroadcast = async (accessToken) => {
    const data = await youtubeGet(accessToken, "/liveBroadcasts", {
      part: "snippet,status",
      broadcastStatus: "active",
      broadcastType: "all",
      maxResults: "5",
    });
    const items = Array.isArray(data?.items) ? data.items : [];
    for (const item of items) {
      const liveChatId = String(item?.snippet?.liveChatId || "").trim();
      if (!liveChatId) continue;
      return {
        liveChatId,
        videoId: String(item?.id || "").trim(),
        broadcastTitle: String(item?.snippet?.title || "").trim(),
      };
    }
    return { liveChatId: "", videoId: "", broadcastTitle: "" };
  };

  const insertLiveChatMessage = async (
    accessToken,
    liveChatId,
    messageText,
  ) => {
    const response = await axios.post(
      "https://www.googleapis.com/youtube/v3/liveChat/messages",
      {
        snippet: {
          liveChatId,
          type: "textMessageEvent",
          textMessageDetails: {
            messageText,
          },
        },
      },
      {
        params: { part: "snippet" },
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
    );
    return response.data;
  };

  const startConnect = async ({
    churchId,
    database,
    userId,
    returnTo,
    desktop = false,
  }) => {
    if (!isOauthConfigured()) {
      throw new Error("YouTube OAuth is not configured on this server.");
    }

    const connectRequestId = createId("youtube_connect");
    const connectRequestSecret = crypto.randomBytes(24).toString("hex");
    const expiresAt = nowMs() + STATE_TTL_MS;
    const state = createId("youtube_state");
    const fromDesktop = Boolean(desktop);
    await saveConnectRequestDoc(
      connectRequestId,
      {
        churchId,
        database,
        userId,
        returnTo: clampRoute(returnTo),
        desktop: fromDesktop,
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
      desktop: fromDesktop,
      connectRequestId,
      expiresAt,
    });
    return {
      authorizeUrl: createAuthorizeUrl(state),
      connectRequestId,
      connectRequestSecret,
      expiresAt,
      pollIntervalMs: YOUTUBE_CONNECT_POLL_INTERVAL_MS,
    };
  };

  const completeConnect = async ({ state, code, denied }) => {
    const stateId = String(state || "").trim();
    const current = await getOauthStateDoc(stateId);
    if (current) {
      await deleteOauthStateDoc(stateId);
    }
    const fromDesktop = Boolean(current?.desktop);
    const throwConnectError = (message) => {
      const err = createClientError(message);
      err.desktop = fromDesktop;
      err.returnTo = current?.returnTo || "/account/integrations";
      throw err;
    };
    if (!current || current.expiresAt < nowMs()) {
      throwConnectError(
        "This YouTube connection attempt expired. Start again.",
      );
    }
    if (denied || !code) {
      await markConnectRequestFailed(
        current.connectRequestId,
        "YouTube connection was not completed.",
      );
      throwConnectError("YouTube connection was not completed.");
    }

    try {
      const tokenResponse = await exchangeCode(code);
      const accessToken =
        tokenResponse.access_token || tokenResponse.accessToken;
      const refreshToken =
        tokenResponse.refresh_token || tokenResponse.refreshToken;
      if (!accessToken) {
        throw new Error("YouTube did not return an access token.");
      }
      if (!refreshToken) {
        const existing = await getTokenDoc(current.churchId);
        if (!existing?.refreshToken) {
          throw new Error(
            "YouTube did not return a refresh token. Disconnect any prior Google grant for this app, then connect again.",
          );
        }
      }

      const accountLabel = await fetchChannelSummary(accessToken);
      const existing = await getTokenDoc(current.churchId);
      await saveTokenDoc(
        current.churchId,
        {
          churchId: current.churchId,
          database: current.database,
          accessToken,
          refreshToken: refreshToken || existing?.refreshToken || "",
          accessTokenExpiresAt:
            nowMs() +
            Number(
              tokenResponse.expires_in ||
                tokenResponse.accessTokenExpiresIn ||
                3600,
            ) *
              1000,
          scope: tokenResponse.scope || YOUTUBE_OAUTH_SCOPES,
          accountLabel,
          createdAt: existing?.createdAt || nowMs(),
          updatedAt: nowMs(),
        },
        { merge: false },
      );

      await persistIntegrationStatus(current.churchId, {
        enabled: true,
        connected: true,
        accountLabel,
        lastError: "",
      });

      await saveConnectRequestDoc(current.connectRequestId, {
        status: CONNECT_STATUS_COMPLETED,
        completedAt: nowMs(),
        errorMessage: "",
        accountLabel,
      });

      return {
        success: true,
        returnTo: current.returnTo,
        accountLabel,
        desktop: fromDesktop,
      };
    } catch (error) {
      console.warn("Could not finish YouTube OAuth exchange:", error);
      const safeMessage = "Could not finish the YouTube connection. Try again.";
      await markConnectRequestFailed(current.connectRequestId, safeMessage);
      throwConnectError(safeMessage);
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

  const disconnect = async ({ churchId }) => {
    const tokenDoc = await getTokenDoc(churchId);
    const tokenToRevoke = tokenDoc?.refreshToken || tokenDoc?.accessToken;
    if (tokenToRevoke) {
      try {
        await revokeToken(tokenToRevoke);
      } catch (error) {
        console.warn("Could not revoke YouTube token:", error);
      }
    }
    await deleteDoc(YOUTUBE_TOKEN_COLLECTION, churchId);
    await persistIntegrationStatus(churchId, {
      enabled: false,
      connected: false,
      accountLabel: "",
      lastError: "",
    });
  };

  const getStatusForChurch = async ({ churchId }) => {
    const tokenDoc = await getTokenDoc(churchId);
    return {
      oauthConfigured: isOauthConfigured(),
      enabled: Boolean(tokenDoc),
      connected: Boolean(tokenDoc?.refreshToken || tokenDoc?.accessToken),
      accountLabel: String(tokenDoc?.accountLabel || "").trim(),
      lastError: "",
    };
  };

  const sendLiveChatMessage = async ({
    churchId,
    messageText,
    videoIdOrUrl,
  }) => {
    const trimmed = String(messageText || "").trim();
    if (!trimmed) {
      throw createClientError("Enter a message to send.");
    }
    if (trimmed.length > YOUTUBE_LIVE_CHAT_MAX_LENGTH) {
      throw createClientError(
        `Message is too long (max ${YOUTUBE_LIVE_CHAT_MAX_LENGTH} characters).`,
      );
    }
    if (/\r|\n/.test(trimmed)) {
      throw createClientError("YouTube chat messages must be a single line.");
    }

    const requestedVideoIdOrUrl = String(videoIdOrUrl || "").trim();
    const videoId = normalizeYouTubeVideoId(requestedVideoIdOrUrl);
    if (requestedVideoIdOrUrl && !videoId) {
      throw createClientError(
        "Enter a valid YouTube live video URL or video ID.",
      );
    }

    const tokenDoc = await ensureValidToken(churchId);
    const accessToken = tokenDoc.accessToken;

    let resolved;
    try {
      if (videoId) {
        resolved = await resolveLiveChatIdFromVideo(accessToken, videoId);
      } else {
        resolved = await resolveLiveChatIdFromActiveBroadcast(accessToken);
      }
    } catch (error) {
      if (error?.statusCode === 400) throw error;
      console.warn("Could not resolve YouTube live chat:", error);
      const message =
        "Could not find an active YouTube live chat. Confirm the stream is live, or paste the live video URL.";
      await persistIntegrationStatus(churchId, { lastError: message });
      throw createClientError(message);
    }

    if (!resolved.liveChatId) {
      const message = videoId
        ? "That YouTube video does not have an active live chat. Confirm the stream is live and chat is enabled."
        : "No active YouTube live chat was found for the connected channel. Start the stream, or paste the live video URL.";
      await persistIntegrationStatus(churchId, { lastError: message });
      throw createClientError(message);
    }

    try {
      const inserted = await insertLiveChatMessage(
        accessToken,
        resolved.liveChatId,
        trimmed,
      );
      await persistIntegrationStatus(churchId, {
        connected: true,
        lastError: "",
        lastPostedAt: nowMs(),
      });
      return {
        success: true,
        messageId: String(inserted?.id || "").trim(),
        liveChatId: resolved.liveChatId,
        videoId: resolved.videoId || videoId || "",
        broadcastTitle: resolved.broadcastTitle || "",
        accountLabel: String(tokenDoc.accountLabel || "").trim(),
      };
    } catch (error) {
      console.warn("Could not post YouTube live chat message:", error);
      const message =
        "Could not post to YouTube live chat. Confirm the stream is live and chat is enabled, then try again.";
      await persistIntegrationStatus(churchId, { lastError: message });
      throw createClientError(message);
    }
  };

  return {
    startConnect,
    completeConnect,
    getConnectStatus,
    disconnect,
    getStatusForChurch,
    sendLiveChatMessage,
    isOauthConfigured,
    normalizeYouTubeVideoId,
  };
};
