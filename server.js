import "./instrument.js";
import { setupExpressErrorHandler } from "@sentry/node";
import express from "express";
import cors from "cors";
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
import { fetchExcelFile } from "./getScheduleFunctions.js";

const packageJson = JSON.parse(readFileSync("./package.json", "utf8"));

dotenv.config();
// Validate required environment variables
const requiredEnvVars = [
  "AZURE_TENANT_ID",
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
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
const frontEndHost = isDevelopment
  ? "https://local.worshipsync.net:3000"
  : "http://localhost:3000";

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
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ limit: "10mb", extended: true }));

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests from web frontend, Electron, or no origin (like Electron)
      const allowedOrigins = [
        frontEndHost,
        "https://local.worshipsync.net:3000",
        "http://localhost:3000",
        "file://", // Electron file:// protocol
      ];

      // Allow requests with no origin (like Electron or mobile apps)
      if (
        !origin ||
        allowedOrigins.some(
          (allowed) =>
            origin.includes(allowed.replace(/https?:\/\//, "")) ||
            origin.startsWith("file://"),
        )
      ) {
        callback(null, true);
      } else {
        callback(null, true); // Allow all for now, can be more restrictive if needed
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Origin", "X-Requested-With", "Content-Type", "Accept"],
    credentials: true,
  }),
);

// API calls
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

    // Return user info (excluding password for security)
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
    console.error("Login error:", error);
    res
      .status(500)
      .json({ success: false, errorMessage: `Login failed: ${error.message}` });
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

app.use(express.static(dist, {
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
  }
}));

app.get("*", (req, res) => {
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
