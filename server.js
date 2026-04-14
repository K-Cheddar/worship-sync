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
  authSessionConfig,
  readChurchPublicBoardHeaderLogoUrl,
  resolveRequestBootstrap,
} from "./authService.js";
import { fetchExcelFile } from "./getScheduleFunctions.js";
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
  validateAliasInput,
  validateBoardPostInput,
} from "./server/boardService.js";

const packageJson = JSON.parse(readFileSync("./package.json", "utf8"));

dotenv.config();
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
const {
  getGeniusTrack,
  getLrclibRequestParams,
  getLrclibTrack,
  searchGeniusTracks,
  searchLrclibTracks,
} = createLyricsImportService({
  geniusAccessToken: process.env.GENIUS_ACCESS_TOKEN,
});

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

const requireAppSession = async (req, res, next) => {
  try {
    const bootstrap = await resolveRequestBootstrap(req);
    if (
      bootstrap?.authenticated &&
      bootstrap.sessionKind !== "display" &&
      bootstrap.database
    ) {
      req.appSession = {
        username:
          bootstrap.user?.displayName ||
          bootstrap.device?.operatorName ||
          bootstrap.device?.label ||
          "Operator",
        database: bootstrap.database,
        access: bootstrap.appAccess || "view",
      };
      return next();
    }

    return res.status(401).json({ error: "Sign in to continue." });
  } catch (error) {
    console.error("Board auth error:", error);
    return res.status(401).json({ error: "Sign in to continue." });
  }
};

const requireFullAppAccess = (req, res, next) => {
  if (req.appSession?.access !== "full") {
    return res.status(403).json({ error: "Full access is required." });
  }
  next();
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
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Origin",
      "X-Requested-With",
      "Content-Type",
      "Accept",
      "x-workstation-token",
      "x-display-token",
      "x-support-token",
      "x-csrf-token",
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
app.post("/api/auth/resend-email-code", authHandlers.resendEmailCode);
app.post("/api/auth/verify-email-code", authHandlers.verifyEmailCode);
app.post("/api/auth/logout", authHandlers.logout);
app.post("/api/auth/forgot-password", authHandlers.forgotPassword);
app.post("/api/auth/profile", authHandlers.updateOwnProfile);
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
app.post("/api/churches/:churchId/invites", authHandlers.createInvite);
app.get("/api/invites/preview", authHandlers.getInvitePreview);
app.post("/api/invites/accept", authHandlers.acceptInvite);
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
  "/api/churches/:churchId/display-devices/:deviceId/revoke",
  authHandlers.revokeDisplayDevice,
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

app.get("/api/boards/admin/bootstrap", async (req, res) => {
  try {
    await ensureBoardDbExists();
    res.json({ success: true });
  } catch (error) {
    console.error("Error bootstrapping board database:", error);
    res.status(500).json({ error: "Could not prepare discussion boards." });
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
  res.json({ version: packageJson.version });
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
    try {
      const geniusTrack = await getGeniusTrack(params);

      if (geniusTrack) {
        return res.json(geniusTrack);
      }
    } catch (error) {}

    const lrclibTrack = await getLrclibTrack(params);

    if (lrclibTrack) {
      return res.json(lrclibTrack);
    }

    return res.status(404).json({
      error:
        "No exact importable lyrics match for this title and artist (Genius and LRCLIB were checked).",
    });
  } catch (error) {
    if (error.response?.status === 404) {
      return res.status(404).json({
        error:
          "No exact importable lyrics match for this title and artist (Genius and LRCLIB were checked).",
      });
    }
    if (error.response?.status === 400) {
      return res.status(400).json({ error: "Invalid lyrics lookup query" });
    }

    console.error("Error fetching exact lyrics match:", error.message);
    res.status(502).json({ error: "Could not fetch lyrics." });
  }
});

app.get("/api/lrclib/search", async (req, res) => {
  const params = getLrclibRequestParams(req);

  if (!params.track_name) {
    return res.status(400).json({ error: "trackName is required" });
  }

  try {
    try {
      const geniusTracks = await searchGeniusTracks(params);

      if (geniusTracks.length > 0) {
        return res.json(geniusTracks);
      }
    } catch (error) {}

    res.json(await searchLrclibTracks(params));
  } catch (error) {
    console.error("Error searching LRCLIB:", error.message);
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

app.get("/getSchedule", async (req, res) => {
  const scheduleFilePath = `/${req.query.fileName}`;
  const schedule = await fetchExcelFile(scheduleFilePath, 0);
  res.send(schedule);
});

app.get("/getMembers", async (req, res) => {
  const membersFilePath = `/${req.query.fileName}`;
  const members = await fetchExcelFile(membersFilePath, 1);
  res.send(members);
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

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    // Create a PouchDB instance to check credentials
    const dbName = "worship-sync-logins";
    const couchURL = `https://${process.env.COUCHDB_HOST}/${dbName}`;

    const response = await axios({
      method: "GET",
      url: `${couchURL}/logins`,
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(
            `${process.env.COUCHDB_USER}:${process.env.COUCHDB_PASSWORD}`,
          ).toString("base64"),
        "Content-Type": "application/json",
      },
    });

    const db_logins = response.data;
    const user = db_logins.logins.find(
      (e) => e.username === username && e.password === password,
    );

    if (!user) {
      return res
        .status(401)
        .json({ success: false, errorMessage: "Invalid credentials" });
    }

    res.json({
      success: true,
      user: {
        username: user.username,
        database: user.database,
        upload_preset: user.upload_preset,
        access: user.access,
      },
    });
  } catch (error) {
    console.error("Sign-in error:", error);
    res.status(500).json({
      success: false,
      errorMessage: `Sign in failed: ${error.message}`,
    });
  }
});

app.delete("/api/cloudinary/delete", async (req, res) => {
  try {
    const { publicId, resourceType } = req.body;

    if (!publicId) {
      return res.status(400).json({ error: "publicId is required" });
    }

    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
    });

    if (result.result === "ok") {
      res.json({ success: true, message: "Image deleted successfully" });
    } else {
      res.status(500).json({ error: "Failed to delete image", result });
    }
  } catch (error) {
    console.error("Error deleting from Cloudinary:", error);
    res
      .status(500)
      .json({ error: "Failed to delete image", details: error.message });
  }
});

// Mux endpoints
app.post("/api/mux/upload", async (req, res) => {
  try {
    if (!mux) {
      return res.status(503).json({
        error:
          "Mux is not configured. Please set MUX_TOKEN_ID and MUX_TOKEN_SECRET environment variables.",
      });
    }

    const { corsOrigin } = req.body;

    const upload = await mux.video.uploads.create({
      cors_origin: corsOrigin || "*",
      new_asset_settings: {
        playback_policy: ["public"],
        encoding_tier: "baseline",
        static_renditions: [
          {
            resolution: "highest",
          },
        ],
      },
    });

    res.json({
      uploadId: upload.id,
      url: upload.url,
    });
  } catch (error) {
    console.error("Error creating Mux upload:", error);
    res
      .status(500)
      .json({ error: "Failed to create upload", details: error.message });
  }
});

app.get("/api/mux/upload/:uploadId", async (req, res) => {
  try {
    if (!mux) {
      return res.status(503).json({ error: "Mux is not configured" });
    }

    const { uploadId } = req.params;
    const upload = await mux.video.uploads.retrieve(uploadId);

    res.json({
      status: upload.status,
      assetId: upload.asset_id,
    });
  } catch (error) {
    console.error("Error getting Mux upload status:", error);
    res
      .status(500)
      .json({ error: "Failed to get upload status", details: error.message });
  }
});

app.get("/api/mux/asset/:assetId", async (req, res) => {
  try {
    if (!mux) {
      return res.status(503).json({ error: "Mux is not configured" });
    }

    const { assetId } = req.params;
    const asset = await mux.video.assets.retrieve(assetId);

    // Check static renditions status
    // Ensure static_renditions is always an array
    let staticRenditions = [];
    if (asset.static_renditions) {
      if (Array.isArray(asset.static_renditions)) {
        staticRenditions = asset.static_renditions;
      } else if (typeof asset.static_renditions === "object") {
        // If it's an object, try to convert it to an array
        staticRenditions = Object.values(asset.static_renditions);
      }
    }

    const highestRendition = staticRenditions.find(
      (r) => r.resolution === "highest",
    );
    const staticRenditionReady = highestRendition?.status === "ready";

    res.json({
      status: asset.status,
      playbackId: asset.playback_ids?.[0]?.id,
      duration: asset.duration,
      aspectRatio: asset.aspect_ratio,
      staticRenditions: staticRenditions.map((r) => ({
        resolution: r.resolution,
        status: r.status,
        name: r.name,
      })),
      staticRenditionReady,
    });
  } catch (error) {
    console.error("Error getting Mux asset:", error);
    res
      .status(500)
      .json({ error: "Failed to get asset", details: error.message });
  }
});

app.delete("/api/mux/asset/:assetId", async (req, res) => {
  try {
    if (!mux) {
      return res.status(503).json({ error: "Mux is not configured" });
    }

    const { assetId } = req.params;
    await mux.video.assets.delete(assetId);

    res.json({ success: true, message: "Asset deleted successfully" });
  } catch (error) {
    console.error("Error deleting Mux asset:", error);
    res
      .status(500)
      .json({ error: "Failed to delete asset", details: error.message });
  }
});

app.get("/api/getDbSession", async (req, res) => {
  try {
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

    console.log(cookies);

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
app.get("/{*path}", (req, res) => {
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

  // Otherwise serve SPA index
  res.sendFile(path.join(dist, "index.html"));
});

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
