import crypto from "node:crypto";

const TOKEN_COLLECTION = "canvaTokens";
const STATE_COLLECTION = "canvaOauthStates";
const CONNECT_COLLECTION = "canvaConnectRequests";
const RTDB_ROOT = "server/canva/v1";
const STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_SKEW_MS = 60 * 1000;
const SCOPES = "design:meta:read design:content:read profile:read";
const MAX_IMPORT_PAGES = 25;

const createClientError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex");
const randomValue = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
const DEFAULT_RETURN_TO = "/account/integrations";
const RETURN_TO_BASE_URL = "https://worshipsync.invalid";

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
  String(value || fallback || "Canva design").trim().slice(0, 160);
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
  const providerMessage =
    error?.response?.data?.message ||
    error?.response?.data?.error_description ||
    error?.response?.data?.error?.message;
  return createClientError(providerMessage || fallback, error?.response?.status || 502);
};

export const createCanvaService = ({
  getFirestore,
  getRealtimeDatabase,
  getIntegrationsPath,
  redirectBaseUrl,
  httpClient,
  cloudinaryClient,
  getMuxClient,
  clientId = process.env.CANVA_CLIENT_ID,
  clientSecret = process.env.CANVA_CLIENT_SECRET,
  tokenEncryptionKey = process.env.CANVA_TOKEN_ENCRYPTION_KEY,
  redirectUri = process.env.CANVA_OAUTH_REDIRECT_URI,
  now = () => Date.now(),
  wait = sleep,
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
      throw normalizeAxiosError(error, "Canva did not complete the connection. Try again.");
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
      throw createClientError("Canva is not configured for this WorshipSync server.", 503);
    }
    const tokenDoc = await getDoc(TOKEN_COLLECTION, churchId);
    if (!tokenDoc) throw createClientError("Connect Canva in Integrations first.", 409);
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
    if (!tokenDoc) throw createClientError("Connect Canva in Integrations first.", 409);
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
      throw normalizeAxiosError(error, "Canva could not load that content. Try again.");
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
      throw normalizeAxiosError(error, "Canva could not start that export. Try again.");
    }
  };

  const startConnect = async ({ churchId, userId, returnTo, desktop }) => {
    if (!configured) {
      throw createClientError("Add the Canva credentials to the server before connecting.", 503);
    }
    const state = randomValue();
    const verifier = randomValue(64);
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
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
      throw createClientError("This Canva connection request expired. Start again.", 400);
    }
    await deleteDoc(STATE_COLLECTION, stateDoc.id);
    const finish = async (patch) =>
      setDoc(CONNECT_COLLECTION, stateDoc.requestId, {
        churchId: stateDoc.churchId,
        secretHash: (await getDoc(CONNECT_COLLECTION, stateDoc.requestId))?.secretHash || "",
        expiresAt: stateDoc.expiresAt,
        ...patch,
      });
    if (denied || !code) {
      await finish({ status: "failed", errorMessage: "Canva access was not approved." });
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
        { headers: { Authorization: `Bearer ${token.access_token}` }, timeout: 20000 },
      );
      const profile = profileResponse.data?.profile || profileResponse.data || {};
      const accountLabel = safeName(profile.display_name, "Connected Canva account");
      await saveToken(stateDoc.churchId, token, accountLabel);
      await updateStatus(stateDoc.churchId, {
        enabled: true,
        connected: true,
        accountLabel,
        lastError: "",
      });
      await finish({ status: "completed", accountLabel, completedAt: now() });
      return { accountLabel, returnTo: stateDoc.returnTo, desktop: stateDoc.desktop };
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
    const doc = await getDoc(CONNECT_COLLECTION, String(connectRequestId || ""));
    if (
      !doc ||
      doc.churchId !== churchId ||
      hash(connectRequestSecret) !== doc.secretHash
    ) {
      throw createClientError("That Canva connection request is not available.", 404);
    }
    if (doc.status === "pending" && Number(doc.expiresAt) <= now()) {
      return { status: "expired", errorMessage: "This Canva connection request expired." };
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
        console.warn("Could not revoke Canva token; removing local connection:", error?.message);
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
    const response = await canvaGet(
      churchId,
      `/designs/${encodeURIComponent(designId)}`,
    );
    return normalizeCanvaDesign(response.data?.design || response.data || {});
  };

  const waitForExport = async (churchId, initialJob) => {
    let job = initialJob;
    for (let attempt = 0; attempt < 90 && job?.status === "in_progress"; attempt += 1) {
      await wait(1000);
      const response = await canvaGet(churchId, `/exports/${encodeURIComponent(job.id)}`);
      job = response.data?.job;
    }
    if (job?.status !== "success" || !Array.isArray(job.urls) || !job.urls.length) {
      const reason = job?.error?.message || job?.error?.code || "The Canva export did not finish.";
      throw createClientError(`${reason} Try another design or format.`, 422);
    }
    return job.urls;
  };

  const importDesign = async ({
    churchId,
    designId,
    pages,
    format,
    existingImportKeys,
  }) => {
    if (!/^[A-Za-z0-9_-]{3,200}$/.test(String(designId || ""))) {
      throw createClientError("Choose a valid Canva design.");
    }
    const requestedPages = [...new Set((Array.isArray(pages) ? pages : []).map(Number))]
      .filter((page) => Number.isInteger(page) && page >= 1 && page <= 500);
    if (!requestedPages.length) throw createClientError("Select at least one page to import.");
    if (requestedPages.length > MAX_IMPORT_PAGES) {
      throw createClientError(
        `Import up to ${MAX_IMPORT_PAGES} pages at a time. Select fewer pages and try again.`,
      );
    }
    if (format !== "png" && format !== "mp4") throw createClientError("Choose PNG or MP4.");

    const designResponse = await canvaGet(churchId, `/designs/${encodeURIComponent(designId)}`);
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
        : existingKeySet.has(mp4ImportKey)
          ? []
          : requestedPages;
    const skippedCount =
      format === "png"
        ? requestedPages.length - selectedPages.length
        : selectedPages.length
          ? 0
          : 1;
    if (!selectedPages.length) {
      return { assets: [], skippedCount, revision };
    }
    const isVertical =
      Number(design.thumbnail?.height || 0) >
      Number(design.thumbnail?.width || 0);
    const exportResponse = await canvaPost(churchId, "/exports", {
      design_id: designId,
      format:
        format === "png"
          ? { type: "png", pages: selectedPages }
          : {
              type: "mp4",
              pages: selectedPages,
              quality: isVertical ? "vertical_1080p" : "horizontal_1080p",
            },
    });
    const urls = await waitForExport(churchId, exportResponse.data?.job);
    const assets = [];
    if (format === "png") {
      if (!cloudinaryClient?.uploader?.upload) {
        throw createClientError("Image storage is not configured. Ask an admin to check the server.", 503);
      }
      for (let index = 0; index < urls.length; index += 1) {
        const uploaded = await cloudinaryClient.uploader.upload(urls[index], {
          resource_type: "image",
          folder: `worship-sync/canva/${churchId}`,
          tags: ["canva-import"],
          context: { caption: `${title} - Page ${selectedPages[index] || index + 1}` },
        });
        assets.push({
          kind: "image",
          data: {
            ...uploaded,
            id: uploaded.asset_id,
            batchId: "canva",
            thumbnail_url: uploaded.secure_url,
            original_filename: `${title} - Page ${selectedPages[index] || index + 1}`,
            path: uploaded.public_id,
            done: true,
            existing: false,
            canvaImportKey: canvaPngImportKey(
              designId,
              revision,
              selectedPages[index] || index + 1,
            ),
            canvaSource: sourceFor([
              selectedPages[index] || index + 1,
            ]),
          },
        });
      }
    } else {
      const mux = getMuxClient?.();
      if (!mux) throw createClientError("Video storage is not configured. Ask an admin to check the server.", 503);
      const asset = await mux.video.assets.create({
        inputs: [{ url: urls[0] }],
        playback_policies: ["public"],
        video_quality: "basic",
        meta: { title, creator_id: churchId, external_id: designId },
      });
      let ready = asset;
      for (let attempt = 0; attempt < 120 && ready.status !== "ready"; attempt += 1) {
        if (ready.status === "errored") throw createClientError("Mux could not process the Canva video.", 422);
        await wait(1000);
        ready = await mux.video.assets.retrieve(asset.id);
      }
      const playbackId = ready.playback_ids?.[0]?.id;
      if (!playbackId) throw createClientError("The Canva video did not finish processing. Try again.", 504);
      assets.push({
        kind: "video",
        data: {
          playbackId,
          assetId: ready.id,
          playbackUrl: `https://stream.mux.com/${playbackId}.m3u8`,
          thumbnailUrl: `https://image.mux.com/${playbackId}/thumbnail.jpg`,
          name: title,
          canvaImportKey: mp4ImportKey,
          canvaSource: sourceFor(selectedPages),
        },
      });
    }
    await updateStatus(churchId, { lastImportedAt: now(), lastError: "" });
    return { assets, skippedCount, revision };
  };

  return {
    startConnect,
    completeConnect,
    getConnectStatus,
    getStatusForChurch,
    disconnect,
    listDesigns,
    getDesign,
    importDesign,
  };
};
