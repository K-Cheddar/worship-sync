import crypto from "node:crypto";
import {
  getCloudinaryAssetBytes,
  getMuxStoredMinutes,
} from "./churchStorageQuota.js";

const TOKEN_COLLECTION = "canvaTokens";
const STATE_COLLECTION = "canvaOauthStates";
const CONNECT_COLLECTION = "canvaConnectRequests";
const RTDB_ROOT = "server/canva/v1";
const STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_SKEW_MS = 60 * 1000;
const SCOPES = "design:meta:read design:content:read profile:read";
const MAX_IMPORT_PAGES = 25;
const DEFAULT_CANVA_EXPORT_CONCURRENCY = 2;
const DEFAULT_MUX_PROCESSING_CONCURRENCY = 2;
const DEFAULT_CANVA_EXPORT_INTERVAL_MS = 3000;
const MUX_PROCESSING_POLL_INTERVAL_MS = 1000;
const CANVA_EXPORT_POLL_MAX_DELAY_MS = 8000;
const CANVA_EXPORT_DEADLINE_MS = 5 * 60 * 1000;
const CANVA_EXPORT_MAX_ATTEMPTS = 90;
const CANVA_EXPORT_CREATE_MAX_RETRIES = 4;
const MAX_CANVA_SHORT_LINK_REDIRECTS = 3;
const CANVA_SHORT_LINK_HOST = "canva.link";
const CANVA_DESIGN_HOSTS = new Set(["canva.com", "www.canva.com"]);

const createClientError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex");
const randomValue = (bytes = 32) =>
  crypto.randomBytes(bytes).toString("base64url");
const DEFAULT_RETURN_TO = "/account/integrations";
const RETURN_TO_BASE_URL = "https://worshipsync.invalid";

export const normalizeMuxStaticRenditions = (asset) => {
  const staticRenditions = asset?.static_renditions;
  if (Array.isArray(staticRenditions?.files)) {
    return staticRenditions.files;
  }
  if (Array.isArray(staticRenditions)) {
    return staticRenditions;
  }
  if (staticRenditions && typeof staticRenditions === "object") {
    return Object.values(staticRenditions);
  }
  return [];
};

export const safeCanvaReturnTo = (value) => {
  const candidate = String(value || "").trim();
  if (!candidate.startsWith("/") || candidate.includes("\\")) {
    return DEFAULT_RETURN_TO;
  }

  try {
    const decoded = decodeURIComponent(candidate);
    if (
      !decoded.startsWith("/") ||
      decoded.startsWith("//") ||
      decoded.includes("\\")
    ) {
      return DEFAULT_RETURN_TO;
    }

    const parsed = new URL(candidate, RETURN_TO_BASE_URL);
    return parsed.origin === RETURN_TO_BASE_URL ? candidate : DEFAULT_RETURN_TO;
  } catch {
    return DEFAULT_RETURN_TO;
  }
};
const safeName = (value, fallback) =>
  String(value || fallback || "Canva design")
    .trim()
    .slice(0, 160);
const safeCanvaDesignUrl = (value) => {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "https:" && parsed.hostname === "www.canva.com"
      ? parsed.toString()
      : "";
  } catch {
    return "";
  }
};
const normalizeCanvaDesign = (design = {}) => ({
  id: String(design.id || ""),
  title: safeName(design.title, "Untitled design"),
  thumbnailUrl: design.thumbnail?.url || "",
  pageCount: Number(design.page_count || 0),
  updatedAt: Math.max(0, Number(design.updated_at) || 0),
  editUrl: safeCanvaDesignUrl(design.urls?.edit_url),
  viewUrl: safeCanvaDesignUrl(design.urls?.view_url),
});
const canvaPngImportKey = (designId, revision, pageNumber) =>
  `canva:${designId}:rev:${revision}:png:${pageNumber}`;
const canvaMp4ImportKey = (designId, revision, pageNumbers) =>
  `canva:${designId}:rev:${revision}:mp4:${[...new Set(pageNumbers)].sort((a, b) => a - b).join(",")}`;

const normalizeAxiosError = (error, fallback) => {
  const statusCode = error?.response?.status || 502;
  const providerMessage =
    error?.response?.data?.message ||
    error?.response?.data?.error_description ||
    error?.response?.data?.error?.message;
  const normalized = createClientError(
    statusCode === 429
      ? "Canva is temporarily limiting export requests. Wait a moment and try again."
      : providerMessage || fallback,
    statusCode,
  );
  const providerCode =
    error?.response?.data?.code || error?.response?.data?.error?.code;
  if (providerCode) normalized.providerCode = String(providerCode);
  const responseHeaders = error?.response?.headers;
  const retryAfter =
    (typeof responseHeaders?.get === "function"
      ? responseHeaders.get("retry-after")
      : undefined) ??
    responseHeaders?.["retry-after"] ??
    responseHeaders?.["Retry-After"];
  if (retryAfter !== undefined) {
    const seconds = Number(retryAfter);
    normalized.retryAfterMs = Number.isFinite(seconds)
      ? Math.max(0, seconds * 1000)
      : Math.max(0, new Date(String(retryAfter)).getTime() - Date.now());
  }
  return normalized;
};

const canvaDesignIdFromUrl = (value) => {
  try {
    const parsed = new URL(String(value || ""));
    if (
      parsed.protocol !== "https:" ||
      !CANVA_DESIGN_HOSTS.has(parsed.hostname.toLowerCase())
    ) {
      return null;
    }
    return (
      parsed.pathname.match(/^\/design\/([A-Za-z0-9_-]{3,200})(?:\/|$)/i)?.[1] ||
      null
    );
  } catch {
    return null;
  }
};

export const createCanvaService = ({
  getFirestore,
  getRealtimeDatabase,
  getIntegrationsPath,
  redirectBaseUrl,
  httpClient,
  cloudinaryClient,
  getMuxClient,
  storageQuota,
  clientId = process.env.CANVA_CLIENT_ID,
  clientSecret = process.env.CANVA_CLIENT_SECRET,
  tokenEncryptionKey = process.env.CANVA_TOKEN_ENCRYPTION_KEY,
  redirectUri = process.env.CANVA_OAUTH_REDIRECT_URI,
  now = () => Date.now(),
  wait = sleep,
  exportConcurrency = DEFAULT_CANVA_EXPORT_CONCURRENCY,
  muxProcessingConcurrency = DEFAULT_MUX_PROCESSING_CONCURRENCY,
  exportCreationIntervalMs = DEFAULT_CANVA_EXPORT_INTERVAL_MS,
  exportDeadlineMs = CANVA_EXPORT_DEADLINE_MS,
  muxProcessingDeadlineMs = exportDeadlineMs,
}) => {
  const memory = {
    [TOKEN_COLLECTION]: new Map(),
    [STATE_COLLECTION]: new Map(),
    [CONNECT_COLLECTION]: new Map(),
  };
  const refreshes = new Map();
  const configured = Boolean(
    String(clientId || "").trim() &&
    String(clientSecret || "").trim() &&
    String(tokenEncryptionKey || "").trim() &&
    String(redirectBaseUrl || "").trim(),
  );
  const encryptionKey = configured
    ? crypto.createHash("sha256").update(String(tokenEncryptionKey)).digest()
    : null;
  const callbackUrl =
    String(redirectUri || "").trim() ||
    `${String(redirectBaseUrl || "").replace(/\/$/, "")}/api/canva/oauth/callback`;
  const resolvedExportConcurrency = Number.isFinite(Number(exportConcurrency))
    ? Math.max(1, Math.floor(Number(exportConcurrency)))
    : DEFAULT_CANVA_EXPORT_CONCURRENCY;
  // Canva documents POST /exports at 20 requests per minute per user.
  const resolvedExportCreationIntervalMs = Number.isFinite(
    Number(exportCreationIntervalMs),
  )
    ? Math.max(0, Number(exportCreationIntervalMs))
    : DEFAULT_CANVA_EXPORT_INTERVAL_MS;
  const resolvedMuxProcessingConcurrency = Number.isFinite(
    Number(muxProcessingConcurrency),
  )
    ? Math.max(1, Math.floor(Number(muxProcessingConcurrency)))
    : DEFAULT_MUX_PROCESSING_CONCURRENCY;
  const resolvedMuxProcessingDeadlineMs = Number.isFinite(
    Number(muxProcessingDeadlineMs),
  )
    ? Math.max(1000, Number(muxProcessingDeadlineMs))
    : CANVA_EXPORT_DEADLINE_MS;
  const createExportPacer = () => {
    let nextAllowedAt = 0;
    let turn = Promise.resolve();
    return async () => {
      const currentTurn = turn.then(async () => {
        const delay = Math.max(0, nextAllowedAt - now());
        if (delay > 0) await wait(delay);
        nextAllowedAt =
          Math.max(nextAllowedAt, now()) + resolvedExportCreationIntervalMs;
      });
      turn = currentTurn.catch(() => {});
      await currentTurn;
    };
  };

  const rtdbPath = (collection, id) =>
    `${RTDB_ROOT}/${collection}/${encodeURIComponent(String(id))}`;
  const getDoc = async (collection, id) => {
    const firestore = getFirestore?.();
    if (firestore) {
      const snapshot = await firestore.collection(collection).doc(id).get();
      return snapshot.exists ? { id, ...snapshot.data() } : null;
    }
    const rtdb = getRealtimeDatabase?.();
    if (rtdb) {
      const snapshot = await rtdb.ref(rtdbPath(collection, id)).get();
      return snapshot.exists() ? { id, ...snapshot.val() } : null;
    }
    const value = memory[collection].get(id);
    return value ? { id, ...value } : null;
  };
  const setDoc = async (collection, id, value) => {
    const firestore = getFirestore?.();
    if (firestore) {
      await firestore.collection(collection).doc(id).set(value);
      return;
    }
    const rtdb = getRealtimeDatabase?.();
    if (rtdb) {
      await rtdb.ref(rtdbPath(collection, id)).set(value);
      return;
    }
    memory[collection].set(id, { ...value });
  };
  const deleteDoc = async (collection, id) => {
    const firestore = getFirestore?.();
    if (firestore) {
      await firestore.collection(collection).doc(id).delete();
      return;
    }
    const rtdb = getRealtimeDatabase?.();
    if (rtdb) {
      await rtdb.ref(rtdbPath(collection, id)).remove();
      return;
    }
    memory[collection].delete(id);
  };
  const updateStatus = async (churchId, patch) => {
    const rtdb = getRealtimeDatabase?.();
    if (!rtdb) return;
    await rtdb.ref(`${getIntegrationsPath(churchId)}/canva`).update(patch);
  };

  const encrypt = (plainText) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(String(plainText), "utf8"),
      cipher.final(),
    ]);
    return `v1.${iv.toString("base64url")}.${cipher
      .getAuthTag()
      .toString("base64url")}.${encrypted.toString("base64url")}`;
  };
  const decrypt = (value) => {
    const [version, iv, tag, encrypted] = String(value || "").split(".");
    if (version !== "v1" || !iv || !tag || !encrypted || !encryptionKey) {
      throw createClientError("The Canva connection must be renewed.", 401);
    }
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encryptionKey,
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  };
  const basicHeaders = () => ({
    Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    "Content-Type": "application/x-www-form-urlencoded",
  });

  const exchangeToken = async (params) => {
    try {
      const response = await httpClient.post(
        "https://api.canva.com/rest/v1/oauth/token",
        new URLSearchParams(params).toString(),
        { headers: basicHeaders(), timeout: 20000 },
      );
      return response.data;
    } catch (error) {
      throw normalizeAxiosError(
        error,
        "Canva did not complete the connection. Try again.",
      );
    }
  };

  const saveToken = async (churchId, data, accountLabel = "") => {
    await setDoc(TOKEN_COLLECTION, churchId, {
      accessToken: encrypt(data.access_token),
      refreshToken: encrypt(data.refresh_token),
      expiresAt: now() + Number(data.expires_in || 14400) * 1000,
      scope: data.scope || SCOPES,
      accountLabel,
      updatedAt: now(),
    });
  };

  const refreshToken = async (churchId, tokenDoc) => {
    if (refreshes.has(churchId)) return refreshes.get(churchId);
    const pending = (async () => {
      const data = await exchangeToken({
        grant_type: "refresh_token",
        refresh_token: decrypt(tokenDoc.refreshToken),
      });
      await saveToken(churchId, data, tokenDoc.accountLabel);
      return data.access_token;
    })().finally(() => refreshes.delete(churchId));
    refreshes.set(churchId, pending);
    return pending;
  };

  const accessTokenFor = async (churchId) => {
    if (!configured) {
      throw createClientError(
        "Canva is not configured for this WorshipSync server.",
        503,
      );
    }
    const tokenDoc = await getDoc(TOKEN_COLLECTION, churchId);
    if (!tokenDoc)
      throw createClientError("Connect Canva in Integrations first.", 409);
    if (Number(tokenDoc.expiresAt) > now() + TOKEN_SKEW_MS) {
      return decrypt(tokenDoc.accessToken);
    }
    try {
      return await refreshToken(churchId, tokenDoc);
    } catch (error) {
      if (error?.statusCode === 400 || error?.statusCode === 401) {
        await deleteDoc(TOKEN_COLLECTION, churchId);
        await updateStatus(churchId, {
          enabled: false,
          connected: false,
          lastError: "The Canva connection expired. Connect it again.",
        });
      }
      throw error;
    }
  };

  const forceRefreshAccessToken = async (churchId) => {
    const tokenDoc = await getDoc(TOKEN_COLLECTION, churchId);
    if (!tokenDoc)
      throw createClientError("Connect Canva in Integrations first.", 409);
    return refreshToken(churchId, tokenDoc);
  };

  const canvaGet = async (churchId, path, params) => {
    const request = async (accessToken) =>
      httpClient.get(`https://api.canva.com/rest/v1${path}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params,
        timeout: 20000,
      });
    try {
      return await request(await accessTokenFor(churchId));
    } catch (error) {
      if (error?.statusCode) throw error;
      if (error?.response?.status === 401) {
        try {
          return await request(await forceRefreshAccessToken(churchId));
        } catch (retryError) {
          throw normalizeAxiosError(
            retryError,
            "The Canva connection expired. Connect it again in Integrations.",
          );
        }
      }
      throw normalizeAxiosError(
        error,
        "Canva could not load that content. Try again.",
      );
    }
  };
  const canvaPost = async (churchId, path, body) => {
    const request = async (accessToken) =>
      httpClient.post(`https://api.canva.com/rest/v1${path}`, body, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        timeout: 20000,
      });
    try {
      return await request(await accessTokenFor(churchId));
    } catch (error) {
      if (error?.statusCode) throw error;
      if (error?.response?.status === 401) {
        try {
          return await request(await forceRefreshAccessToken(churchId));
        } catch (retryError) {
          throw normalizeAxiosError(
            retryError,
            "The Canva connection expired. Connect it again in Integrations.",
          );
        }
      }
      throw normalizeAxiosError(
        error,
        "Canva could not start that export. Try again.",
      );
    }
  };

  const startConnect = async ({ churchId, userId, returnTo, desktop }) => {
    if (!configured) {
      throw createClientError(
        "Add the Canva credentials to the server before connecting.",
        503,
      );
    }
    const state = randomValue();
    const verifier = randomValue(64);
    const challenge = crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64url");
    const requestId = `canva_${crypto.randomUUID()}`;
    const requestSecret = randomValue();
    const expiresAt = now() + STATE_TTL_MS;
    await setDoc(STATE_COLLECTION, state, {
      churchId,
      userId,
      verifier,
      requestId,
      returnTo: safeCanvaReturnTo(returnTo),
      desktop: Boolean(desktop),
      expiresAt,
    });
    await setDoc(CONNECT_COLLECTION, requestId, {
      churchId,
      secretHash: hash(requestSecret),
      status: "pending",
      expiresAt,
    });
    const params = new URLSearchParams({
      client_id: String(clientId),
      redirect_uri: callbackUrl,
      response_type: "code",
      scope: SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    return {
      authorizeUrl: `https://www.canva.com/api/oauth/authorize?${params}`,
      connectRequestId: requestId,
      connectRequestSecret: requestSecret,
      expiresAt,
      pollIntervalMs: 1500,
    };
  };

  const completeConnect = async ({ state, code, denied }) => {
    const stateDoc = await getDoc(STATE_COLLECTION, String(state || ""));
    if (!stateDoc || Number(stateDoc.expiresAt) <= now()) {
      throw createClientError(
        "This Canva connection request expired. Start again.",
        400,
      );
    }
    await deleteDoc(STATE_COLLECTION, stateDoc.id);
    const finish = async (patch) =>
      setDoc(CONNECT_COLLECTION, stateDoc.requestId, {
        churchId: stateDoc.churchId,
        secretHash:
          (await getDoc(CONNECT_COLLECTION, stateDoc.requestId))?.secretHash ||
          "",
        expiresAt: stateDoc.expiresAt,
        ...patch,
      });
    if (denied || !code) {
      await finish({
        status: "failed",
        errorMessage: "Canva access was not approved.",
      });
      const error = createClientError("Canva access was not approved.");
      error.returnTo = stateDoc.returnTo;
      error.desktop = stateDoc.desktop;
      throw error;
    }
    try {
      const token = await exchangeToken({
        grant_type: "authorization_code",
        code,
        code_verifier: stateDoc.verifier,
        redirect_uri: callbackUrl,
      });
      const profileResponse = await httpClient.get(
        "https://api.canva.com/rest/v1/users/me/profile",
        {
          headers: { Authorization: `Bearer ${token.access_token}` },
          timeout: 20000,
        },
      );
      const profile =
        profileResponse.data?.profile || profileResponse.data || {};
      const accountLabel = safeName(
        profile.display_name,
        "Connected Canva account",
      );
      await saveToken(stateDoc.churchId, token, accountLabel);
      await updateStatus(stateDoc.churchId, {
        enabled: true,
        connected: true,
        accountLabel,
        lastError: "",
      });
      await finish({ status: "completed", accountLabel, completedAt: now() });
      return {
        accountLabel,
        returnTo: stateDoc.returnTo,
        desktop: stateDoc.desktop,
      };
    } catch (error) {
      await finish({ status: "failed", errorMessage: error.message });
      error.returnTo = stateDoc.returnTo;
      error.desktop = stateDoc.desktop;
      throw error;
    }
  };

  const getConnectStatus = async ({
    churchId,
    connectRequestId,
    connectRequestSecret,
  }) => {
    const doc = await getDoc(
      CONNECT_COLLECTION,
      String(connectRequestId || ""),
    );
    if (
      !doc ||
      doc.churchId !== churchId ||
      hash(connectRequestSecret) !== doc.secretHash
    ) {
      throw createClientError(
        "That Canva connection request is not available.",
        404,
      );
    }
    if (doc.status === "pending" && Number(doc.expiresAt) <= now()) {
      return {
        status: "expired",
        errorMessage: "This Canva connection request expired.",
      };
    }
    return {
      status: doc.status,
      errorMessage: doc.errorMessage || "",
      accountLabel: doc.accountLabel || "",
      expiresAt: doc.expiresAt,
      completedAt: doc.completedAt,
    };
  };

  const getStatusForChurch = async ({ churchId }) => {
    const doc = await getDoc(TOKEN_COLLECTION, churchId);
    return {
      oauthConfigured: configured,
      connected: Boolean(doc),
      accountLabel: doc?.accountLabel || "",
    };
  };

  const disconnect = async ({ churchId }) => {
    const doc = await getDoc(TOKEN_COLLECTION, churchId);
    if (doc) {
      try {
        await httpClient.post(
          "https://api.canva.com/rest/v1/oauth/revoke",
          new URLSearchParams({ token: decrypt(doc.refreshToken) }).toString(),
          { headers: basicHeaders(), timeout: 10000 },
        );
      } catch (error) {
        console.warn(
          "Could not revoke Canva token; removing local connection:",
          error?.message,
        );
      }
    }
    await deleteDoc(TOKEN_COLLECTION, churchId);
    await updateStatus(churchId, {
      enabled: false,
      connected: false,
      accountLabel: "",
      lastError: "",
    });
  };

  const listDesigns = async ({ churchId, query, continuation }) => {
    const response = await canvaGet(churchId, "/designs", {
      ...(String(query || "").trim() ? { query: String(query).trim() } : {}),
      ...(String(continuation || "").trim() ? { continuation } : {}),
    });
    return {
      items: (response.data?.items || []).map(normalizeCanvaDesign),
      continuation: response.data?.continuation || "",
    };
  };

  const getDesign = async ({ churchId, designId }) => {
    if (!/^[A-Za-z0-9_-]{3,200}$/.test(String(designId || ""))) {
      throw createClientError("Choose a valid Canva design.");
    }
    try {
      const response = await canvaGet(
        churchId,
        `/designs/${encodeURIComponent(designId)}`,
      );
      return normalizeCanvaDesign(response.data?.design || response.data || {});
    } catch (error) {
      if (error?.statusCode === 403 || error?.statusCode === 404) {
        let accountLabel = "";
        try {
          accountLabel = String((await getDoc(TOKEN_COLLECTION, churchId))?.accountLabel || "").trim();
        } catch {
          accountLabel = "";
        }
        const accountReference = accountLabel
          ? ` ("${accountLabel}")`
          : "";
        const message =
          error.statusCode === 403
            ? `WorshipSync found this Canva design, but the Canva account connected to WorshipSync${accountReference} does not have API access to it. “Anyone with the link” access is not enough for Canva Connect. In Canva, share the design directly with the connected account under People with access, then try again.`
            : `Canva could not find this design for the account connected to WorshipSync${accountReference}. If the design exists and is only shared by link, share it directly with the connected account under People with access, then try again.`;
        throw createClientError(
          message,
          error.statusCode,
        );
      }
      throw error;
    }
  };

  const resolveDesignLink = async ({ url }) => {
    let current;
    try {
      current = new URL(String(url || "").trim());
    } catch {
      throw createClientError("Paste a valid Canva short link.");
    }
    if (
      current.protocol !== "https:" ||
      current.hostname.toLowerCase() !== CANVA_SHORT_LINK_HOST ||
      current.username ||
      current.password ||
      current.port
    ) {
      throw createClientError("Paste a valid Canva short link.");
    }

    for (let redirect = 0; redirect <= MAX_CANVA_SHORT_LINK_REDIRECTS; redirect += 1) {
      let response;
      try {
        response = await httpClient.get(current.toString(), {
          maxRedirects: 0,
          timeout: 10000,
          validateStatus: () => true,
        });
      } catch {
        throw createClientError("That Canva short link could not be resolved.", 422);
      }
      const status = Number(response?.status || 0);
      if (status >= 300 && status < 400) {
        if (redirect >= MAX_CANVA_SHORT_LINK_REDIRECTS) {
          throw createClientError("That Canva short link has too many redirects.", 422);
        }
        const location = response.headers?.location;
        let next;
        try {
          next = new URL(String(location || ""), current);
        } catch {
          throw createClientError("That Canva short link has an invalid redirect.", 422);
        }
        const nextHost = next.hostname.toLowerCase();
        if (
          next.protocol !== "https:" ||
          (nextHost !== CANVA_SHORT_LINK_HOST && !CANVA_DESIGN_HOSTS.has(nextHost)) ||
          next.username ||
          next.password ||
          next.port
        ) {
          throw createClientError("That Canva short link redirects outside Canva.", 422);
        }
        current = next;
        continue;
      }
      const designId = canvaDesignIdFromUrl(current);
      if (status >= 200 && status < 300 && designId) return { designId };
      throw createClientError("That Canva short link does not resolve to a Canva design.", 422);
    }
    throw createClientError("That Canva short link could not be resolved.", 422);
  };

  const runBounded = async (items, concurrency, task, isCancelled) => {
    const results = new Array(items.length);
    const errors = [];
    let nextIndex = 0;
    const worker = async () => {
      while (true) {
        if (isCancelled?.()) return;
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        try {
          results[index] = await task(items[index], index);
        } catch (error) {
          errors.push({ index, error });
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(Math.max(1, concurrency), items.length) },
        worker,
      ),
    );
    return { results, errors };
  };

  const requestExportJob = async (
    churchId,
    body,
    paceExportCreation,
    isCancelled,
  ) => {
    let retry = 0;
    while (true) {
      if (isCancelled?.()) throw createClientError("Canva import cancelled.", 499);
      await paceExportCreation();
      try {
        const response = await canvaPost(churchId, "/exports", body);
        const job = response.data?.job;
        if (!job?.id) {
          throw createClientError("Canva did not start the export. Try again.", 502);
        }
        return job;
      } catch (error) {
        if (error?.statusCode !== 429 || retry >= CANVA_EXPORT_CREATE_MAX_RETRIES) {
          throw error;
        }
        const backoff = Math.min(
          1000 * 2 ** retry,
          CANVA_EXPORT_POLL_MAX_DELAY_MS,
        );
        await wait(Math.max(backoff, error.retryAfterMs || 0));
        retry += 1;
      }
    }
  };

  const waitForExport = async (
    churchId,
    initialJob,
    { allowEmptyUrls = false, onRateLimit, isCancelled } = {},
  ) => {
    let job = initialJob;
    let pollDelay = 1000;
    let attempt = 0;
    let sawRateLimit = false;
    const deadline = now() + exportDeadlineMs;
    while (job?.status === "in_progress" && attempt < CANVA_EXPORT_MAX_ATTEMPTS) {
      if (isCancelled?.()) throw createClientError("Canva import cancelled.", 499);
      const remaining = deadline - now();
      if (remaining <= 0) break;
      await wait(Math.min(pollDelay, remaining));
      if (isCancelled?.()) throw createClientError("Canva import cancelled.", 499);
      attempt += 1;
      try {
        const response = await canvaGet(
          churchId,
          `/exports/${encodeURIComponent(job.id)}`,
        );
        job = response.data?.job;
        pollDelay = Math.min(pollDelay * 2, CANVA_EXPORT_POLL_MAX_DELAY_MS);
      } catch (error) {
        if (error?.statusCode !== 429) throw error;
        sawRateLimit = true;
        const retryDelay = Math.max(
          Math.min(pollDelay * 2, CANVA_EXPORT_POLL_MAX_DELAY_MS),
          error.retryAfterMs || 0,
        );
        pollDelay = Math.min(retryDelay, CANVA_EXPORT_POLL_MAX_DELAY_MS);
        await onRateLimit?.({ delayMs: pollDelay, attempt });
      }
    }
    if (job?.status === "in_progress" && (sawRateLimit || now() >= deadline)) {
      throw createClientError(
        "Canva is temporarily limiting export requests. Wait a moment and try again.",
        429,
      );
    }
    const hasUrlArray = Array.isArray(job?.urls);
    if (
      job?.status !== "success" ||
      (!hasUrlArray && !allowEmptyUrls) ||
      (!allowEmptyUrls && !job.urls.length)
    ) {
      const reason =
        job?.error?.message ||
        job?.error?.code ||
        "The Canva export did not finish.";
      throw createClientError(`${reason} Try another design or format.`, 422);
    }
    return hasUrlArray ? job.urls : [];
  };

  const isUsableExportUrl = (url) =>
    typeof url === "string" && url.trim().length > 0;
  const logPngExportMismatch = ({
    designId,
    requestedPages,
    expectedUrlCount,
    actualUrlCount,
    job,
  }) => {
    console.warn("[Canva] PNG export returned an unexpected URL count.", {
      designId,
      format: "png",
      requestedPages,
      expectedUrlCount,
      actualUrlCount,
      exportJobId: job?.id,
      exportStatus: job?.status,
    });
  };

  const importDesign = async ({
    churchId,
    designId,
    pages,
    format,
    mp4ImportMode = "combined",
    existingImportKeys,
    onProgress,
    isCancelled,
  }) => {
    if (!/^[A-Za-z0-9_-]{3,200}$/.test(String(designId || ""))) {
      throw createClientError("Choose a valid Canva design.");
    }
    const requestedPages = [
      ...new Set((Array.isArray(pages) ? pages : []).map(Number)),
    ].filter((page) => Number.isInteger(page) && page >= 1 && page <= 500);
    if (!requestedPages.length)
      throw createClientError("Select at least one page to import.");
    if (requestedPages.length > MAX_IMPORT_PAGES) {
      throw createClientError(
        `Import up to ${MAX_IMPORT_PAGES} pages at a time. Select fewer pages and try again.`,
      );
    }
    if (format !== "png" && format !== "mp4")
      throw createClientError("Choose PNG or MP4.");
    if (
      format === "mp4" &&
      mp4ImportMode !== "combined" &&
      mp4ImportMode !== "separate"
    )
      throw createClientError("Choose a valid MP4 import mode.");

    const designResponse = await canvaGet(
      churchId,
      `/designs/${encodeURIComponent(designId)}`,
    );
    const design = designResponse.data?.design || designResponse.data || {};
    const title = safeName(design.title, "Canva design");
    const revision = Math.max(0, Number(design.updated_at) || 0);
    const sourceFor = (pageNumbers) => ({
      designId,
      designTitle: title,
      revision,
      format,
      pageNumbers,
    });
    const existingKeySet = new Set(
      (Array.isArray(existingImportKeys) ? existingImportKeys : [])
        .slice(0, 500)
        .map((key) => String(key || "").slice(0, 500)),
    );
    const mp4ImportKey = canvaMp4ImportKey(designId, revision, requestedPages);
    const selectedPages =
      format === "png"
        ? requestedPages.filter(
            (pageNumber) =>
              !existingKeySet.has(
                canvaPngImportKey(designId, revision, pageNumber),
              ),
          )
        : mp4ImportMode === "separate"
          ? requestedPages.filter(
              (pageNumber) =>
                !existingKeySet.has(
                  canvaMp4ImportKey(designId, revision, [pageNumber]),
                ),
            )
        : existingKeySet.has(mp4ImportKey)
          ? []
          : requestedPages;
    const skippedCount =
      format === "png"
        ? requestedPages.length - selectedPages.length
        : mp4ImportMode === "separate"
          ? requestedPages.length - selectedPages.length
        : selectedPages.length
          ? 0
          : 1;
    const emitProgress = async (event) => {
      await onProgress?.(event);
    };
      await emitProgress({
      type: "started",
      total: requestedPages.length,
      pages: requestedPages,
    });
    for (const pageNumber of requestedPages) {
      const isSkipped = !selectedPages.includes(pageNumber);
      if (isSkipped) {
        await emitProgress({
          type: "page-progress",
          page: pageNumber,
          status: "ready",
          skipped: true,
        });
      }
    }
    if (!selectedPages.length) {
      return { assets: [], skippedCount, revision };
    }
    const paceExportCreation = createExportPacer();
    const importPageProgress = async (page, status, extra = {}) => {
      await emitProgress({ type: "page-progress", page, status, ...extra });
    };
    const isVertical =
      Number(design.thumbnail?.height || 0) >
      Number(design.thumbnail?.width || 0);
    const assets = [];
    const createdCloudinaryPublicIds = new Set();
    const committedCloudinaryPublicIds = new Set();
    let cleanupCreatedCloudinaryAssets = null;
    let cleanupCreatedMuxAssets = null;
    const committedMuxAssetIds = new Set();
    const accountedCloudinaryAssets = new Set();
    const accountedMuxAssets = new Set();
    try {
      if (format === "png") {
      const destroyCloudinaryAsset = cloudinaryClient?.uploader?.destroy;
      cleanupCreatedCloudinaryAssets = async () => {
        if (typeof destroyCloudinaryAsset !== "function") return;
        for (const publicId of [...createdCloudinaryPublicIds].filter(
          (id) => !committedCloudinaryPublicIds.has(id),
        )) {
          try {
            await destroyCloudinaryAsset.call(cloudinaryClient.uploader, publicId, {
              resource_type: "image",
              invalidate: true,
            });
            if (accountedCloudinaryAssets.has(publicId)) {
              await storageQuota?.removeProviderAsset({
                churchId,
                provider: "cloudinaryBytes",
                assetId: publicId,
              });
              accountedCloudinaryAssets.delete(publicId);
            }
          } catch (error) {
            console.warn("Could not remove failed Canva Cloudinary asset:", {
              publicId,
              error,
            });
          }
        }
      };
      for (const pageNumber of selectedPages) {
        await importPageProgress(pageNumber, "waiting");
        await importPageProgress(pageNumber, "exporting");
      }
      const exportJob = await requestExportJob(churchId, {
        design_id: designId,
        format: { type: "png", pages: selectedPages, as_single_image: false },
      }, paceExportCreation, isCancelled);
      const urls = await waitForExport(churchId, exportJob, {
        allowEmptyUrls: true,
        isCancelled,
      });
      let pageUrls = urls;
      const initialExportIsUsable =
        urls.length === selectedPages.length && urls.every(isUsableExportUrl);
      if (!initialExportIsUsable) {
        logPngExportMismatch({
          designId,
          requestedPages: selectedPages,
          expectedUrlCount: selectedPages.length,
          actualUrlCount: urls.length,
          job: exportJob,
        });
        pageUrls = await Promise.all(
          selectedPages.map(async (pageNumber) => {
            let pageJob;
            try {
              pageJob = await requestExportJob(churchId, {
                design_id: designId,
                format: {
                  type: "png",
                  pages: [pageNumber],
                  as_single_image: false,
                },
              }, paceExportCreation, isCancelled);
              const pageUrls = await waitForExport(churchId, pageJob, {
                allowEmptyUrls: true,
                isCancelled,
              });
              if (pageUrls.length !== 1 || !isUsableExportUrl(pageUrls[0])) {
                logPngExportMismatch({
                  designId,
                  requestedPages: [pageNumber],
                  expectedUrlCount: 1,
                  actualUrlCount: pageUrls.length,
                  job: pageJob,
                });
                throw createClientError(
                  `Canva returned an unusable PNG export for page ${pageNumber}.`,
                  422,
                );
              }
              return pageUrls[0];
            } catch (error) {
              if (error?.statusCode) {
                await importPageProgress(pageNumber, "error", {
                  error: error.message,
                });
                throw createClientError(
                  `Could not export Canva page ${pageNumber}. ${error.message}`,
                  error.statusCode,
                );
              }
              await importPageProgress(pageNumber, "error", {
                error: `Could not export Canva page ${pageNumber}. Try again.`,
              });
              throw createClientError(
                `Could not export Canva page ${pageNumber}. Try again.`,
                422,
              );
            }
          }),
        );
      }
      if (!cloudinaryClient?.uploader?.upload) {
        throw createClientError(
          "Image storage is not configured. Ask an admin to check the server.",
          503,
        );
      }
      for (let index = 0; index < pageUrls.length; index += 1) {
        const pageNumber = selectedPages[index];
        if (isCancelled?.())
          throw createClientError("Canva import cancelled.", 499);
        await importPageProgress(pageNumber, "processing");
        let uploaded;
        try {
          uploaded = await cloudinaryClient.uploader.upload(
            pageUrls[index],
            {
              resource_type: "image",
              folder: `worship-sync/canva/${churchId}`,
              tags: ["canva-import"],
              context: {
                caption: `${title} - Page ${pageNumber || index + 1}`,
              },
            },
          );
        } catch (error) {
          await importPageProgress(pageNumber, "error", {
            error: `Could not save Canva page ${pageNumber}. Try again.`,
          });
          throw error;
        }
        if (uploaded?.public_id) {
          createdCloudinaryPublicIds.add(uploaded.public_id);
        }
        assets.push({
          kind: "image",
          data: {
            ...uploaded,
            id: uploaded.asset_id,
            batchId: "canva",
            thumbnail_url: uploaded.secure_url,
            original_filename: `${title} - Page ${pageNumber || index + 1}`,
            path: uploaded.public_id,
            done: true,
            existing: false,
            canvaImportKey: canvaPngImportKey(
              designId,
              revision,
              pageNumber || index + 1,
            ),
            canvaSource: sourceFor([pageNumber || index + 1]),
          },
        });
        await importPageProgress(pageNumber, "ready");
      }
    } else {
      const mux = getMuxClient?.();
      if (!mux)
        throw createClientError(
          "Video storage is not configured. Ask an admin to check the server.",
          503,
        );
      const pageSelections =
        mp4ImportMode === "separate"
          ? selectedPages.map((pageNumber) => [pageNumber])
          : [selectedPages];
      const createdMuxAssetIds = new Set();
      cleanupCreatedMuxAssets = async () => {
        const deleteAsset = mux.video.assets.delete;
        if (typeof deleteAsset !== "function") return;
        await runBounded(
          [...createdMuxAssetIds].filter(
            (assetId) => !committedMuxAssetIds.has(assetId),
          ),
          resolvedMuxProcessingConcurrency,
          async (assetId) => {
            try {
              await deleteAsset.call(mux.video.assets, assetId);
              if (accountedMuxAssets.has(assetId)) {
                await storageQuota?.removeProviderAsset({
                  churchId,
                  provider: "muxMinutes",
                  assetId,
                });
                accountedMuxAssets.delete(assetId);
              }
            } catch (error) {
              console.warn("Could not remove failed Canva Mux asset:", {
                assetId,
                error,
              });
            }
          },
        );
      };
      const hasPlaybackId = (asset) =>
        typeof asset?.playback_ids?.[0]?.id === "string" &&
        asset.playback_ids[0].id.length > 0;
      const createMuxAsset = async (videoUrl, pageNumbers) => {
        if (isCancelled?.())
          throw createClientError("Canva import cancelled.", 499);
        const asset = await mux.video.assets.create({
          inputs: [{ url: videoUrl }],
          playback_policies: ["public"],
          video_quality: "basic",
          static_renditions: [{ resolution: "highest" }],
          meta: { title, creator_id: churchId, external_id: designId },
        });
        if (asset?.id) createdMuxAssetIds.add(asset.id);
        const processingDeadline = now() + resolvedMuxProcessingDeadlineMs;
        const maxProcessingPolls = Math.max(
          1,
          Math.ceil(
            resolvedMuxProcessingDeadlineMs / MUX_PROCESSING_POLL_INTERVAL_MS,
          ),
        );
        let ready = asset;
        for (
          let attempt = 0;
          attempt < maxProcessingPolls &&
          (ready.status !== "ready" ||
            !hasPlaybackId(ready));
          attempt += 1
        ) {
          if (isCancelled?.())
            throw createClientError("Canva import cancelled.", 499);
          if (now() >= processingDeadline)
            throw createClientError(
              "Mux video processing timed out.",
              504,
            );
          if (ready.status === "errored")
            throw createClientError(
              "Mux could not process the Canva video.",
              422,
            );
          await wait(MUX_PROCESSING_POLL_INTERVAL_MS);
          if (isCancelled?.())
            throw createClientError("Canva import cancelled.", 499);
          if (now() >= processingDeadline)
            throw createClientError(
              "Mux video processing timed out.",
              504,
            );
          ready = await mux.video.assets.retrieve(asset.id);
        }
        if (ready.status === "errored")
          throw createClientError(
            "Mux could not process the Canva video.",
            422,
          );
        if (ready.status !== "ready")
          throw createClientError(
            "Mux video processing timed out.",
            504,
          );
        const playbackId = ready.playback_ids?.[0]?.id;
        if (!playbackId)
          throw createClientError(
            "The Canva video did not finish processing. Try again.",
            504,
          );
        return {
          kind: "video",
          data: {
            playbackId,
            assetId: ready.id,
            duration: ready.duration,
            playbackUrl: `https://stream.mux.com/${playbackId}.m3u8`,
            thumbnailUrl: `https://image.mux.com/${playbackId}/thumbnail.jpg`,
            name:
              mp4ImportMode === "separate"
                ? `${title} - Page ${pageNumbers[0]}`
                : title,
            canvaImportKey: canvaMp4ImportKey(
              designId,
              revision,
              pageNumbers,
            ),
            canvaSource: sourceFor(pageNumbers),
          },
        };
      };
      const exportSeparatePage = async (pageNumbers) => {
        const pageNumber = pageNumbers[0];
        try {
          await importPageProgress(pageNumber, "exporting");
          const exportJob = await requestExportJob(
            churchId,
            {
              design_id: designId,
              format: {
                type: "mp4",
                pages: pageNumbers,
                quality: isVertical ? "vertical_1080p" : "horizontal_1080p",
              },
            },
            paceExportCreation,
            isCancelled,
          );
          const urls = await waitForExport(churchId, exportJob, {
            onRateLimit: () => importPageProgress(pageNumber, "waiting"),
            isCancelled,
          });
          if (urls.length !== 1 || !isUsableExportUrl(urls[0])) {
            throw createClientError(
              "Canva did not return a usable MP4 export. Try again.",
              422,
            );
          }
          return { pageNumbers, url: urls[0] };
        } catch (error) {
          await importPageProgress(pageNumber, "error", {
            error: `Page ${pageNumber} could not finish Canva export. Try again.`,
          });
          throw error;
        }
      };
      const processSeparatePage = async ({ pageNumbers, url }) => {
        const pageNumber = pageNumbers[0];
        try {
          await importPageProgress(pageNumber, "processing", { exported: true });
          const asset = await createMuxAsset(url, pageNumbers);
          await importPageProgress(pageNumber, "ready", { exported: true });
          return asset;
        } catch (error) {
          await importPageProgress(pageNumber, "error", {
            error: `Page ${pageNumber} could not finish video processing. Try again.`,
          });
          throw error;
        }
      };
      if (mp4ImportMode === "separate") {
        for (const pageNumber of selectedPages) {
          await importPageProgress(pageNumber, "waiting");
        }
        const exportedQueue = [];
        const queueWaiters = [];
        let exportsComplete = false;
        const processedResults = new Array(pageSelections.length);
        const processedErrors = [];
        const takeExportedPage = () => {
          if (exportedQueue.length > 0) {
            return Promise.resolve(exportedQueue.shift());
          }
          if (exportsComplete || isCancelled?.()) return Promise.resolve(null);
          return new Promise((resolve) => queueWaiters.push(resolve));
        };
        const enqueueExportedPage = (page) => {
          const waiter = queueWaiters.shift();
          if (waiter) waiter(page);
          else exportedQueue.push(page);
        };
        const finishExportQueue = () => {
          exportsComplete = true;
          while (queueWaiters.length > 0) queueWaiters.shift()(null);
        };
        const exportRun = runBounded(
          pageSelections,
          resolvedExportConcurrency,
          async (pageNumbers, index) => {
            const exported = await exportSeparatePage(pageNumbers);
            enqueueExportedPage({ index, ...exported });
            return exported;
          },
          isCancelled,
        );
        const muxWorkers = Array.from(
          { length: resolvedMuxProcessingConcurrency },
          async () => {
            while (true) {
              const page = await takeExportedPage();
              if (!page) return;
              if (isCancelled?.()) return;
              try {
                processedResults[page.index] = await processSeparatePage(page);
              } catch (error) {
                processedErrors.push({ index: page.index, error });
              }
            }
          },
        );
        const exportedPages = await exportRun;
        finishExportQueue();
        await Promise.all(muxWorkers);
        if (isCancelled?.()) {
          throw createClientError("Canva import cancelled.", 499);
        }
        if (exportedPages.errors.length > 0) {
          throw exportedPages.errors[0].error;
        }
        const processedPages = {
          results: processedResults,
          errors: processedErrors,
        };
        if (isCancelled?.()) {
          throw createClientError("Canva import cancelled.", 499);
        }
        if (processedPages.errors.length > 0) {
          throw processedPages.errors[0].error;
        }
        assets.push(...processedPages.results.filter(Boolean));
      } else {
        for (const pageNumber of selectedPages) {
          await importPageProgress(pageNumber, "waiting");
          await importPageProgress(pageNumber, "exporting");
        }
        const exportJob = await requestExportJob(
          churchId,
          {
            design_id: designId,
            format: {
              type: "mp4",
              pages: selectedPages,
              quality: isVertical ? "vertical_1080p" : "horizontal_1080p",
            },
          },
          paceExportCreation,
          isCancelled,
        );
        const urls = await waitForExport(churchId, exportJob, { isCancelled });
        if (urls.length !== 1 || !isUsableExportUrl(urls[0])) {
          throw createClientError(
            "Canva did not return a usable MP4 export. Try again.",
            422,
          );
        }
        for (const pageNumber of selectedPages) {
          await importPageProgress(pageNumber, "processing", { exported: true });
        }
        assets.push(await createMuxAsset(urls[0], selectedPages));
        for (const pageNumber of selectedPages) {
          await importPageProgress(pageNumber, "ready", { exported: true });
        }
      }
      }
      await emitProgress({ type: "finalizing" });
      for (const asset of assets) {
        if (asset.kind === "image" && asset.data.public_id) {
          const bytes = getCloudinaryAssetBytes(asset.data);
          if (bytes > 0) {
            await storageQuota?.recordProviderAsset({
              churchId,
              provider: "cloudinaryBytes",
              assetId: asset.data.public_id,
              amount: bytes,
            });
            accountedCloudinaryAssets.add(asset.data.public_id);
          }
        } else if (asset.kind === "video" && asset.data.assetId) {
          const minutes = getMuxStoredMinutes(asset.data);
          if (minutes > 0) {
            await storageQuota?.recordProviderAsset({
              churchId,
              provider: "muxMinutes",
              assetId: asset.data.assetId,
              amount: minutes,
            });
            accountedMuxAssets.add(asset.data.assetId);
          }
        }
      }
      await updateStatus(churchId, { lastImportedAt: now(), lastError: "" });
      for (const asset of assets) {
        if (asset.kind === "image" && asset.data.public_id) {
          committedCloudinaryPublicIds.add(asset.data.public_id);
        }
      }
      for (const asset of assets) {
        if (asset.kind === "video" && asset.data.assetId) {
          committedMuxAssetIds.add(asset.data.assetId);
        }
      }
      return { assets, skippedCount, revision };
    } catch (error) {
      await cleanupCreatedCloudinaryAssets?.();
      await cleanupCreatedMuxAssets?.();
      throw error;
    }
  };

  return {
    startConnect,
    completeConnect,
    getConnectStatus,
    getStatusForChurch,
    disconnect,
    listDesigns,
    getDesign,
    resolveDesignLink,
    importDesign,
  };
};
