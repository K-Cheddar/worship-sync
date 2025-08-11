import express from "express";
import cors from "cors";
import path from "path";
import bodyParser from "body-parser";
import fsPromise from "fs/promises";
import fs from "fs";
import axios from "axios";
import qs from "qs";
import * as XLSX from "xlsx";
import dotenv from "dotenv";
import packageJson from "./package.json" assert { type: "json" };
import { v2 as cloudinary } from "cloudinary";
import https from "https";

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

const tenantId = process.env.AZURE_TENANT_ID;
const clientId = process.env.AZURE_CLIENT_ID;
const clientSecret = process.env.AZURE_CLIENT_SECRET;
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

if (isDevelopment) {
  console.log("isDevelopment");
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

app.use(bodyParser.json({ limit: "10mb", extended: true }));
app.use(express.json());

app.use(
  cors({
    origin: frontEndHost,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Origin", "X-Requested-With", "Content-Type", "Accept"],
    credentials: true,
  })
);

// API calls
app.get("/api/hello", (req, res) => {
  res.send({ express: "Hello From Express" });
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
  } catch (error) {}
  // console.log(data);

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
    }
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
            `${process.env.COUCHDB_USER}:${process.env.COUCHDB_PASSWORD}`
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

async function getAccessToken() {
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  const tokenData = qs.stringify({
    client_id: clientId,
    scope: "https://graph.microsoft.com/.default",
    client_secret: clientSecret,
    grant_type: "client_credentials",
  });

  try {
    const response = await axios.post(tokenUrl, tokenData, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
    });

    return response.data.access_token;
  } catch (error) {
    console.error(
      "Error getting access token:",
      error.response?.data || error.message
    );
    throw error;
  }
}

async function fetchExcelFile(filePath, sheetIndex = 0) {
  try {
    const token = await getAccessToken();

    const userRes = await axios.get(
      "https://graph.microsoft.com/v1.0/users/kevin.cheddar@eliathahsda.org",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      }
    );
    const userId = userRes.data.id;

    const driveRes = await axios.get(
      `https://graph.microsoft.com/v1.0/users/${userId}/drive`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      }
    );
    const driveId = driveRes.data.id;

    const fileMeta = await axios.get(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/root:${filePath}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      }
    );
    const itemId = fileMeta.data.id;

    const fileContent = await axios.get(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/content`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        responseType: "arraybuffer",
      }
    );

    try {
      const workbook = XLSX.read(fileContent.data, {
        type: "buffer",
        cellDates: true, // This will parse dates properly
        cellNF: false, // Don't parse number formats
        cellText: false, // Don't parse text formats
      });

      const sheet = workbook.Sheets[workbook.SheetNames[sheetIndex]];

      if (!sheet) {
        throw new Error("No sheets found in the Excel file");
      }

      const json = XLSX.utils.sheet_to_json(sheet, {
        raw: false, // Convert numbers to strings
        defval: null, // Default value for empty cells
        header: 1, // Use first row as headers
      });

      return json;
    } catch (error) {
      return {
        error: "Error processing Excel file",
        details: error.message,
      };
    }
  } catch (error) {
    return {
      error: "Error fetching Excel file",
      details: error.response?.data || error.message,
    };
  }
}

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

app.get("/api/version", (req, res) => {
  res.json({ version: packageJson.version });
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
            `${process.env.COUCHDB_USER}:${process.env.COUCHDB_PASSWORD}`
          ).toString("base64"),
        "Content-Type": "application/json",
      },
    });

    const db_logins = response.data;
    const user = db_logins.logins.find(
      (e) => e.username === username && e.password === password
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

app.get("/api/getDbSession", async (req, res) => {
  try {
    const couchURL = `https://${process.env.COUCHDB_HOST}/_session`;

    const response = await axios({
      method: "POST",
      url: couchURL,
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(
            `${process.env.COUCHDB_USER}:${process.env.COUCHDB_PASSWORD}`
          ).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      data: `name=${process.env.COUCHDB_USER}&password=${process.env.COUCHDB_PASSWORD}`,
    });

    const cookies = response.headers["set-cookie"];

    if (cookies?.length) {
      cookies.forEach((cookie) => {
        const updatedCookie = cookie.replace(
          /; HttpOnly/,
          "; HttpOnly; SameSite=None; Secure; Domain=.worshipsync.net;"
        );
        res.append("Set-Cookie", updatedCookie);
      });
    }

    res.json({
      success: true,
      message: "Session established",
    });
  } catch (error) {
    console.error("Error getting CouchDB session:", error);
    res.status(500).json({
      success: false,
      message: "Failed to establish session",
    });
  }
});

// Serve any static files
app.use(express.static(path.join(dirname, "/client/build")));
// Handle React routing, return all requests to React app
app.get("*", function (req, res) {
  res.sendFile(path.join(dirname, "/client/build", "index.html"));
});
