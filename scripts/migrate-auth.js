import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import axios from "axios";
import dotenv from "dotenv";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

dotenv.config();

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const getArgValue = (flag) => {
  const entry = args.find((arg) => arg.startsWith(`${flag}=`));
  return entry ? entry.slice(flag.length + 1) : "";
};

const emailMapPath = getArgValue("--email-map");
const reportPath =
  getArgValue("--report") ||
  path.join(process.cwd(), "auth-migration-report.json");

const requiredEnv = [
  "COUCHDB_HOST",
  "COUCHDB_USER",
  "COUCHDB_PASSWORD",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
];

const missing = requiredEnv.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error("Missing required env vars:", missing.join(", "));
  process.exit(1);
}

if (!emailMapPath) {
  console.error("Provide --email-map=/absolute/or/relative/path.json");
  process.exit(1);
}

const credential = cert({
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
});

const app = getApps()[0] || initializeApp({ credential });
const auth = getAuth(app);
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

const normalizeEmail = (email = "") => email.trim().toLowerCase();
const nowIso = () => new Date().toISOString();
const deterministicChurchId = (database) =>
  `church_${crypto.createHash("sha1").update(database).digest("hex").slice(0, 16)}`;

const buildAuthHeaders = () => ({
  Authorization:
    "Basic " +
    Buffer.from(
      `${process.env.COUCHDB_USER}:${process.env.COUCHDB_PASSWORD}`
    ).toString("base64"),
  "Content-Type": "application/json",
});

const readEmailMap = async () => {
  const raw = await fs.readFile(path.resolve(emailMapPath), "utf8");
  return JSON.parse(raw);
};

const fetchLegacyLogins = async () => {
  const url = `https://${process.env.COUCHDB_HOST}/worship-sync-logins/logins`;
  const response = await axios.get(url, { headers: buildAuthHeaders() });
  return Array.isArray(response.data?.logins) ? response.data.logins : [];
};

const resolveMappedUser = (entry, emailMap) => {
  const mapped = emailMap[entry.username];
  if (!mapped) return null;
  if (typeof mapped === "string") {
    return {
      email: normalizeEmail(mapped),
      displayName: entry.username,
      churchName: entry.database,
    };
  }
  return {
    email: normalizeEmail(mapped.email || ""),
    displayName: mapped.displayName || entry.username,
    churchName: mapped.churchName || entry.database,
  };
};

const getOrCreateFirebaseUser = async ({ email, displayName }) => {
  try {
    return await auth.getUserByEmail(email);
  } catch (error) {
    if (error?.code !== "auth/user-not-found") {
      throw error;
    }
  }
  return auth.createUser({
    email,
    displayName,
    password: crypto.randomBytes(18).toString("base64url"),
  });
};

const run = async () => {
  const emailMap = await readEmailMap();
  const legacyLogins = await fetchLegacyLogins();

  const report = {
    generatedAt: nowIso(),
    dryRun,
    scanned: legacyLogins.length,
    migratedUsers: 0,
    migratedChurchs: 0,
    missingMappings: [],
    duplicateEmails: [],
    churches: {},
  };

  const seenEmails = new Set();
  const churches = new Map();

  for (const entry of legacyLogins) {
    const mapped = resolveMappedUser(entry, emailMap);
    if (!mapped?.email) {
      report.missingMappings.push({
        username: entry.username,
        database: entry.database,
      });
      continue;
    }

    if (seenEmails.has(mapped.email)) {
      report.duplicateEmails.push({
        username: entry.username,
        email: mapped.email,
      });
      continue;
    }
    seenEmails.add(mapped.email);

    const churchId = deterministicChurchId(entry.database);
    const church = churches.get(churchId) || {
      churchId,
      name: mapped.churchName,
      status: "active",
      adminCount: 0,
      recoveryEmail: mapped.email,
      contentDatabaseKey: entry.database,
      firebaseNamespace: entry.database,
      cloudinaryUploadPreset: entry.upload_preset || "bpqu4ma5",
      createdAt: nowIso(),
      createdByUid: null,
      members: [],
    };

    church.adminCount += 1;
    church.recoveryEmail = church.recoveryEmail || mapped.email;
    church.members.push({
      username: entry.username,
      email: mapped.email,
      displayName: mapped.displayName,
      access: entry.access || "full",
    });
    churches.set(churchId, church);
  }

  report.migratedChurchs = churches.size;

  for (const church of churches.values()) {
    report.churches[church.churchId] = {
      name: church.name,
      database: church.contentDatabaseKey,
      adminCount: church.adminCount,
      members: church.members.map((member) => ({
        email: member.email,
        access: member.access,
      })),
    };

    if (dryRun) {
      report.migratedUsers += church.members.length;
      continue;
    }

    for (const member of church.members) {
      const userRecord = await getOrCreateFirebaseUser({
        email: member.email,
        displayName: member.displayName,
      });

      if (!church.createdByUid) {
        church.createdByUid = userRecord.uid;
      }

      await db.collection("users").doc(userRecord.uid).set(
        {
          uid: userRecord.uid,
          email: member.email,
          normalizedEmail: member.email,
          displayName: member.displayName,
          createdAt: nowIso(),
          lastLoginAt: null,
          migrationSource: "legacy-couchdb",
        },
        { merge: true }
      );

      await db.collection("churches").doc(church.churchId).set(
        {
          churchId: church.churchId,
          name: church.name,
          status: "active",
          adminCount: church.adminCount,
          recoveryEmail: church.recoveryEmail,
          contentDatabaseKey: church.contentDatabaseKey,
          firebaseNamespace: church.firebaseNamespace,
          cloudinaryUploadPreset: church.cloudinaryUploadPreset,
          createdAt: church.createdAt,
          createdByUid: church.createdByUid || userRecord.uid,
        },
        { merge: true }
      );

      await db
        .collection("memberships")
        .doc(`${church.churchId}_${userRecord.uid}`)
        .set(
          {
            membershipId: `${church.churchId}_${userRecord.uid}`,
            churchId: church.churchId,
            userId: userRecord.uid,
            role: "admin",
            appAccess: member.access || "full",
            status: "active",
            createdAt: nowIso(),
            createdByUid: church.createdByUid || userRecord.uid,
          },
          { merge: true }
        );

      report.migratedUsers += 1;
    }
  }

  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`Wrote migration report to ${reportPath}`);
};

run().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
