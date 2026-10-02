import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import axios from "axios";
import { getFirebaseAdminRuntime } from "../server/firebaseAdminRuntime.js";
import { toWorshipSyncContentDbName } from "../server/couchContentDatabase.js";
import {
  migrateMediaLibraryV2,
  resolveMediaMigrationDatabases,
} from "../server/mediaLibraryV2Migration.js";

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const getArg = (name) => args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1) || "";

if (hasFlag("--help")) {
  console.log([
    "Migrate a CouchDB media library to per-item documents.",
    "Usage:",
    "  node scripts/migrate-media-library-v2.js --database=<content-database-key-or-worship-sync-name> [--dry-run]",
    "  node scripts/migrate-media-library-v2.js --all [--dry-run]",
    "Options:",
    "  --database=<key>  Migrate one content database key or full worship-sync-* name (not a Firestore church ID).",
    "  --all             Migrate all churches listed in Firebase Admin.",
    "  --dry-run         Report counts without writing or setting schemaVersion.",
    "  --report=<path>   JSON report path.",
  ].join("\n"));
  process.exit(0);
}

const databaseArg = getArg("--database");
const dryRun = hasFlag("--dry-run");
const reportPath = path.resolve(getArg("--report") || "media-library-v2-migration-report.json");
const missingEnv = ["COUCHDB_HOST", "COUCHDB_USER", "COUCHDB_PASSWORD"].filter((key) => !process.env[key]);
if (missingEnv.length) {
  console.error(`Missing required environment variables: ${missingEnv.join(", ")}`);
  process.exit(1);
}
if (!databaseArg && !hasFlag("--all")) {
  console.error("Provide --database=<key> or --all. Use --help for details.");
  process.exit(1);
}

const couchOrigin = process.env.COUCHDB_HOST.startsWith("http")
  ? process.env.COUCHDB_HOST.replace(/\/$/, "")
  : `https://${process.env.COUCHDB_HOST}`;
const client = axios.create({
  baseURL: couchOrigin,
  auth: { username: process.env.COUCHDB_USER, password: process.env.COUCHDB_PASSWORD },
  timeout: 60000,
  validateStatus: (status) => status >= 200 && status < 300,
});

let databases;
let skippedChurches = [];
if (databaseArg) {
  databases = [toWorshipSyncContentDbName(databaseArg)];
} else {
  const firestore = getFirebaseAdminRuntime()?.db;
  if (!firestore) {
    console.error("Firebase Admin Firestore is not configured; use --database=<key>.");
    process.exit(1);
  }
  const snapshot = await firestore.collection("churches").get();
  const targets = resolveMediaMigrationDatabases(snapshot.docs);
  databases = targets.databases;
  skippedChurches = targets.skippedChurches;
}

const reports = [];
for (const database of databases) {
  reports.push(await migrateMediaLibraryV2({ client, database, dryRun }));
}

const report = {
  dryRun,
  complete: skippedChurches.length === 0 && reports.length > 0 && reports.every((entry) => entry.schemaVersionResult === "set_v2" || entry.schemaVersionResult === "already_v2"),
  databases: reports,
  skippedChurches,
};
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Media library v2 migration report: ${reportPath}`);
console.log(JSON.stringify({
  dryRun,
  databases: reports.length,
  skippedChurches: skippedChurches.length,
  migrated: reports.filter((entry) => entry.schemaVersionResult === "set_v2").length,
  blocked: reports.filter((entry) => entry.blocked).length,
  failures: reports.reduce((count, entry) => count + entry.failures.length, 0),
}, null, 2));
if (!report.complete && !dryRun) process.exitCode = 2;
