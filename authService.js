import "dotenv/config";
import crypto from "node:crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { Resend } from "resend";
import {
  renderAccountRestoredEmail,
  renderAdminRecoveryRequestEmail,
  renderInviteEmail,
  renderPairingSetupCodeEmail,
  renderPasswordResetEmail,
  renderSignInCodeEmail,
} from "./email-templates/renderEmail.tsx";
import {
  sanitizeDisplayDeviceForClient,
  sanitizeInviteForClient,
  sanitizePairingForClient,
  sanitizeWorkstationDeviceForClient,
} from "./server/authResponseSanitize.js";
import { isRecoverableInvalidHumanSessionError } from "./server/authSessionRecovery.js";
import { getInviteMembershipConflict } from "./server/inviteMembershipGuards.js";

const SESSION_KIND_HUMAN = "human";
const SESSION_KIND_WORKSTATION = "workstation";
const SESSION_KIND_DISPLAY = "display";
const CHURCH_STATUS_ACTIVE = "active";
const CHURCH_STATUS_NEEDS_ADMIN = "needs-admin";

const APP_BASE_URL =
  process.env.AUTH_APP_BASE_URL?.replace(/\/$/, "") ||
  "https://www.worshipsync.net";
const EMAIL_CODE_TTL_MS = Number(
  process.env.AUTH_EMAIL_CODE_TTL_MS || 10 * 60 * 1000,
);
const EMAIL_CODE_MAX_ATTEMPTS = Number(
  process.env.AUTH_EMAIL_CODE_MAX_ATTEMPTS || 5,
);
const PAIRING_TTL_MS = Number(
  process.env.AUTH_PAIRING_TTL_MS || 30 * 60 * 1000,
);
const PAIRING_EXPIRES_MINUTES = Math.max(1, Math.round(PAIRING_TTL_MS / 60000));
const INVITE_TTL_MS = Number(
  process.env.AUTH_INVITE_TTL_MS || 7 * 24 * 60 * 60 * 1000,
);
const RECOVERY_TTL_MS = Number(
  process.env.AUTH_RECOVERY_TTL_MS || 24 * 60 * 60 * 1000,
);
const SESSION_IDLE_TTL_MS = Number(
  process.env.AUTH_SESSION_IDLE_TTL_MS || 7 * 24 * 60 * 60 * 1000,
);
const SESSION_ABSOLUTE_TTL_MS = Number(
  process.env.AUTH_SESSION_ABSOLUTE_TTL_MS || 30 * 24 * 60 * 60 * 1000,
);

const COLLECTIONS = {
  churches: "churches",
  users: "users",
  memberships: "memberships",
  invites: "invites",
  trustedHumanDevices: "trustedHumanDevices",
  workstationPairings: "workstationPairings",
  workstationDevices: "workstationDevices",
  displayPairings: "displayPairings",
  displayDevices: "displayDevices",
  adminRecoveryRequests: "adminRecoveryRequests",
  securityEvents: "securityEvents",
  emailCodeChallenges: "emailCodeChallenges",
};

const normalizeEmail = (email = "") => email.trim().toLowerCase();
const nowIso = () => new Date().toISOString();
const createId = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const createNumericCode = () => crypto.randomInt(100000, 1000000).toString();
const hashValue = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex");
const randomSecret = (bytes = 32) => crypto.randomBytes(bytes).toString("hex");
const APP_ACCESS_VALUES = new Set(["full", "music", "view"]);
const normalizeAppAccess = (value, fallback = "view") => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return APP_ACCESS_VALUES.has(normalized) ? normalized : fallback;
};

const httpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const logAuthEvent = (level, event, details = {}) => {
  const line = JSON.stringify({
    scope: "auth",
    event,
    ...details,
    at: nowIso(),
  });
  const logger =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : console.log;
  logger(line);
};

/** Service account keys in .env are often one line with literal \n — normalize for PEM parsing. */
const normalizeFirebasePrivateKey = (raw) => {
  if (raw == null || String(raw).trim() === "") {
    return null;
  }
  let key = String(raw)
    .trim()
    .replace(/^\uFEFF/, "");
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1);
  }
  return key.replace(/\\n/g, "\n").replace(/\r\n/g, "\n");
};

const firebaseCredentials = () => {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = normalizeFirebasePrivateKey(
    process.env.FIREBASE_PRIVATE_KEY,
  );
  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }
  try {
    return cert({ projectId, clientEmail, privateKey });
  } catch (error) {
    logAuthEvent("error", "firebase.admin.credentials.invalid", {
      message: error.message,
      hint: "FIREBASE_PRIVATE_KEY must be the exact private_key string from the Firebase service account JSON. In .env use one line with \\n between PEM lines, or real newlines inside double quotes.",
    });
    return null;
  }
};

const firebaseRuntime = (() => {
  const credential = firebaseCredentials();
  if (!credential) {
    return null;
  }
  const app = getApps()[0] || initializeApp({ credential });
  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });
  return {
    auth: getAuth(app),
    db,
  };
})();

/** In production, auth persistence must use Firestore — in-memory Maps are not safe for deploys. */
if (process.env.NODE_ENV === "production" && !firebaseRuntime?.db) {
  throw new Error(
    "Firestore is required in production. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY to the Firebase service account used by this server.",
  );
}

const resendFromEmail = process.env.RESEND_FROM_EMAIL || null;
const resendWebhookSecret = process.env.RESEND_WEBHOOK_SECRET || null;
const resendClient =
  process.env.RESEND_API_KEY && resendFromEmail
    ? new Resend(process.env.RESEND_API_KEY)
    : null;

const sessionCookieName = "worshipsync_sid";
const sessionSecret = process.env.AUTH_SESSION_SECRET;

if (process.env.NODE_ENV === "production" && !sessionSecret) {
  throw new Error("AUTH_SESSION_SECRET must be set in production.");
}

export const authSessionConfig = {
  name: sessionCookieName,
  secret: sessionSecret || "dev-auth-secret",
  resave: false,
  saveUninitialized: false,
  rolling: true,
  unset: "destroy",
  proxy: process.env.NODE_ENV === "production",
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV !== "development",
    maxAge: SESSION_IDLE_TTL_MS,
    domain: process.env.AUTH_COOKIE_DOMAIN || undefined,
    path: process.env.AUTH_COOKIE_PATH || "/",
  },
};

export const authRuntimeInfo = {
  hasFirebaseAdmin: Boolean(firebaseRuntime?.auth),
  hasFirestore: Boolean(firebaseRuntime?.db),
  hasResend: Boolean(resendClient),
};

const memoryState = {
  churches: new Map(),
  users: new Map(),
  memberships: new Map(),
  invites: new Map(),
  trustedHumanDevices: new Map(),
  workstationPairings: new Map(),
  workstationDevices: new Map(),
  displayPairings: new Map(),
  displayDevices: new Map(),
  adminRecoveryRequests: new Map(),
  securityEvents: new Map(),
  emailCodeChallenges: new Map(),
};

const collectionMap = {
  [COLLECTIONS.churches]: memoryState.churches,
  [COLLECTIONS.users]: memoryState.users,
  [COLLECTIONS.memberships]: memoryState.memberships,
  [COLLECTIONS.invites]: memoryState.invites,
  [COLLECTIONS.trustedHumanDevices]: memoryState.trustedHumanDevices,
  [COLLECTIONS.workstationPairings]: memoryState.workstationPairings,
  [COLLECTIONS.workstationDevices]: memoryState.workstationDevices,
  [COLLECTIONS.displayPairings]: memoryState.displayPairings,
  [COLLECTIONS.displayDevices]: memoryState.displayDevices,
  [COLLECTIONS.adminRecoveryRequests]: memoryState.adminRecoveryRequests,
  [COLLECTIONS.securityEvents]: memoryState.securityEvents,
  [COLLECTIONS.emailCodeChallenges]: memoryState.emailCodeChallenges,
};

const rateLimits = new Map();

/**
 * Use the direct request IP for auth rate limits.
 * We intentionally avoid trusting X-Forwarded-For here because this server does
 * not enforce a trusted proxy chain itself, so clients could spoof buckets.
 */
const getClientIp = (req) =>
  String(req.socket?.remoteAddress || req.ip || "unknown").trim();

const enforceRateLimit = ({ scope, key, limit, windowMs, blockMs }) => {
  const bucketKey = `${scope}:${key}`;
  const now = Date.now();
  const current = rateLimits.get(bucketKey) || {
    count: 0,
    resetAt: now + windowMs,
    blockedUntil: 0,
  };

  if (current.blockedUntil && current.blockedUntil > now) {
    throw httpError(429, "Too many attempts. Wait a moment and try again.");
  }

  if (current.resetAt <= now) {
    current.count = 0;
    current.resetAt = now + windowMs;
    current.blockedUntil = 0;
  }

  current.count += 1;
  if (current.count > limit) {
    current.blockedUntil = now + blockMs;
    rateLimits.set(bucketKey, current);
    throw httpError(429, "Too many attempts. Wait a moment and try again.");
  }

  rateLimits.set(bucketKey, current);
};

const getCookies = (req) => {
  const header = req.headers.cookie || "";
  return header.split(";").reduce((cookies, chunk) => {
    const [rawName, ...rest] = chunk.split("=");
    const name = rawName?.trim();
    if (!name) return cookies;
    cookies[name] = decodeURIComponent(rest.join("=").trim());
    return cookies;
  }, {});
};

const parseDeviceTokens = (req) => {
  const cookies = getCookies(req);
  return {
    workstationToken:
      req.headers["x-workstation-token"] ||
      req.body?.workstationToken ||
      cookies.worshipsync_workstation ||
      null,
    displayToken:
      req.headers["x-display-token"] ||
      req.body?.displayToken ||
      cookies.worshipsync_display ||
      null,
  };
};

/** Resend tag names/values may only use ASCII letters, numbers, underscores, or dashes. */
const sanitizeResendTagPart = (s) =>
  String(s)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 256);

const createEmailTags = (tags = {}) =>
  Object.entries(tags)
    .filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    )
    .map(([name, value]) => ({
      name: sanitizeResendTagPart(name),
      value: sanitizeResendTagPart(value),
    }))
    .filter(({ name, value }) => name.length > 0 && value.length > 0)
    .slice(0, 10);

const sendEmail = async ({ to, subject, textBody, htmlBody, tags = {} }) => {
  if (resendClient && resendFromEmail) {
    const response = await resendClient.emails.send({
      from: resendFromEmail,
      to: [to],
      subject,
      text: textBody,
      html: htmlBody,
      tags: createEmailTags(tags),
    });
    if (response.error) {
      throw new Error(response.error.message || "Could not send email.");
    }
    return response.data || null;
  }
  logAuthEvent("log", "email.debug", { to, subject, tags });
  return null;
};

const buildPairingSetupUrl = (kind, token) => {
  const route = kind === "workstation" ? "/workstation/pair" : "/display/pair";
  return `${APP_BASE_URL}/#${route}?token=${encodeURIComponent(token)}`;
};

const assertValidPairingNotifyEmail = (raw) => {
  const email = normalizeEmail(raw);
  if (!email || !email.includes("@") || email.length > 320) {
    throw httpError(400, "Enter a valid email address.");
  }
  return email;
};

const sendPairingSetupEmailInternal = async ({ to, kind, label, token }) => {
  if (!resendClient || !resendFromEmail) {
    throw httpError(503, "Email is not configured on this server.");
  }
  const normalizedTo = assertValidPairingNotifyEmail(to);
  const setupUrl = buildPairingSetupUrl(kind, token);
  const { html, text } = await renderPairingSetupCodeEmail({
    kind,
    label,
    code: token,
    setupUrl,
    expiresMinutes: PAIRING_EXPIRES_MINUTES,
  });
  const deviceWord = kind === "workstation" ? "Workstation" : "Display";
  await sendEmail({
    to: normalizedTo,
    subject: `${deviceWord} setup: ${label}`,
    textBody: text,
    htmlBody: html,
    tags: { type: "pairing_setup", kind },
  });
};

const buildInviteUrl = (token) =>
  `${APP_BASE_URL}/#/invite?token=${encodeURIComponent(token)}`;
const buildRecoveryUrl = (token) =>
  `${APP_BASE_URL}/#/recovery/confirm?token=${encodeURIComponent(token)}`;
const buildResetUrlFromFirebaseLink = (firebaseLink) => {
  try {
    const parsed = new URL(firebaseLink);
    const oobCode = parsed.searchParams.get("oobCode");
    if (!oobCode) return firebaseLink;
    return `${APP_BASE_URL}/#/auth/reset?oobCode=${encodeURIComponent(oobCode)}`;
  } catch {
    return firebaseLink;
  }
};

const getWebhookPayloadString = (req) => {
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  return JSON.stringify(req.body || {});
};

const resendWebhookEventDetails = (event) => {
  switch (event.type) {
    case "email.bounced":
      return event.data?.bounce ?? null;
    case "email.failed":
      return event.data?.failed ?? null;
    case "email.suppressed":
      return event.data?.suppressed ?? null;
    case "email.clicked":
      return event.data?.click ?? null;
    default:
      return null;
  }
};

const verifyResendWebhook = (req) => {
  if (!resendClient || !resendWebhookSecret) {
    throw httpError(503, "Resend webhooks are not configured on this server.");
  }

  return resendClient.webhooks.verify({
    payload: getWebhookPayloadString(req),
    headers: new Headers({
      "svix-id": String(req.headers["svix-id"] || ""),
      "svix-timestamp": String(req.headers["svix-timestamp"] || ""),
      "svix-signature": String(req.headers["svix-signature"] || ""),
    }),
    webhookSecret: resendWebhookSecret,
  });
};

const createWebhookDeliveryEventId = (deliveryId) =>
  `event_resend_${hashValue(deliveryId).slice(0, 24)}`;

const getBearerToken = (req) => {
  const header = String(req.headers.authorization || "");
  if (!header.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  return header.slice(7).trim();
};

const requireFirebaseAdmin = () => {
  if (!firebaseRuntime?.auth) {
    throw httpError(503, "Firebase Auth is not configured on this server.");
  }
  return firebaseRuntime.auth;
};

const requireFirestore = () => firebaseRuntime?.db || null;

const readDeviceFingerprint = (body = {}) =>
  hashValue(
    JSON.stringify({
      deviceId: body.deviceId || "",
      userAgent: body.userAgent || "",
      platform: body.platform || "",
    }),
  );

const sessionExpired = (authSession) =>
  Boolean(authSession?.issuedAt) &&
  Date.now() - authSession.issuedAt > SESSION_ABSOLUTE_TTL_MS;

const ensureSessionCsrfToken = (req) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = randomSecret(24);
  }
  return req.session.csrfToken;
};

/**
 * CSRF for mutating routes that already require an authenticated session.
 * If there is no session auth yet, we skip (caller must enforce auth first).
 */
const assertCsrf = (req) => {
  if (!req.session?.auth) return;
  const expected = ensureSessionCsrfToken(req);
  const provided = String(req.headers["x-csrf-token"] || "").trim();
  if (!provided || provided !== expected) {
    throw httpError(403, "Could not verify this request.");
  }
};

const getDoc = async (collectionName, id) => {
  const db = requireFirestore();
  if (db) {
    const snapshot = await db.collection(collectionName).doc(id).get();
    return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
  }
  const item = collectionMap[collectionName].get(id);
  return item ? { id, ...item } : null;
};

const setDoc = async (collectionName, id, data, { merge = false } = {}) => {
  const db = requireFirestore();
  if (db) {
    await db.collection(collectionName).doc(id).set(data, { merge });
    return;
  }
  const store = collectionMap[collectionName];
  const current = store.get(id) || {};
  store.set(id, merge ? { ...current, ...data } : { ...data });
};

const deleteDoc = async (collectionName, id) => {
  const db = requireFirestore();
  if (db) {
    await db.collection(collectionName).doc(id).delete();
    return;
  }
  collectionMap[collectionName].delete(id);
};

const queryDocs = async (
  collectionName,
  filters = [],
  { limit = 100 } = {},
) => {
  const db = requireFirestore();
  if (db) {
    let query = db.collection(collectionName);
    for (const filter of filters) {
      query = query.where(filter.field, filter.op || "==", filter.value);
    }
    if (limit) {
      query = query.limit(limit);
    }
    const snapshot = await query.get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  const store = Array.from(collectionMap[collectionName].entries()).map(
    ([id, value]) => ({ id, ...value }),
  );
  return store
    .filter((item) =>
      filters.every((filter) => {
        if ((filter.op || "==") !== "==") return false;
        return item[filter.field] === filter.value;
      }),
    )
    .slice(0, limit);
};

const addSecurityEvent = async (event) => {
  const eventId = createId("event");
  const payload = {
    eventId,
    createdAt: nowIso(),
    ...event,
  };
  await setDoc(COLLECTIONS.securityEvents, eventId, payload);
  logAuthEvent("log", event.type || "security_event", payload);
  return payload;
};

const addWebhookDeliveryEvent = async (deliveryId, event) => {
  const eventId = createWebhookDeliveryEventId(deliveryId);
  const payload = {
    eventId,
    createdAt: nowIso(),
    ...event,
  };
  const db = requireFirestore();
  if (db) {
    const inserted = await db.runTransaction(async (transaction) => {
      const docRef = db.collection(COLLECTIONS.securityEvents).doc(eventId);
      const snapshot = await transaction.get(docRef);
      if (snapshot.exists) {
        return false;
      }
      transaction.set(docRef, payload);
      return true;
    });
    if (!inserted) {
      return null;
    }
  } else {
    const store = collectionMap[COLLECTIONS.securityEvents];
    if (store.has(eventId)) {
      return null;
    }
    store.set(eventId, payload);
  }
  logAuthEvent("log", event.type || "security_event", payload);
  return payload;
};

const getUserByUid = async (uid) => {
  const user = await getDoc(COLLECTIONS.users, uid);
  return user ? { uid: user.id || uid, ...user } : null;
};

const getUserByEmail = async (email) => {
  const normalizedEmail = normalizeEmail(email);
  const [user] = await queryDocs(
    COLLECTIONS.users,
    [{ field: "normalizedEmail", value: normalizedEmail }],
    { limit: 1 },
  );
  return user ? { uid: user.id, ...user } : null;
};

const upsertUserProfile = async ({
  uid,
  email,
  displayName,
  migrationSource = "firebase-auth",
}) => {
  const normalizedEmail = normalizeEmail(email);
  const existing = await getDoc(COLLECTIONS.users, uid);
  const payload = {
    uid,
    email: normalizedEmail,
    normalizedEmail,
    displayName: displayName || existing?.displayName || normalizedEmail,
    createdAt: existing?.createdAt || nowIso(),
    lastLoginAt: nowIso(),
    migrationSource: existing?.migrationSource || migrationSource,
  };
  await setDoc(COLLECTIONS.users, uid, payload, { merge: true });
  return payload;
};

const membershipIdFor = ({ churchId, userId }) => `${churchId}_${userId}`;

const getChurchById = async (churchId) => {
  const church = await getDoc(COLLECTIONS.churches, churchId);
  return church ? { churchId: church.id || churchId, ...church } : null;
};

const getMembershipForUser = async (userId, churchId) => {
  if (churchId) {
    const membership = await getDoc(
      COLLECTIONS.memberships,
      membershipIdFor({ churchId, userId }),
    );
    return membership ? { membershipId: membership.id, ...membership } : null;
  }
  const [membership] = await queryDocs(
    COLLECTIONS.memberships,
    [
      { field: "userId", value: userId },
      { field: "status", value: "active" },
    ],
    { limit: 1 },
  );
  return membership ? { membershipId: membership.id, ...membership } : null;
};

const listMembershipsForChurch = async (churchId) => {
  const memberships = await queryDocs(
    COLLECTIONS.memberships,
    [{ field: "churchId", value: churchId }],
    { limit: 500 },
  );
  return memberships.map((membership) => ({
    membershipId: membership.id,
    ...membership,
  }));
};

const listTrustedHumanDevicesForUser = async (userId) => {
  const devices = await queryDocs(
    COLLECTIONS.trustedHumanDevices,
    [{ field: "userId", value: userId }],
    { limit: 100 },
  );
  const rankedDevices = devices
    .map((device) => ({ deviceId: device.id, ...device }))
    .sort(
      (a, b) =>
        new Date(b.lastSeenAt || b.createdAt || 0).getTime() -
        new Date(a.lastSeenAt || a.createdAt || 0).getTime(),
    );

  const byFingerprint = new Map();
  for (const device of rankedDevices) {
    const fingerprintKey =
      String(device.deviceFingerprintHash || "").trim() || device.deviceId;
    const existing = byFingerprint.get(fingerprintKey);
    if (!existing) {
      byFingerprint.set(fingerprintKey, device);
      continue;
    }

    const shouldReplace = Boolean(existing.revokedAt) && !device.revokedAt;
    if (shouldReplace) {
      byFingerprint.set(fingerprintKey, device);
    }
  }

  return Array.from(byFingerprint.values());
};

const listTrustedHumanDevicesForChurch = async (churchId) => {
  const memberships = await listMembershipsForChurch(churchId);
  const activeMemberships = memberships.filter(
    (membership) => membership.status === "active",
  );

  const devicesByUser = await Promise.all(
    activeMemberships.map(async (membership) => ({
      membership,
      user: await getUserByUid(membership.userId),
      devices: await listTrustedHumanDevicesForUser(membership.userId),
    })),
  );

  return devicesByUser.flatMap(({ membership, user, devices }) =>
    devices.map((device) => ({
      ...device,
      membershipId: membership.membershipId,
      churchId: membership.churchId,
      user: user
        ? {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName || "",
          }
        : null,
    })),
  );
};

const getTrustedHumanDeviceByFingerprint = async ({
  userId,
  fingerprintHash,
}) => {
  const devices = await queryDocs(
    COLLECTIONS.trustedHumanDevices,
    [
      { field: "userId", value: userId },
      { field: "deviceFingerprintHash", value: fingerprintHash },
    ],
    { limit: 20 },
  );
  const device = devices.find((item) => !item.revokedAt) || null;
  return device ? { deviceId: device.id, ...device } : null;
};

const createTrustedHumanDevice = async ({
  userId,
  fingerprintHash,
  label,
  platformType,
}) => {
  const existing = await getTrustedHumanDeviceByFingerprint({
    userId,
    fingerprintHash,
  });

  if (existing) {
    const updatedDevice = {
      label: label || existing.label || platformType || "Trusted device",
      platformType: platformType || existing.platformType || null,
      lastSeenAt: nowIso(),
    };
    await setDoc(
      COLLECTIONS.trustedHumanDevices,
      existing.deviceId,
      updatedDevice,
      { merge: true },
    );
    return {
      ...existing,
      ...updatedDevice,
      deviceId: existing.deviceId,
    };
  }

  const deviceId = createId("humanDevice");
  const device = {
    userId,
    deviceFingerprintHash: fingerprintHash,
    label: label || platformType || "Trusted device",
    platformType: platformType || null,
    createdAt: nowIso(),
    lastSeenAt: nowIso(),
    revokedAt: null,
    revokedBy: null,
  };
  await setDoc(COLLECTIONS.trustedHumanDevices, deviceId, device);
  return { deviceId, ...device };
};

const findDocByTokenHash = async (collectionName, token) => {
  const [item] = await queryDocs(
    collectionName,
    [{ field: "tokenHash", value: hashValue(token || "") }],
    { limit: 1 },
  );
  return item ? { id: item.id, ...item } : null;
};

const verifyIdToken = async (idToken) => {
  const auth = requireFirebaseAdmin();
  return auth.verifyIdToken(idToken);
};

const upsertProfileFromVerifiedToken = async (
  verifiedToken,
  displayNameOverride,
) => {
  const email = normalizeEmail(verifiedToken.email || "");
  if (!email) {
    throw httpError(400, "This account is missing an email address.");
  }
  let fromToken = String(
    displayNameOverride ||
      verifiedToken.name ||
      verifiedToken.displayName ||
      "",
  ).trim();

  if (!fromToken) {
    try {
      const auth = requireFirebaseAdmin();
      const record = await auth.getUser(verifiedToken.uid);
      fromToken = String(record.displayName || "").trim();
    } catch (error) {
      logAuthEvent("warn", "auth.profile.display_name", {
        message: error.message,
      });
    }
  }

  return upsertUserProfile({
    uid: verifiedToken.uid,
    email,
    displayName: fromToken || undefined,
  });
};

const buildHumanBootstrap = ({
  req,
  user,
  church,
  membership,
  device,
  profileDisplayName = "",
}) => ({
  authenticated: true,
  sessionKind: SESSION_KIND_HUMAN,
  churchId: church.churchId,
  churchName: church.name || "",
  churchStatus: church.status,
  recoveryEmail: church.recoveryEmail || "",
  csrfToken: ensureSessionCsrfToken(req),
  database: church.contentDatabaseKey,
  uploadPreset: church.cloudinaryUploadPreset || "bpqu4ma5",
  role: membership.role,
  appAccess: membership.appAccess || "view",
  user: {
    uid: user.uid,
    email: user.email,
    displayName: String(profileDisplayName || "").trim(),
  },
  device: {
    deviceId: device?.deviceId || null,
    label: device?.label || null,
    operatorName: null,
    surfaceType: null,
  },
});

const buildWorkstationBootstrap = ({ req, church, workstation }) => ({
  authenticated: true,
  sessionKind: SESSION_KIND_WORKSTATION,
  churchId: church.churchId,
  churchName: church.name || "",
  churchStatus: church.status,
  recoveryEmail: church.recoveryEmail || "",
  csrfToken: req.session?.auth ? ensureSessionCsrfToken(req) : null,
  database: church.contentDatabaseKey,
  uploadPreset: church.cloudinaryUploadPreset || "bpqu4ma5",
  role: null,
  appAccess: workstation.appAccess,
  user: null,
  device: {
    deviceId: workstation.deviceId,
    label: workstation.label,
    operatorName: workstation.lastOperatorName || null,
    surfaceType: null,
  },
});

const buildDisplayBootstrap = ({ church, display }) => ({
  authenticated: true,
  sessionKind: SESSION_KIND_DISPLAY,
  churchId: church.churchId,
  churchName: church.name || "",
  churchStatus: church.status,
  recoveryEmail: church.recoveryEmail || "",
  csrfToken: null,
  database: church.contentDatabaseKey,
  uploadPreset: church.cloudinaryUploadPreset || "bpqu4ma5",
  role: null,
  appAccess: "view",
  user: null,
  device: {
    deviceId: display.deviceId,
    label: display.label,
    operatorName: null,
    surfaceType: display.surfaceType,
  },
});

const buildRealtimeAuthUid = ({ sessionKind, userId, deviceId }) => {
  if (sessionKind === SESSION_KIND_HUMAN && userId) {
    return userId;
  }
  if (sessionKind === SESSION_KIND_WORKSTATION && deviceId) {
    return `workstation_${deviceId}`;
  }
  if (sessionKind === SESSION_KIND_DISPLAY && deviceId) {
    return `display_${deviceId}`;
  }
  throw httpError(401, "A valid authenticated session is required.");
};

export const resolveRequestBootstrap = async (req) => {
  const humanBootstrap = await getHumanBootstrap(req);
  if (humanBootstrap) {
    return humanBootstrap;
  }

  const { workstationToken, displayToken } = parseDeviceTokens(req);
  const workstationBootstrap = await getWorkstationBootstrap(
    req,
    workstationToken,
  );
  if (workstationBootstrap) {
    return workstationBootstrap;
  }

  const displayBootstrap = await getDisplayBootstrap(req, displayToken);
  if (displayBootstrap) {
    return displayBootstrap;
  }

  return null;
};

const getHumanContext = async ({ uid, churchId }) => {
  const user = await getUserByUid(uid);
  if (!user) {
    throw httpError(401, "Authentication required");
  }
  const membership = await getMembershipForUser(uid, churchId);
  if (!membership || membership.status !== "active") {
    throw httpError(403, "No active church membership was found.");
  }
  const church = await getChurchById(membership.churchId);
  if (!church) {
    throw httpError(404, "Church not found");
  }
  return { user, membership, church };
};

const resolveHumanProfileDisplayName = async (user) => {
  const fromProfile = String(user?.displayName || "").trim();
  try {
    const auth = requireFirebaseAdmin();
    const record = await auth.getUser(user.uid);
    const fromAuth = String(record.displayName || "").trim();
    if (fromAuth) {
      return fromAuth;
    }
  } catch (error) {
    logAuthEvent("warn", "auth.bootstrap.display_name", {
      message: error.message,
    });
  }
  return fromProfile;
};

const establishHumanSession = async ({
  req,
  user,
  church,
  membership,
  device,
}) => {
  ensureSessionCsrfToken(req);
  req.session.auth = {
    sessionKind: SESSION_KIND_HUMAN,
    userId: user.uid,
    churchId: church.churchId,
    deviceId: device?.deviceId || null,
    issuedAt: Date.now(),
  };
  const profileDisplayName = await resolveHumanProfileDisplayName(user);
  return buildHumanBootstrap({
    req,
    user,
    church,
    membership,
    device,
    profileDisplayName,
  });
};

const establishWorkstationSession = async ({ req, church, workstation }) => {
  ensureSessionCsrfToken(req);
  req.session.auth = {
    sessionKind: SESSION_KIND_WORKSTATION,
    churchId: church.churchId,
    deviceId: workstation.deviceId,
    issuedAt: Date.now(),
  };
  return buildWorkstationBootstrap({ req, church, workstation });
};

const destroySession = (req) =>
  new Promise((resolve) => {
    if (!req.session) {
      resolve();
      return;
    }
    req.session.destroy(() => resolve());
  });

const createEmailChallenge = async ({
  user,
  church,
  membership,
  fingerprintHash,
  deviceLabel,
  platformType,
}) => {
  const pendingAuthId = createId("pending");
  const code = createNumericCode();
  const payload = {
    userId: user.uid,
    churchId: church.churchId,
    membershipId: membership.membershipId,
    fingerprintHash,
    deviceLabel: deviceLabel || "",
    platformType: platformType || "",
    codeHash: hashValue(code),
    failedAttempts: 0,
    lockedAt: null,
    lastFailedAt: null,
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + EMAIL_CODE_TTL_MS).toISOString(),
  };
  await setDoc(COLLECTIONS.emailCodeChallenges, pendingAuthId, payload);
  const loginWithCodeUrl = `${APP_BASE_URL}/#/login?code=${encodeURIComponent(
    code,
  )}&pendingAuthId=${encodeURIComponent(pendingAuthId)}`;
  const signInEmail = await renderSignInCodeEmail(code, { loginWithCodeUrl });
  await sendEmail({
    to: user.email,
    subject: "Your WorshipSync sign-in code",
    textBody: signInEmail.text,
    htmlBody: signInEmail.html,
    tags: {
      category: "sign_in_code",
      churchId: church.churchId,
      userId: user.uid,
    },
  });
  await addSecurityEvent({
    type: "email_code_sent",
    churchId: church.churchId,
    userId: user.uid,
    label: deviceLabel || null,
  });
  return { requiresEmailCode: true, pendingAuthId };
};

const getEmailChallenge = async (pendingAuthId) => {
  const challenge = await getDoc(
    COLLECTIONS.emailCodeChallenges,
    pendingAuthId,
  );
  return challenge ? { pendingAuthId: challenge.id, ...challenge } : null;
};

const recordFailedEmailChallengeAttempt = async (challenge) => {
  const timestamp = nowIso();
  const failedAttempts = Number(challenge.failedAttempts || 0) + 1;
  const shouldLock = failedAttempts >= EMAIL_CODE_MAX_ATTEMPTS;
  const updates = {
    failedAttempts,
    lastFailedAt: timestamp,
    ...(shouldLock
      ? {
          lockedAt: timestamp,
          expiresAt: timestamp,
        }
      : {}),
  };

  await setDoc(
    COLLECTIONS.emailCodeChallenges,
    challenge.pendingAuthId,
    updates,
    { merge: true },
  );

  await addSecurityEvent({
    type: shouldLock ? "email_code_locked" : "email_code_failed",
    churchId: challenge.churchId,
    userId: challenge.userId,
    pendingAuthId: challenge.pendingAuthId,
    failedAttempts,
  });

  return { failedAttempts, shouldLock };
};

/** Active challenge for this user + device; used to avoid sending a new email on refresh. */
const findActiveEmailChallengeForDevice = async ({
  userId,
  fingerprintHash,
}) => {
  const challenges = await queryDocs(
    COLLECTIONS.emailCodeChallenges,
    [
      { field: "userId", value: userId },
      { field: "fingerprintHash", value: fingerprintHash },
    ],
    { limit: 50 },
  );
  const now = Date.now();
  const valid = challenges.filter((c) => {
    const exp = c.expiresAt ? new Date(c.expiresAt).getTime() : 0;
    return exp > now && !c.lockedAt;
  });
  if (valid.length === 0) {
    return null;
  }
  valid.sort(
    (a, b) =>
      new Date(b.createdAt || 0).getTime() -
      new Date(a.createdAt || 0).getTime(),
  );
  return valid[0];
};

const verifySupportPrincipal = async (req) => {
  const token = getBearerToken(req);
  if (!token) {
    throw httpError(401, "Support authentication required");
  }
  const claims = await verifyIdToken(token);
  if (!claims.worshipsyncSupport) {
    throw httpError(403, "Support access required");
  }
  return claims;
};

const createChurchWithRootAdmin = async ({
  uid,
  email,
  displayName,
  churchName,
}) => {
  const churchId = createId("church");
  const church = {
    churchId,
    name: churchName,
    status: CHURCH_STATUS_ACTIVE,
    adminCount: 1,
    recoveryEmail: normalizeEmail(email),
    contentDatabaseKey: churchId,
    firebaseNamespace: churchId,
    cloudinaryUploadPreset: "bpqu4ma5",
    createdAt: nowIso(),
    createdByUid: uid,
  };
  const membershipId = membershipIdFor({ churchId, userId: uid });
  const membership = {
    membershipId,
    churchId,
    userId: uid,
    role: "admin",
    appAccess: "full",
    status: "active",
    createdAt: nowIso(),
    createdByUid: uid,
  };

  const db = requireFirestore();
  if (db) {
    await db.runTransaction(async (transaction) => {
      const existingMemberships = await transaction.get(
        db
          .collection(COLLECTIONS.memberships)
          .where("userId", "==", uid)
          .where("status", "==", "active")
          .limit(1),
      );
      if (!existingMemberships.empty) {
        throw httpError(409, "This account already belongs to a church.");
      }
      transaction.set(
        db.collection(COLLECTIONS.churches).doc(churchId),
        church,
      );
      transaction.set(
        db.collection(COLLECTIONS.memberships).doc(membershipId),
        membership,
      );
      transaction.set(
        db.collection(COLLECTIONS.users).doc(uid),
        {
          uid,
          email: normalizeEmail(email),
          normalizedEmail: normalizeEmail(email),
          displayName: displayName || email,
          createdAt: nowIso(),
          lastLoginAt: nowIso(),
          migrationSource: "firebase-auth",
        },
        { merge: true },
      );
    });
  } else {
    const existingMembership = await getMembershipForUser(uid);
    if (existingMembership) {
      throw httpError(409, "This account already belongs to a church.");
    }
    await setDoc(COLLECTIONS.churches, churchId, church);
    await setDoc(COLLECTIONS.memberships, membershipId, membership);
    await setDoc(
      COLLECTIONS.users,
      uid,
      {
        uid,
        email: normalizeEmail(email),
        normalizedEmail: normalizeEmail(email),
        displayName: displayName || email,
        createdAt: nowIso(),
        lastLoginAt: nowIso(),
        migrationSource: "firebase-auth",
      },
      { merge: true },
    );
  }

  return { church, membership };
};

const acceptInviteMembership = async ({ invite, user }) => {
  const churchId = invite.churchId;
  const membershipId = membershipIdFor({ churchId, userId: user.uid });
  const db = requireFirestore();

  if (db) {
    const transactionResult = await db.runTransaction(async (transaction) => {
      const inviteRef = db.collection(COLLECTIONS.invites).doc(invite.inviteId);
      const membershipRef = db
        .collection(COLLECTIONS.memberships)
        .doc(membershipId);
      const churchRef = db.collection(COLLECTIONS.churches).doc(churchId);

      const inviteSnap = await transaction.get(inviteRef);
      if (!inviteSnap.exists) {
        throw httpError(404, "Invite not found");
      }
      const inviteData = inviteSnap.data();
      if (inviteData.status !== "pending") {
        throw httpError(400, "This invite is not active");
      }
      if (new Date(inviteData.expiresAt).getTime() < Date.now()) {
        transaction.update(inviteRef, { status: "expired" });
        return { expired: true };
      }

      const userActiveMembershipsSnap = await transaction.get(
        db
          .collection(COLLECTIONS.memberships)
          .where("userId", "==", user.uid)
          .where("status", "==", "active"),
      );
      const inviteMembershipConflict = getInviteMembershipConflict({
        userId: user.uid,
        invitedChurchId: churchId,
        activeMemberships: userActiveMembershipsSnap.docs.map((d) => ({
          userId: d.get("userId"),
          churchId: d.get("churchId"),
          status: d.get("status"),
        })),
      });
      if (inviteMembershipConflict) {
        throw httpError(
          inviteMembershipConflict.statusCode,
          inviteMembershipConflict.message,
        );
      }

      const adminSnapshot = await transaction.get(
        db
          .collection(COLLECTIONS.memberships)
          .where("churchId", "==", churchId)
          .where("role", "==", "admin")
          .where("status", "==", "active"),
      );

      transaction.set(
        membershipRef,
        {
          membershipId,
          churchId,
          userId: user.uid,
          role: invite.role,
          appAccess: invite.appAccess,
          status: "active",
          createdAt: invite.createdAt || nowIso(),
          createdByUid: invite.createdByUid,
        },
        { merge: true },
      );

      const nextAdminCount =
        adminSnapshot.docs.some((doc) => doc.id === membershipId) ||
        invite.role !== "admin"
          ? adminSnapshot.size
          : adminSnapshot.size + 1;
      transaction.update(churchRef, {
        adminCount: nextAdminCount,
        status:
          nextAdminCount > 0 ? CHURCH_STATUS_ACTIVE : CHURCH_STATUS_NEEDS_ADMIN,
      });
      transaction.update(inviteRef, {
        status: "accepted",
        acceptedAt: nowIso(),
      });
      return { expired: false };
    });

    if (transactionResult?.expired) {
      throw httpError(400, "This invite has expired");
    }
  } else {
    const activeRows = await queryDocs(
      COLLECTIONS.memberships,
      [
        { field: "userId", value: user.uid },
        { field: "status", value: "active" },
      ],
      { limit: 25 },
    );
    const inviteMembershipConflict = getInviteMembershipConflict({
      userId: user.uid,
      invitedChurchId: churchId,
      activeMemberships: activeRows,
    });
    if (inviteMembershipConflict) {
      throw httpError(
        inviteMembershipConflict.statusCode,
        inviteMembershipConflict.message,
      );
    }
    await setDoc(
      COLLECTIONS.memberships,
      membershipId,
      {
        membershipId,
        churchId,
        userId: user.uid,
        role: invite.role,
        appAccess: invite.appAccess,
        status: "active",
        createdAt: invite.createdAt || nowIso(),
        createdByUid: invite.createdByUid,
      },
      { merge: true },
    );
    const memberships = await listMembershipsForChurch(churchId);
    const adminCount = memberships.filter(
      (item) => item.role === "admin" && item.status === "active",
    ).length;
    await setDoc(
      COLLECTIONS.churches,
      churchId,
      {
        adminCount,
        status:
          adminCount > 0 ? CHURCH_STATUS_ACTIVE : CHURCH_STATUS_NEEDS_ADMIN,
      },
      { merge: true },
    );
    await setDoc(
      COLLECTIONS.invites,
      invite.inviteId,
      { status: "accepted", acceptedAt: nowIso() },
      { merge: true },
    );
  }
};

const removeChurchMembership = async ({ churchId, userId }) => {
  const membershipId = membershipIdFor({ churchId, userId });
  const db = requireFirestore();
  if (db) {
    await db.runTransaction(async (transaction) => {
      const membershipRef = db
        .collection(COLLECTIONS.memberships)
        .doc(membershipId);
      const churchRef = db.collection(COLLECTIONS.churches).doc(churchId);
      const membershipSnap = await transaction.get(membershipRef);
      if (!membershipSnap.exists) {
        throw httpError(404, "Membership not found");
      }
      const adminSnapshot = await transaction.get(
        db
          .collection(COLLECTIONS.memberships)
          .where("churchId", "==", churchId)
          .where("role", "==", "admin")
          .where("status", "==", "active"),
      );
      transaction.delete(membershipRef);
      const nextAdminCount = Math.max(
        0,
        adminSnapshot.docs.filter((doc) => doc.id !== membershipId).length,
      );
      transaction.update(churchRef, {
        adminCount: nextAdminCount,
        status:
          nextAdminCount > 0 ? CHURCH_STATUS_ACTIVE : CHURCH_STATUS_NEEDS_ADMIN,
      });
    });
  } else {
    const membership = await getDoc(COLLECTIONS.memberships, membershipId);
    if (!membership) {
      throw httpError(404, "Membership not found");
    }
    await deleteDoc(COLLECTIONS.memberships, membershipId);
    const memberships = await listMembershipsForChurch(churchId);
    const adminCount = memberships.filter(
      (item) => item.role === "admin" && item.status === "active",
    ).length;
    await setDoc(
      COLLECTIONS.churches,
      churchId,
      {
        adminCount,
        status:
          adminCount > 0 ? CHURCH_STATUS_ACTIVE : CHURCH_STATUS_NEEDS_ADMIN,
      },
      { merge: true },
    );
  }
};

const demoteAdminMembership = async ({ churchId, userId }) => {
  const membershipId = membershipIdFor({ churchId, userId });
  const db = requireFirestore();
  if (db) {
    await db.runTransaction(async (transaction) => {
      const membershipRef = db
        .collection(COLLECTIONS.memberships)
        .doc(membershipId);
      const churchRef = db.collection(COLLECTIONS.churches).doc(churchId);
      const membershipSnap = await transaction.get(membershipRef);
      if (!membershipSnap.exists) {
        throw httpError(404, "Membership not found");
      }
      const membershipData = membershipSnap.data();
      const adminSnapshot = await transaction.get(
        db
          .collection(COLLECTIONS.memberships)
          .where("churchId", "==", churchId)
          .where("role", "==", "admin")
          .where("status", "==", "active"),
      );
      const nextAdminCount = Math.max(
        0,
        adminSnapshot.docs.filter((doc) => doc.id !== membershipId).length,
      );
      transaction.update(membershipRef, {
        role: "member",
        appAccess: normalizeAppAccess(membershipData.appAccess, "full"),
      });
      transaction.update(churchRef, {
        adminCount: nextAdminCount,
        status:
          nextAdminCount > 0 ? CHURCH_STATUS_ACTIVE : CHURCH_STATUS_NEEDS_ADMIN,
      });
    });
  } else {
    const membership = await getDoc(COLLECTIONS.memberships, membershipId);
    if (!membership) {
      throw httpError(404, "Membership not found");
    }
    await setDoc(
      COLLECTIONS.memberships,
      membershipId,
      {
        role: "member",
        appAccess: normalizeAppAccess(membership.appAccess, "full"),
      },
      { merge: true },
    );
    const memberships = await listMembershipsForChurch(churchId);
    const adminCount = memberships.filter(
      (item) => item.role === "admin" && item.status === "active",
    ).length;
    await setDoc(
      COLLECTIONS.churches,
      churchId,
      {
        adminCount,
        status:
          adminCount > 0 ? CHURCH_STATUS_ACTIVE : CHURCH_STATUS_NEEDS_ADMIN,
      },
      { merge: true },
    );
  }
};

const updateMemberAppAccess = async ({ churchId, userId, appAccess }) => {
  const membershipId = membershipIdFor({ churchId, userId });
  const db = requireFirestore();
  if (db) {
    await db.runTransaction(async (transaction) => {
      const membershipRef = db
        .collection(COLLECTIONS.memberships)
        .doc(membershipId);
      const membershipSnap = await transaction.get(membershipRef);
      if (!membershipSnap.exists) {
        throw httpError(404, "Membership not found");
      }
      const membershipData = membershipSnap.data();
      if (membershipData.status !== "active") {
        throw httpError(400, "Only active members can be updated.");
      }
      transaction.update(membershipRef, { appAccess });
    });
  } else {
    const membership = await getDoc(COLLECTIONS.memberships, membershipId);
    if (!membership) {
      throw httpError(404, "Membership not found");
    }
    if (membership.status !== "active") {
      throw httpError(400, "Only active members can be updated.");
    }
    await setDoc(
      COLLECTIONS.memberships,
      membershipId,
      { appAccess },
      { merge: true },
    );
  }
};

const approveRecoveryRequest = async (recoveryRequest) => {
  const membershipId = membershipIdFor({
    churchId: recoveryRequest.churchId,
    userId: recoveryRequest.requesterUid,
  });
  const db = requireFirestore();
  if (db) {
    const transactionResult = await db.runTransaction(async (transaction) => {
      const requestRef = db
        .collection(COLLECTIONS.adminRecoveryRequests)
        .doc(recoveryRequest.requestId);
      const churchRef = db
        .collection(COLLECTIONS.churches)
        .doc(recoveryRequest.churchId);
      const membershipRef = db
        .collection(COLLECTIONS.memberships)
        .doc(membershipId);
      const requestSnap = await transaction.get(requestRef);
      if (!requestSnap.exists) {
        throw httpError(404, "Recovery request not found");
      }
      const requestData = requestSnap.data();
      if (requestData.status !== "pending") {
        throw httpError(400, "This recovery request is not active");
      }
      if (new Date(requestData.expiresAt).getTime() < Date.now()) {
        transaction.update(requestRef, { status: "expired" });
        return { expired: true };
      }

      const adminSnapshot = await transaction.get(
        db
          .collection(COLLECTIONS.memberships)
          .where("churchId", "==", recoveryRequest.churchId)
          .where("role", "==", "admin")
          .where("status", "==", "active"),
      );

      transaction.set(
        membershipRef,
        {
          membershipId,
          churchId: recoveryRequest.churchId,
          userId: recoveryRequest.requesterUid,
          role: "admin",
          appAccess: "full",
          status: "active",
          createdAt: requestData.createdAt || nowIso(),
          createdByUid: "recovery",
        },
        { merge: true },
      );

      const nextAdminCount = adminSnapshot.docs.some(
        (doc) => doc.id === membershipId,
      )
        ? adminSnapshot.size
        : adminSnapshot.size + 1;
      transaction.update(churchRef, {
        adminCount: nextAdminCount,
        status: CHURCH_STATUS_ACTIVE,
      });
      transaction.update(requestRef, {
        status: "approved",
        approvedAt: nowIso(),
        approvedBy: "recovery-link",
      });
      return { expired: false };
    });

    if (transactionResult?.expired) {
      throw httpError(400, "This recovery request has expired");
    }
  } else {
    await setDoc(
      COLLECTIONS.memberships,
      membershipId,
      {
        membershipId,
        churchId: recoveryRequest.churchId,
        userId: recoveryRequest.requesterUid,
        role: "admin",
        appAccess: "full",
        status: "active",
        createdAt: nowIso(),
        createdByUid: "recovery",
      },
      { merge: true },
    );
    const memberships = await listMembershipsForChurch(
      recoveryRequest.churchId,
    );
    const adminCount = memberships.filter(
      (item) => item.role === "admin" && item.status === "active",
    ).length;
    await setDoc(
      COLLECTIONS.churches,
      recoveryRequest.churchId,
      { adminCount, status: CHURCH_STATUS_ACTIVE },
      { merge: true },
    );
    await setDoc(
      COLLECTIONS.adminRecoveryRequests,
      recoveryRequest.requestId,
      {
        status: "approved",
        approvedAt: nowIso(),
        approvedBy: "recovery-link",
      },
      { merge: true },
    );
  }
};

const supportRecoverAdminMembership = async ({ churchId, userId }) => {
  const membershipId = membershipIdFor({ churchId, userId });
  const db = requireFirestore();
  if (db) {
    await db.runTransaction(async (transaction) => {
      const churchRef = db.collection(COLLECTIONS.churches).doc(churchId);
      const membershipRef = db
        .collection(COLLECTIONS.memberships)
        .doc(membershipId);
      const adminSnapshot = await transaction.get(
        db
          .collection(COLLECTIONS.memberships)
          .where("churchId", "==", churchId)
          .where("role", "==", "admin")
          .where("status", "==", "active"),
      );
      transaction.set(
        membershipRef,
        {
          membershipId,
          churchId,
          userId,
          role: "admin",
          appAccess: "full",
          status: "active",
          createdAt: nowIso(),
          createdByUid: "support",
        },
        { merge: true },
      );
      const nextAdminCount = adminSnapshot.docs.some(
        (doc) => doc.id === membershipId,
      )
        ? adminSnapshot.size
        : adminSnapshot.size + 1;
      transaction.update(churchRef, {
        adminCount: nextAdminCount,
        status: CHURCH_STATUS_ACTIVE,
      });
    });
  } else {
    await setDoc(
      COLLECTIONS.memberships,
      membershipId,
      {
        membershipId,
        churchId,
        userId,
        role: "admin",
        appAccess: "full",
        status: "active",
        createdAt: nowIso(),
        createdByUid: "support",
      },
      { merge: true },
    );
    const memberships = await listMembershipsForChurch(churchId);
    const adminCount = memberships.filter(
      (item) => item.role === "admin" && item.status === "active",
    ).length;
    await setDoc(
      COLLECTIONS.churches,
      churchId,
      { adminCount, status: CHURCH_STATUS_ACTIVE },
      { merge: true },
    );
  }
};

const getHumanBootstrap = async (req) => {
  const authSession = req.session?.auth;
  if (!authSession || authSession.sessionKind !== SESSION_KIND_HUMAN) {
    return null;
  }
  if (sessionExpired(authSession)) {
    await destroySession(req);
    return null;
  }
  let humanContext;
  try {
    humanContext = await getHumanContext({
      uid: authSession.userId,
      churchId: authSession.churchId,
    });
  } catch (error) {
    if (!isRecoverableInvalidHumanSessionError(error)) {
      throw error;
    }
    logAuthEvent("warn", "auth.session.invalid_human_recovered", {
      message: error.message,
      userId: authSession.userId || null,
      churchId: authSession.churchId || null,
    });
    await destroySession(req);
    return null;
  }
  const { user, membership, church } = humanContext;
  const devices = await listTrustedHumanDevicesForUser(user.uid);
  const device =
    devices.find(
      (item) => item.deviceId === authSession.deviceId && !item.revokedAt,
    ) || null;
  if (authSession.deviceId && !device) {
    await destroySession(req);
    return null;
  }
  const profileDisplayName = await resolveHumanProfileDisplayName(user);
  return buildHumanBootstrap({
    req,
    user,
    church,
    membership,
    device,
    profileDisplayName,
  });
};

const resolveWorkstationFromSession = async (req) => {
  const authSession = req.session?.auth;
  if (!authSession || authSession.sessionKind !== SESSION_KIND_WORKSTATION) {
    return null;
  }
  if (sessionExpired(authSession)) {
    await destroySession(req);
    return null;
  }
  const workstation = await getDoc(
    COLLECTIONS.workstationDevices,
    authSession.deviceId,
  );
  if (!workstation || workstation.revokedAt) {
    return null;
  }
  const church = await getChurchById(
    authSession.churchId || workstation.churchId,
  );
  if (!church) return null;
  return {
    church,
    workstation: { deviceId: workstation.id, ...workstation },
  };
};

const getWorkstationBootstrap = async (req, token) => {
  const sessionResolved = await resolveWorkstationFromSession(req);
  if (sessionResolved) {
    return buildWorkstationBootstrap({
      req,
      church: sessionResolved.church,
      workstation: sessionResolved.workstation,
    });
  }
  if (!token) return null;
  const [workstation] = await queryDocs(
    COLLECTIONS.workstationDevices,
    [{ field: "credentialHash", value: hashValue(token) }],
    { limit: 1 },
  );
  if (!workstation || workstation.revokedAt) {
    return null;
  }
  const church = await getChurchById(workstation.churchId);
  if (!church) return null;
  return buildWorkstationBootstrap({
    req,
    church,
    workstation: { deviceId: workstation.id, ...workstation },
  });
};

const getDisplayBootstrap = async (req, token) => {
  if (!token) return null;
  const [display] = await queryDocs(
    COLLECTIONS.displayDevices,
    [{ field: "credentialHash", value: hashValue(token) }],
    { limit: 1 },
  );
  if (!display || display.revokedAt) {
    return null;
  }
  const church = await getChurchById(display.churchId);
  if (!church) return null;
  return buildDisplayBootstrap({
    church,
    display: { deviceId: display.id, ...display },
  });
};

const requireHumanSession = async (req) => {
  const bootstrap = await getHumanBootstrap(req);
  if (!bootstrap) {
    throw httpError(401, "Authentication required");
  }
  return bootstrap;
};

const requireAdminSession = async (req, churchId) => {
  const bootstrap = await requireHumanSession(req);
  if (bootstrap.role !== "admin" || bootstrap.churchId !== churchId) {
    throw httpError(403, "Admin access required");
  }
  return bootstrap;
};

const resolveAuthenticatedWorkstation = async (req) => {
  const fromSession = await resolveWorkstationFromSession(req);
  if (fromSession) {
    return fromSession.workstation;
  }
  const { workstationToken } = parseDeviceTokens(req);
  if (!workstationToken) {
    throw httpError(401, "Workstation authentication required");
  }
  const [workstation] = await queryDocs(
    COLLECTIONS.workstationDevices,
    [{ field: "credentialHash", value: hashValue(workstationToken) }],
    { limit: 1 },
  );
  if (!workstation || workstation.revokedAt) {
    throw httpError(401, "Workstation authentication required");
  }
  return { deviceId: workstation.id, ...workstation };
};

export const authHandlers = {
  async getAuthMe(req, res) {
    try {
      const humanBootstrap = await getHumanBootstrap(req);
      if (humanBootstrap) {
        return res.json(humanBootstrap);
      }

      const { workstationToken, displayToken } = parseDeviceTokens(req);
      const workstationBootstrap = await getWorkstationBootstrap(
        req,
        workstationToken,
      );
      if (workstationBootstrap) {
        return res.json(workstationBootstrap);
      }

      const displayBootstrap = await getDisplayBootstrap(req, displayToken);
      if (displayBootstrap) {
        return res.json(displayBootstrap);
      }

      return res.json({
        authenticated: false,
        sessionKind: null,
        csrfToken: null,
        firebaseAdminConfigured: authRuntimeInfo.hasFirebaseAdmin,
      });
    } catch (error) {
      logAuthEvent("error", "auth.me.error", { message: error.message });
      return res.status(error.statusCode || 500).json({
        authenticated: false,
        errorMessage: error.message || "Could not validate the current session",
      });
    }
  },

  async handleResendWebhook(req, res) {
    try {
      const deliveryId = String(req.headers["svix-id"] || "").trim();
      if (!deliveryId) {
        throw httpError(400, "Webhook delivery ID is required.");
      }

      const event = verifyResendWebhook(req);

      const recipient = Array.isArray(event.data?.to)
        ? event.data.to[0] || ""
        : "";
      const tags = event.data?.tags || {};

      const recordedEvent = await addWebhookDeliveryEvent(deliveryId, {
        type: "email_webhook_received",
        provider: "resend",
        webhookDeliveryId: deliveryId,
        webhookEventType: event.type,
        emailId: event.data?.email_id || null,
        churchId: tags.churchId || null,
        userId: tags.userId || tags.requesterUid || null,
        inviteId: tags.inviteId || null,
        requestId: tags.requestId || null,
        recipient,
        tags,
        providerCreatedAt: event.created_at,
        details: resendWebhookEventDetails(event),
      });

      if (!recordedEvent) {
        return res.status(200).json({ success: true, duplicate: true });
      }

      if (
        event.type === "email.bounced" ||
        event.type === "email.failed" ||
        event.type === "email.complained" ||
        event.type === "email.suppressed"
      ) {
        logAuthEvent("warn", "email.webhook.issue", {
          provider: "resend",
          webhookDeliveryId: deliveryId,
          webhookEventType: event.type,
          emailId: event.data?.email_id || null,
          recipient,
          tags,
        });
      }

      return res.status(200).json({ success: true });
    } catch (error) {
      logAuthEvent("warn", "email.webhook.error", {
        message: error.message,
        deliveryId: String(req.headers["svix-id"] || ""),
      });
      return res.status(error.statusCode || 400).json({
        success: false,
        errorMessage: error.message || "Could not process webhook",
      });
    }
  },

  async createSharedDataToken(req, res) {
    try {
      const bootstrap = await resolveRequestBootstrap(req);
      if (!bootstrap?.authenticated || !bootstrap.database) {
        throw httpError(401, "Authentication required");
      }

      const auth = requireFirebaseAdmin();
      const uid = buildRealtimeAuthUid({
        sessionKind: bootstrap.sessionKind,
        userId: bootstrap.user?.uid || null,
        deviceId: bootstrap.device?.deviceId || null,
      });

      const token = await auth.createCustomToken(uid, {
        worshipsyncRealtime: true,
        sessionKind: bootstrap.sessionKind,
        churchId: bootstrap.churchId || null,
        database: bootstrap.database,
        appAccess: bootstrap.appAccess || "view",
        role: bootstrap.role || null,
        deviceId: bootstrap.device?.deviceId || null,
      });

      return res.json({
        success: true,
        token,
        database: bootstrap.database,
      });
    } catch (error) {
      logAuthEvent("warn", "shared-data-token.error", {
        message: error.message,
      });
      return res.status(error.statusCode || 500).json({
        success: false,
        errorMessage: error.message || "Could not prepare live data access",
      });
    }
  },

  async createChurchAccount(req, res) {
    try {
      enforceRateLimit({
        scope: "church-create",
        key: getClientIp(req),
        limit: 5,
        windowMs: 15 * 60 * 1000,
        blockMs: 15 * 60 * 1000,
      });

      const { churchName, adminName, idToken, deviceLabel, platform } =
        req.body || {};
      if (!churchName || !adminName || !idToken) {
        throw httpError(
          400,
          "Church name, admin name, and identity token are required.",
        );
      }

      const verified = await verifyIdToken(idToken);
      const user = await upsertProfileFromVerifiedToken(verified, adminName);
      const auth = requireFirebaseAdmin();
      if ((verified.name || "") !== adminName.trim()) {
        await auth.updateUser(verified.uid, { displayName: adminName.trim() });
      }

      const { church, membership } = await createChurchWithRootAdmin({
        uid: verified.uid,
        email: verified.email,
        displayName: adminName.trim(),
        churchName: churchName.trim(),
      });

      const pending = await createEmailChallenge({
        user,
        church,
        membership,
        fingerprintHash: readDeviceFingerprint(req.body),
        deviceLabel,
        platformType: platform,
      });

      await addSecurityEvent({
        type: "church_created",
        churchId: church.churchId,
        userId: user.uid,
      });

      return res.json({
        success: true,
        churchId: church.churchId,
        ...pending,
      });
    } catch (error) {
      logAuthEvent("error", "church.create.error", { message: error.message });
      return res.status(error.statusCode || 500).json({
        success: false,
        errorMessage: error.message || "Could not create church account",
      });
    }
  },

  async createHumanSession(req, res) {
    try {
      enforceRateLimit({
        scope: "login",
        key: `${getClientIp(req)}:${hashValue(req.body?.idToken || "")}`,
        limit: 10,
        windowMs: 15 * 60 * 1000,
        blockMs: 15 * 60 * 1000,
      });

      const { idToken, deviceLabel, platform, requestNewCode } = req.body || {};
      if (!idToken) {
        throw httpError(400, "Identity token is required.");
      }

      const verified = await verifyIdToken(idToken);
      const user = await upsertProfileFromVerifiedToken(verified);
      const { church, membership } = await getHumanContext({
        uid: verified.uid,
      });
      const fingerprintHash = readDeviceFingerprint(req.body);
      const trustedDevice = await getTrustedHumanDeviceByFingerprint({
        userId: user.uid,
        fingerprintHash,
      });

      if (trustedDevice) {
        await setDoc(
          COLLECTIONS.trustedHumanDevices,
          trustedDevice.deviceId,
          { lastSeenAt: nowIso() },
          { merge: true },
        );
        const bootstrap = await establishHumanSession({
          req,
          user,
          church,
          membership,
          device: trustedDevice,
        });
        await addSecurityEvent({
          type: "human_login_trusted_device",
          churchId: church.churchId,
          userId: user.uid,
          deviceId: trustedDevice.deviceId,
        });
        return res.json({ success: true, bootstrap });
      }

      const existingChallenge = await findActiveEmailChallengeForDevice({
        userId: user.uid,
        fingerprintHash,
      });
      if (existingChallenge) {
        return res.json({
          success: true,
          requiresEmailCode: true,
          pendingAuthId: existingChallenge.id,
        });
      }

      // Session restore (requestNewCode: false): do not email; user must sign in or use Resend.
      if (requestNewCode === false) {
        return res.json({
          success: true,
          requiresEmailCode: false,
        });
      }

      const pending = await createEmailChallenge({
        user,
        church,
        membership,
        fingerprintHash,
        deviceLabel,
        platformType: platform,
      });
      return res.json({ success: true, ...pending });
    } catch (error) {
      logAuthEvent("warn", "auth.session.error", { message: error.message });
      return res.status(error.statusCode || 500).json({
        success: false,
        errorMessage: error.message || "Could not sign in",
      });
    }
  },

  async resendEmailCode(req, res) {
    try {
      enforceRateLimit({
        scope: "resend-email-code",
        key: `${getClientIp(req)}:${hashValue(req.body?.idToken || "")}`,
        limit: 5,
        windowMs: 15 * 60 * 1000,
        blockMs: 15 * 60 * 1000,
      });

      const { idToken, pendingAuthId, deviceLabel, platform } = req.body || {};
      if (!idToken) {
        throw httpError(400, "Identity token is required.");
      }

      const verified = await verifyIdToken(idToken);
      const user = await upsertProfileFromVerifiedToken(verified);
      const { church, membership } = await getHumanContext({
        uid: verified.uid,
      });
      const fingerprintHash = readDeviceFingerprint(req.body);

      const trustedDevice = await getTrustedHumanDeviceByFingerprint({
        userId: user.uid,
        fingerprintHash,
      });

      if (trustedDevice) {
        await setDoc(
          COLLECTIONS.trustedHumanDevices,
          trustedDevice.deviceId,
          { lastSeenAt: nowIso() },
          { merge: true },
        );
        const bootstrap = await establishHumanSession({
          req,
          user,
          church,
          membership,
          device: trustedDevice,
        });
        await addSecurityEvent({
          type: "human_login_trusted_device",
          churchId: church.churchId,
          userId: user.uid,
          deviceId: trustedDevice.deviceId,
        });
        return res.json({ success: true, bootstrap });
      }

      if (pendingAuthId) {
        const challenge = await getEmailChallenge(pendingAuthId);
        if (
          challenge &&
          challenge.userId === user.uid &&
          challenge.fingerprintHash === fingerprintHash
        ) {
          await deleteDoc(COLLECTIONS.emailCodeChallenges, pendingAuthId);
        }
      }

      const pending = await createEmailChallenge({
        user,
        church,
        membership,
        fingerprintHash,
        deviceLabel,
        platformType: platform,
      });
      return res.json({ success: true, ...pending });
    } catch (error) {
      logAuthEvent("warn", "auth.resend-email-code.error", {
        message: error.message,
      });
      return res.status(error.statusCode || 500).json({
        success: false,
        errorMessage: error.message || "Could not resend the code",
      });
    }
  },

  async verifyEmailCode(req, res) {
    try {
      enforceRateLimit({
        scope: "verify-email-code",
        key: `${getClientIp(req)}:${req.body?.pendingAuthId || "unknown"}`,
        limit: 10,
        windowMs: 15 * 60 * 1000,
        blockMs: 15 * 60 * 1000,
      });

      const { pendingAuthId, code, deviceLabel, platform } = req.body || {};
      if (!pendingAuthId || !code) {
        throw httpError(400, "Pending sign-in and code are required.");
      }

      const challenge = await getEmailChallenge(pendingAuthId);
      if (!challenge) {
        throw httpError(
          400,
          "This sign-in code has expired. Try signing in again.",
        );
      }
      if (new Date(challenge.expiresAt).getTime() < Date.now()) {
        await deleteDoc(COLLECTIONS.emailCodeChallenges, pendingAuthId);
        throw httpError(
          400,
          "This sign-in code has expired. Try signing in again.",
        );
      }
      if (challenge.lockedAt) {
        throw httpError(
          400,
          "This sign-in code has been locked after too many attempts. Sign in again to get a new code.",
        );
      }
      if (challenge.codeHash !== hashValue(code)) {
        const { shouldLock } =
          await recordFailedEmailChallengeAttempt(challenge);
        if (shouldLock) {
          throw httpError(
            400,
            "This sign-in code has been locked after too many attempts. Sign in again to get a new code.",
          );
        }
        throw httpError(400, "That code is not valid.");
      }

      const { user, church, membership } = await getHumanContext({
        uid: challenge.userId,
        churchId: challenge.churchId,
      });
      const device = await createTrustedHumanDevice({
        userId: user.uid,
        fingerprintHash: challenge.fingerprintHash,
        label: deviceLabel || challenge.deviceLabel,
        platformType: platform || challenge.platformType,
      });
      const bootstrap = await establishHumanSession({
        req,
        user,
        church,
        membership,
        device,
      });
      await deleteDoc(COLLECTIONS.emailCodeChallenges, pendingAuthId);

      await addSecurityEvent({
        type: "human_login_verified",
        churchId: church.churchId,
        userId: user.uid,
        deviceId: device.deviceId,
      });

      return res.json({ success: true, bootstrap });
    } catch (error) {
      logAuthEvent("warn", "email-code.verify.error", {
        message: error.message,
      });
      return res.status(error.statusCode || 500).json({
        success: false,
        errorMessage: error.message || "Could not verify the sign-in code",
      });
    }
  },

  async logout(req, res) {
    try {
      assertCsrf(req);
      await destroySession(req);
      res.clearCookie(sessionCookieName, {
        path: process.env.AUTH_COOKIE_PATH || "/",
        domain: process.env.AUTH_COOKIE_DOMAIN || undefined,
      });
      return res.json({ success: true });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        errorMessage: error.message || "Could not sign out",
      });
    }
  },

  async forgotPassword(req, res) {
    try {
      const email = normalizeEmail(req.body?.email);
      if (!email) {
        throw httpError(400, "Email is required.");
      }
      enforceRateLimit({
        scope: "forgot-password",
        key: `${getClientIp(req)}:${email}`,
        limit: 5,
        windowMs: 15 * 60 * 1000,
        blockMs: 15 * 60 * 1000,
      });

      try {
        const auth = requireFirebaseAdmin();
        const resetLink = await auth.generatePasswordResetLink(email);
        const hostedResetUrl = buildResetUrlFromFirebaseLink(resetLink);
        const passwordResetEmail =
          await renderPasswordResetEmail(hostedResetUrl);
        await sendEmail({
          to: email,
          subject: "Reset your WorshipSync password",
          textBody: passwordResetEmail.text,
          htmlBody: passwordResetEmail.html,
          tags: {
            category: "password_reset",
          },
        });
      } catch (error) {
        logAuthEvent("warn", "forgot-password.generate-link.failed", {
          email,
          message: error.message,
        });
      }

      await addSecurityEvent({
        type: "forgot_password_requested",
        email,
      });

      return res.json({ success: true });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        errorMessage: error.message || "Could not start password reset",
      });
    }
  },

  async listTrustedHumanDevices(req, res) {
    try {
      const admin = await requireHumanSession(req);
      await requireAdminSession(req, admin.churchId);
      const devices = await listTrustedHumanDevicesForChurch(admin.churchId);
      return res.json({ success: true, devices });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        errorMessage: error.message,
      });
    }
  },

  async revokeTrustedHumanDevice(req, res) {
    try {
      assertCsrf(req);
      const admin = await requireHumanSession(req);
      await requireAdminSession(req, admin.churchId);
      const device = await getDoc(
        COLLECTIONS.trustedHumanDevices,
        req.params.deviceId,
      );
      if (!device) {
        throw httpError(404, "Trusted device not found");
      }
      const membership = await getMembershipForUser(
        device.userId,
        admin.churchId,
      );
      if (!membership || membership.status !== "active") {
        throw httpError(404, "Trusted device not found");
      }
      await setDoc(
        COLLECTIONS.trustedHumanDevices,
        req.params.deviceId,
        {
          revokedAt: nowIso(),
          revokedBy: admin.user.uid,
        },
        { merge: true },
      );
      await addSecurityEvent({
        type: "trusted_device_revoked",
        churchId: admin.churchId,
        userId: admin.user.uid,
        targetUserId: device.userId,
        deviceId: req.params.deviceId,
      });
      return res.json({ success: true });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        errorMessage: error.message,
      });
    }
  },

  async listChurchMembers(req, res) {
    try {
      await requireAdminSession(req, req.params.churchId);
      const memberships = await listMembershipsForChurch(req.params.churchId);
      const members = await Promise.all(
        memberships.map(async (membership) => ({
          ...membership,
          user: await getUserByUid(membership.userId),
        })),
      );
      return res.json({ success: true, members });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        errorMessage: error.message,
      });
    }
  },

  async listChurchInvites(req, res) {
    try {
      await requireAdminSession(req, req.params.churchId);
      const invites = await queryDocs(
        COLLECTIONS.invites,
        [{ field: "churchId", value: req.params.churchId }],
        { limit: 200 },
      );
      const pendingInvites = invites
        .filter((invite) => invite.status === "pending")
        .sort(
          (a, b) =>
            new Date(b.createdAt || 0).getTime() -
            new Date(a.createdAt || 0).getTime(),
        );
      return res.json({
        success: true,
        invites: pendingInvites.map((invite) =>
          sanitizeInviteForClient(invite),
        ),
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        errorMessage: error.message,
      });
    }
  },

  async updateRecoveryEmail(req, res) {
    try {
      assertCsrf(req);
      const admin = await requireAdminSession(req, req.params.churchId);
      const recoveryEmail = normalizeEmail(req.body?.recoveryEmail);
      if (!recoveryEmail) {
        throw httpError(400, "Recovery email is required.");
      }
      const church = await getChurchById(req.params.churchId);
      if (!church) {
        throw httpError(404, "Church not found");
      }
      await setDoc(
        COLLECTIONS.churches,
        req.params.churchId,
        { recoveryEmail },
        { merge: true },
      );
      await addSecurityEvent({
        type: "recovery_email_updated",
        churchId: req.params.churchId,
        userId: admin.user.uid,
        recoveryEmail,
      });
      return res.json({
        success: true,
        church: {
          churchId: req.params.churchId,
          recoveryEmail,
        },
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        errorMessage: error.message,
      });
    }
  },

  async createInvite(req, res) {
    try {
      assertCsrf(req);
      const admin = await requireAdminSession(req, req.params.churchId);
      const email = normalizeEmail(req.body?.email);
      const role = req.body?.role || "admin";
      const appAccess = req.body?.appAccess || "full";
      if (!email) {
        throw httpError(400, "Email is required.");
      }
      enforceRateLimit({
        scope: "invite-create",
        key: `${req.params.churchId}:${admin.user.uid}`,
        limit: 50,
        windowMs: 60 * 60 * 1000,
        blockMs: 60 * 60 * 1000,
      });

      const rawToken = `${createNumericCode()}-${crypto.randomUUID()}`;
      const inviteId = createId("invite");
      const invite = {
        inviteId,
        churchId: req.params.churchId,
        email,
        role,
        appAccess,
        status: "pending",
        tokenHash: hashValue(rawToken),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
        createdAt: nowIso(),
        acceptedAt: null,
        createdByUid: admin.user.uid,
      };
      await setDoc(COLLECTIONS.invites, inviteId, invite);
      const church = await getChurchById(req.params.churchId);
      if (!church) {
        throw httpError(404, "Church not found");
      }
      const churchNameTrimmed = church.name ? String(church.name).trim() : "";
      const churchName = churchNameTrimmed || "your church";
      const churchNameSubject = churchNameTrimmed || "Your church";
      const inviteLink = buildInviteUrl(rawToken);
      const inviteEmail = await renderInviteEmail(inviteLink, { churchName });
      await sendEmail({
        to: email,
        subject: `${churchNameSubject} invites you to join WorshipSync`,
        textBody: inviteEmail.text,
        htmlBody: inviteEmail.html,
        tags: {
          category: "church_invite",
          churchId: req.params.churchId,
          inviteId,
          role,
        },
      });
      await addSecurityEvent({
        type: "invite_created",
        churchId: req.params.churchId,
        userId: admin.user.uid,
        inviteId,
        email,
      });
      return res.json({
        success: true,
        invite: sanitizeInviteForClient({
          ...invite,
          inviteLink,
        }),
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        errorMessage: error.message,
      });
    }
  },

  async getInvitePreview(req, res) {
    try {
      enforceRateLimit({
        scope: "invite-preview",
        key: getClientIp(req),
        limit: 60,
        windowMs: 15 * 60 * 1000,
        blockMs: 15 * 60 * 1000,
      });
      const token = String(req.query?.token || "").trim();
      if (!token) {
        throw httpError(400, "Invite token is required.");
      }
      const invite = await findDocByTokenHash(COLLECTIONS.invites, token);
      if (!invite) {
        throw httpError(404, "Invite not found.");
      }
      const church = await getChurchById(invite.churchId);
      const churchName =
        (church && church.name && String(church.name).trim()) || "your church";
      return res.json({
        success: true,
        churchName,
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        errorMessage: error.message || "Could not load invite details",
      });
    }
  },

  async acceptInvite(req, res) {
    try {
      enforceRateLimit({
        scope: "invite-accept",
        key: `${getClientIp(req)}:${hashValue(req.body?.token || "")}`,
        limit: 10,
        windowMs: 30 * 60 * 1000,
        blockMs: 30 * 60 * 1000,
      });

      const token = req.body?.token || "";
      if (!token) {
        throw httpError(400, "Invite token is required.");
      }
      const invite = await findDocByTokenHash(COLLECTIONS.invites, token);
      if (!invite || invite.status !== "pending") {
        throw httpError(400, "This invite is not active.");
      }
      if (new Date(invite.expiresAt).getTime() < Date.now()) {
        await setDoc(
          COLLECTIONS.invites,
          invite.inviteId,
          { status: "expired" },
          { merge: true },
        );
        throw httpError(400, "This invite has expired.");
      }

      const idToken = String(req.body?.idToken || "").trim();
      if (!idToken) {
        throw httpError(
          401,
          "Sign in with the invited email address before accepting this invite.",
        );
      }
      const verified = await verifyIdToken(idToken);
      if (normalizeEmail(verified.email || "") !== invite.email) {
        throw httpError(403, "This invite is for a different email address.");
      }
      const user = await upsertProfileFromVerifiedToken(verified);

      await acceptInviteMembership({ invite, user });
      await addSecurityEvent({
        type: "invite_accepted",
        churchId: invite.churchId,
        userId: user.uid,
        inviteId: invite.inviteId,
      });

      return res.json({
        success: true,
        email: invite.email,
        churchId: invite.churchId,
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        errorMessage: error.message || "Could not accept this invite",
      });
    }
  },

  async removeAdmin(req, res) {
    try {
      assertCsrf(req);
      const admin = await requireAdminSession(req, req.params.churchId);
      const targetUserId = req.params.userId;
      if (targetUserId === admin.user.uid) {
        throw httpError(
          400,
          "Cannot remove your own admin access. Ask another church admin for help.",
        );
      }
      const memberships = await listMembershipsForChurch(req.params.churchId);
      const targetMembership = memberships.find(
        (m) => m.userId === targetUserId,
      );
      if (!targetMembership) {
        throw httpError(404, "Membership not found");
      }
      if (
        targetMembership.role !== "admin" ||
        targetMembership.status !== "active"
      ) {
        throw httpError(400, "That member is not an active church admin.");
      }
      const activeAdmins = memberships.filter(
        (m) => m.role === "admin" && m.status === "active",
      );
      if (activeAdmins.length <= 1) {
        throw httpError(
          400,
          "Cannot remove the last admin for this church. Invite another admin first.",
        );
      }
      await demoteAdminMembership({
        churchId: req.params.churchId,
        userId: targetUserId,
      });
      const church = await getChurchById(req.params.churchId);
      await addSecurityEvent({
        type: "admin_removed",
        churchId: req.params.churchId,
        userId: admin.user.uid,
        targetUserId: req.params.userId,
      });
      return res.json({ success: true, church });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        errorMessage: error.message,
      });
    }
  },

  async removeMember(req, res) {
    try {
      assertCsrf(req);
      const admin = await requireAdminSession(req, req.params.churchId);
      const targetUserId = req.params.userId;
      if (targetUserId === admin.user.uid) {
        throw httpError(
          400,
          "Cannot remove your own membership. Ask another church admin for help.",
        );
      }
      const memberships = await listMembershipsForChurch(req.params.churchId);
      const targetMembership = memberships.find(
        (membership) =>
          membership.userId === targetUserId && membership.status === "active",
      );
      if (!targetMembership) {
        throw httpError(404, "Membership not found");
      }
      if (targetMembership.role === "admin") {
        const activeAdmins = memberships.filter(
          (membership) =>
            membership.role === "admin" && membership.status === "active",
        );
        if (activeAdmins.length <= 1) {
          throw httpError(
            400,
            "Cannot remove the last admin for this church. Invite another admin first.",
          );
        }
      }
      await removeChurchMembership({
        churchId: req.params.churchId,
        userId: targetUserId,
      });
      await addSecurityEvent({
        type: "member_removed",
        churchId: req.params.churchId,
        userId: admin.user.uid,
        targetUserId,
      });
      return res.json({ success: true });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        errorMessage: error.message,
      });
    }
  },

  async updateMemberAccess(req, res) {
    try {
      assertCsrf(req);
      const admin = await requireAdminSession(req, req.params.churchId);
      const appAccess = normalizeAppAccess(req.body?.appAccess, "");
      if (!appAccess) {
        throw httpError(400, "Choose a valid access level.");
      }
      const memberships = await listMembershipsForChurch(req.params.churchId);
      const targetMembership = memberships.find(
        (membership) =>
          membership.userId === req.params.userId &&
          membership.status === "active",
      );
      if (!targetMembership) {
        throw httpError(404, "Membership not found");
      }
      if (targetMembership.role === "admin" && appAccess !== "full") {
        throw httpError(400, "Admins must keep full access.");
      }
      await updateMemberAppAccess({
        churchId: req.params.churchId,
        userId: req.params.userId,
        appAccess,
      });
      await addSecurityEvent({
        type: "member_access_updated",
        churchId: req.params.churchId,
        userId: admin.user.uid,
        targetUserId: req.params.userId,
        appAccess,
      });
      return res.json({ success: true });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        errorMessage: error.message,
      });
    }
  },

  async requestAdminAccess(req, res) {
    try {
      assertCsrf(req);
      const bootstrap = await requireHumanSession(req);
      if (bootstrap.churchId !== req.params.churchId) {
        throw httpError(403, "This request does not match the current church.");
      }
      if (bootstrap.role === "admin") {
        throw httpError(400, "This account already has admin access.");
      }
      const church = await getChurchById(req.params.churchId);
      if (!church) {
        throw httpError(404, "Church not found");
      }
      if (church.status !== CHURCH_STATUS_NEEDS_ADMIN) {
        throw httpError(
          400,
          "Admin recovery is only available when the church needs an admin.",
        );
      }
      const rawToken = `${createNumericCode()}-${crypto.randomUUID()}`;
      const requestId = createId("recovery");
      const request = {
        requestId,
        churchId: church.churchId,
        requesterUid: bootstrap.user.uid,
        requesterEmail: bootstrap.user.email,
        status: "pending",
        tokenHash: hashValue(rawToken),
        createdAt: nowIso(),
        expiresAt: new Date(Date.now() + RECOVERY_TTL_MS).toISOString(),
        approvedAt: null,
        approvedBy: null,
      };
      await setDoc(COLLECTIONS.adminRecoveryRequests, requestId, request);
      if (church.recoveryEmail) {
        const recoveryLink = buildRecoveryUrl(rawToken);
        const adminRecoveryEmail = await renderAdminRecoveryRequestEmail({
          requesterEmail: bootstrap.user.email,
          churchName: church.name,
          recoveryUrl: recoveryLink,
        });
        await sendEmail({
          to: church.recoveryEmail,
          subject: "WorshipSync admin access requested",
          textBody: adminRecoveryEmail.text,
          htmlBody: adminRecoveryEmail.html,
          tags: {
            category: "admin_recovery_request",
            churchId: church.churchId,
            requestId,
            requesterUid: bootstrap.user.uid,
          },
        });
      }
      await addSecurityEvent({
        type: "admin_recovery_requested",
        churchId: church.churchId,
        userId: bootstrap.user.uid,
        requestId,
      });
      return res.json({ success: true, requestId });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        errorMessage: error.message,
      });
    }
  },

  async confirmRecovery(req, res) {
    try {
      enforceRateLimit({
        scope: "recovery-confirm",
        key: `${getClientIp(req)}:${hashValue(req.body?.token || "")}`,
        limit: 10,
        windowMs: 30 * 60 * 1000,
        blockMs: 30 * 60 * 1000,
      });
      const token = req.body?.token || "";
      if (!token) {
        throw httpError(400, "Recovery token is required.");
      }
      const request = await findDocByTokenHash(
        COLLECTIONS.adminRecoveryRequests,
        token,
      );
      if (!request || request.status !== "pending") {
        throw httpError(400, "This recovery request is not active.");
      }
      if (new Date(request.expiresAt).getTime() < Date.now()) {
        await setDoc(
          COLLECTIONS.adminRecoveryRequests,
          request.requestId,
          { status: "expired" },
          { merge: true },
        );
        throw httpError(400, "This recovery request has expired.");
      }
      await approveRecoveryRequest(request);
      await addSecurityEvent({
        type: "admin_recovery_approved",
        churchId: request.churchId,
        userId: request.requesterUid,
        requestId: request.requestId,
      });
      return res.json({ success: true, churchId: request.churchId });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        errorMessage: error.message,
      });
    }
  },

  async recoverAdmin(req, res) {
    try {
      enforceRateLimit({
        scope: "support-recover",
        key: `${getClientIp(req)}:${normalizeEmail(req.body?.email || "")}`,
        limit: 20,
        windowMs: 60 * 60 * 1000,
        blockMs: 60 * 60 * 1000,
      });

      const supportClaims = await verifySupportPrincipal(req);
      const church = await getChurchById(req.params.churchId);
      if (!church) {
        throw httpError(404, "Church not found");
      }
      const email = normalizeEmail(req.body?.email);
      if (!email) {
        throw httpError(400, "Email is required.");
      }

      let user = await getUserByEmail(email);
      if (!user) {
        const auth = requireFirebaseAdmin();
        const tempPassword = randomSecret(18);
        const created = await auth.createUser({
          email,
          password: tempPassword,
          displayName: String(req.body?.displayName || email).trim(),
        });
        user = await upsertUserProfile({
          uid: created.uid,
          email,
          displayName: created.displayName || email,
        });
      }

      await supportRecoverAdminMembership({
        churchId: req.params.churchId,
        userId: user.uid,
      });

      try {
        const auth = requireFirebaseAdmin();
        const resetLink = await auth.generatePasswordResetLink(email);
        const hostedResetUrl = buildResetUrlFromFirebaseLink(resetLink);
        const accountRestoredEmail = await renderAccountRestoredEmail({
          churchName: church.name,
          resetUrl: hostedResetUrl,
        });
        await sendEmail({
          to: email,
          subject: "Your WorshipSync account has been restored",
          textBody: accountRestoredEmail.text,
          htmlBody: accountRestoredEmail.html,
          tags: {
            category: "support_admin_recovered",
            churchId: req.params.churchId,
            userId: user.uid,
          },
        });
      } catch (error) {
        logAuthEvent("warn", "support-recover.reset-link.failed", {
          email,
          message: error.message,
        });
      }

      await addSecurityEvent({
        type: "support_admin_recovered",
        churchId: req.params.churchId,
        userId: user.uid,
        approvedBy: supportClaims.uid,
      });
      return res.json({ success: true });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        errorMessage: error.message,
      });
    }
  },

  async createWorkstationPairing(req, res) {
    try {
      assertCsrf(req);
      const admin = await requireAdminSession(req, req.params.churchId);
      enforceRateLimit({
        scope: "workstation-pairing-create",
        key: `${req.params.churchId}:${admin.user.uid}`,
        limit: 20,
        windowMs: 60 * 60 * 1000,
        blockMs: 60 * 60 * 1000,
      });
      const label = String(req.body?.label || "").trim();
      const appAccess = req.body?.appAccess || "view";
      const platformType = req.body?.platformType || "electron";
      if (!label) {
        throw httpError(400, "A workstation label is required.");
      }
      const rawToken = `${createNumericCode()}-${crypto.randomUUID()}`;
      const pairingId = createId("workstationPairing");
      const pairing = {
        pairingId,
        churchId: req.params.churchId,
        label,
        appAccess,
        platformType,
        tokenHash: hashValue(rawToken),
        status: "pending",
        expiresAt: new Date(Date.now() + PAIRING_TTL_MS).toISOString(),
        createdAt: nowIso(),
        createdByUid: admin.user.uid,
        redeemedAt: null,
        workstationDeviceId: null,
      };
      await setDoc(COLLECTIONS.workstationPairings, pairingId, pairing);
      await addSecurityEvent({
        type: "workstation_pairing_created",
        churchId: req.params.churchId,
        userId: admin.user.uid,
        pairingId,
      });
      return res.json({
        success: true,
        pairing: {
          ...sanitizePairingForClient(pairing),
          token: rawToken,
        },
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        errorMessage: error.message,
      });
    }
  },

  async redeemWorkstationPairing(req, res) {
    try {
      enforceRateLimit({
        scope: "workstation-redeem",
        key: `${getClientIp(req)}:${hashValue(req.body?.token || "")}`,
        limit: 10,
        windowMs: 30 * 60 * 1000,
        blockMs: 30 * 60 * 1000,
      });
      const token = req.body?.token || "";
      if (!token) {
        throw httpError(400, "Pairing token is required.");
      }
      const pairing = await findDocByTokenHash(
        COLLECTIONS.workstationPairings,
        token,
      );
      if (!pairing || pairing.status !== "pending") {
        throw httpError(400, "This workstation pairing code is not active.");
      }
      if (new Date(pairing.expiresAt).getTime() < Date.now()) {
        await setDoc(
          COLLECTIONS.workstationPairings,
          pairing.pairingId,
          { status: "expired" },
          { merge: true },
        );
        throw httpError(400, "This workstation pairing code has expired.");
      }

      const credential = crypto.randomUUID();
      const deviceId = createId("workstation");
      const workstation = {
        churchId: pairing.churchId,
        label: pairing.label,
        appAccess: pairing.appAccess,
        platformType: req.body?.platformType || pairing.platformType || "web",
        status: "active",
        credentialHash: hashValue(credential),
        createdAt: nowIso(),
        lastSeenAt: nowIso(),
        revokedAt: null,
        revokedBy: null,
        lastOperatorName: null,
      };
      await setDoc(COLLECTIONS.workstationDevices, deviceId, workstation);
      await setDoc(
        COLLECTIONS.workstationPairings,
        pairing.pairingId,
        {
          status: "redeemed",
          redeemedAt: nowIso(),
          workstationDeviceId: deviceId,
        },
        { merge: true },
      );

      const church = await getChurchById(pairing.churchId);
      if (req.body?.platformType === "web" && church) {
        const bootstrap = await establishWorkstationSession({
          req,
          church,
          workstation: { deviceId, ...workstation },
        });
        await addSecurityEvent({
          type: "workstation_pairing_redeemed",
          churchId: pairing.churchId,
          deviceId,
          mode: "session",
        });
        return res.json({
          success: true,
          sessionEstablished: true,
          bootstrap,
          device: sanitizeWorkstationDeviceForClient({
            deviceId,
            ...workstation,
          }),
        });
      }

      await addSecurityEvent({
        type: "workstation_pairing_redeemed",
        churchId: pairing.churchId,
        deviceId,
        mode: "credential",
      });
      return res.json({
        success: true,
        credential,
        device: sanitizeWorkstationDeviceForClient({
          deviceId,
          ...workstation,
        }),
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        errorMessage: error.message,
      });
    }
  },

  async listWorkstations(req, res) {
    try {
      await requireAdminSession(req, req.params.churchId);
      const workstations = await queryDocs(
        COLLECTIONS.workstationDevices,
        [{ field: "churchId", value: req.params.churchId }],
        { limit: 200 },
      );
      return res.json({
        success: true,
        workstations: workstations.map((item) =>
          sanitizeWorkstationDeviceForClient({ deviceId: item.id, ...item }),
        ),
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        errorMessage: error.message,
      });
    }
  },

  async revokeWorkstation(req, res) {
    try {
      assertCsrf(req);
      const admin = await requireAdminSession(req, req.params.churchId);
      const workstation = await getDoc(
        COLLECTIONS.workstationDevices,
        req.params.deviceId,
      );
      if (!workstation || workstation.churchId !== req.params.churchId) {
        throw httpError(404, "Workstation not found");
      }
      await setDoc(
        COLLECTIONS.workstationDevices,
        req.params.deviceId,
        {
          revokedAt: nowIso(),
          revokedBy: admin.user.uid,
          status: "revoked",
        },
        { merge: true },
      );
      await addSecurityEvent({
        type: "workstation_revoked",
        churchId: req.params.churchId,
        userId: admin.user.uid,
        deviceId: req.params.deviceId,
      });
      return res.json({ success: true });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        errorMessage: error.message,
      });
    }
  },

  async unlinkWorkstation(req, res) {
    try {
      if (req.session?.auth?.sessionKind === SESSION_KIND_WORKSTATION) {
        assertCsrf(req);
      }
      const workstation = await resolveAuthenticatedWorkstation(req);
      if (req.params.deviceId !== workstation.deviceId) {
        throw httpError(403, "That workstation is not available.");
      }
      const revokedAt = nowIso();
      await setDoc(
        COLLECTIONS.workstationDevices,
        workstation.deviceId,
        {
          lastOperatorName: null,
          lastSeenAt: revokedAt,
          revokedAt,
          revokedBy: null,
          status: "revoked",
        },
        { merge: true },
      );
      await addSecurityEvent({
        type: "workstation_unlinked",
        churchId: workstation.churchId,
        deviceId: workstation.deviceId,
      });
      if (
        req.session?.auth?.sessionKind === SESSION_KIND_WORKSTATION &&
        req.session.auth.deviceId === workstation.deviceId
      ) {
        await destroySession(req);
        res.clearCookie(sessionCookieName, {
          path: process.env.AUTH_COOKIE_PATH || "/",
          domain: process.env.AUTH_COOKIE_DOMAIN || undefined,
        });
      }
      return res.json({ success: true });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        errorMessage: error.message,
      });
    }
  },

  async updateWorkstationOperator(req, res) {
    try {
      if (req.session?.auth?.sessionKind === SESSION_KIND_WORKSTATION) {
        assertCsrf(req);
      }
      const workstation = await resolveAuthenticatedWorkstation(req);
      const operatorName = String(req.body?.operatorName || "").trim();
      const now = nowIso();
      if (operatorName) {
        await setDoc(
          COLLECTIONS.workstationDevices,
          workstation.deviceId,
          {
            lastOperatorName: operatorName,
            lastSeenAt: now,
          },
          { merge: true },
        );
      } else {
        await setDoc(
          COLLECTIONS.workstationDevices,
          workstation.deviceId,
          {
            lastOperatorName: null,
            lastSeenAt: now,
          },
          { merge: true },
        );
      }
      return res.json({
        success: true,
        workstation: sanitizeWorkstationDeviceForClient({
          ...workstation,
          lastOperatorName: operatorName || null,
          lastSeenAt: now,
        }),
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        errorMessage: error.message,
      });
    }
  },

  async createDisplayPairing(req, res) {
    try {
      assertCsrf(req);
      const admin = await requireAdminSession(req, req.params.churchId);
      enforceRateLimit({
        scope: "display-pairing-create",
        key: `${req.params.churchId}:${admin.user.uid}`,
        limit: 20,
        windowMs: 60 * 60 * 1000,
        blockMs: 60 * 60 * 1000,
      });
      const label = String(req.body?.label || "").trim();
      const surfaceType = req.body?.surfaceType || "display";
      if (!label) {
        throw httpError(400, "A display label is required.");
      }
      const rawToken = `${createNumericCode()}-${crypto.randomUUID()}`;
      const pairingId = createId("displayPairing");
      const pairing = {
        pairingId,
        churchId: req.params.churchId,
        label,
        surfaceType,
        tokenHash: hashValue(rawToken),
        status: "pending",
        expiresAt: new Date(Date.now() + PAIRING_TTL_MS).toISOString(),
        createdAt: nowIso(),
        createdByUid: admin.user.uid,
        redeemedAt: null,
        displayDeviceId: null,
      };
      await setDoc(COLLECTIONS.displayPairings, pairingId, pairing);
      await addSecurityEvent({
        type: "display_pairing_created",
        churchId: req.params.churchId,
        userId: admin.user.uid,
        pairingId,
      });
      return res.json({
        success: true,
        pairing: {
          ...sanitizePairingForClient(pairing),
          token: rawToken,
        },
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        errorMessage: error.message,
      });
    }
  },

  async sendPairingCodeEmail(req, res) {
    try {
      assertCsrf(req);
      const admin = await requireAdminSession(req, req.params.churchId);
      enforceRateLimit({
        scope: "pairing-code-email",
        key: `${req.params.churchId}:${admin.user.uid}`,
        limit: 40,
        windowMs: 60 * 60 * 1000,
        blockMs: 60 * 60 * 1000,
      });
      const kind = req.body?.kind;
      const token = String(req.body?.token || "");
      const to = req.body?.to;
      if (kind !== "workstation" && kind !== "display") {
        throw httpError(400, "Invalid pairing type.");
      }
      if (!token) {
        throw httpError(400, "Pairing token is required.");
      }
      const collection =
        kind === "workstation"
          ? COLLECTIONS.workstationPairings
          : COLLECTIONS.displayPairings;
      const pairing = await findDocByTokenHash(collection, token);
      if (!pairing || pairing.churchId !== req.params.churchId) {
        throw httpError(
          400,
          "That pairing code was not found for this church.",
        );
      }
      if (pairing.status !== "pending") {
        throw httpError(400, "This pairing code is no longer active.");
      }
      if (new Date(pairing.expiresAt).getTime() < Date.now()) {
        throw httpError(400, "This pairing code has expired.");
      }
      await sendPairingSetupEmailInternal({
        to,
        kind,
        label: pairing.label,
        token,
      });
      await addSecurityEvent({
        type: "pairing_code_emailed",
        churchId: req.params.churchId,
        userId: admin.user.uid,
        pairingId: pairing.pairingId,
      });
      return res.json({ success: true });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        errorMessage: error.message,
      });
    }
  },

  async redeemDisplayPairing(req, res) {
    try {
      enforceRateLimit({
        scope: "display-redeem",
        key: `${getClientIp(req)}:${hashValue(req.body?.token || "")}`,
        limit: 10,
        windowMs: 30 * 60 * 1000,
        blockMs: 30 * 60 * 1000,
      });
      const token = req.body?.token || "";
      if (!token) {
        throw httpError(400, "Pairing token is required.");
      }
      const pairing = await findDocByTokenHash(
        COLLECTIONS.displayPairings,
        token,
      );
      if (!pairing || pairing.status !== "pending") {
        throw httpError(400, "This display pairing code is not active.");
      }
      if (new Date(pairing.expiresAt).getTime() < Date.now()) {
        await setDoc(
          COLLECTIONS.displayPairings,
          pairing.pairingId,
          { status: "expired" },
          { merge: true },
        );
        throw httpError(400, "This display pairing code has expired.");
      }
      const credential = crypto.randomUUID();
      const deviceId = createId("display");
      const display = {
        churchId: pairing.churchId,
        label: pairing.label,
        surfaceType: pairing.surfaceType,
        status: "active",
        credentialHash: hashValue(credential),
        createdAt: nowIso(),
        lastSeenAt: nowIso(),
        revokedAt: null,
        revokedBy: null,
      };
      await setDoc(COLLECTIONS.displayDevices, deviceId, display);
      await setDoc(
        COLLECTIONS.displayPairings,
        pairing.pairingId,
        {
          status: "redeemed",
          redeemedAt: nowIso(),
          displayDeviceId: deviceId,
        },
        { merge: true },
      );
      await addSecurityEvent({
        type: "display_pairing_redeemed",
        churchId: pairing.churchId,
        deviceId,
      });
      return res.json({
        success: true,
        credential,
        device: sanitizeDisplayDeviceForClient({ deviceId, ...display }),
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        errorMessage: error.message,
      });
    }
  },

  async listDisplayDevices(req, res) {
    try {
      await requireAdminSession(req, req.params.churchId);
      const displayDevices = await queryDocs(
        COLLECTIONS.displayDevices,
        [{ field: "churchId", value: req.params.churchId }],
        { limit: 200 },
      );
      return res.json({
        success: true,
        displayDevices: displayDevices.map((item) =>
          sanitizeDisplayDeviceForClient({ deviceId: item.id, ...item }),
        ),
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        errorMessage: error.message,
      });
    }
  },

  async revokeDisplayDevice(req, res) {
    try {
      assertCsrf(req);
      const admin = await requireAdminSession(req, req.params.churchId);
      const display = await getDoc(
        COLLECTIONS.displayDevices,
        req.params.deviceId,
      );
      if (!display || display.churchId !== req.params.churchId) {
        throw httpError(404, "Display not found");
      }
      await setDoc(
        COLLECTIONS.displayDevices,
        req.params.deviceId,
        {
          revokedAt: nowIso(),
          revokedBy: admin.user.uid,
          status: "revoked",
        },
        { merge: true },
      );
      await addSecurityEvent({
        type: "display_revoked",
        churchId: req.params.churchId,
        userId: admin.user.uid,
        deviceId: req.params.deviceId,
      });
      return res.json({ success: true });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        errorMessage: error.message,
      });
    }
  },
};
