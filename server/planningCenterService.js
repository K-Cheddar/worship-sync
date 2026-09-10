import crypto from "node:crypto";
import { mapPlanningCenterPlanToImportData } from "./planningCenterPlanImport.js";

const TOKEN_COLLECTION = "planningCenterTokens";
const STATE_COLLECTION = "planningCenterOauthStates";
const CONNECT_COLLECTION = "planningCenterConnectRequests";
const RTDB_ROOT = "server/planningCenter/v1";
const STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_SKEW_MS = 60 * 1000;
/** people = identity; services = plan import. */
const SCOPES = "people services";
const USER_AGENT = "WorshipSync (https://www.worshipsync.net/)";
const API_BASE = "https://api.planningcenteronline.com";
const AUTHORIZE_URL = `${API_BASE}/oauth/authorize`;
const TOKEN_URL = `${API_BASE}/oauth/token`;
const REVOKE_URL = `${API_BASE}/oauth/revoke`;
const USERINFO_URL = `${API_BASE}/oauth/userinfo`;
const DEFAULT_RETURN_TO = "/account/integrations";
const RETURN_TO_BASE_URL = "https://worshipsync.invalid";
const MAX_COLLECTION_PAGES = 20;

const createClientError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const hash = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex");
const randomValue = (bytes = 32) =>
  crypto.randomBytes(bytes).toString("base64url");

export const safePlanningCenterReturnTo = (value) => {
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
  String(value || fallback || "Connected Planning Center account")
    .trim()
    .slice(0, 160);

const normalizeAxiosError = (error, fallback) => {
  const providerMessage =
    error?.response?.data?.error_description ||
    error?.response?.data?.error?.message ||
    (typeof error?.response?.data?.error === "string"
      ? error.response.data.error
      : null) ||
    error?.response?.data?.message;
  return createClientError(
    providerMessage || fallback,
    error?.response?.status || 502,
  );
};

export const createPlanningCenterService = ({
  getFirestore,
  getRealtimeDatabase,
  getIntegrationsPath,
  redirectBaseUrl,
  httpClient,
  clientId = process.env.PLANNING_CENTER_CLIENT_ID,
  clientSecret = process.env.PLANNING_CENTER_CLIENT_SECRET,
  tokenEncryptionKey = process.env.PLANNING_CENTER_TOKEN_ENCRYPTION_KEY,
  redirectUri = process.env.PLANNING_CENTER_OAUTH_REDIRECT_URI,
  now = () => Date.now(),
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
    `${String(redirectBaseUrl || "").replace(/\/$/, "")}/api/planning-center/oauth/callback`;

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
    await rtdb
      .ref(`${getIntegrationsPath(churchId)}/planningCenter`)
      .update(patch);
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
      throw createClientError(
        "The Planning Center connection must be renewed.",
        401,
      );
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

  const exchangeToken = async (params) => {
    try {
      const response = await httpClient.post(
        TOKEN_URL,
        new URLSearchParams({
          ...params,
          client_id: String(clientId),
          client_secret: String(clientSecret),
        }).toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            "User-Agent": USER_AGENT,
          },
          timeout: 20000,
        },
      );
      return response.data;
    } catch (error) {
      throw normalizeAxiosError(
        error,
        "Planning Center did not complete the connection. Try again.",
      );
    }
  };

  const saveToken = async (churchId, data, accountLabel = "") => {
    await setDoc(TOKEN_COLLECTION, churchId, {
      accessToken: encrypt(data.access_token),
      refreshToken: encrypt(data.refresh_token),
      expiresAt: now() + Number(data.expires_in || 7200) * 1000,
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
        "Planning Center is not configured for this WorshipSync server.",
        503,
      );
    }
    const tokenDoc = await getDoc(TOKEN_COLLECTION, churchId);
    if (!tokenDoc) {
      throw createClientError(
        "Connect Planning Center in Integrations first.",
        409,
      );
    }
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
          lastError:
            "The Planning Center connection expired. Connect it again.",
        });
      }
      throw error;
    }
  };

  const startConnect = async ({ churchId, userId, returnTo, desktop }) => {
    if (!configured) {
      throw createClientError(
        "Add the Planning Center credentials to the server before connecting.",
        503,
      );
    }
    const state = randomValue();
    const verifier = randomValue(64);
    const challenge = crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64url");
    const requestId = `pco_${crypto.randomUUID()}`;
    const requestSecret = randomValue();
    const expiresAt = now() + STATE_TTL_MS;
    await setDoc(STATE_COLLECTION, state, {
      churchId,
      userId,
      verifier,
      requestId,
      returnTo: safePlanningCenterReturnTo(returnTo),
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
      prompt: "select_account",
    });
    return {
      authorizeUrl: `${AUTHORIZE_URL}?${params}`,
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
        "This Planning Center connection request expired. Start again.",
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
        errorMessage: "Planning Center access was not approved.",
      });
      const error = createClientError(
        "Planning Center access was not approved.",
      );
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
      let accountLabel = "Connected Planning Center account";
      try {
        const profileResponse = await httpClient.get(USERINFO_URL, {
          headers: {
            Authorization: `Bearer ${token.access_token}`,
            Accept: "application/json",
            "User-Agent": USER_AGENT,
          },
          timeout: 20000,
        });
        const profile = profileResponse.data || {};
        accountLabel = safeName(
          profile.organization_name || profile.name,
          accountLabel,
        );
      } catch (profileError) {
        console.warn(
          "Planning Center connected, but profile lookup failed:",
          profileError?.message,
        );
      }
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
        "That Planning Center connection request is not available.",
        404,
      );
    }
    if (doc.status === "pending" && Number(doc.expiresAt) <= now()) {
      return {
        status: "expired",
        errorMessage: "This Planning Center connection request expired.",
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
          REVOKE_URL,
          new URLSearchParams({
            token: decrypt(doc.refreshToken),
            token_type_hint: "refresh_token",
            client_id: String(clientId),
            client_secret: String(clientSecret),
          }).toString(),
          {
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Accept: "application/json",
              "User-Agent": USER_AGENT,
            },
            timeout: 10000,
          },
        );
      } catch (error) {
        console.warn(
          "Could not revoke Planning Center token; removing local connection:",
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

  const forceRefreshAccessToken = async (churchId) => {
    const tokenDoc = await getDoc(TOKEN_COLLECTION, churchId);
    if (!tokenDoc) {
      throw createClientError(
        "Connect Planning Center in Integrations first.",
        409,
      );
    }
    return refreshToken(churchId, tokenDoc);
  };

  const pcoGet = async (churchId, path, params) => {
    const request = async (accessToken) =>
      httpClient.get(`${API_BASE}${path}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
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
            "The Planning Center connection expired. Connect it again in Integrations.",
          );
        }
      }
      throw normalizeAxiosError(
        error,
        "Planning Center could not load that content. Try again.",
      );
    }
  };

  const pcoGetCollection = async (churchId, path, params = {}) => {
    const data = [];
    const includedByKey = new Map();
    let offset = 0;
    const perPage = Math.min(100, Number(params.per_page) || 100);
    for (let page = 0; page < MAX_COLLECTION_PAGES; page += 1) {
      const response = await pcoGet(churchId, path, {
        ...params,
        per_page: perPage,
        offset,
      });
      const pageData = Array.isArray(response.data?.data)
        ? response.data.data
        : [];
      data.push(...pageData);
      for (const entry of response.data?.included || []) {
        if (!entry?.type || entry.id == null) continue;
        includedByKey.set(`${entry.type}:${entry.id}`, entry);
      }
      if (pageData.length < perPage) break;
      offset += perPage;
    }
    return { data, included: [...includedByKey.values()] };
  };

  const safeId = (value, label) => {
    const id = String(value || "").trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      throw createClientError(`Choose a valid Planning Center ${label}.`);
    }
    return id;
  };

  const listServiceTypes = async ({ churchId }) => {
    const { data } = await pcoGetCollection(
      churchId,
      "/services/v2/service_types",
      { order: "name", per_page: 100 },
    );
    return {
      items: data.map((entry) => ({
        id: String(entry.id),
        name:
          String(entry.attributes?.name || "Service type").trim() ||
          "Service type",
      })),
    };
  };

  const listPlans = async ({ churchId, serviceTypeId, filter = "future" }) => {
    const typeId = safeId(serviceTypeId, "service type");
    const planFilter =
      filter === "past" || filter === "no_dates" ? filter : "future";
    const { data } = await pcoGetCollection(
      churchId,
      `/services/v2/service_types/${encodeURIComponent(typeId)}/plans`,
      {
        filter: planFilter,
        order: planFilter === "past" ? "-sort_date" : "sort_date",
        per_page: 50,
      },
    );
    return {
      items: data.map((entry) => {
        const attrs = entry.attributes || {};
        const dates =
          String(attrs.dates || attrs.short_dates || "").trim() || "No date";
        const title = String(attrs.title || attrs.series_title || "").trim();
        return {
          id: String(entry.id),
          serviceTypeId: typeId,
          dates,
          title,
          label: title ? `${dates} · ${title}` : dates,
          itemsCount: Number(attrs.items_count) || 0,
          sortDate: attrs.sort_date || "",
          sourceUrl:
            String(attrs.planning_center_url || "").trim() ||
            `https://services.planningcenteronline.com/plans/${encodeURIComponent(String(entry.id))}`,
        };
      }),
    };
  };

  const getPlanImport = async ({ churchId, serviceTypeId, planId }) => {
    const typeId = safeId(serviceTypeId, "service type");
    const id = safeId(planId, "plan");
    const planResponse = await pcoGet(
      churchId,
      `/services/v2/service_types/${encodeURIComponent(typeId)}/plans/${encodeURIComponent(id)}`,
    );
    const plan = planResponse.data?.data;
    if (!plan) {
      throw createClientError("That Planning Center plan was not found.", 404);
    }
    const { data: items, included } = await pcoGetCollection(
      churchId,
      `/services/v2/service_types/${encodeURIComponent(typeId)}/plans/${encodeURIComponent(id)}/items`,
      {
        include:
          "song,arrangement,key,item_notes,item_assignments,item_assignments.assignable,item_times,item_times.plan_time",
        order: "sequence",
        per_page: 100,
      },
    );
    const mapped = mapPlanningCenterPlanToImportData({
      plan,
      items,
      included,
    });
    return {
      planLabel: mapped.planLabel,
      sourceUrl: mapped.sourceUrl,
      serviceTypeId: mapped.serviceTypeId || typeId,
      planId: mapped.planId,
      sections: mapped.sections,
      teamAssignments: mapped.teamAssignments,
    };
  };

  return {
    startConnect,
    completeConnect,
    getConnectStatus,
    getStatusForChurch,
    disconnect,
    accessTokenFor,
    listServiceTypes,
    listPlans,
    getPlanImport,
  };
};
