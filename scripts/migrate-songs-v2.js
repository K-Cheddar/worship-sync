import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import axios from "axios";
import { getFirebaseAdminRuntime } from "../server/firebaseAdminRuntime.js";
import { toWorshipSyncContentDbName } from "../server/couchContentDatabase.js";
import { resolveContentMigrationDatabases } from "../server/contentDatabaseMigration.js";
import { migrateSongDatabaseToV2 } from "../server/songSchemaV2Migration.js";

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const getArg = (name) => args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1) || "";
const recognized = new Set(["--help", "--all", "--dry-run"]);
for (const arg of args) {
  if (arg.startsWith("--database=") || arg.startsWith("--song=") || arg.startsWith("--report=")) continue;
  if (!recognized.has(arg)) {
    console.error(`Unknown option: ${arg}`);
    process.exit(1);
  }
}

if (hasFlag("--help")) {
  console.log([
    "Prepare legacy songs as schema v2 documents and publish each root last.",
    "Usage:",
    "  npm run migrate:songs-v2:dry-run -- --database=<content-database-key> [--song=<logical-song-id>]",
    "  npm run migrate:songs-v2 -- --database=<content-database-key> [--song=<logical-song-id>]",
    "  npm run migrate:songs-v2:dry-run -- --all",
    "Options:",
    "  --database=<key>  Content database key or full worship-sync-* name, not a Firestore church ID.",
    "  --song=<id>       Migrate or inspect one logical song; requires --database.",
    "  --all             Use Firestore churches' contentDatabaseKey values.",
    "  --dry-run         Inspect and report without writing.",
    "  --report=<path>   JSON report path.",
  ].join("\n"));
  process.exit(0);
}

const databaseArg = getArg("--database");
const songId = getArg("--song");
const dryRun = hasFlag("--dry-run");
const all = hasFlag("--all");
const reportPath = path.resolve(getArg("--report") || "song-schema-v2-migration-report.json");
if ((databaseArg && all) || (songId && all) || (songId && !databaseArg) || (!databaseArg && !all)) {
  console.error("Use --database=<key> or --all. --song requires --database and cannot be combined with --all.");
  process.exit(1);
}
const missingEnv = ["COUCHDB_HOST", "COUCHDB_USER", "COUCHDB_PASSWORD"].filter((key) => !process.env[key]);
if (missingEnv.length) {
  console.error(`Missing required environment variables: ${missingEnv.join(", ")}`);
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
  const targets = resolveContentMigrationDatabases(snapshot.docs);
  databases = targets.databases;
  skippedChurches = targets.skippedChurches;
}

const databaseReports = [];
for (const database of databases) {
  try {
    databaseReports.push(await migrateSongDatabaseToV2({ client, database, songId, dryRun }));
  } catch (error) {
    console.error(`${database}: ${error.message}`);
    databaseReports.push({ database, legacySongCount: 0, alreadyV2Count: 0, migratedCount: 0, blockedCount: 0, failedCount: 1, dryRun, complete: false, songs: [], failures: [error.message] });
  }
}

const report = {
  dryRun,
  complete: skippedChurches.length === 0 && databaseReports.length > 0 && databaseReports.every((entry) => entry.complete),
  databases: databaseReports,
  skippedChurches,
};
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Song schema v2 migration report: ${reportPath}`);
console.log(JSON.stringify({
  dryRun,
  databases: databaseReports.length,
  skippedChurches: skippedChurches.length,
  migrated: databaseReports.reduce((count, entry) => count + entry.migratedCount, 0),
  alreadyV2: databaseReports.reduce((count, entry) => count + entry.alreadyV2Count, 0),
  blocked: databaseReports.reduce((count, entry) => count + entry.blockedCount, 0),
  failed: databaseReports.reduce((count, entry) => count + entry.failedCount, 0),
}, null, 2));
if (!report.complete) process.exitCode = 2;
