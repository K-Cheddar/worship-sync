import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { getFirestore } from "firebase-admin/firestore";

let runtime;
let runtimeLoaded = false;

/** Service account keys in .env are often one line with literal \n. */
const normalizePrivateKey = (raw) => {
  if (raw == null || String(raw).trim() === "") return null;
  let key = String(raw).trim().replace(/^\uFEFF/, "");
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1);
  }
  return key.replace(/\\n/g, "\n").replace(/\r\n/g, "\n");
};

/** Lazily share the app's Firebase Admin initialization with server-side tools. */
export const getFirebaseAdminRuntime = ({ onInvalidCredentials } = {}) => {
  if (runtimeLoaded) return runtime;
  runtimeLoaded = true;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);
  if (!projectId || !clientEmail || !privateKey) {
    runtime = null;
    return runtime;
  }

  let credential;
  try {
    credential = cert({ projectId, clientEmail, privateKey });
  } catch (error) {
    onInvalidCredentials?.(error);
    runtime = null;
    return runtime;
  }

  const databaseURL =
    process.env.FIREBASE_DATABASE_URL ||
    process.env.VITE_FIREBASE_DATABASE_URL ||
    undefined;
  const app =
    getApps()[0] ||
    initializeApp({ credential, ...(databaseURL ? { databaseURL } : {}) });
  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });
  const rtdb = databaseURL ? getDatabase(app) : null;
  runtime = { auth: getAuth(app), db, rtdb };
  return runtime;
};
