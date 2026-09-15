import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore } from "firebase-admin/firestore";
import {
  getRestreamMessageCanonicalTimestampMs,
  getRestreamMessageExpirationDate,
  RESTREAM_MESSAGE_CANONICAL_TIMESTAMP_FIELD,
  RESTREAM_MESSAGE_TTL_FIELD,
} from "../server/restreamRetention.js";

dotenv.config();

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const getArgValue = (flag) => {
  const entry = args.find((arg) => arg.startsWith(`${flag}=`));
  return entry ? entry.slice(flag.length + 1).trim() : "";
};

const printUsage = () => {
  console.log(`
Backfill canonical timestamps and expiration timestamps on Restream messages.

Usage:
  node scripts/backfill-restream-message-expiration.js --database=<database> [--dry-run]
  node scripts/backfill-restream-message-expiration.js --all [--start-after=<doc-id>]

Options:
  --database=<database>  Limit the run to one WorshipSync database.
  --all                  Explicitly allow a cross-database run.
  --dry-run              Report changes without writing documents.
  --limit=<number>       Maximum documents to inspect (default: 500, max: 500).
  --start-after=<id>     Continue after a previous bounded run's last document.
  --report=<path>        JSON report output path.
  --help                 Show this help text.

Timestamp fallback order is postedAt, receivedAt, createdAt, then updatedAt.
The canonical timestamp and expiration are written together. Documents with no
usable timestamp are reported and left unchanged.
`);
};

if (hasFlag("--help")) {
  printUsage();
  process.exit(0);
}

const database = getArgValue("--database");
const allDatabases = hasFlag("--all");
const dryRun = hasFlag("--dry-run");
const startAfter = getArgValue("--start-after");
const parsedLimit = Number.parseInt(getArgValue("--limit") || "500", 10);
const limit = Number.isFinite(parsedLimit)
  ? Math.min(Math.max(parsedLimit, 1), 500)
  : 500;

if (!database && !allDatabases) {
  console.error("Provide --database=<database> or explicitly pass --all.");
  printUsage();
  process.exit(1);
}

const requiredEnv = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
  console.error("Missing required env vars:", missingEnv.join(", "));
  process.exit(1);
}

const app =
  getApps()[0] ||
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

const reportPath = path.resolve(
  getArgValue("--report") ||
    (database
      ? `${database}-restream-message-expiration-backfill-report.json`
      : "restream-message-expiration-backfill-report.json"),
);

const run = async () => {
  let query = db.collection("restreamMessages");
  if (database) query = query.where("database", "==", database);
  query = query.orderBy(FieldPath.documentId());
  if (startAfter) query = query.startAfter(startAfter);

  const snapshot = await query.limit(limit).get();
  const report = {
    startedAt: new Date().toISOString(),
    dryRun,
    database: database || null,
    allDatabases,
    limit,
    startAfter: startAfter || null,
    inspected: 0,
    updated: 0,
    skippedExisting: 0,
    skippedNoTimestamp: 0,
    failed: 0,
    failures: [],
  };

  console.log(
    `Inspecting up to ${limit} Restream messages${
      database ? ` for ${database}` : " across all databases"
    }${startAfter ? ` after ${startAfter}` : ""}.`,
  );

  for (const doc of snapshot.docs) {
    report.inspected += 1;
    const data = doc.data();
    const hasCanonicalTimestamp = Number.isFinite(
      getRestreamMessageCanonicalTimestampMs({
        ...data,
        fallbackToNow: false,
      }),
    );
    const hasExpiration =
      data?.[RESTREAM_MESSAGE_TTL_FIELD] !== undefined &&
      data?.[RESTREAM_MESSAGE_TTL_FIELD] !== null;
    if (hasCanonicalTimestamp && hasExpiration) {
      report.skippedExisting += 1;
      continue;
    }

    const timestampMs = getRestreamMessageCanonicalTimestampMs({
      ...data,
      fallbackToNow: false,
    });
    const expiresAt = getRestreamMessageExpirationDate({
      ...data,
      messageTimestamp: timestampMs,
      fallbackToNow: false,
    });
    if (!Number.isFinite(timestampMs) || !expiresAt) {
      report.skippedNoTimestamp += 1;
      console.warn(`Skipping ${doc.id}: no usable historical timestamp.`);
      continue;
    }

    const update = {
      ...(!hasCanonicalTimestamp
        ? { [RESTREAM_MESSAGE_CANONICAL_TIMESTAMP_FIELD]: timestampMs }
        : {}),
      ...(!hasExpiration ? { [RESTREAM_MESSAGE_TTL_FIELD]: expiresAt } : {}),
    };

    if (dryRun) {
      report.updated += 1;
      continue;
    }

    try {
      await doc.ref.update(update);
      report.updated += 1;
      console.log(`Updated ${doc.id} (${report.inspected}/${snapshot.size}).`);
    } catch (error) {
      report.failed += 1;
      report.failures.push({
        id: doc.id,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`Could not update ${doc.id}:`, error);
    }
  }

  report.finishedAt = new Date().toISOString();
  report.nextStartAfter = snapshot.docs.at(-1)?.id || null;
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    `${dryRun ? "[dry run] " : ""}inspected ${report.inspected}, ` +
      `${dryRun ? "would update" : "updated"} ${report.updated}, ` +
      `skipped ${report.skippedExisting} existing and ` +
      `${report.skippedNoTimestamp} without timestamps, ` +
      `failed ${report.failed}.`,
  );
  console.log(`Report: ${reportPath}`);

  if (report.failed > 0) process.exitCode = 1;
};

run().catch((error) => {
  console.error("Restream expiration backfill failed:", error);
  process.exitCode = 1;
});
