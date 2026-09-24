import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import axios from "axios";
import Mux from "@mux/mux-node";
import { v2 as cloudinary } from "cloudinary";
import { createChurchStorageQuotaService } from "../server/churchStorageQuota.js";
import { getFirebaseAdminRuntime } from "../server/firebaseAdminRuntime.js";
import { createProviderStorageBackfill } from "../server/providerStorageBackfill.js";
import { toWorshipSyncContentDbName } from "../server/couchContentDatabase.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const getArg = (name) => args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1) || "";
const reportPath = path.resolve(getArg("--report") || "provider-storage-backfill-report.json");
const requiredEnv = [
  "COUCHDB_HOST", "COUCHDB_USER", "COUCHDB_PASSWORD",
  "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET",
  "MUX_TOKEN_ID", "MUX_TOKEN_SECRET",
];
const missingEnv = requiredEnv.filter((name) => !process.env[name]);
if (missingEnv.length) {
  console.error(`Missing required environment variables: ${missingEnv.join(", ")}`);
  process.exit(1);
}

const firestore = getFirebaseAdminRuntime()?.db;
if (!firestore) {
  console.error("Firebase Admin Firestore is not configured.");
  process.exit(1);
}

cloudinary.config({
  cloud_name: "portable-media",
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});
const mux = new Mux({
  tokenId: process.env.MUX_TOKEN_ID,
  tokenSecret: process.env.MUX_TOKEN_SECRET,
});
const storageQuota = createChurchStorageQuotaService({
  getFirestore: () => firestore,
  getChurch: async (churchId) => {
    const snapshot = await firestore.collection("churches").doc(churchId).get();
    return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
  },
  providerQuotaEnforcementEnabled: () => false,
});
const couchOrigin = process.env.COUCHDB_HOST.startsWith("http")
  ? process.env.COUCHDB_HOST.replace(/\/$/, "")
  : `https://${process.env.COUCHDB_HOST}`;
const couchAuth = {
  username: process.env.COUCHDB_USER,
  password: process.env.COUCHDB_PASSWORD,
};
const backfill = createProviderStorageBackfill({
  listChurches: async () => {
    const snapshot = await firestore.collection("churches").limit(100000).get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  },
  readMediaLibrary: async (churchId) => {
    const dbName = toWorshipSyncContentDbName(churchId);
    const url = `${couchOrigin}/${encodeURIComponent(dbName)}/media`;
    const response = await axios.get(url, { auth: couchAuth, timeout: 30000 });
    return response.data;
  },
  cloudinaryClient: cloudinary,
  muxClient: mux,
  storageQuota,
});

try {
  const report = await backfill.run({ dryRun });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Provider storage backfill ${dryRun ? "dry run" : "run"} report: ${reportPath}`);
  console.log(JSON.stringify({
    dryRun: report.dryRun,
    complete: report.complete,
    churches: report.churches.length,
    ready: report.churches.filter((church) => church.ready).length,
    issues: report.churches.reduce((total, church) => total + church.issues.length, 0),
  }, null, 2));
  if (!dryRun && !report.complete) process.exitCode = 2;
} catch (error) {
  console.error(`Provider storage backfill failed: ${error?.message || error}`);
  process.exitCode = 1;
}
