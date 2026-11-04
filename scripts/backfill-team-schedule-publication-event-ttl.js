import dotenv from "dotenv";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore } from "firebase-admin/firestore";

dotenv.config();

const args = process.argv.slice(2);
const getArgValue = (flag) => {
  const entry = args.find((arg) => arg.startsWith(`${flag}=`));
  return entry ? entry.slice(flag.length + 1).trim() : "";
};
const hasFlag = (flag) => args.includes(flag);

const printUsage = () => console.log(`
Backfill expiration timestamps for completed team schedule publication events.

Usage:
  node scripts/backfill-team-schedule-publication-event-ttl.js [--limit=250] [--after-id=<document-id>] [--apply]

Options:
  --limit=<number>     Maximum documents inspected (default: 250, maximum: 500).
  --after-id=<id>      Continue after a bounded page's reported cursor.
  --apply              Write changes. Without this flag the run is a dry-run.
  --help               Show this help text.

Only completed records missing expiresAt are updated. The expiration is derived
from completedAt plus 30 days. Pending records and records without a valid
completedAt remain unchanged. Repeat with the reported cursor until the scan is
complete; each invocation is bounded and safe to retry.
`);

if (hasFlag("--help")) {
  printUsage();
  process.exit(0);
}

const parsedLimit = Number.parseInt(getArgValue("--limit") || "250", 10);
if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 500) {
  console.error("--limit must be a whole number between 1 and 500.");
  process.exit(1);
}
const limit = parsedLimit;
const afterId = getArgValue("--after-id");
const apply = hasFlag("--apply");

const requiredEnv = ["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);
if (missingEnv.length) {
  console.error("Missing required Firebase environment variables:", missingEnv.join(", "));
  process.exit(1);
}

const app = getApps()[0] || initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});
const db = getFirestore(app);

const run = async () => {
  let query = db.collection("teamSchedulePublicationEvents")
    .where("status", "==", "completed")
    .orderBy(FieldPath.documentId());
  if (afterId) query = query.startAfter(afterId);
  const snapshot = await query.limit(limit).get();
  const result = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    dryRun: !apply,
    inspected: snapshot.size,
    wouldUpdate: 0,
    updated: 0,
    skippedExisting: 0,
    skippedMissingCompletionTime: 0,
    skippedChanged: 0,
    failed: 0,
    failures: [],
    planned: [],
  };

  for (const document of snapshot.docs) {
    const current = document.data();
    if (current.expiresAt != null) {
      result.skippedExisting += 1;
      continue;
    }
    const completedAtMs = new Date(current.completedAt || "").getTime();
    if (!Number.isFinite(completedAtMs)) {
      result.skippedMissingCompletionTime += 1;
      console.error(`Leaving completed event ${document.id} unchanged: completedAt is missing or invalid.`);
      continue;
    }
    const expiresAt = new Date(completedAtMs + 30 * 24 * 60 * 60_000);
    result.wouldUpdate += 1;
    result.planned.push({ id: document.id, expiresAt: expiresAt.toISOString() });
    if (!apply) continue;

    try {
      const updated = await db.runTransaction(async (transaction) => {
        const latestSnapshot = await transaction.get(document.ref);
        if (!latestSnapshot.exists) return "changed";
        const latest = latestSnapshot.data();
        if (latest.status !== "completed" || latest.expiresAt != null) return "changed";
        const latestCompletedAtMs = new Date(latest.completedAt || "").getTime();
        if (!Number.isFinite(latestCompletedAtMs)) return "changed";
        transaction.update(document.ref, {
          expiresAt: new Date(latestCompletedAtMs + 30 * 24 * 60 * 60_000),
        });
        return "updated";
      });
      if (updated === "updated") result.updated += 1;
      else result.skippedChanged += 1;
    } catch (error) {
      result.failed += 1;
      result.failures.push({ id: document.id, name: error?.name || "Error" });
      console.error(`Could not backfill event ${document.id}:`, error?.name || "Error");
    }
  }

  const nextAfterId = snapshot.size === limit ? snapshot.docs.at(-1)?.id || "" : "";
  console.log(JSON.stringify({ ...result, nextAfterId: nextAfterId || null }, null, 2));
  if (result.failed) process.exitCode = 1;
};

run().catch((error) => {
  console.error("Could not scan team schedule publication events:", error?.name || "Error");
  process.exitCode = 1;
});
