import "dotenv/config";
import { createChatService } from "../server/chatService.js";
import { createChurchR2UsageLoader } from "../server/churchR2Usage.js";
import { createChurchStorageQuotaService } from "../server/churchStorageQuota.js";
import { createChatImageStorage } from "../server/chatImageStorage.js";
import { getFirebaseAdminRuntime } from "../server/firebaseAdminRuntime.js";
import axios from "axios";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const getArg = (name) => args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
const configuredLimit = Number.parseInt(getArg("--limit") || "500", 10);
const limit = Number.isFinite(configuredLimit)
  ? Math.min(Math.max(configuredLimit, 1), 1000)
  : 500;

const requiredEnv = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
];
if (!dryRun) {
  requiredEnv.push(
    "COUCHDB_HOST",
    "COUCHDB_USER",
    "COUCHDB_PASSWORD",
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_RESOURCES_BUCKET",
  );
}
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

if (dryRun) {
  const now = new Date();
  const due = await firestore.collection("chatMessages")
    .where("attachmentCleanupPending", "==", true)
    .where("attachmentCleanupAt", "<=", now)
    .orderBy("attachmentCleanupAt", "asc")
    .limit(limit)
    .get();
  console.log(JSON.stringify({ dryRun: true, scanned: due.size, limit }, null, 2));
  process.exit(0);
}

const loadR2Usage = createChurchR2UsageLoader({
  getFirestore: () => firestore,
  axios,
});
const quota = createChurchStorageQuotaService({
  getFirestore: () => firestore,
  getChurch: async (churchId) => {
    const snapshot = await firestore.collection("churches").doc(churchId).get();
    return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
  },
  loadR2Usage,
});
const imageStorage = createChatImageStorage({ quota });
const chatService = createChatService({
  getFirestore: () => firestore,
  onAttachmentRemoved: ({ churchId, attachment, expired }) => expired
    ? imageStorage.deleteExpiredAttachment({ churchId, attachment })
    : imageStorage.deleteAttachment({ churchId, attachment }),
});

const cleanup = await chatService.cleanupDueAttachments({ limit });
const churches = await firestore.collection("churches").limit(100000).get();
const reconciled = [];
const failed = [];
for (const church of churches.docs) {
  try {
    await quota.reconcileR2Usage(church.id);
    reconciled.push(church.id);
  } catch (error) {
    failed.push({ churchId: church.id, error: error?.message || String(error) });
  }
}
console.log(JSON.stringify({
  dryRun: false,
  cleanup,
  reconciledChurches: reconciled.length,
  failedChurches: failed,
}, null, 2));
if (cleanup.failed || failed.length) process.exitCode = 2;
