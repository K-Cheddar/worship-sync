import "./instrument.js";
import { setupExpressErrorHandler } from "@sentry/node";
import express from "express";
import cors from "cors";
import session from "express-session";
import path from "path";
import bodyParser from "body-parser";
import fsPromise from "fs/promises";
import fs from "fs";
import axios from "axios";
import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { v2 as cloudinary } from "cloudinary";
import Mux from "@mux/mux-node";
import https from "https";
import {
  authHandlers,
  COLLECTIONS,
  deleteDoc,
  getServerFirestore,
  getServerRealtimeDatabase,
  authSessionConfig,
  getDoc,
  nowIso,
  queryDocs,
  readChurchPublicBoardHeaderLogoUrl,
  resolveRequestBootstrap,
  requireTeamsViewSession,
  assertServerCsrf,
  setDoc,
} from "./authService.js";
import { createAppSessionGuards } from "./server/appSessionGuards.js";
import { createLyricsImportService } from "./lyricsImport.js";
import {
  BOARD_DB_NAME,
  archiveBoardDoc,
  createAliasDoc,
  createBoardDoc,
  createBoardPostDoc,
  getAliasDocId,
  getBoardPostRange,
  isBoardAuthorInUse,
  normalizeAliasId,
  normalizeBoardParticipantId,
  normalizeBoardTitle,
  rotateAliasDoc,
  updateAliasPresentationFontScale,
  assertAttendeeCanMutateBoardPost,
  validateAliasInput,
  validateBoardPostInput,
  validateBoardPostTextUpdate,
} from "./server/boardService.js";
import { getChurchIntegrationsPath } from "./server/churchIntegrations.js";
import { ensureWorshipSyncContentDatabase } from "./server/couchContentDatabase.js";
import {
  createRestreamService,
  normalizeRestreamPostedAtMs,
} from "./server/restreamService.js";
import { createYouTubeLiveChatService } from "./server/youtubeLiveChatService.js";
import {
  YouTubeSearchInputError,
  YouTubeSearchNotConfiguredError,
  YouTubeSearchUpstreamError,
  createYouTubeSearchService,
} from "./server/youtubeSearchService.js";
import {
  createCanvaService,
} from "./server/canvaService.js";
import { createPlanningCenterService } from "./server/planningCenterService.js";
import { addTeamsSseClient, removeTeamsSseClient } from "./server/teamsSse.js";
import {
  SongAudioInputError,
  SongAudioStorageNotConfiguredError,
  createSongAudioStorage,
} from "./server/songAudioStorage.js";
import {
  createChurchResourceStorage,
  getChurchResourceMaxBytes,
} from "./server/churchResourceService.js";
import { createChurchResourceHandlers } from "./server/churchResourceApi.js";
import { createChurchResourceUploadGuard } from "./server/churchResourceUploadGuard.js";
import {
  createChurchStorageQuotaService,
} from "./server/churchStorageQuota.js";
import { createChurchR2UsageLoader } from "./server/churchR2Usage.js";
import { createProviderStorageService } from "./server/providerStorageService.js";
import { toWorshipSyncContentDbName } from "./server/couchContentDatabase.js";
import { createSongAudioUploadGuard } from "./server/songAudioUploadGuard.js";
import {
  RichLinkPreviewInputError,
  RichLinkPreviewUnavailableError,
  createRichLinkPreviewService,
} from "./server/richLinkPreview.js";
import {
  ExternalResourceError,
  createExternalResourceService,
} from "./server/externalResourceService.js";
import {
  buildPublicShareImageUrl,
  isLinkPreviewCrawler,
  matchPublicShareRoute,
  renderPublicShareHtml,
  resolvePublicShareMeta,
} from "./server/publicShareMeta.js";
import { createChatService } from "./server/chatService.js";
import { createChatHandlers } from "./server/chatApi.js";
import {
  CHAT_IMAGE_MAX_BYTES,
  createChatImageStorage,
} from "./server/chatImageStorage.js";
import {
  createChatImageFinalizeGuard,
  createChatImageUploadGuard,
} from "./server/chatImageUploadGuard.js";
import { resolveMinimumSupportedWebVersion } from "./server/webUpdatePolicy.js";

const packageJson = JSON.parse(readFileSync("./package.json", "utf8"));

dotenv.config();

const minimumSupportedWebVersion = resolveMinimumSupportedWebVersion(
  process.env.MIN_SUPPORTED_WEB_VERSION,
  packageJson.version,
);

if (process.env.MIN_SUPPORTED_WEB_VERSION && !minimumSupportedWebVersion) {
  console.error(
    "Ignoring invalid MIN_SUPPORTED_WEB_VERSION; it must be a released version at or below this deployment.",
  );
}

// Validate required environment variables
const requiredEnvVars = [
  "AZURE_TENANT_ID",
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
  "COUCHDB_HOST",
  "COUCHDB_USER",
  "COUCHDB_PASSWORD",
];
const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error("Missing required environment variables:", missingEnvVars);
  process.exit(1);
}

const app = express();
const dirname = import.meta.dirname;

const isDevelopment = process.env.NODE_ENV === "development";

const port = process.env.PORT || 5000;

/** Production browser origin derived from AUTH_APP_BASE_URL (canonical app URL). */
const resolveProductionFrontEndHost = () => {
  const raw = process.env.AUTH_APP_BASE_URL;
  if (!raw) {
    return "http://localhost:3000";
  }
  try {
    return new URL(raw).origin;
  } catch {
    return "http://localhost:3000";
  }
};

const frontEndHost = isDevelopment
  ? "https://local.worshipsync.net:3000"
  : resolveProductionFrontEndHost();

const APP_PUBLIC_BASE_URL =
  process.env.AUTH_APP_BASE_URL?.replace(/\/$/, "") ||
  "https://www.worshipsync.net";
const PUBLIC_SHARE_OG_IMAGE_URL = buildPublicShareImageUrl(APP_PUBLIC_BASE_URL);
/** Crawler OG title lookup only — keep share HTML responsive if CouchDB stalls. */
const BOARD_SHARE_PREVIEW_TIMEOUT_MS = 2000;

const withTimeout = async (promise, timeoutMs, timeoutMessage) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Path-based public share pages: crawlers get Open Graph HTML; browsers get the
 * SPA so {@link PublicApp} can mount on the same path (BrowserRouter).
 */
const sendPublicShareMetaPage = async (req, res, matched) => {
  let overrides = {};
  if (
    (matched.kind === "board" || matched.kind === "board-present") &&
    matched.param
  ) {
    try {
      const aliasId = normalizeAliasId(matched.param);
      if (aliasId) {
        const aliasDoc = await withTimeout(
          getBoardDoc(getAliasDocId(aliasId)),
          BOARD_SHARE_PREVIEW_TIMEOUT_MS,
          "Board share preview timed out",
        );
        const boardTitle = String(aliasDoc?.title || "").trim();
        if (boardTitle) {
          overrides = {
            title: `${boardTitle} | WorshipSync`,
            description:
              matched.kind === "board-present"
                ? `View the live presentation for ${boardTitle}.`
                : `Join the conversation on ${boardTitle}.`,
          };
        }
      }
    } catch (error) {
      console.error("Error loading board title for share preview:", error);
    }
  }

  const { title, description } = resolvePublicShareMeta(
    matched.kind,
    overrides,
  );
  const canonicalUrl = `${APP_PUBLIC_BASE_URL}${matched.canonicalPath}${
    matched.kind === "invite" && req.query?.token
      ? `?${new URLSearchParams({ token: String(req.query.token) }).toString()}`
      : ""
  }`;

  res
    .status(200)
    .setHeader("Content-Type", "text/html; charset=utf-8")
    .setHeader("Cache-Control", "public, max-age=300")
    .send(
      renderPublicShareHtml({
        title,
        description,
        canonicalUrl,
        imageUrl: PUBLIC_SHARE_OG_IMAGE_URL,
      }),
    );
};

// The public app is deployed on the `www` hostname, but people naturally type
// the apex domain. Normalize that hostname before any API or SPA handling so a
// manually entered `worshipsync.net` URL behaves exactly like the invite link.
// Keep the hash fragment client-side: it is not included in req.originalUrl,
// and the browser will preserve it when following this redirect.
if (!isDevelopment) {
  app.use((req, res, next) => {
    if (
      req.hostname === "worshipsync.net" &&
      (req.method === "GET" || req.method === "HEAD")
    ) {
      res.redirect(308, `${frontEndHost.replace(/\/$/, "")}${req.originalUrl}`);
      return;
    }
    next();
  });
}
const {
  getGeniusTrack,
  getLrclibRequestParams,
  getLrclibTrack,
  getLyricsOvhTrack,
  searchAllLyricsTracks,
  searchGeniusTracks,
  searchLrclibTracks,
} = createLyricsImportService({
  geniusAccessToken: process.env.GENIUS_ACCESS_TOKEN,
});
/** Set this flag to bypass Genius when its upstream service is unavailable. */
const skipGeniusLyricsImport = process.env.LYRICS_IMPORT_SKIP_GENIUS === "true";

const configuredAllowedOrigins = [
  frontEndHost,
  "https://local.worshipsync.net:3000",
  "http://localhost:3000",
  process.env.AUTH_APP_BASE_URL,
  ...(process.env.AUTH_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
];
/** Normalized browser origins allowed for credentialed CORS (see cors() below). */
const corsAllowedOrigins = Array.from(
  new Set(
    configuredAllowedOrigins
      .map((origin) => {
        try {
          return new URL(origin).origin;
        } catch {
          return origin;
        }
      })
      .filter(Boolean),
  ),
);

const {
  requireAppSession,
  requireMutationCsrf,
  requireFullAppAccess,
  requireChurchAdmin,
  requireSongAudioEditAccess,
  assertSongAudioChurchAccess,
  requireChurchResourceBrowseAccess,
  requireChurchResourceReferenceReadAccess,
  requireChurchResourceEditAccess,
} = createAppSessionGuards({
  resolveRequestBootstrap,
  assertRequestCsrf: assertServerCsrf,
});

const songAudioMaxBytes = (() => {
  const configured = Number(process.env.SONG_AUDIO_MAX_BYTES);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : 50 * 1024 * 1024;
})();
const parseSongAudioBytes = express.raw({
  type: ["audio/mpeg", "audio/mp3", "audio/x-mpeg"],
  limit: songAudioMaxBytes,
});
const parseChurchResourceBytes = express.raw({
  type: "*/*",
  limit: getChurchResourceMaxBytes(),
});
const guardSongAudioUpload = createSongAudioUploadGuard();
const guardChurchResourceUpload = createChurchResourceUploadGuard();
const chatImageMaxBytes = (() => {
  const configured = Number(process.env.CHAT_IMAGE_MAX_BYTES);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : CHAT_IMAGE_MAX_BYTES;
})();
const parseChatImageBytes = express.raw({
  type: ["image/jpeg", "image/png", "image/webp"],
  limit: chatImageMaxBytes,
});
const guardChatImageUpload = createChatImageUploadGuard();
const guardChatImageFinalize = createChatImageFinalizeGuard();
const richLinkPreviewService = createRichLinkPreviewService({
  httpClient: axios,
});
const externalResourceService = createExternalResourceService({
  httpClient: axios,
});
const youtubeSearchService = createYouTubeSearchService({
  httpClient: axios,
  apiKey: process.env.YOUTUBE_API_KEY,
});

let songAudioStorage;
const loadChurchR2Usage = createChurchR2UsageLoader({
  getFirestore: getServerFirestore,
  queryDocs,
  axios,
});
const churchStorageQuota = createChurchStorageQuotaService({
  getFirestore: getServerFirestore,
  getChurch: (churchId) => getDoc(COLLECTIONS.churches, churchId),
  providerQuotaEnforcementEnabled: () =>
    process.env.CHURCH_PROVIDER_STORAGE_QUOTAS_ENABLED === "true",
  loadR2Usage: loadChurchR2Usage,
});
const getSongAudioStorage = () => {
  if (!songAudioStorage) {
    songAudioStorage = createSongAudioStorage({ quota: churchStorageQuota });
  }
  return songAudioStorage;
};

const getStoredSongAudioSize = async (churchId, songId) => {
  if (!process.env.COUCHDB_HOST || !process.env.COUCHDB_USER || !process.env.COUCHDB_PASSWORD) return 0;
  const database = toWorshipSyncContentDbName(churchId);
  const url = `https://${process.env.COUCHDB_HOST}/${encodeURIComponent(database)}/${encodeURIComponent(songId)}`;
  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${process.env.COUCHDB_USER}:${process.env.COUCHDB_PASSWORD}`).toString("base64")}`,
      },
    });
    return Number(response.data?.songAudio?.sizeBytes) || 0;
  } catch (error) {
    if (error?.response?.status === 404) return 0;
    throw error;
  }
};

let churchResourceHandlers;
const getChurchResourceHandlers = () => {
  if (!churchResourceHandlers) {
    churchResourceHandlers = createChurchResourceHandlers({
      COLLECTIONS,
      deleteDoc,
      getDoc,
      nowIso,
      queryDocs,
      setDoc,
      storageFactory: () => createChurchResourceStorage(),
      quota: churchStorageQuota,
    });
  }
  return churchResourceHandlers;
};

let chatImageStorage;
const getChatImageStorage = () => {
  if (!chatImageStorage) {
    chatImageStorage = createChatImageStorage({ quota: churchStorageQuota });
  }
  return chatImageStorage;
};

const respondSongAudioError = (res, context, error) => {
  if (error?.code === "CHURCH_STORAGE_QUOTA_EXCEEDED") {
    return res.status(413).json({
      success: false,
      error: error.message,
      code: error.code,
      quota: error.provider,
    });
  }
  if (error?.code === "CHURCH_STORAGE_MUTATION_IN_PROGRESS") {
    return res.status(409).json({
      success: false,
      error: error.message,
      code: error.code,
    });
  }
  if (error instanceof SongAudioInputError) {
    return res.status(400).json({ error: error.message });
  }
  if (error instanceof SongAudioStorageNotConfiguredError) {
    return res
      .status(503)
      .json({ error: "Song audio storage is not configured yet." });
  }
  if (error?.name === "NotFound" || error?.name === "NoSuchKey") {
    return res.status(404).json({
      error:
        "The uploaded MP3 was not found. Select the file and upload it again.",
    });
  }
  console.error(context, error);
  return res
    .status(502)
    .json({ error: "Song audio could not be completed. Try again." });
};

const requireBoardDatabaseAccess = (req, res, database) => {
  if (!database || req.appSession?.database !== database) {
    res.status(403).json({ error: "That discussion board is not available." });
    return false;
  }

  return true;
};

const buildCouchAdminHeaders = (contentType = "application/json") => ({
  Authorization:
    "Basic " +
    Buffer.from(
      `${process.env.COUCHDB_USER}:${process.env.COUCHDB_PASSWORD}`,
    ).toString("base64"),
  "Content-Type": contentType,
});

const getBoardDbUrl = () =>
  `https://${process.env.COUCHDB_HOST}/${BOARD_DB_NAME}`;

let boardDbEnsurePromise;

const ensureBoardDbExists = async () => {
  if (!boardDbEnsurePromise) {
    boardDbEnsurePromise = axios({
      method: "PUT",
      url: getBoardDbUrl(),
      headers: buildCouchAdminHeaders(),
    }).catch((error) => {
      if (error?.response?.status === 412) return;
      boardDbEnsurePromise = undefined;
      throw error;
    });
  }

  await boardDbEnsurePromise;
};

const boardSseClients = new Map();

const addBoardSseClient = (aliasId, res) => {
  const clients = boardSseClients.get(aliasId);
  if (clients) {
    clients.add(res);
    return;
  }
  boardSseClients.set(aliasId, new Set([res]));
};

const removeBoardSseClient = (aliasId, res) => {
  const clients = boardSseClients.get(aliasId);
  if (!clients) return;
  clients.delete(res);
  if (clients.size === 0) {
    boardSseClients.delete(aliasId);
  }
};

const emitBoardEvent = (aliasId, type, payload = {}) => {
  const clients = boardSseClients.get(aliasId);
  if (!clients?.size) return;

  const event = JSON.stringify({
    type,
    aliasId,
    timestamp: Date.now(),
    ...payload,
  });

  clients.forEach((client) => {
    client.write(`data: ${event}\n\n`);
  });
};

const closeBoardSseClients = (aliasId) => {
  const clients = boardSseClients.get(aliasId);
  if (!clients?.size) return;

  clients.forEach((client) => {
    client.end();
  });
  boardSseClients.delete(aliasId);
};

/** Serializes create-post handling per board session to avoid duplicate display-name races. */
const boardPostCreateChains = new Map();

const runExclusiveBoardPostCreate = (boardId, fn) => {
  const previous = boardPostCreateChains.get(boardId) ?? Promise.resolve();
  // Recover the chain if the predecessor rejected so queued submissions still run.
  const tail = previous.catch(() => {}).then(() => fn());
  boardPostCreateChains.set(boardId, tail);
  return tail.finally(() => {
    if (boardPostCreateChains.get(boardId) === tail) {
      boardPostCreateChains.delete(boardId);
    }
  });
};

const boardDbRequest = async ({ method, path = "", params, data, headers }) => {
  await ensureBoardDbExists();

  const response = await axios({
    method,
    url: `${getBoardDbUrl()}${path}`,
    params,
    data,
    headers: headers || buildCouchAdminHeaders(),
  });

  return response.data;
};

const getBoardDoc = async (docId) => {
  try {
    return await boardDbRequest({
      method: "GET",
      path: `/${encodeURIComponent(docId)}`,
    });
  } catch (error) {
    if (error?.response?.status === 404) return null;
    throw error;
  }
};

const putBoardDoc = (doc) =>
  boardDbRequest({
    method: "PUT",
    path: `/${encodeURIComponent(doc._id)}`,
    data: doc,
  });

const getBoardDocsByRange = async ({
  startkey,
  endkey,
  keys,
  includeDocs = true,
}) => {
  if (keys) {
    const result = await boardDbRequest({
      method: "POST",
      path: "/_all_docs",
      params: { include_docs: includeDocs },
      data: { keys },
    });
    return result.rows ?? [];
  }

  const result = await boardDbRequest({
    method: "GET",
    path: "/_all_docs",
    params: {
      include_docs: includeDocs,
      startkey: JSON.stringify(startkey),
      endkey: JSON.stringify(endkey),
    },
  });
  return result.rows ?? [];
};

const bulkDeleteBoardDocs = async (docs) => {
  if (!docs.length) return;

  await boardDbRequest({
    method: "POST",
    path: "/_bulk_docs",
    data: {
      docs: docs.map((doc) => ({ ...doc, _deleted: true })),
    },
  });
};

const RESTREAM_CLIENT_ERROR_MESSAGE =
  "Something went wrong. Try again in a moment.";
const YOUTUBE_CLIENT_ERROR_MESSAGE =
  "Something went wrong. Try again in a moment.";

const restreamParseReturnTo = (raw) => {
  if (raw === undefined || raw === null) {
    return "/account?tab=integrations";
  }
  const s = String(raw).trim();
  if (!s.startsWith("/") || s.length > 512) {
    return "/account?tab=integrations";
  }
  if (/^https?:\/\//i.test(s) || s.startsWith("//")) {
    return "/account?tab=integrations";
  }
  return s;
};

const youtubeParseReturnTo = restreamParseReturnTo;

const readRestreamConnectStatusBody = (body) => {
  const connectRequestId = body?.connectRequestId;
  const connectRequestSecret = body?.connectRequestSecret;
  if (typeof connectRequestId !== "string" || !connectRequestId.trim()) {
    const err = new Error("INVALID_REQUEST");
    err.statusCode = 400;
    throw err;
  }
  if (
    typeof connectRequestSecret !== "string" ||
    !connectRequestSecret.trim()
  ) {
    const err = new Error("INVALID_REQUEST");
    err.statusCode = 400;
    throw err;
  }
  return {
    connectRequestId: connectRequestId.trim(),
    connectRequestSecret: connectRequestSecret.trim(),
  };
};

const readYouTubeConnectStatusBody = readRestreamConnectStatusBody;

const isRestreamValidationError = (error) =>
  Boolean(error && error.statusCode === 400);

const isYouTubeValidationError = isRestreamValidationError;

const respondRestreamJsonError = (res, logLabel, error) => {
  console.error(logLabel, error);
  if (isRestreamValidationError(error)) {
    res.status(400).json({ error: "Invalid request." });
    return;
  }
  res.status(500).json({ error: RESTREAM_CLIENT_ERROR_MESSAGE });
};

const respondYouTubeJsonError = (res, logLabel, error) => {
  console.error(logLabel, error);
  if (isYouTubeValidationError(error)) {
    res.status(400).json({
      error:
        error instanceof Error &&
        error.message &&
        error.message !== "INVALID_REQUEST"
          ? error.message
          : "Invalid request.",
    });
    return;
  }
  res.status(500).json({ error: YOUTUBE_CLIENT_ERROR_MESSAGE });
};

const boardAliasIdsByDatabase = new Map();
let boardAliasCacheBuilt = false;

const rebuildBoardAliasIdsByDatabaseCache = async () => {
  boardAliasIdsByDatabase.clear();
  const rows = await getBoardDocsByRange({
    startkey: "alias:",
    endkey: "alias:\ufff0",
  });
  for (const row of rows) {
    const doc = row.doc;
    if (!doc?.database || !doc?.aliasId) continue;
    let set = boardAliasIdsByDatabase.get(doc.database);
    if (!set) {
      set = new Set();
      boardAliasIdsByDatabase.set(doc.database, set);
    }
    set.add(doc.aliasId);
  }
  boardAliasCacheBuilt = true;
};

const invalidateBoardAliasIdsByDatabaseCache = () => {
  boardAliasCacheBuilt = false;
  boardAliasIdsByDatabase.clear();
};

const emitBoardEventForDatabase = async (database, type, payload = {}) => {
  if (!database) return;
  if (!boardAliasCacheBuilt) {
    await rebuildBoardAliasIdsByDatabaseCache();
  }
  const aliasIds = boardAliasIdsByDatabase.get(database);
  if (!aliasIds?.size) return;
  for (const aliasId of aliasIds) {
    emitBoardEvent(aliasId, type, payload);
  }
};

const restreamService = createRestreamService({
  getFirestore: getServerFirestore,
  getRealtimeDatabase: getServerRealtimeDatabase,
  getIntegrationsPath: getChurchIntegrationsPath,
  onBoardDisplayUpdate: (database) =>
    emitBoardEventForDatabase(database, "restream-session-updated"),
  redirectBaseUrl: frontEndHost,
});

const youtubeLiveChatService = createYouTubeLiveChatService({
  getFirestore: getServerFirestore,
  getRealtimeDatabase: getServerRealtimeDatabase,
  getIntegrationsPath: getChurchIntegrationsPath,
  redirectBaseUrl: frontEndHost,
});
let canvaService;
let planningCenterService;

const chatService = createChatService({
  getFirestore: getServerFirestore,
  getRealtimeDatabase: getServerRealtimeDatabase,
  onAttachmentRemoved: ({ churchId, attachment, expired }) =>
    expired
      ? getChatImageStorage().deleteExpiredAttachment({ churchId, attachment })
      : getChatImageStorage().deleteAttachment({ churchId, attachment }),
  onAttachmentAttached: ({ churchId, attachment }) =>
    getChatImageStorage().commitAttachment({ churchId, attachment }),
  onAttachmentAborted: ({ churchId, attachment }) =>
    getChatImageStorage().abortAttachment({ churchId, attachment }),
});
const chatHandlers = createChatHandlers({ chatService, getChatImageStorage });

const serializeBoardAlias = (aliasDoc) => ({
  _id: aliasDoc._id,
  _rev: aliasDoc._rev,
  type: aliasDoc.type,
  docType: aliasDoc.docType,
  aliasId: aliasDoc.aliasId,
  title: aliasDoc.title,
  database: aliasDoc.database,
  currentBoardId: aliasDoc.currentBoardId,
  history: aliasDoc.history || [],
  presentationFontScale:
    typeof aliasDoc.presentationFontScale === "number"
      ? aliasDoc.presentationFontScale
      : 1,
  createdAt: aliasDoc.createdAt,
  updatedAt: aliasDoc.updatedAt,
});

const serializeBoardDoc = (boardDoc) => ({
  _id: boardDoc._id,
  _rev: boardDoc._rev,
  type: boardDoc.type,
  docType: boardDoc.docType,
  id: boardDoc.id,
  aliasId: boardDoc.aliasId,
  database: boardDoc.database,
  createdAt: boardDoc.createdAt,
  archived: boardDoc.archived,
});

const serializeBoardPost = (postDoc) => ({
  _id: postDoc._id,
  _rev: postDoc._rev,
  type: postDoc.type,
  docType: postDoc.docType,
  id: postDoc.id,
  aliasId: postDoc.aliasId,
  boardId: postDoc.boardId,
  database: postDoc.database,
  text: postDoc.text,
  author: postDoc.author,
  authorId: postDoc.authorId || "",
  timestamp: postDoc.timestamp,
  hidden: Boolean(postDoc.hidden),
  highlighted: Boolean(postDoc.highlighted),
  deleted: Boolean(postDoc.deleted),
  ...(typeof postDoc.editedAt === "number"
    ? { editedAt: postDoc.editedAt }
    : {}),
  ...(typeof postDoc.deletedAt === "number"
    ? { deletedAt: postDoc.deletedAt }
    : {}),
});

const serializeRestreamMessage = (messageDoc) => ({
  id: messageDoc.id,
  churchId: messageDoc.churchId,
  database: messageDoc.database,
  sessionId: messageDoc.sessionId,
  platform: messageDoc.platform || "Restream",
  connectionIdentifier: messageDoc.connectionIdentifier || "",
  author: messageDoc.author || "Unknown author",
  authorAvatarUrl: messageDoc.authorAvatarUrl || "",
  text: messageDoc.text || "",
  postedAt:
    normalizeRestreamPostedAtMs(messageDoc.postedAt) ?? messageDoc.postedAt,
  receivedAt: messageDoc.receivedAt,
  rawEventType: messageDoc.rawEventType || "",
  kind:
    messageDoc.kind === "moderator_reply"
      ? "moderator_reply"
      : "viewer_message",
  isHighlighted: Boolean(messageDoc.isHighlighted),
  hidden: Boolean(messageDoc.hidden),
  ...(typeof messageDoc.highlightedAt === "number"
    ? { highlightedAt: messageDoc.highlightedAt }
    : {}),
  ...(typeof messageDoc.hiddenAt === "number"
    ? { hiddenAt: messageDoc.hiddenAt }
    : {}),
  ...(typeof messageDoc.clientReplyUuid === "string" &&
  messageDoc.clientReplyUuid.trim()
    ? { clientReplyUuid: messageDoc.clientReplyUuid.trim() }
    : {}),
  ...(typeof messageDoc.replyUuid === "string" && messageDoc.replyUuid.trim()
    ? { replyUuid: messageDoc.replyUuid.trim() }
    : {}),
  ...(typeof messageDoc.replyDeliveryStatus === "string" &&
  messageDoc.replyDeliveryStatus.trim()
    ? {
        replyDeliveryStatus: messageDoc.replyDeliveryStatus.trim(),
      }
    : {}),
  ...(typeof messageDoc.replyFailureReason === "string" &&
  messageDoc.replyFailureReason.trim()
    ? {
        replyFailureReason: messageDoc.replyFailureReason.trim(),
      }
    : {}),
  ...(typeof messageDoc.failedConnectionIdentifier === "string" &&
  messageDoc.failedConnectionIdentifier.trim()
    ? {
        failedConnectionIdentifier:
          messageDoc.failedConnectionIdentifier.trim(),
      }
    : {}),
});

const serializeBoardDisplayItem = (item) => ({
  id: item.id,
  source: item.source,
  sourceLabel: item.sourceLabel,
  author: item.author,
  text: item.text,
  timestamp: item.timestamp,
});

const serializeBoardPostForViewer = (postDoc, viewerAuthorId) => {
  const normalizedViewerAuthorId = normalizeBoardParticipantId(viewerAuthorId);
  const normalizedPostAuthorId = normalizeBoardParticipantId(postDoc.authorId);
  const isOwnedByViewer =
    Boolean(normalizedViewerAuthorId) &&
    normalizedViewerAuthorId === normalizedPostAuthorId;

  return {
    ...serializeBoardPost(postDoc),
    authorId: isOwnedByViewer ? normalizedPostAuthorId : "",
  };
};

// Configure Cloudinary
cloudinary.config({
  cloud_name: "portable-media",
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configure Mux
let mux;
if (process.env.MUX_TOKEN_ID && process.env.MUX_TOKEN_SECRET) {
  mux = new Mux({
    tokenId: process.env.MUX_TOKEN_ID,
    tokenSecret: process.env.MUX_TOKEN_SECRET,
  });
}

canvaService = createCanvaService({
  getFirestore: getServerFirestore,
  getRealtimeDatabase: getServerRealtimeDatabase,
  getIntegrationsPath: getChurchIntegrationsPath,
  redirectBaseUrl: frontEndHost,
  httpClient: axios,
  cloudinaryClient: cloudinary,
  getMuxClient: () => mux,
  storageQuota: churchStorageQuota,
});

const providerStorageService = createProviderStorageService({
  cloudinaryClient: cloudinary,
  getMuxClient: () => mux,
  storageQuota: churchStorageQuota,
});

planningCenterService = createPlanningCenterService({
  getFirestore: getServerFirestore,
  getRealtimeDatabase: getServerRealtimeDatabase,
  getIntegrationsPath: getChurchIntegrationsPath,
  redirectBaseUrl: frontEndHost,
  httpClient: axios,
});

app.post(
  "/api/webhooks/resend",
  express.raw({ type: "application/json", limit: "1mb" }),
  authHandlers.handleResendWebhook,
);

app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ limit: "10mb", extended: true }));
app.use(session(authSessionConfig));

app.use(
  cors({
    origin: (origin, callback) => {
      // No Origin: non-browser clients, Electron, curl, etc.
      if (!origin || origin === "null") {
        callback(null, true);
        return;
      }
      if (origin.startsWith("file://")) {
        callback(null, true);
        return;
      }
      if (corsAllowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Origin",
      "X-Requested-With",
      "Content-Type",
      "Accept",
      "x-workstation-token",
      "x-display-token",
      "x-support-token",
      "x-csrf-token",
      "x-song-audio-id",
      "x-song-audio-key",
      "Authorization",
    ],
    credentials: true,
  }),
);

// API calls
app.get("/api/auth/me", authHandlers.getAuthMe);
app.get("/api/auth/shared-data-token", authHandlers.createSharedDataToken);
app.post("/api/auth/churches/create", authHandlers.createChurchAccount);
app.post("/api/auth/session", authHandlers.createHumanSession);
app.post("/api/auth/desktop/start", authHandlers.startDesktopAuth);
app.post("/api/auth/desktop/complete", authHandlers.completeDesktopAuth);
app.post("/api/auth/desktop/status", authHandlers.getDesktopAuthStatus);
app.post("/api/auth/desktop/exchange", authHandlers.exchangeDesktopAuth);
app.post("/api/device-pairing-requests/start", authHandlers.startDevicePairingRequest);
app.post("/api/device-pairing-requests/status", authHandlers.getDevicePairingRequestStatus);
app.get("/api/device-pairing-requests/:requestId", authHandlers.getDevicePairingRequest);
app.post("/api/auth/resend-email-code", authHandlers.resendEmailCode);
app.post("/api/auth/email-code-hint", authHandlers.getEmailCodeHint);
app.post("/api/auth/verify-email-code", authHandlers.verifyEmailCode);
app.post("/api/auth/logout", authHandlers.logout);
app.post("/api/auth/forgot-password", authHandlers.forgotPassword);
app.post("/api/support/contact", authHandlers.submitSupportContact);
app.post("/api/sms-consent", authHandlers.submitSmsConsent);
app.post("/api/sms-consent/verify", authHandlers.verifySmsConsent);
app.post("/api/sms-consent/:churchId", authHandlers.submitSmsConsent);
app.post("/api/sms-consent/:churchId/verify", authHandlers.verifySmsConsent);
// Twilio authenticates this endpoint with X-Twilio-Signature; it deliberately
// does not use browser session or CSRF authentication.
app.post(
  "/api/webhooks/twilio/sms-status",
  authHandlers.handleSmsStatusWebhook,
);
app.post(
  "/api/webhooks/twilio/sms-inbound",
  authHandlers.handleSmsInboundWebhook,
);
app.post("/api/auth/profile", authHandlers.updateOwnProfile);
app.post(
  "/api/auth/notification-preferences",
  authHandlers.updateOwnNotificationPreferences,
);
app.get("/api/devices/human", authHandlers.listTrustedHumanDevices);
app.post(
  "/api/devices/human/:deviceId/revoke",
  authHandlers.revokeTrustedHumanDevice,
);
app.get("/api/churches/:churchId/members", authHandlers.listChurchMembers);
app.get("/api/churches/:churchId/invites", authHandlers.listChurchInvites);
app.post(
  "/api/churches/:churchId/recovery-email",
  authHandlers.updateRecoveryEmail,
);
app.post("/api/churches/:churchId/branding", authHandlers.updateChurchBranding);
app.post(
  "/api/churches/:churchId/integrations",
  authHandlers.updateChurchIntegrations,
);
app.post(
  "/api/churches/:churchId/current-service-workspace",
  authHandlers.updateCurrentServiceWorkspace,
);

app.use("/api/churches/:churchId/chat", requireAppSession);
app.get("/api/churches/:churchId/chat/context", chatHandlers.getContext);
app.get("/api/churches/:churchId/chat/messages", chatHandlers.listMessages);
app.get("/api/churches/:churchId/chat/stream", chatHandlers.stream);
app.get(
  "/api/churches/:churchId/chat/messages/:messageId/image/:variant",
  chatHandlers.getImageUrl,
);
app.post(
  "/api/churches/:churchId/chat/typing",
  requireMutationCsrf,
  chatHandlers.updateTyping,
);
app.post(
  "/api/churches/:churchId/chat/images/upload",
  requireMutationCsrf,
  guardChatImageUpload,
  chatHandlers.createImageUpload,
);
app.post(
  "/api/churches/:churchId/chat/images/upload-from-app",
  requireMutationCsrf,
  guardChatImageUpload,
  parseChatImageBytes,
  chatHandlers.uploadImageFromApp,
);
app.post(
  "/api/churches/:churchId/chat/messages",
  requireMutationCsrf,
  guardChatImageFinalize,
  chatHandlers.createMessage,
);
app.patch(
  "/api/churches/:churchId/chat/messages/:messageId",
  requireMutationCsrf,
  chatHandlers.updateMessage,
);
app.delete(
  "/api/churches/:churchId/chat/messages/:messageId",
  requireMutationCsrf,
  chatHandlers.deleteMessage,
);
app.post(
  "/api/churches/:churchId/chat/messages/:messageId/reactions",
  requireMutationCsrf,
  chatHandlers.toggleReaction,
);

const respondRichLinkPreviewError = (res, error) => {
  if (error instanceof RichLinkPreviewInputError) {
    return res.status(400).json({ errorMessage: error.message });
  }
  if (error instanceof RichLinkPreviewUnavailableError) {
    return res.status(404).json({ errorMessage: error.message });
  }
  console.error("Error loading rich link preview:", error);
  return res.status(502).json({
    errorMessage:
      "Link details could not be loaded. You can still open the original link.",
  });
};

app.get("/api/link-previews", requireAppSession, async (req, res) => {
  try {
    const preview = await richLinkPreviewService.getPreview(req.query.url);
    return res.json({ preview });
  } catch (error) {
    return respondRichLinkPreviewError(res, error);
  }
});

app.get("/api/resources/resolve", requireAppSession, async (req, res) => {
  try {
    const descriptor = await externalResourceService.resolveRateLimited(
      req.query.url,
      req.appSession.actorId || req.ip || "unknown",
    );
    return res.json({ resource: descriptor });
  } catch (error) {
    if (error instanceof ExternalResourceError) {
      return res.status(error.statusCode).json({ error: error.message, code: error.code });
    }
    console.error("External resource resolution error:", error);
    return res.status(502).json({ error: "That resource could not be resolved." });
  }
});

// Media elements cannot attach the workstation/bearer headers used by the
// resolver request. Authorization therefore comes from the short-lived,
// target-bound capability issued only by authenticated /resolve requests; this
// is not an unrestricted URL proxy. It intentionally does not forward app
// cookies or third-party credentials to the upstream resource.
app.get("/api/resources/proxy", (req, res) => {
  void externalResourceService.handleProxy(req, res).catch((error) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (error instanceof ExternalResourceError) {
      res.status(error.statusCode).json({ error: error.message, code: error.code });
      return;
    }
    console.error("External resource proxy error:", error);
    res.status(502).json({ error: "That resource could not be loaded." });
  });
});

const respondYouTubeSearchError = (res, error) => {
  if (error instanceof YouTubeSearchInputError) {
    return res.status(400).json({ errorMessage: error.message });
  }
  if (error instanceof YouTubeSearchNotConfiguredError) {
    return res.status(503).json({
      errorMessage: "YouTube search is not configured on this server yet.",
    });
  }
  if (error instanceof YouTubeSearchUpstreamError) {
    console.error("Error searching YouTube:", error.cause);
  } else {
    console.error("Error searching YouTube:", error);
  }
  return res.status(502).json({
    errorMessage: "YouTube search is unavailable right now. Try again.",
  });
};

app.get("/api/youtube/search", requireAppSession, async (req, res) => {
  try {
    const result = await youtubeSearchService.search({
      title: req.query.title,
      artist: req.query.artist,
      album: req.query.album,
      query: req.query.query,
      forceRefresh:
        req.query.refresh === "true" || req.query.refresh === "1",
    });
    return res.json(result);
  } catch (error) {
    return respondYouTubeSearchError(res, error);
  }
});

// Kept for older clients while the provider-neutral endpoint rolls out.
app.get("/api/youtube/videos/:videoId", requireAppSession, async (req, res) => {
  try {
    const preview = await richLinkPreviewService.getPreview(
      `https://www.youtube.com/watch?v=${req.params.videoId}`,
    );
    return res.json({
      video: {
        videoId: preview.resourceId,
        title: preview.title,
        authorName: preview.creator || "",
        thumbnailUrl: preview.thumbnailUrl,
        thumbnailWidth: preview.thumbnailWidth,
        thumbnailHeight: preview.thumbnailHeight,
        watchUrl: preview.canonicalUrl,
        embedUrl: preview.embedUrl,
      },
    });
  } catch (error) {
    return respondRichLinkPreviewError(res, error);
  }
});
app.use("/api/churches/:churchId/song-audio", requireAppSession);

app.post(
  "/api/churches/:churchId/song-audio/:songId/upload",
  requireSongAudioEditAccess,
  guardSongAudioUpload,
  async (req, res) => {
    if (!assertSongAudioChurchAccess(req, res)) return;
    try {
      const result = await getSongAudioStorage().createUpload({
        churchId: req.params.churchId,
        songId: req.params.songId,
        upload: req.body,
      });
      res.json(result);
    } catch (error) {
      respondSongAudioError(res, "Error creating song audio upload:", error);
    }
  },
);

app.post(
  "/api/churches/:churchId/song-audio/:songId/complete",
  requireSongAudioEditAccess,
  async (req, res) => {
    if (!assertSongAudioChurchAccess(req, res)) return;
    try {
      const audio = await getSongAudioStorage().completeUpload({
        churchId: req.params.churchId,
        songId: req.params.songId,
        audio: req.body?.audio,
        previousAudio: req.body?.previousAudio,
      });
      res.json({ audio });
    } catch (error) {
      respondSongAudioError(res, "Error completing song audio upload:", error);
    }
  },
);

app.post(
  "/api/churches/:churchId/song-audio/:songId/upload-from-app",
  requireSongAudioEditAccess,
  // Reject over-quota uploads from Content-Length before express.raw allocates
  // and buffers as much as the full MP3 body.
  guardSongAudioUpload,
  parseSongAudioBytes,
  async (req, res) => {
    if (!assertSongAudioChurchAccess(req, res)) return;
    try {
      const audio = await getSongAudioStorage().uploadFromServer({
        churchId: req.params.churchId,
        songId: req.params.songId,
        upload: {
          fileName: req.query.fileName,
          contentType: req.get("content-type"),
        },
        body: req.body,
        audioId: req.get("x-song-audio-upload-id"),
        previousAudio:
          req.get("x-song-audio-id") || req.get("x-song-audio-key")
            ? {
                id: req.get("x-song-audio-id"),
                key: req.get("x-song-audio-key"),
              }
            : undefined,
      });
      res.json({ audio });
    } catch (error) {
      respondSongAudioError(res, "Error uploading song audio from app:", error);
    }
  },
);

app.get(
  "/api/churches/:churchId/song-audio/:songId/:audioId/url",
  async (req, res) => {
    if (!assertSongAudioChurchAccess(req, res)) return;
    try {
      const result = await getSongAudioStorage().createReadUrl({
        churchId: req.params.churchId,
        songId: req.params.songId,
        audio: {
          id: req.params.audioId,
          key: req.query.key,
          fileName: req.query.fileName,
        },
        disposition: req.query.disposition,
      });
      res.json(result);
    } catch (error) {
      respondSongAudioError(res, "Error creating song audio URL:", error);
    }
  },
);

app.delete(
  "/api/churches/:churchId/song-audio/:songId/:audioId",
  requireSongAudioEditAccess,
  async (req, res) => {
    if (!assertSongAudioChurchAccess(req, res)) return;
    try {
      await getSongAudioStorage().remove({
        churchId: req.params.churchId,
        songId: req.params.songId,
        getStoredSize: () => getStoredSongAudioSize(req.params.churchId, req.params.songId),
        audio: {
          id: req.params.audioId,
          key: req.body?.key,
        },
      });
      res.json({ success: true });
    } catch (error) {
      respondSongAudioError(res, "Error deleting song audio:", error);
    }
  },
);

app.use("/api/churches/:churchId/resources", requireAppSession);
app.get(
  "/api/churches/:churchId/storage-quota",
  requireAppSession,
  (req, res) => getChurchResourceHandlers().storageQuota(req, res),
);
app.get(
  "/api/churches/:churchId/resources",
  requireChurchResourceBrowseAccess,
  (req, res) => getChurchResourceHandlers().list(req, res),
);
app.get(
  "/api/churches/:churchId/resources/:resourceId",
  requireChurchResourceReferenceReadAccess,
  (req, res) => getChurchResourceHandlers().get(req, res),
);
app.post(
  "/api/churches/:churchId/resources/upload",
  requireChurchResourceEditAccess,
  requireMutationCsrf,
  guardChurchResourceUpload,
  (req, res) => getChurchResourceHandlers().createUpload(req, res),
);
app.post(
  "/api/churches/:churchId/resources/:resourceId/complete",
  requireChurchResourceEditAccess,
  requireMutationCsrf,
  (req, res) => getChurchResourceHandlers().completeUpload(req, res),
);
app.post(
  "/api/churches/:churchId/resources/upload-from-app",
  requireChurchResourceEditAccess,
  requireMutationCsrf,
  // Apply the same quota before express.raw buffers the Electron fallback.
  guardChurchResourceUpload,
  parseChurchResourceBytes,
  (req, res) => getChurchResourceHandlers().uploadFromApp(req, res),
);
app.get(
  "/api/churches/:churchId/resources/:resourceId/url",
  requireChurchResourceReferenceReadAccess,
  (req, res) => getChurchResourceHandlers().createUrl(req, res),
);
app.patch(
  "/api/churches/:churchId/resources/:resourceId",
  requireChurchResourceEditAccess,
  requireMutationCsrf,
  (req, res) => getChurchResourceHandlers().update(req, res),
);
app.delete(
  "/api/churches/:churchId/resources/:resourceId",
  requireChurchResourceEditAccess,
  requireMutationCsrf,
  (req, res) => getChurchResourceHandlers().remove(req, res),
);
app.get(
  "/api/churches/:churchId/teams/bootstrap",
  authHandlers.getTeamsBootstrap,
);
app.get(
  "/api/churches/:churchId/notification-intents",
  authHandlers.listIntents,
);
app.get(
  "/api/churches/:churchId/notification-intents/:intentId/preview",
  authHandlers.getIntentPreview,
);
app.post(
  "/api/churches/:churchId/notification-intents/:intentId/send",
  authHandlers.sendIntent,
);
app.post(
  "/api/churches/:churchId/notification-batches/prepare",
  authHandlers.prepareAvailabilityBatch,
);
app.get(
  "/api/churches/:churchId/notification-batches/:batchId",
  authHandlers.getAvailabilityBatch,
);
app.post(
  "/api/churches/:churchId/notification-batches/:batchId/dispatch",
  authHandlers.dispatchAvailabilityBatch,
);
app.post(
  "/api/churches/:churchId/notification-intents/replacement-invitation",
  authHandlers.prepareReplacementInvitation,
);
app.post(
  "/api/churches/:churchId/notification-intents/:intentId/resolve-replacement",
  authHandlers.resolveReplacementInvitation,
);
app.get(
  "/api/churches/:churchId/team-intake/forms/:formId/sms-attempts",
  authHandlers.getTeamIntakeSmsAttempts,
);
app.post(
  "/api/churches/:churchId/team-intake/forms",
  authHandlers.createTeamIntakeForm,
);
app.post(
  "/api/churches/:churchId/team-intake/forms/:formId",
  authHandlers.updateTeamIntakeForm,
);
app.post(
  "/api/churches/:churchId/team-intake/forms/:formId/link",
  authHandlers.getTeamIntakeFormLink,
);
app.post(
  "/api/churches/:churchId/team-intake/forms/:formId/recipients",
  authHandlers.createTeamIntakeRecipients,
);
app.post(
  "/api/churches/:churchId/team-intake/recipients/:recipientId/link",
  authHandlers.getTeamIntakeRecipientLink,
);
app.post(
  "/api/churches/:churchId/team-intake/recipients/:recipientId/sms",
  authHandlers.sendTeamIntakeRecipientSms,
);
app.post(
  "/api/churches/:churchId/team-intake/recipients/:recipientId/revoke",
  authHandlers.revokeTeamIntakeRecipient,
);
app.post(
  "/api/churches/:churchId/team-intake/submissions/:submissionId",
  authHandlers.updateTeamIntakeSubmission,
);
app.get("/api/team-intake/preview", authHandlers.getTeamIntakePreview);
app.post("/api/team-intake/submit", authHandlers.submitTeamIntake);
app.get("/api/team-intake/recipient-preview", (req, res) => {
  req.teamIntakeRecipientOnly = true;
  return authHandlers.getTeamIntakePreview(req, res);
});
app.post("/api/team-intake/recipient-submit", (req, res) => {
  req.teamIntakeRecipientOnly = true;
  return authHandlers.submitTeamIntake(req, res);
});
app.post(
  "/api/churches/:churchId/team-roster-members",
  authHandlers.createTeamRosterMember,
);
app.post(
  "/api/churches/:churchId/team-roster-members/:memberId",
  authHandlers.updateTeamRosterMember,
);
app.post(
  "/api/churches/:churchId/team-roster-members/:memberId/archive",
  authHandlers.archiveTeamRosterMember,
);
app.post(
  "/api/churches/:churchId/team-roster-members/:memberId/delete",
  authHandlers.deleteTeamRosterMember,
);
app.get(
  "/api/churches/:churchId/my-team-assignments",
  authHandlers.getMyTeamAssignments,
);
// Self-scoped: resolves the member from the session, not a :memberId, so a
// schedule-only volunteer can maintain their own availability without any
// teams permission.
app.post(
  "/api/churches/:churchId/my-blockout-dates",
  authHandlers.updateMyBlockoutDates,
);
// Also self-scoped: the slot must be held by the session's own member.
app.post(
  "/api/churches/:churchId/my-assignments/respond",
  authHandlers.respondToMyAssignment,
);
// Public and unauthenticated by design: volunteers often have no account, so a
// signed single-purpose token is the only way they can answer at all.
app.post(
  "/api/churches/:churchId/team-schedules/:scheduleId/send",
  authHandlers.sendTeamSchedule,
);
app.get(
  "/api/team-schedule-response",
  authHandlers.getAssignmentResponseContext,
);
app.post(
  "/api/team-schedule-response",
  authHandlers.respondToAssignmentByToken,
);
// Sends mail, so it is rate limited harder than answering. The address comes
// from the roster record the token names, never from the request body.
app.post(
  "/api/team-schedule-response/invite",
  authHandlers.requestAccountFromAssignmentToken,
);
app.post(
  "/api/churches/:churchId/team-roster-members/:memberId/link",
  authHandlers.linkTeamRosterMember,
);
app.post(
  "/api/churches/:churchId/team-roster-members/:memberId/unlink",
  authHandlers.unlinkTeamRosterMember,
);
app.post(
  "/api/churches/:churchId/team-positions",
  authHandlers.createTeamPosition,
);
// Registered before the :positionId route so "reorder" is not read as a positionId.
app.post(
  "/api/churches/:churchId/team-positions/reorder",
  authHandlers.reorderTeamPositions,
);
app.post(
  "/api/churches/:churchId/team-positions/:positionId",
  authHandlers.updateTeamPosition,
);
app.post(
  "/api/churches/:churchId/team-positions/:positionId/archive",
  authHandlers.archiveTeamPosition,
);
app.post(
  "/api/churches/:churchId/team-positions/:positionId/delete",
  authHandlers.deleteTeamPosition,
);
app.post("/api/churches/:churchId/team-roles", authHandlers.createTeamRole);
app.post(
  "/api/churches/:churchId/team-roles/:roleId",
  authHandlers.updateTeamRole,
);
app.post(
  "/api/churches/:churchId/team-roles/:roleId/archive",
  authHandlers.archiveTeamRole,
);
app.post(
  "/api/churches/:churchId/team-roles/:roleId/delete",
  authHandlers.deleteTeamRole,
);
app.post(
  "/api/churches/:churchId/team-qualification-areas",
  authHandlers.createTeamQualificationArea,
);
app.post(
  "/api/churches/:churchId/team-qualification-areas/:areaId",
  authHandlers.updateTeamQualificationArea,
);
app.post(
  "/api/churches/:churchId/team-qualification-areas/:areaId/archive",
  authHandlers.archiveTeamQualificationArea,
);
app.post(
  "/api/churches/:churchId/team-qualification-areas/:areaId/delete",
  authHandlers.deleteTeamQualificationArea,
);
app.post(
  "/api/churches/:churchId/team-qualification-levels",
  authHandlers.createTeamQualificationLevel,
);
app.post(
  "/api/churches/:churchId/team-qualification-levels/:levelId",
  authHandlers.updateTeamQualificationLevel,
);
app.post(
  "/api/churches/:churchId/team-qualification-levels/:levelId/archive",
  authHandlers.archiveTeamQualificationLevel,
);
app.post(
  "/api/churches/:churchId/team-qualification-levels/:levelId/delete",
  authHandlers.deleteTeamQualificationLevel,
);
app.post("/api/churches/:churchId/teams", authHandlers.createTeam);
app.post("/api/churches/:churchId/teams/:teamId", authHandlers.updateTeam);
app.post(
  "/api/churches/:churchId/teams/:teamId/archive",
  authHandlers.archiveTeam,
);
app.post(
  "/api/churches/:churchId/teams/:teamId/delete",
  authHandlers.deleteTeam,
);
app.get(
  "/api/churches/:churchId/team-schedules/:scheduleId",
  authHandlers.getTeamScheduleDetail,
);
app.post(
  "/api/churches/:churchId/team-schedules",
  authHandlers.createTeamSchedule,
);
app.post(
  "/api/churches/:churchId/team-schedules/:scheduleId",
  authHandlers.updateTeamSchedule,
);
app.post(
  "/api/churches/:churchId/team-schedules/:scheduleId/archive",
  authHandlers.archiveTeamSchedule,
);
app.post(
  "/api/churches/:churchId/team-schedules/:scheduleId/delete",
  authHandlers.deleteTeamSchedule,
);
app.post(
  "/api/churches/:churchId/team-schedules/:scheduleId/assignments",
  authHandlers.updateTeamScheduleAssignment,
);
app.post(
  "/api/churches/:churchId/team-schedules/:scheduleId/assignment-microphones",
  authHandlers.updateTeamScheduleAssignmentMicrophones,
);
app.post(
  "/api/churches/:churchId/team-schedules/:scheduleId/additional-position-slots",
  authHandlers.addTeamSchedulePositionSlot,
);
app.post(
  "/api/churches/:churchId/team-schedules/:scheduleId/additional-position-slots/remove",
  authHandlers.removeTeamSchedulePositionSlot,
);
app.post(
  "/api/churches/:churchId/team-schedules/:scheduleId/assignment-swaps",
  authHandlers.updateTeamScheduleAssignmentSwap,
);
app.post(
  "/api/churches/:churchId/team-schedules/:scheduleId/link",
  authHandlers.getTeamSchedulePublicLink,
);
app.get("/api/team-schedule/public", authHandlers.getPublicTeamSchedule);
app.get("/api/churches/:churchId/service-plans", authHandlers.listServicePlans);
app.get(
  "/api/churches/:churchId/service-plans/:planKey/assignments",
  authHandlers.getServicePlanAssignments,
);
app.get(
  "/api/churches/:churchId/service-plans/:planKey",
  authHandlers.getServicePlan,
);
app.get(
  "/api/churches/:churchId/service-plans/:planKey/public-snapshot",
  authHandlers.getServicePlanPublicSnapshot,
);
app.get(
  "/api/churches/:churchId/service-plans/:planKey/viewer",
  authHandlers.getServicePlanViewer,
);
app.post(
  "/api/churches/:churchId/service-plans/:planKey",
  authHandlers.saveServicePlan,
);
app.post(
  "/api/churches/:churchId/service-plans/:planKey/publish",
  authHandlers.publishServicePlan,
);
app.post(
  "/api/churches/:churchId/service-plans/:planKey/email",
  authHandlers.sendServicePlanShareEmail,
);
app.post(
  "/api/churches/:churchId/service-plans/:planKey/unpublish",
  authHandlers.unpublishServicePlan,
);
app.post(
  "/api/churches/:churchId/service-plans/:planKey/live",
  authHandlers.updateServicePlanPublicLive,
);
app.post(
  "/api/churches/:churchId/service-plans/:planKey/delete",
  authHandlers.deleteServicePlan,
);
app.get(
  "/api/churches/:churchId/service-plan-templates",
  authHandlers.listServicePlanTemplates,
);
app.post(
  "/api/churches/:churchId/service-plan-templates",
  authHandlers.saveServicePlanTemplate,
);
app.post(
  "/api/churches/:churchId/service-plan-templates/:templateId/delete",
  authHandlers.deleteServicePlanTemplate,
);
app.get(
  "/api/churches/:churchId/service-plan-assignment-history",
  authHandlers.getServicePlanAssignmentHistory,
);
app.post(
  "/api/churches/:churchId/service-plan-assignment-history",
  authHandlers.saveServicePlanAssignmentHistory,
);
app.get(
  "/api/churches/:churchId/service-plan-microphones",
  authHandlers.getServicePlanMicrophones,
);
app.post(
  "/api/churches/:churchId/service-plan-microphones",
  authHandlers.saveServicePlanMicrophones,
);
app.get("/api/service-plan/public", authHandlers.getPublicServicePlan);
app.get(
  "/api/service-plan/public/stream",
  authHandlers.openPublicServicePlanStream,
);
app.post("/api/churches/:churchId/invites", authHandlers.createInvite);
app.post(
  "/api/churches/:churchId/invites/:inviteId/resend",
  authHandlers.resendChurchInvite,
);
app.post(
  "/api/churches/:churchId/invites/:inviteId/access",
  authHandlers.updateInviteAccess,
);
app.post(
  "/api/churches/:churchId/invites/:inviteId/revoke",
  authHandlers.revokeChurchInvite,
);
app.delete(
  "/api/churches/:churchId/invites/:inviteId",
  authHandlers.removeExpiredChurchInvite,
);
app.get("/api/invites/preview", authHandlers.getInvitePreview);
app.post("/api/invites/accept", authHandlers.acceptInvite);
app.post(
  "/api/churches/:churchId/members/:userId/make-admin",
  authHandlers.makeAdmin,
);
app.post(
  "/api/churches/:churchId/members/:userId/remove-admin",
  authHandlers.removeAdmin,
);
app.post(
  "/api/churches/:churchId/members/:userId/remove",
  authHandlers.removeMember,
);
app.post(
  "/api/churches/:churchId/members/:userId/access",
  authHandlers.updateMemberAccess,
);
app.post(
  "/api/churches/:churchId/request-admin-access",
  authHandlers.requestAdminAccess,
);
app.post("/api/recovery/confirm", authHandlers.confirmRecovery);
app.post(
  "/api/support/churches/:churchId/recover-admin",
  authHandlers.recoverAdmin,
);
app.post(
  "/api/churches/:churchId/workstation-pairings",
  authHandlers.createWorkstationPairing,
);
app.post(
  "/api/churches/:churchId/device-pairing-requests/:requestId/approve",
  authHandlers.approveDevicePairingRequest,
);
app.post(
  "/api/device-pairing-requests/exchange",
  authHandlers.exchangeDevicePairingRequest,
);
app.post(
  "/api/workstation-pairings/redeem",
  authHandlers.redeemWorkstationPairing,
);
app.get("/api/churches/:churchId/workstations", authHandlers.listWorkstations);
app.post(
  "/api/churches/:churchId/workstations/:deviceId/revoke",
  authHandlers.revokeWorkstation,
);
app.post(
  "/api/workstations/:deviceId/operator",
  authHandlers.updateWorkstationOperator,
);
app.post("/api/workstations/:deviceId/unlink", authHandlers.unlinkWorkstation);
app.post(
  "/api/churches/:churchId/display-pairings",
  authHandlers.createDisplayPairing,
);
app.post(
  "/api/churches/:churchId/pairing-code-email",
  authHandlers.sendPairingCodeEmail,
);
app.post("/api/display-pairings/redeem", authHandlers.redeemDisplayPairing);
app.get(
  "/api/churches/:churchId/display-devices",
  authHandlers.listDisplayDevices,
);
app.post(
  "/api/churches/:churchId/display-devices/:deviceId/settings",
  authHandlers.updateDisplayDeviceSettings,
);
app.post(
  "/api/churches/:churchId/display-devices/:deviceId/revoke",
  authHandlers.revokeDisplayDevice,
);
app.get("/api/restream/oauth/callback", async (req, res) => {
  try {
    const result = await restreamService.completeConnect({
      state: req.query.state,
      code: req.query.code,
      denied: !req.query.code,
    });
    const redirectParams = new URLSearchParams({
      status: "success",
      returnTo: result.returnTo || "/account?tab=integrations",
    });
    if (result.accountLabel) {
      redirectParams.set("accountLabel", result.accountLabel);
    }
    res.redirect(
      `${frontEndHost.replace(/\/$/, "")}/#/restream/connect-complete?${redirectParams.toString()}`,
    );
  } catch (error) {
    console.error("Error completing Restream connection:", error);
    const redirectParams = new URLSearchParams({
      status: "error",
      message:
        "The Restream connection did not finish. Return to WorshipSync and try again.",
      returnTo: "/account?tab=integrations",
    });
    res.redirect(
      `${frontEndHost.replace(/\/$/, "")}/#/restream/connect-complete?${redirectParams.toString()}`,
    );
  }
});
app.use(
  "/api/churches/:churchId/restream",
  requireAppSession,
  requireFullAppAccess,
);

app.get("/api/churches/:churchId/restream/connect", async (req, res) => {
  try {
    if (req.appSession.churchId !== req.params.churchId) {
      return res.status(403).json({ error: "That church is not available." });
    }

    const { authorizeUrl } = await restreamService.startConnect({
      churchId: req.params.churchId,
      database: req.appSession.database,
      userId: req.appSession.userId,
      returnTo: restreamParseReturnTo(req.query.returnTo),
    });
    res.redirect(authorizeUrl);
  } catch (error) {
    respondRestreamJsonError(res, "Error starting Restream connection:", error);
  }
});

app.get("/api/churches/:churchId/restream/connect-url", async (req, res) => {
  try {
    if (req.appSession.churchId !== req.params.churchId) {
      return res.status(403).json({ error: "That church is not available." });
    }

    const result = await restreamService.startConnect({
      churchId: req.params.churchId,
      database: req.appSession.database,
      userId: req.appSession.userId,
      returnTo: restreamParseReturnTo(req.query.returnTo),
    });
    res.json(result);
  } catch (error) {
    respondRestreamJsonError(
      res,
      "Error starting Restream connection URL request:",
      error,
    );
  }
});

app.post(
  "/api/churches/:churchId/restream/connect-status",
  async (req, res) => {
    try {
      if (req.appSession.churchId !== req.params.churchId) {
        return res.status(403).json({ error: "That church is not available." });
      }

      const { connectRequestId, connectRequestSecret } =
        readRestreamConnectStatusBody(req.body);
      const result = await restreamService.getConnectStatus({
        connectRequestId,
        connectRequestSecret,
      });
      res.json(result);
    } catch (error) {
      respondRestreamJsonError(
        res,
        "Error loading Restream connect status:",
        error,
      );
    }
  },
);

app.post("/api/churches/:churchId/restream/disconnect", async (req, res) => {
  try {
    if (req.appSession.churchId !== req.params.churchId) {
      return res.status(403).json({ error: "That church is not available." });
    }

    await restreamService.disconnect({
      churchId: req.params.churchId,
      database: req.appSession.database,
    });
    res.json({ success: true });
  } catch (error) {
    respondRestreamJsonError(res, "Error disconnecting Restream:", error);
  }
});

app.get("/api/churches/:churchId/restream/session", async (req, res) => {
  try {
    if (req.appSession.churchId !== req.params.churchId) {
      return res.status(403).json({ error: "That church is not available." });
    }

    const status = await restreamService.getStatusForChurch({
      churchId: req.params.churchId,
      database: req.appSession.database,
    });
    if (status.session.enabled) {
      void restreamService.ensureReceiver(req.params.churchId);
    }
    res.json(status);
  } catch (error) {
    respondRestreamJsonError(
      res,
      "Error loading Restream session status:",
      error,
    );
  }
});

app.get("/api/churches/:churchId/restream/messages", async (req, res) => {
  try {
    if (req.appSession.churchId !== req.params.churchId) {
      return res.status(403).json({ error: "That church is not available." });
    }

    const messages = await restreamService.listCurrentSessionMessages({
      churchId: req.params.churchId,
      database: req.appSession.database,
    });
    res.json({
      messages: messages.map(serializeRestreamMessage),
    });
  } catch (error) {
    respondRestreamJsonError(
      res,
      "Error loading Restream session messages:",
      error,
    );
  }
});

app.get("/api/churches/:churchId/restream/stream", async (req, res) => {
  if (req.appSession.churchId !== req.params.churchId) {
    return res.status(403).json({ error: "That church is not available." });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write(
    `data: ${JSON.stringify({
      type: "connected",
      churchId: req.params.churchId,
    })}\n\n`,
  );

  restreamService.addSseClient(req.params.churchId, res);

  const heartbeat = setInterval(() => {
    res.write(": keep-alive\n\n");
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    restreamService.removeSseClient(req.params.churchId, res);
    res.end();
  });
});

app.post(
  "/api/churches/:churchId/restream/messages/:messageId/hidden",
  async (req, res) => {
    try {
      if (req.appSession.churchId !== req.params.churchId) {
        return res.status(403).json({ error: "That church is not available." });
      }

      await restreamService.setMessageHidden({
        churchId: req.params.churchId,
        database: req.appSession.database,
        messageId: req.params.messageId,
        hidden: typeof req.body?.value === "boolean" ? req.body.value : true,
        actorName: req.appSession.username,
        actorId: req.appSession.userId,
      });

      const messages = await restreamService.listCurrentSessionMessages({
        churchId: req.params.churchId,
        database: req.appSession.database,
      });
      const updated = messages.find(
        (message) => message.id === req.params.messageId,
      );
      res.json({ message: updated ? serializeRestreamMessage(updated) : null });
    } catch (error) {
      respondRestreamJsonError(
        res,
        "Error updating Restream hidden state:",
        error,
      );
    }
  },
);

app.post(
  "/api/churches/:churchId/restream/messages/:messageId/highlighted",
  async (req, res) => {
    try {
      if (req.appSession.churchId !== req.params.churchId) {
        return res.status(403).json({ error: "That church is not available." });
      }

      await restreamService.setMessageHighlighted({
        churchId: req.params.churchId,
        database: req.appSession.database,
        messageId: req.params.messageId,
        highlighted:
          typeof req.body?.value === "boolean" ? req.body.value : true,
        actorName: req.appSession.username,
        actorId: req.appSession.userId,
      });

      const messages = await restreamService.listCurrentSessionMessages({
        churchId: req.params.churchId,
        database: req.appSession.database,
      });
      const updated = messages.find(
        (message) => message.id === req.params.messageId,
      );
      res.json({ message: updated ? serializeRestreamMessage(updated) : null });
    } catch (error) {
      respondRestreamJsonError(
        res,
        "Error updating Restream highlight state:",
        error,
      );
    }
  },
);

app.post("/api/churches/:churchId/restream/session/reset", async (req, res) => {
  try {
    if (req.appSession.churchId !== req.params.churchId) {
      return res.status(403).json({ error: "That church is not available." });
    }

    await restreamService.resetSession({
      churchId: req.params.churchId,
      database: req.appSession.database,
      reason: "manual_reset",
    });
    const status = await restreamService.getStatusForChurch({
      churchId: req.params.churchId,
      database: req.appSession.database,
    });
    res.json(status);
  } catch (error) {
    respondRestreamJsonError(res, "Error resetting Restream session:", error);
  }
});

app.post(
  "/api/churches/:churchId/restream/session/keep-current",
  async (req, res) => {
    try {
      if (req.appSession.churchId !== req.params.churchId) {
        return res.status(403).json({ error: "That church is not available." });
      }

      const status = await restreamService.dismissSessionSuggestion({
        churchId: req.params.churchId,
        database: req.appSession.database,
      });
      res.json(status);
    } catch (error) {
      respondRestreamJsonError(
        res,
        "Error keeping the current Restream session:",
        error,
      );
    }
  },
);

app.get("/api/youtube/oauth/callback", async (req, res) => {
  try {
    const result = await youtubeLiveChatService.completeConnect({
      state: req.query.state,
      code: req.query.code,
      denied: !req.query.code,
    });
    const redirectParams = new URLSearchParams({
      status: "success",
      returnTo: result.returnTo || "/account/integrations",
    });
    if (result.accountLabel) {
      redirectParams.set("accountLabel", result.accountLabel);
    }
    if (result.desktop) {
      redirectParams.set("desktop", "1");
    }
    res.redirect(
      `${frontEndHost.replace(/\/$/, "")}/#/youtube/connect-complete?${redirectParams.toString()}`,
    );
  } catch (error) {
    console.error("Error completing YouTube connection:", error);
    const redirectParams = new URLSearchParams({
      status: "error",
      message:
        "The YouTube connection did not finish. Return to WorshipSync and try again.",
      returnTo:
        typeof error?.returnTo === "string" && error.returnTo.startsWith("/")
          ? error.returnTo
          : "/account/integrations",
    });
    if (error?.desktop) {
      redirectParams.set("desktop", "1");
    }
    res.redirect(
      `${frontEndHost.replace(/\/$/, "")}/#/youtube/connect-complete?${redirectParams.toString()}`,
    );
  }
});

app.use(
  "/api/churches/:churchId/youtube",
  requireAppSession,
  requireFullAppAccess,
);

app.get("/api/churches/:churchId/youtube/connect-url", async (req, res) => {
  try {
    if (req.appSession.churchId !== req.params.churchId) {
      return res.status(403).json({ error: "That church is not available." });
    }

    const result = await youtubeLiveChatService.startConnect({
      churchId: req.params.churchId,
      database: req.appSession.database,
      userId: req.appSession.userId,
      returnTo: youtubeParseReturnTo(req.query.returnTo),
      desktop:
        req.query.desktop === "1" ||
        String(req.query.desktop || "").toLowerCase() === "true",
    });
    res.json(result);
  } catch (error) {
    respondYouTubeJsonError(
      res,
      "Error starting YouTube connection URL request:",
      error,
    );
  }
});

app.post("/api/churches/:churchId/youtube/connect-status", async (req, res) => {
  try {
    if (req.appSession.churchId !== req.params.churchId) {
      return res.status(403).json({ error: "That church is not available." });
    }

    const { connectRequestId, connectRequestSecret } =
      readYouTubeConnectStatusBody(req.body);
    const result = await youtubeLiveChatService.getConnectStatus({
      connectRequestId,
      connectRequestSecret,
    });
    res.json(result);
  } catch (error) {
    respondYouTubeJsonError(
      res,
      "Error loading YouTube connect status:",
      error,
    );
  }
});

app.post("/api/churches/:churchId/youtube/disconnect", async (req, res) => {
  try {
    if (req.appSession.churchId !== req.params.churchId) {
      return res.status(403).json({ error: "That church is not available." });
    }

    await youtubeLiveChatService.disconnect({
      churchId: req.params.churchId,
    });
    res.json({ success: true });
  } catch (error) {
    respondYouTubeJsonError(res, "Error disconnecting YouTube:", error);
  }
});

app.get("/api/churches/:churchId/youtube/status", async (req, res) => {
  try {
    if (req.appSession.churchId !== req.params.churchId) {
      return res.status(403).json({ error: "That church is not available." });
    }

    const status = await youtubeLiveChatService.getStatusForChurch({
      churchId: req.params.churchId,
    });
    res.json(status);
  } catch (error) {
    respondYouTubeJsonError(res, "Error loading YouTube status:", error);
  }
});

app.post(
  "/api/churches/:churchId/youtube/live-chat/messages",
  async (req, res) => {
    try {
      if (req.appSession.churchId !== req.params.churchId) {
        return res.status(403).json({ error: "That church is not available." });
      }

      const messageText =
        typeof req.body?.messageText === "string"
          ? req.body.messageText
          : typeof req.body?.text === "string"
            ? req.body.text
            : "";
      const videoIdOrUrl =
        typeof req.body?.videoId === "string"
          ? req.body.videoId
          : typeof req.body?.videoUrl === "string"
            ? req.body.videoUrl
            : "";

      const result = await youtubeLiveChatService.sendLiveChatMessage({
        churchId: req.params.churchId,
        messageText,
        videoIdOrUrl,
      });
      res.json(result);
    } catch (error) {
      respondYouTubeJsonError(
        res,
        "Error posting YouTube live chat message:",
        error,
      );
    }
  },
);

const respondCanvaError = (res, context, error) => {
  console.error(context, error);
  res.status(error?.statusCode || 500).json({
    error:
      error?.statusCode && error?.message
        ? error.message
        : "Canva could not complete that request. Try again.",
    ...(error?.code ? { code: error.code } : {}),
    ...(error?.provider ? { quota: error.provider } : {}),
  });
};

const getCanvaReplacementCandidates = async ({ churchId, designId, preferredMediaIds = [] }) => {
  if (!process.env.COUCHDB_HOST || !process.env.COUCHDB_USER || !process.env.COUCHDB_PASSWORD) {
    return [];
  }
  const database = toWorshipSyncContentDbName(churchId);
  const url = `https://${process.env.COUCHDB_HOST}/${encodeURIComponent(database)}/media`;
  let mediaDocument;
  try {
    const response = await axios.get(url, {
      auth: { username: process.env.COUCHDB_USER, password: process.env.COUCHDB_PASSWORD },
    });
    mediaDocument = response.data;
  } catch (error) {
    if (error?.response?.status === 404) return [];
    throw error;
  }
  const preferred = new Set(preferredMediaIds);
  return (Array.isArray(mediaDocument?.list) ? mediaDocument.list : [])
    .flatMap((media) => {
      const source = media?.canvaSource;
      if (source?.designId !== designId || !Array.isArray(source.pageNumbers)) return [];
      const provider = media?.providerStorage?.provider === "mux" || media?.source === "mux"
        ? "muxMinutes"
        : media?.providerStorage?.provider === "cloudinary" || media?.source === "cloudinary"
          ? "cloudinaryBytes"
          : "";
      const assetId = provider === "mux"
        ? media?.providerStorage?.assetId || media?.muxAssetId
        : provider === "cloudinary"
          ? media?.providerStorage?.publicId || media?.publicId
          : "";
      if (!provider || typeof assetId !== "string" || !assetId.trim()) return [];
      return [{
        provider,
        assetId: assetId.trim(),
        mediaId: String(media.id || ""),
        revision: Number(source.revision) || 0,
        pageNumbers: source.pageNumbers.map(Number).filter(Number.isInteger),
        preferred: preferred.has(String(media.id || "")),
      }];
    });
};

app.get("/api/canva/oauth/callback", async (req, res) => {
  try {
    const result = await canvaService.completeConnect({
      state: req.query.state,
      code: req.query.code,
      denied: Boolean(req.query.error) || !req.query.code,
    });
    const params = new URLSearchParams({
      status: "success",
      returnTo: result.returnTo || "/account/integrations",
      ...(result.accountLabel ? { accountLabel: result.accountLabel } : {}),
      ...(result.desktop ? { desktop: "1" } : {}),
    });
    res.redirect(
      `${frontEndHost.replace(/\/$/, "")}/#/canva/connect-complete?${params}`,
    );
  } catch (error) {
    console.error("Error completing Canva connection:", error);
    const params = new URLSearchParams({
      status: "error",
      message:
        "The Canva connection did not finish. Return to WorshipSync and try again.",
      returnTo:
        typeof error?.returnTo === "string" && error.returnTo.startsWith("/")
          ? error.returnTo
          : "/account/integrations",
      ...(error?.desktop ? { desktop: "1" } : {}),
    });
    res.redirect(
      `${frontEndHost.replace(/\/$/, "")}/#/canva/connect-complete?${params}`,
    );
  }
});

app.use(
  "/api/churches/:churchId/canva",
  requireAppSession,
  requireFullAppAccess,
  (req, res, next) =>
    req.appSession.churchId === req.params.churchId
      ? next()
      : res.status(403).json({ error: "That church is not available." }),
);

app.get("/api/churches/:churchId/canva/status", async (req, res) => {
  try {
    res.json(
      await canvaService.getStatusForChurch({ churchId: req.params.churchId }),
    );
  } catch (error) {
    respondCanvaError(res, "Error loading Canva status:", error);
  }
});

app.post(
  "/api/churches/:churchId/canva/connect-url",
  requireMutationCsrf,
  requireChurchAdmin,
  async (req, res) => {
    try {
      res.json(
        await canvaService.startConnect({
          churchId: req.params.churchId,
          userId: req.appSession.userId,
          returnTo: req.body?.returnTo,
          desktop: Boolean(req.body?.desktop),
        }),
      );
    } catch (error) {
      respondCanvaError(res, "Error starting Canva connection:", error);
    }
  },
);

app.post(
  "/api/churches/:churchId/canva/connect-status",
  requireMutationCsrf,
  requireChurchAdmin,
  async (req, res) => {
    try {
      res.json(
        await canvaService.getConnectStatus({
          churchId: req.params.churchId,
          connectRequestId: req.body?.connectRequestId,
          connectRequestSecret: req.body?.connectRequestSecret,
        }),
      );
    } catch (error) {
      respondCanvaError(res, "Error loading Canva connection status:", error);
    }
  },
);

app.post(
  "/api/churches/:churchId/canva/disconnect",
  requireMutationCsrf,
  requireChurchAdmin,
  async (req, res) => {
    try {
      await canvaService.disconnect({ churchId: req.params.churchId });
      res.json({ success: true });
    } catch (error) {
      respondCanvaError(res, "Error disconnecting Canva:", error);
    }
  },
);

app.get("/api/churches/:churchId/canva/designs", async (req, res) => {
  try {
    res.json(
      await canvaService.listDesigns({
        churchId: req.params.churchId,
        query: req.query.query,
        continuation: req.query.continuation,
      }),
    );
  } catch (error) {
    respondCanvaError(res, "Error listing Canva designs:", error);
  }
});

app.post(
  "/api/churches/:churchId/canva/resolve-design-link",
  requireMutationCsrf,
  async (req, res) => {
    try {
      res.json(
        await canvaService.resolveDesignLink({
          url: req.body?.url,
        }),
      );
    } catch (error) {
      respondCanvaError(res, "Error resolving Canva design link:", error);
    }
  },
);

app.get("/api/churches/:churchId/canva/designs/:designId", async (req, res) => {
  try {
    res.json(
      await canvaService.getDesign({
        churchId: req.params.churchId,
        designId: req.params.designId,
      }),
    );
  } catch (error) {
    respondCanvaError(res, "Error loading Canva design:", error);
  }
});

app.post(
  "/api/churches/:churchId/canva/imports",
  requireMutationCsrf,
  async (req, res) => {
    let streamStarted = false;
    let clientDisconnected = false;
    res.on("close", () => {
      if (!res.writableEnded) clientDisconnected = true;
    });
    res.on("error", () => {
      clientDisconnected = true;
    });
    const writeProgress = (event) => {
      if (clientDisconnected || res.writableEnded || res.destroyed) return;
      if (!streamStarted) {
        streamStarted = true;
        res.status(200);
        res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("X-Accel-Buffering", "no");
      }
      try {
        res.write(`${JSON.stringify(event)}\n`);
      } catch {
        clientDisconnected = true;
      }
    };
    try {
      const requestedReplacementAssets = Array.isArray(req.body?.replacementAssets)
        ? req.body.replacementAssets
        : [];
      const replacementAssets = requestedReplacementAssets.length
        ? await getCanvaReplacementCandidates({
            churchId: req.params.churchId,
            designId: String(req.body?.designId || ""),
            preferredMediaIds: requestedReplacementAssets
              .filter((asset) => asset?.preferred === true && typeof asset.mediaId === "string")
              .map((asset) => asset.mediaId),
          })
        : [];
      const result = await canvaService.importDesign({
        churchId: req.params.churchId,
        designId: req.body?.designId,
        pages: req.body?.pages,
        format: req.body?.format,
        mp4ImportMode: req.body?.mp4ImportMode,
        existingImportKeys: req.body?.existingImportKeys,
        replacementAssets,
        onProgress: writeProgress,
        isCancelled: () => clientDisconnected,
      });
      if (streamStarted) {
        writeProgress({ type: "complete", result });
        if (!clientDisconnected && !res.writableEnded) res.end();
      } else {
        res.json(result);
      }
    } catch (error) {
      if (streamStarted) {
        writeProgress({
          type: "error",
          error:
            error?.message || "Canva could not complete that import. Try again.",
        });
        if (!clientDisconnected && !res.writableEnded) res.end();
      } else {
        respondCanvaError(res, "Error importing from Canva:", error);
      }
    }
  },
);

const respondPlanningCenterError = (res, context, error) => {
  console.error(context, error);
  res.status(error?.statusCode || 500).json({
    error:
      error?.statusCode && error?.message
        ? error.message
        : "Planning Center could not complete that request. Try again.",
  });
};

app.get("/api/planning-center/oauth/callback", async (req, res) => {
  try {
    const result = await planningCenterService.completeConnect({
      state: req.query.state,
      code: req.query.code,
      denied: Boolean(req.query.error) || !req.query.code,
    });
    const params = new URLSearchParams({
      status: "success",
      returnTo: result.returnTo || "/account/integrations",
      ...(result.accountLabel ? { accountLabel: result.accountLabel } : {}),
      ...(result.desktop ? { desktop: "1" } : {}),
    });
    res.redirect(
      `${frontEndHost.replace(/\/$/, "")}/#/planning-center/connect-complete?${params}`,
    );
  } catch (error) {
    console.error("Error completing Planning Center connection:", error);
    const params = new URLSearchParams({
      status: "error",
      message:
        "The Planning Center connection did not finish. Return to WorshipSync and try again.",
      returnTo:
        typeof error?.returnTo === "string" && error.returnTo.startsWith("/")
          ? error.returnTo
          : "/account/integrations",
      ...(error?.desktop ? { desktop: "1" } : {}),
    });
    res.redirect(
      `${frontEndHost.replace(/\/$/, "")}/#/planning-center/connect-complete?${params}`,
    );
  }
});

app.use(
  "/api/churches/:churchId/planning-center",
  requireAppSession,
  requireFullAppAccess,
  (req, res, next) =>
    req.appSession.churchId === req.params.churchId
      ? next()
      : res.status(403).json({ error: "That church is not available." }),
);

app.get("/api/churches/:churchId/planning-center/status", async (req, res) => {
  try {
    res.json(
      await planningCenterService.getStatusForChurch({
        churchId: req.params.churchId,
      }),
    );
  } catch (error) {
    respondPlanningCenterError(
      res,
      "Error loading Planning Center status:",
      error,
    );
  }
});

app.post(
  "/api/churches/:churchId/planning-center/connect-url",
  requireMutationCsrf,
  requireChurchAdmin,
  async (req, res) => {
    try {
      res.json(
        await planningCenterService.startConnect({
          churchId: req.params.churchId,
          userId: req.appSession.userId,
          returnTo: req.body?.returnTo,
          desktop: Boolean(req.body?.desktop),
        }),
      );
    } catch (error) {
      respondPlanningCenterError(
        res,
        "Error starting Planning Center connection:",
        error,
      );
    }
  },
);

app.post(
  "/api/churches/:churchId/planning-center/connect-status",
  requireMutationCsrf,
  requireChurchAdmin,
  async (req, res) => {
    try {
      res.json(
        await planningCenterService.getConnectStatus({
          churchId: req.params.churchId,
          connectRequestId: req.body?.connectRequestId,
          connectRequestSecret: req.body?.connectRequestSecret,
        }),
      );
    } catch (error) {
      respondPlanningCenterError(
        res,
        "Error loading Planning Center connection status:",
        error,
      );
    }
  },
);

app.post(
  "/api/churches/:churchId/planning-center/disconnect",
  requireMutationCsrf,
  requireChurchAdmin,
  async (req, res) => {
    try {
      await planningCenterService.disconnect({ churchId: req.params.churchId });
      res.json({ success: true });
    } catch (error) {
      respondPlanningCenterError(
        res,
        "Error disconnecting Planning Center:",
        error,
      );
    }
  },
);

app.get(
  "/api/churches/:churchId/planning-center/service-types",
  async (req, res) => {
    try {
      res.json(
        await planningCenterService.listServiceTypes({
          churchId: req.params.churchId,
        }),
      );
    } catch (error) {
      respondPlanningCenterError(
        res,
        "Error listing Planning Center service types:",
        error,
      );
    }
  },
);

app.get(
  "/api/churches/:churchId/planning-center/service-types/:serviceTypeId/plans",
  async (req, res) => {
    try {
      res.json(
        await planningCenterService.listPlans({
          churchId: req.params.churchId,
          serviceTypeId: req.params.serviceTypeId,
          filter: req.query.filter,
        }),
      );
    } catch (error) {
      respondPlanningCenterError(
        res,
        "Error listing Planning Center plans:",
        error,
      );
    }
  },
);

app.get(
  "/api/churches/:churchId/planning-center/service-types/:serviceTypeId/plans/:planId/import",
  async (req, res) => {
    try {
      res.json(
        await planningCenterService.getPlanImport({
          churchId: req.params.churchId,
          serviceTypeId: req.params.serviceTypeId,
          planId: req.params.planId,
        }),
      );
    } catch (error) {
      respondPlanningCenterError(
        res,
        "Error importing Planning Center plan:",
        error,
      );
    }
  },
);

app.use("/api/boards/admin", requireAppSession, requireFullAppAccess);

app.get("/api/boards/stream/:aliasId", (req, res) => {
  const aliasId = normalizeAliasId(req.params.aliasId || "");

  if (!aliasId) {
    res.status(400).json({ error: "Link name is required." });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write(`data: ${JSON.stringify({ type: "connected", aliasId })}\n\n`);

  addBoardSseClient(aliasId, res);

  const heartbeat = setInterval(() => {
    res.write(": keep-alive\n\n");
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    removeBoardSseClient(aliasId, res);
    res.end();
  });
});

// Live channel for the Teams scheduling grid. Schedule mutation handlers push
// the updated schedule doc to every other client viewing this church so the
// grid collaborates in real time (see server/teamsSse.js).
app.get(
  "/api/churches/:churchId/teams/stream",
  requireAppSession,
  async (req, res) => {
    const churchId = req.params.churchId;
    if (!churchId || req.appSession.churchId !== churchId) {
      res.status(403).json({ error: "That church is not available." });
      return;
    }

    // Gate the stream behind the same Teams view permission getTeamsBootstrap
    // requires — otherwise any app-session holder for the church (including
    // users with no Teams access) could subscribe and receive schedule payloads.
    try {
      await requireTeamsViewSession(req, churchId);
    } catch {
      res.status(403).json({ error: "Teams access required" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    res.write(`data: ${JSON.stringify({ type: "connected", churchId })}\n\n`);

    addTeamsSseClient(churchId, res);

    const heartbeat = setInterval(() => {
      res.write(": keep-alive\n\n");
    }, 25000);

    req.on("close", () => {
      clearInterval(heartbeat);
      removeTeamsSseClient(churchId, res);
      res.end();
    });
  },
);

app.get("/api/boards/admin/bootstrap", async (req, res) => {
  try {
    await ensureBoardDbExists();
    res.json({ success: true });
  } catch (error) {
    console.error("Error bootstrapping board database:", error);
    res.status(500).json({ error: "Could not prepare discussion boards." });
  }
});

app.get("/api/boards/admin/aliases", async (req, res) => {
  try {
    await ensureBoardDbExists();
    const database = req.appSession.database;
    const rows = await getBoardDocsByRange({
      startkey: "alias:",
      endkey: `alias:${String.fromCharCode(0xfff0)}`,
    });
    const aliases = rows
      .map((row) => row.doc)
      .filter((doc) => doc?.aliasId && doc.database === database)
      .sort((a, b) => String(a.title).localeCompare(String(b.title)))
      .map(serializeBoardAlias);
    res.json({ aliases });
  } catch (error) {
    console.error("Error listing board aliases:", error);
    res.status(500).json({ error: "Could not load discussion boards." });
  }
});

app.post("/api/boards/admin/aliases", async (req, res) => {
  try {
    const validation = validateAliasInput(req.body || {});
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    const { aliasId, title } = validation.value;
    const database = req.appSession.database;
    const existingAlias = await getBoardDoc(getAliasDocId(aliasId));
    if (existingAlias) {
      return res
        .status(409)
        .json({ error: "That link name is already in use." });
    }

    const boardDoc = createBoardDoc({ aliasId, database });
    const aliasDoc = createAliasDoc({
      aliasId,
      title,
      database,
      boardId: boardDoc.id,
    });

    await putBoardDoc(boardDoc);
    await putBoardDoc(aliasDoc);

    emitBoardEvent(aliasId, "alias-created");
    invalidateBoardAliasIdsByDatabaseCache();

    res.status(201).json({
      alias: serializeBoardAlias(aliasDoc),
      board: serializeBoardDoc(boardDoc),
    });
  } catch (error) {
    console.error("Error creating board alias:", error);
    res.status(500).json({ error: "Could not create discussion board." });
  }
});

app.post("/api/boards/admin/aliases/:aliasId/soft-reset", async (req, res) => {
  try {
    const aliasId = normalizeAliasId(req.params.aliasId || "");
    const aliasDoc = await getBoardDoc(getAliasDocId(aliasId));
    if (!aliasDoc) {
      return res.status(404).json({ error: "Discussion board not found." });
    }
    if (!requireBoardDatabaseAccess(req, res, aliasDoc.database)) return;

    const range = getBoardPostRange(aliasDoc.currentBoardId);
    const rows = await getBoardDocsByRange(range);
    const docs = rows.flatMap((row) => (row.doc ? [row.doc] : []));

    await bulkDeleteBoardDocs(docs);
    emitBoardEvent(aliasId, "board-soft-reset");

    res.json({ deletedCount: docs.length });
  } catch (error) {
    console.error("Error soft resetting board:", error);
    res.status(500).json({ error: "Could not clear posts." });
  }
});

app.post("/api/boards/admin/aliases/:aliasId/hard-reset", async (req, res) => {
  try {
    const aliasId = normalizeAliasId(req.params.aliasId || "");
    const aliasDoc = await getBoardDoc(getAliasDocId(aliasId));
    if (!aliasDoc) {
      return res.status(404).json({ error: "Discussion board not found." });
    }
    if (!requireBoardDatabaseAccess(req, res, aliasDoc.database)) return;

    const currentBoardDoc = await getBoardDoc(
      `board:${aliasDoc.currentBoardId}`,
    );
    const nextBoardDoc = createBoardDoc({
      aliasId: aliasDoc.aliasId,
      database: aliasDoc.database,
    });
    const nextAliasDoc = rotateAliasDoc({
      aliasDoc,
      nextBoardId: nextBoardDoc.id,
    });

    await putBoardDoc(nextBoardDoc);
    if (currentBoardDoc) {
      await putBoardDoc(archiveBoardDoc(currentBoardDoc));
    }
    await putBoardDoc(nextAliasDoc);

    emitBoardEvent(aliasId, "board-hard-reset");

    res.json({
      alias: serializeBoardAlias(nextAliasDoc),
      board: serializeBoardDoc(nextBoardDoc),
    });
  } catch (error) {
    console.error("Error rotating board:", error);
    res.status(500).json({ error: "Could not start a new session." });
  }
});

app.post("/api/boards/admin/aliases/:aliasId/title", async (req, res) => {
  try {
    const aliasId = normalizeAliasId(req.params.aliasId || "");
    const aliasDoc = await getBoardDoc(getAliasDocId(aliasId));
    if (!aliasDoc) {
      return res.status(404).json({ error: "Discussion board not found." });
    }
    if (!requireBoardDatabaseAccess(req, res, aliasDoc.database)) return;

    const title = normalizeBoardTitle(req.body?.title);
    if (!title) {
      return res.status(400).json({ error: "Title is required." });
    }

    const nextAliasDoc = {
      ...aliasDoc,
      title,
      updatedAt: Date.now(),
    };

    await putBoardDoc(nextAliasDoc);
    emitBoardEvent(aliasId, "alias-updated");

    res.json({
      alias: serializeBoardAlias(nextAliasDoc),
    });
  } catch (error) {
    console.error("Error renaming board alias:", error);
    res.status(500).json({ error: "Could not rename discussion board." });
  }
});

app.delete("/api/boards/admin/aliases/:aliasId", async (req, res) => {
  try {
    const aliasId = normalizeAliasId(req.params.aliasId || "");
    const aliasDoc = await getBoardDoc(getAliasDocId(aliasId));
    if (!aliasDoc) {
      return res.status(404).json({ error: "Discussion board not found." });
    }
    if (!requireBoardDatabaseAccess(req, res, aliasDoc.database)) return;

    const boardIds = Array.from(
      new Set([aliasDoc.currentBoardId, ...(aliasDoc.history || [])]),
    );

    const boardRows = await getBoardDocsByRange({
      keys: boardIds.map((boardId) => `board:${boardId}`),
    });
    const boardDocs = boardRows.flatMap((row) => (row.doc ? [row.doc] : []));

    const postRowsByBoard = await Promise.all(
      boardIds.map((boardId) =>
        getBoardDocsByRange(getBoardPostRange(boardId)),
      ),
    );
    const postDocs = postRowsByBoard.flatMap((rows) =>
      rows.flatMap((row) => (row.doc ? [row.doc] : [])),
    );

    await bulkDeleteBoardDocs([...postDocs, ...boardDocs, aliasDoc]);
    emitBoardEvent(aliasId, "alias-deleted");
    invalidateBoardAliasIdsByDatabaseCache();
    closeBoardSseClients(aliasId);

    res.json({ deletedAliasId: aliasId });
  } catch (error) {
    console.error("Error deleting board alias:", error);
    res.status(500).json({ error: "Could not delete discussion board." });
  }
});

app.post(
  "/api/boards/admin/aliases/:aliasId/presentation-font-scale",
  async (req, res) => {
    try {
      const aliasId = normalizeAliasId(req.params.aliasId || "");
      const aliasDoc = await getBoardDoc(getAliasDocId(aliasId));
      if (!aliasDoc) {
        return res.status(404).json({ error: "Discussion board not found." });
      }
      if (!requireBoardDatabaseAccess(req, res, aliasDoc.database)) return;

      const nextAliasDoc = updateAliasPresentationFontScale({
        aliasDoc,
        presentationFontScale: Number(req.body?.value),
      });

      await putBoardDoc(nextAliasDoc);
      emitBoardEvent(aliasId, "board-presentation-updated", {
        presentationFontScale: nextAliasDoc.presentationFontScale,
      });

      res.json({
        alias: serializeBoardAlias(nextAliasDoc),
      });
    } catch (error) {
      console.error("Error updating board presentation font scale:", error);
      res
        .status(500)
        .json({ error: "Could not update presentation text size." });
    }
  },
);

app.post("/api/boards/admin/posts/:postId/hidden", async (req, res) => {
  try {
    const postId = req.params.postId;
    const postDoc = await getBoardDoc(postId);
    if (!postDoc) {
      return res.status(404).json({ error: "Post not found." });
    }
    if (!requireBoardDatabaseAccess(req, res, postDoc.database)) return;

    const nextHidden =
      typeof req.body?.value === "boolean" ? req.body.value : !postDoc.hidden;
    const nextPost = {
      ...postDoc,
      hidden: nextHidden,
      highlighted: nextHidden ? false : Boolean(postDoc.highlighted),
    };

    const response = await putBoardDoc(nextPost);
    nextPost._rev = response.rev;

    emitBoardEvent(postDoc.aliasId, "post-updated");

    res.json({ post: serializeBoardPost(nextPost) });
  } catch (error) {
    console.error("Error updating board post hidden state:", error);
    res.status(500).json({ error: "Could not update post." });
  }
});

app.post("/api/boards/admin/posts/:postId/highlighted", async (req, res) => {
  try {
    const postId = req.params.postId;
    const postDoc = await getBoardDoc(postId);
    if (!postDoc) {
      return res.status(404).json({ error: "Post not found." });
    }
    if (!requireBoardDatabaseAccess(req, res, postDoc.database)) return;

    const nextHighlighted =
      typeof req.body?.value === "boolean"
        ? req.body.value
        : !postDoc.highlighted;
    const nextPost = {
      ...postDoc,
      highlighted: postDoc.hidden ? false : nextHighlighted,
    };

    const response = await putBoardDoc(nextPost);
    nextPost._rev = response.rev;

    emitBoardEvent(postDoc.aliasId, "post-updated");

    res.json({ post: serializeBoardPost(nextPost) });
  } catch (error) {
    console.error("Error updating board post highlight state:", error);
    res.status(500).json({ error: "Could not update post." });
  }
});

app.get("/api/boards/:aliasId/posts", async (req, res) => {
  try {
    const aliasId = normalizeAliasId(req.params.aliasId || "");
    const aliasDoc = await getBoardDoc(getAliasDocId(aliasId));
    if (!aliasDoc) {
      return res.status(404).json({ error: "Discussion board not found." });
    }

    const requestedBoardId = String(
      req.query.boardId || aliasDoc.currentBoardId,
    );
    const boardIds = new Set([
      aliasDoc.currentBoardId,
      ...(aliasDoc.history || []),
    ]);
    if (!boardIds.has(requestedBoardId)) {
      return res
        .status(404)
        .json({ error: "That session was not found for this board." });
    }

    const range = getBoardPostRange(requestedBoardId);
    const rows = await getBoardDocsByRange(range);
    const includeHidden = String(req.query.includeHidden || "") === "true";
    const viewerAuthorId = normalizeBoardParticipantId(
      req.query.viewerAuthorId,
    );
    const posts = rows
      .flatMap((row) => (row.doc ? [row.doc] : []))
      .filter((post) => {
        if (post.deleted) {
          return false;
        }
        if (includeHidden) return true;
        if (!post.hidden) return true;

        const postAuthorId = normalizeBoardParticipantId(post.authorId);
        return Boolean(
          viewerAuthorId && postAuthorId && postAuthorId === viewerAuthorId,
        );
      })
      .map((post) =>
        includeHidden
          ? serializeBoardPost(post)
          : serializeBoardPostForViewer(post, viewerAuthorId),
      )
      .sort((a, b) => {
        if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
        return a._id.localeCompare(b._id);
      });

    res.json({
      aliasId: aliasDoc.aliasId,
      boardId: requestedBoardId,
      posts,
    });
  } catch (error) {
    console.error("Error loading board posts:", error);
    res.status(500).json({ error: "Could not load posts." });
  }
});

app.get("/api/boards/:aliasId/display-items", async (req, res) => {
  try {
    const aliasId = normalizeAliasId(req.params.aliasId || "");
    const aliasDoc = await getBoardDoc(getAliasDocId(aliasId));
    if (!aliasDoc) {
      return res.status(404).json({ error: "Discussion board not found." });
    }

    const boardRows = await getBoardDocsByRange(
      getBoardPostRange(aliasDoc.currentBoardId),
    );
    const boardPosts = boardRows
      .flatMap((row) => (row.doc ? [row.doc] : []))
      .filter(
        (postDoc) =>
          !postDoc.hidden && !postDoc.deleted && Boolean(postDoc.highlighted),
      )
      .map((postDoc) =>
        serializeBoardDisplayItem({
          id: postDoc._id,
          source: "board",
          sourceLabel: "Board",
          author: postDoc.author,
          text: postDoc.text,
          timestamp: postDoc.timestamp,
        }),
      );

    const restreamMessages = (
      await restreamService.listHighlightedMessagesForDatabase(
        aliasDoc.database,
      )
    ).map((messageDoc) =>
      serializeBoardDisplayItem({
        id: messageDoc.id,
        source: "restream",
        sourceLabel: messageDoc.platform || "Restream",
        author: messageDoc.author,
        text: messageDoc.text,
        timestamp:
          normalizeRestreamPostedAtMs(messageDoc.postedAt) ??
          messageDoc.postedAt,
      }),
    );

    const items = [...boardPosts, ...restreamMessages].sort((a, b) => {
      if (a.timestamp !== b.timestamp) {
        return a.timestamp - b.timestamp;
      }
      return a.id.localeCompare(b.id);
    });

    res.json({ aliasId, items });
  } catch (error) {
    console.error("Error loading board display items:", error);
    res.status(500).json({ error: "Could not load presentation." });
  }
});

app.post("/api/boards/:aliasId/posts", async (req, res) => {
  try {
    const aliasId = normalizeAliasId(req.params.aliasId || "");
    const aliasDoc = await getBoardDoc(getAliasDocId(aliasId));
    if (!aliasDoc) {
      return res.status(404).json({ error: "Discussion board not found." });
    }

    const validation = validateBoardPostInput(req.body || {});
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    const boardId = aliasDoc.currentBoardId;

    const outcome = await runExclusiveBoardPostCreate(boardId, async () => {
      const existingRows = await getBoardDocsByRange(
        getBoardPostRange(boardId),
      );
      const existingPosts = existingRows.flatMap((row) =>
        row.doc ? [row.doc] : [],
      );

      if (isBoardAuthorInUse(existingPosts, validation.value)) {
        return { kind: "conflict" };
      }

      const postDoc = createBoardPostDoc({
        aliasId: aliasDoc.aliasId,
        boardId,
        database: aliasDoc.database,
        author: validation.value.author,
        authorId: validation.value.authorId,
        text: validation.value.text,
      });

      const response = await putBoardDoc(postDoc);
      postDoc._rev = response.rev;

      emitBoardEvent(aliasId, "post-created");

      return { kind: "created", post: serializeBoardPost(postDoc) };
    });

    if (outcome.kind === "conflict") {
      return res.status(409).json({
        error: "That display name is already in use for this discussion board.",
      });
    }

    return res.status(201).json({ post: outcome.post });
  } catch (error) {
    console.error("Error creating board post:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Could not send post." });
    }
  }
});

app.put("/api/boards/:aliasId/posts/:postDocId", async (req, res) => {
  try {
    const aliasId = normalizeAliasId(req.params.aliasId || "");
    const postDocId = decodeURIComponent(req.params.postDocId || "");
    const aliasDoc = await getBoardDoc(getAliasDocId(aliasId));
    if (!aliasDoc) {
      return res.status(404).json({ error: "Discussion board not found." });
    }

    const postDoc = await getBoardDoc(postDocId);
    const authz = assertAttendeeCanMutateBoardPost({
      aliasDoc,
      postDoc,
      requestAuthorId: req.body?.authorId,
    });
    if (!authz.ok) {
      return res.status(authz.status).json({ error: authz.error });
    }

    const validation = validateBoardPostTextUpdate(req.body || {});
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    const nextPost = {
      ...postDoc,
      text: validation.value.text,
      editedAt: Date.now(),
    };

    try {
      const response = await putBoardDoc(nextPost);
      nextPost._rev = response.rev;
    } catch (error) {
      if (error?.response?.status === 409) {
        return res.status(409).json({
          error: "This post was updated elsewhere. Refresh and try again.",
        });
      }
      throw error;
    }

    emitBoardEvent(aliasId, "post-updated");

    res.json({ post: serializeBoardPost(nextPost) });
  } catch (error) {
    console.error("Error updating board post:", error);
    res.status(500).json({ error: "Could not update post." });
  }
});

app.delete("/api/boards/:aliasId/posts/:postDocId", async (req, res) => {
  try {
    const aliasId = normalizeAliasId(req.params.aliasId || "");
    const postDocId = decodeURIComponent(req.params.postDocId || "");
    const aliasDoc = await getBoardDoc(getAliasDocId(aliasId));
    if (!aliasDoc) {
      return res.status(404).json({ error: "Discussion board not found." });
    }

    const postDoc = await getBoardDoc(postDocId);
    if (!postDoc || postDoc.docType !== "board-post") {
      return res.status(404).json({ error: "Post not found." });
    }

    if (postDoc.deleted) {
      const postAuthorId = normalizeBoardParticipantId(postDoc.authorId);
      const normalizedRequest = normalizeBoardParticipantId(req.body?.authorId);
      const sameOwner =
        Boolean(postAuthorId && normalizedRequest) &&
        postAuthorId === normalizedRequest;
      const sameAlias = postDoc.aliasId === aliasDoc.aliasId;
      const sameSession = postDoc.boardId === aliasDoc.currentBoardId;
      if (sameOwner && sameAlias && sameSession) {
        return res.json({ ok: true, post: serializeBoardPost(postDoc) });
      }
      return res.status(404).json({ error: "Post not found." });
    }

    const authz = assertAttendeeCanMutateBoardPost({
      aliasDoc,
      postDoc,
      requestAuthorId: req.body?.authorId,
    });
    if (!authz.ok) {
      return res.status(authz.status).json({ error: authz.error });
    }

    const nextPost = {
      ...postDoc,
      deleted: true,
      deletedAt: Date.now(),
      highlighted: false,
    };

    try {
      const response = await putBoardDoc(nextPost);
      nextPost._rev = response.rev;
    } catch (error) {
      if (error?.response?.status === 409) {
        return res.status(409).json({
          error: "This post was updated elsewhere. Refresh and try again.",
        });
      }
      throw error;
    }

    emitBoardEvent(aliasId, "post-updated");

    res.json({ ok: true, post: serializeBoardPost(nextPost) });
  } catch (error) {
    console.error("Error deleting board post:", error);
    res.status(500).json({ error: "Could not delete post." });
  }
});

app.get("/api/boards/:aliasId", async (req, res) => {
  try {
    const aliasId = normalizeAliasId(req.params.aliasId || "");
    const aliasDoc = await getBoardDoc(getAliasDocId(aliasId));
    if (!aliasDoc) {
      return res.status(404).json({ error: "Discussion board not found." });
    }

    const boardDoc = await getBoardDoc(`board:${aliasDoc.currentBoardId}`);
    if (!boardDoc) {
      return res.status(404).json({ error: "Current session was not found." });
    }

    const churchLogoUrl = await readChurchPublicBoardHeaderLogoUrl(
      aliasDoc.database,
    );

    res.json({
      alias: serializeBoardAlias(aliasDoc),
      board: serializeBoardDoc(boardDoc),
      ...(churchLogoUrl ? { churchLogoUrl } : {}),
    });
  } catch (error) {
    console.error("Error resolving board alias:", error);
    res.status(500).json({ error: "Could not load discussion board." });
  }
});

app.get("/api/hello", (req, res) => {
  res.send({ express: "Hello From Express" });
});

app.get("/api/version", (req, res) => {
  res.json({
    version: packageJson.version,
    minSupportedWebVersion: minimumSupportedWebVersion,
  });
});

app.post("/api/log", (req, res) => {
  const { level = "log", messages } = req.body || {};
  const prefix = `[client ${level}]`;
  if (Array.isArray(messages)) {
    console.log(prefix, ...messages);
  } else {
    console.log(prefix, messages);
  }
  res.status(204).send();
});

app.get("/api/bible", async (req, res) => {
  let book = req.query.book;
  let chapter = req.query.chapter;
  let version = req.query.version;

  let data = "";

  const url = `https://www.biblegateway.com/passage/?search=${book}%20${chapter}&version=${version}`;

  try {
    const response = await fetch(url);
    data = await response.text();
  } catch (error) {
    console.error("Error fetching Bible data:", error);
  }

  res.send(data);
});

app.get("/api/getEventDetails", async (req, res) => {
  const url = req.query.url;

  let data = "";

  try {
    const response = await fetch(url);
    data = await response.text();
  } catch (error) {
    console.error("Error fetching event details:", error);
  }

  res.send(data);
});

app.get("/api/lrclib/get", async (req, res) => {
  const params = getLrclibRequestParams(req);

  if (!params.track_name) {
    return res.status(400).json({ error: "trackName is required" });
  }

  if (!params.artist_name) {
    return res
      .status(400)
      .json({ error: "artistName is required for exact lyrics lookup" });
  }

  try {
    if (!skipGeniusLyricsImport) {
      try {
        const geniusTrack = await getGeniusTrack(params);

        if (geniusTrack) {
          return res.json(geniusTrack);
        }
      } catch (error) {
        console.warn("Genius lookup failed, falling back to LRCLIB:", {
          message: error.message,
          status: error.response?.status,
          code: error.code,
          trackName: params.track_name,
          artistName: params.artist_name,
        });
      }
    }

    const lrclibTrack = await getLrclibTrack(params);

    if (lrclibTrack) {
      return res.json(lrclibTrack);
    }

    try {
      const lyricsOvhTrack = await getLyricsOvhTrack(params);

      if (lyricsOvhTrack) {
        return res.json(lyricsOvhTrack);
      }
    } catch (error) {
      console.warn("lyrics.ovh lookup failed after other providers:", {
        message: error.message,
        status: error.response?.status,
        code: error.code,
        trackName: params.track_name,
        artistName: params.artist_name,
      });
    }

    return res.status(404).json({
      error:
        "No exact importable lyrics match for this title and artist (Genius, LRCLIB, and lyrics.ovh were checked).",
    });
  } catch (error) {
    if (error.response?.status === 404) {
      return res.status(404).json({
        error:
          "No exact importable lyrics match for this title and artist (Genius, LRCLIB, and lyrics.ovh were checked).",
      });
    }
    if (error.response?.status === 400) {
      return res.status(400).json({ error: "Invalid lyrics lookup query" });
    }

    console.error("Error fetching exact lyrics match:", {
      message: error.message,
      status: error.response?.status,
      code: error.code,
      trackName: params.track_name,
      artistName: params.artist_name,
      albumName: params.album_name,
    });
    res.status(502).json({ error: "Could not fetch lyrics." });
  }
});

app.get("/api/lrclib/search", async (req, res) => {
  const params = getLrclibRequestParams(req);
  const localGeniusClient = req.query.localGenius === "true";

  if (!params.track_name) {
    return res.status(400).json({ error: "trackName is required" });
  }

  try {
    res.json(
      await searchAllLyricsTracks(params, {
        includeGenius: !skipGeniusLyricsImport && !localGeniusClient,
        includeGeniusLyrics: !localGeniusClient,
      }),
    );
  } catch (error) {
    console.error("Error searching lyrics providers:", {
      message: error.message,
      status: error.response?.status,
      code: error.code,
      trackName: params.track_name,
      artistName: params.artist_name,
      albumName: params.album_name,
    });
    res.status(502).json({ error: "Could not search LRCLIB" });
  }
});

app.get("/bible", async (req, res) => {
  let version = req.query.version;

  const bible = await fsPromise.readFile(
    `./bibles/${version}.json`,
    "utf8",
    function (err, data) {
      if (err) throw err;
      return JSON.parse(data);
    },
  );

  res.send(bible);
});

app.use("/db", async (req, res) => {
  const path = req.originalUrl.replace(/^\/db/, ""); // strips `/db` prefix
  const couchURL = `https://${process.env.COUCHDB_HOST}${path}`;

  try {
    const response = await axios({
      method: req.method,
      url: couchURL,
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(
            `${process.env.COUCHDB_USER}:${process.env.COUCHDB_PASSWORD}`,
          ).toString("base64"),
        "Content-Type": "application/json",
      },
      data: req.body,
    });
    res.status(response.status).send(response.data);
  } catch (err) {
    console.log(err?.response?.data);
    res.status(err?.response?.status || 500).send(err);
  }
});

app.get("/api/changelog", async (req, res) => {
  try {
    const changelogPath = path.join(dirname, "CHANGELOG.md");
    const changelogContent = await fsPromise.readFile(changelogPath, "utf8");
    res.setHeader("Content-Type", "text/plain");
    res.send(changelogContent);
  } catch (error) {
    console.error("Error reading changelog:", error);
    res.status(500).json({ error: "Failed to load changelog" });
  }
});

app.use(
  "/api/churches/:churchId/media-storage",
  requireAppSession,
  requireFullAppAccess,
  (req, res, next) =>
    req.appSession.churchId === req.params.churchId
      ? next()
      : res.status(403).json({ error: "That church is not available." }),
);
app.post(
  "/api/churches/:churchId/media-storage/cloudinary/commit",
  requireMutationCsrf,
  async (req, res) => {
    try {
      const asset = await providerStorageService.commitCloudinaryImage({
        churchId: req.params.churchId,
        publicId: req.body?.publicId,
      });
      res.json({ asset });
    } catch (error) {
      res.status(error?.statusCode || 500).json({
        error: error?.message || "Could not commit the image to Media.",
        ...(error?.code ? { code: error.code } : {}),
        ...(error?.provider ? { provider: error.provider } : {}),
      });
    }
  },
);
app.post(
  "/api/churches/:churchId/media-storage/cloudinary/delete",
  requireMutationCsrf,
  async (req, res) => {
    try {
      res.json(await providerStorageService.deleteCloudinaryImage({
        churchId: req.params.churchId,
        publicId: req.body?.publicId,
      }));
    } catch (error) {
      res.status(error?.statusCode || 500).json({
        error: error?.message || "Could not delete the image.",
      });
    }
  },
);

app.use(
  "/api/churches/:churchId/mux",
  requireAppSession,
  requireFullAppAccess,
  (req, res, next) =>
    req.appSession.churchId === req.params.churchId
      ? next()
      : res.status(403).json({ error: "That church is not available." }),
);
app.post(
  "/api/churches/:churchId/mux/uploads",
  requireMutationCsrf,
  async (req, res) => {
    try {
      res.json(await providerStorageService.createMuxUpload({
        churchId: req.params.churchId,
        mediaId: req.body?.mediaId,
        title: req.body?.title,
        corsOrigin: req.get("origin"),
        temporary: req.body?.temporary === true,
      }));
    } catch (error) {
      res.status(error?.statusCode || 500).json({
        error: error?.message || "Could not create the video upload.",
      });
    }
  },
);
app.get(
  "/api/churches/:churchId/mux/uploads/:uploadId",
  async (req, res) => {
    try {
      res.json(await providerStorageService.getMuxUpload({
        churchId: req.params.churchId,
        uploadId: req.params.uploadId,
      }));
    } catch (error) {
      res.status(error?.statusCode || 500).json({
        error: error?.message || "Could not read the video upload.",
      });
    }
  },
);
app.get(
  "/api/churches/:churchId/mux/assets/:assetId",
  async (req, res) => {
    try {
      res.json(await providerStorageService.getMuxAsset({
        churchId: req.params.churchId,
        assetId: req.params.assetId,
      }));
    } catch (error) {
      res.status(error?.statusCode || 500).json({
        error: error?.message || "Could not read the video asset.",
        ...(error?.code ? { code: error.code } : {}),
        ...(error?.provider ? { provider: error.provider } : {}),
      });
    }
  },
);
app.post(
  "/api/churches/:churchId/mux/assets/:assetId/delete",
  requireMutationCsrf,
  async (req, res) => {
    try {
      res.json(await providerStorageService.deleteMuxAsset({
        churchId: req.params.churchId,
        assetId: req.params.assetId,
      }));
    } catch (error) {
      res.status(error?.statusCode || 500).json({
        error: error?.message || "Could not delete the video.",
      });
    }
  },
);

app.delete(
  "/api/cloudinary/delete",
  requireAppSession,
  requireFullAppAccess,
  requireMutationCsrf,
  async (req, res) => {
    try {
      const { publicId, resourceType } = req.body || {};
      if (!publicId) {
        return res.status(400).json({ error: "publicId is required" });
      }
      if (resourceType && resourceType !== "image") {
        return res.status(400).json({
          error: "Only Cloudinary images can be deleted here.",
        });
      }

      return res.json(await providerStorageService.deleteCloudinaryImage({
        churchId: req.appSession.churchId,
        publicId,
      }));
    } catch (error) {
      res.status(error?.statusCode || 500).json({
        error: error?.message || "Failed to delete image",
      });
    }
  },
);

app.all("/api/mux/*path", (_req, res) =>
  res.status(410).json({ error: "Sign in to upload and manage church videos." }),
);

app.get("/api/getDbSession", async (req, res) => {
  try {
    // New churches need an empty CouchDB content DB before the client can
    // finish initial replication. Ensure it here so already-created churches
    // without a remote DB recover on the next controller open.
    try {
      const bootstrap = await resolveRequestBootstrap(req);
      const contentDatabaseKey = String(bootstrap?.database || "").trim();
      if (contentDatabaseKey) {
        await ensureWorshipSyncContentDatabase(contentDatabaseKey);
      }
    } catch (provisionError) {
      console.error(
        "Error ensuring church content database:",
        provisionError?.message || provisionError,
      );
      // Still establish the CouchDB cookie below; replication may retry once
      // the DB exists. Creation failure is logged for ops.
    }

    const couchURL = `https://${process.env.COUCHDB_HOST}/_session`;

    const loginResp = await axios({
      method: "POST",
      url: couchURL,
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(
            `${process.env.COUCHDB_USER}:${process.env.COUCHDB_PASSWORD}`,
          ).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      data: `name=${process.env.COUCHDB_USER}&password=${process.env.COUCHDB_PASSWORD}`,
    });

    const cookies = loginResp.headers["set-cookie"];

    // delete cookies from .worshipsync.net
    const reqCookieHeader = req.headers.cookie || "";
    if (reqCookieHeader) {
      const cookieNames = Array.from(
        new Set(
          reqCookieHeader
            .split(";")
            .map((c) => c.split("=")[0].trim())
            .filter(Boolean),
        ),
      );
      const domainsToClear = [
        "worshipsync.net",
        ".worshipsync.net",
        "www.worshipsync.net",
        "db.worshipsync.net",
      ];
      cookieNames.forEach((name) => {
        domainsToClear.forEach((domain) => {
          res.append(
            "Set-Cookie",
            `${name}=; Path=/; Domain=${domain}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; Secure; HttpOnly; SameSite=None`,
          );
        });
      });
    }

    if (cookies?.length) {
      // Set the new one exactly as CouchDB gave it, adjusting attributes
      cookies.forEach((cookie) => {
        const updatedCookie = cookie.replace(
          /; HttpOnly/,
          "; HttpOnly; SameSite=None; Secure; Domain=.worshipsync.net; Path=/",
        );
        res.append("Set-Cookie", updatedCookie);
      });
    }

    res.json({
      success: true,
      message: "New session established",
    });
  } catch (error) {
    console.error("Error getting CouchDB session:", error);
    res.status(500).json({
      success: false,
      message: "Failed to establish session",
    });
  }
});

setupExpressErrorHandler(app);

const HASHED_FILENAME = /-[A-Za-z0-9]{8,}\.(js|css|png|jpg|jpeg|svg|woff2?)$/;

const dist = path.join(dirname, "client/dist");

app.use(
  express.static(dist, {
    setHeaders(res, filePath) {
      const name = path.basename(filePath);

      if (filePath.endsWith("index.html")) {
        res.setHeader("Cache-Control", "no-store");
      } else if (filePath.endsWith("service-worker.js")) {
        res.setHeader("Cache-Control", "no-cache");
      } else if (HASHED_FILENAME.test(name)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  }),
);

// Express 5 / path-to-regexp v8+: bare "*" is invalid; use a named wildcard.
app.get("/{*path}", async (req, res) => {
  const pathname = req.path;

  // Don’t serve index.html for these
  if (
    pathname === "/service-worker.js" ||
    pathname === "/manifest.json" ||
    pathname === "/manifest.webmanifest"
  ) {
    res.status(404).end();
    return;
  }

  // If it looks like a file, let express.static handle it
  if (/\.[a-z0-9]+$/i.test(pathname)) {
    res.status(404).end();
    return;
  }

  const publicShare = matchPublicShareRoute(
    pathname,
    req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "",
  );
  if (publicShare && isLinkPreviewCrawler(req.get("user-agent") || "")) {
    await sendPublicShareMetaPage(req, res, publicShare);
    return;
  }

  // SPA index: public paths mount PublicApp; everything else uses HashRouter
  res.sendFile(path.join(dist, "index.html"));
});

void restreamService.initializeConnections();

if (isDevelopment) {
  const options = {
    key: fs.readFileSync("./local.worshipsync.net-key.pem"),
    cert: fs.readFileSync("./local.worshipsync.net.pem"),
  };

  https.createServer(options, app).listen(5000, "local.worshipsync.net", () => {
    console.log("HTTPS server running at https://local.worshipsync.net:5000");
  });
} else {
  app.listen(port, () => console.log(`Listening on port ${port}`));
}
